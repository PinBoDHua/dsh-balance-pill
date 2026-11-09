/**
 * 余额徽章 —— 延迟合并写盘（审计 P2-7 / P2-8）。
 *
 * ## 为什么需要这一层
 * 余额每成功读取一次，徽章就要把历史样本与会话基准写回 `localStorage`。旧实现
 * 有两个问题：
 *
 *  1. **每次轮询固定两次同步写盘**（P2-8）：历史与基准各一次 `JSON.stringify`
 *     + `setItem`，即便内容与上一次完全相同；`localStorage` 是同步 API，写在
 *     渲染线程上。
 *  2. **整份覆写**（P2-7）：历史数组在组件 ref 里，写回时不看存储里已有什么；
 *     同时开两个窗口（或 Web + 桌面端）时，后写的窗口会覆盖另一个窗口采集的
 *     样本 —— 用户会看到「历史缺段」「今日已用突然变小」。
 *
 * 这一层把写盘收敛成「排队 → 合并 → 差异检测 → 一次写入」：
 *
 *  - 调用方给出 `merge(rawText, value)`，flush 时**重新从存储读**再合并，
 *    因此另一个窗口刚写进去的样本不会被覆盖；
 *  - 同一枚键在延迟窗口内多次排队只保留最后一次，写入合并成一次；
 *  - 合并结果与存储里的字符串完全相同时**不写**（P2-8 的差异检测）；
 *  - 默认延迟 3 秒（`WRITE_COALESCE_MS`），落在调度器的空闲回调里；
 *    页面隐藏 / 卸载时调用方调 `flush()` 立即落盘。
 *
 * 不直接使用 `requestIdleCallback`：Safari 长期没有它，而 `setTimeout` 在这里
 * 的语义（延迟合并）已经足够；`requestIdleCallback` 的 50 ms 预算对一次
 * `setItem` 也没有实际收益。
 */

/** 写盘合并窗口：3 秒内的多次排队合并成一次写入。 */
export const WRITE_COALESCE_MS = 3000

/**
 * 创建一个合并写盘器。
 *
 * @param options - `{storage, delayMs, schedule, cancel, now}`：
 *   - `storage`：形如 `localStorage` 的对象（必须有 `getItem` / `setItem`）；
 *   - `delayMs`：合并窗口，缺省 `WRITE_COALESCE_MS`；
 *   - `schedule` / `cancel`：便于测试注入的定时器，缺省 `setTimeout` / `clearTimeout`。
 * @returns `{queue, flush, dispose, pending, stats}`：
 *   - `queue(key, value, merge)`：排队一次写入；`merge(rawText, value)` 返回合并后的值；
 *   - `flush()`：立即写盘，返回实际写入的键数；
 *   - `dispose()`：flush 后停止接收新写入；
 *   - `pending()`：仍在队列里的键数；
 *   - `stats()`：`{queued, written, skipped, failed}`，供测试与诊断。
 */
export function createStorageWriter(options = {}) {
  const storage = options.storage
  const delayMs = Number.isFinite(options.delayMs) ? Math.max(0, options.delayMs) : WRITE_COALESCE_MS
  const schedule = typeof options.schedule === 'function'
    ? options.schedule
    : (fn, ms) => setTimeout(fn, ms)
  const cancel = typeof options.cancel === 'function'
    ? options.cancel
    : (handle) => clearTimeout(handle)

  /** key → {value, merge}；Map 的插入顺序就是 flush 的顺序。 */
  const pending = new Map()
  let timer = null
  let disposed = false
  const stats = { queued: 0, written: 0, skipped: 0, failed: 0 }

  const clearTimer = () => {
    if (timer === null) return
    cancel(timer)
    timer = null
  }

  /**
   * 把队列里的写入落到存储。
   * @returns 实际写入了几个键。
   */
  const flush = () => {
    clearTimer()
    if (pending.size === 0) return 0
    const batch = [...pending.entries()]
    pending.clear()
    if (disposed === true) return 0
    if (storage === undefined || storage === null) return 0
    let written = 0
    for (const [key, entry] of batch) {
      try {
        const raw = storage.getItem(key)
        const merged = typeof entry.merge === 'function' ? entry.merge(raw, entry.value) : entry.value
        const text = JSON.stringify(merged)
        // 差异检测（P2-8）：与存储里的内容逐字节相同就不写。
        if (raw === text) {
          stats.skipped += 1
          continue
        }
        storage.setItem(key, text)
        stats.written += 1
        written += 1
      } catch {
        // 配额不足 / 隐私模式：历史不是关键路径，丢掉这一批而不是反复重试。
        stats.failed += 1
      }
    }
    return written
  }

  const arm = () => {
    if (timer !== null) return
    timer = schedule(() => {
      timer = null
      flush()
    }, delayMs)
  }

  return {
    queue(key, value, merge) {
      if (disposed === true) return
      if (typeof key !== 'string' || key === '') return
      pending.set(key, { value, merge })
      stats.queued += 1
      arm()
    },
    flush,
    dispose() {
      if (disposed === true) return
      flush()
      disposed = true
    },
    pending() {
      return pending.size
    },
    stats() {
      return { ...stats }
    }
  }
}
