/**
 * 余额徽章 —— 最近一次成功读数的共享槽位。
 *
 * ## 为什么需要它
 * 会话作用域的徽章与 root 作用域的时段看门狗（见 tariff-service.js）都要用到
 * 「余额现在是多少」。看门狗没法自己去读账号 —— 那会让同一个 Remote 被两处
 * 独立轮询，两边的数字还可能相差一个轮询周期 —— 于是让徽章把成功读数写进这个
 * 极薄的槽位，看门狗读它。
 *
 * 它是**只读快照 + 写入端**的共享状态，不参与 React 渲染：没有订阅者，也就不会
 * 引起额外重渲染。历史（history.js）记录的是采样点序列，而这里是「最后一条」，
 * 两者用途不同，因此不合并。
 */

/** 槽位内容：`{amount, currency, at, perHour}`；从未读到过时为 null。 */
let latest = null

/**
 * 记录一次成功读数。
 * @param reading - `{amount, currency, at, perHour}`；`amount` 非法时忽略本次写入。
 */
export function recordReading(reading) {
  if (reading === null || reading === undefined) return
  const amount = Number(reading.amount)
  if (!Number.isFinite(amount)) return
  const perHour = Number(reading.perHour)
  latest = {
    amount,
    currency: typeof reading.currency === 'string' ? reading.currency : '',
    at: Number.isFinite(Number(reading.at)) ? Number(reading.at) : Date.now(),
    /** 消耗速度（元/小时）；未知或非正数时为 null（与 balance.js 的口径一致）。 */
    perHour: Number.isFinite(perHour) && perHour > 0 ? perHour : null
  }
}

/** 当前槽位内容（只读快照）；从未写入时为 null。 */
export function latestReading() {
  return latest
}

/**
 * 清空槽位。
 *
 * 只在单测里用：模块级状态会跨用例泄漏，测试必须能重置它。
 * 生产代码里余额只会因为「换账号」而失效，而那时下一次轮询会立刻覆盖它。
 */
export function resetReading() {
  latest = null
}
