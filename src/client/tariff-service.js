/**
 * 余额徽章 —— 时段看门狗（高峰 / 空闲切换的检测与提醒）。
 *
 * ## 为什么需要一个「看门狗」而不是每条渲染自己算
 * 时段判定本身是纯函数，谁都能算；难的是**记住上一次是什么时段**，并且这个记忆
 * 必须跨会话存活。而本插件唯一跨会话的入口是 `shell.overlay`（root 作用域），
 * 徽章挂在 `conversation.composer.dock`（session 作用域）—— 切换会话会把徽章
 * 连同它 ref 里的状态一起卸载重挂。v1.2 的余额提醒就是因此被搬到浮层上的，
 * 时段提醒同理：不然每次切会话都会重新「首次观测」，提醒会被无声吞掉。
 *
 * 因此这里把「算快照 + 推状态机 + 写共享卡片仓库」收成一个小服务：
 *  - 由 `shell.overlay` 的提醒宿主每 30 秒 tick 一次（也由它负责在设置变化时 tick）；
 *  - 由徽章侧按需 `snapshot()` 取展示数据（同一份计算，不重复实现）。
 *
 * 30 秒的粒度够用：时段的切换点都是整点，而倒计时的「走字」由组件层的秒级
 * 计时器负责，与这里无关。
 */

import { createAlertStore } from './alert.js'
import { pricingSnapshot } from './pricing.js'
import { advanceTariffAlert, createTariffAlertState } from './tariff-alert.js'

/** tick 的最小间隔：时段边界都是整点，30 秒的检测粒度绰绰有余。 */
export const TARIFF_TICK_MS = 30000

/**
 * 两次 tick 之间允许的**真实时钟**前进上限。
 *
 * 超过它就意味着「不是正常的一拍」：机器刚从休眠醒来、NTP 把表校了、或者后台
 * 标签页被节流到几分钟才跑一次。这些情况下时钟可能已经跨过一个甚至多个时段边界，
 * 而 v1.3 的实现只在「React 依赖变化」时重算，于是这类跨档被**静默漏掉** ——
 * 真实 GUI 验证台正是因此报出「进入空闲方向的提醒卡 75 秒内一张都没有」。
 *
 * 取 2 倍 tick 间隔：正常抖动（定时器 ±几十毫秒、事件循环繁忙）远达不到它，
 * 而任何一次真实的跳变都会远超它。
 */
export const TARIFF_MAX_GAP_MS = TARIFF_TICK_MS * 2

/**
 * 组装时段看门狗。
 *
 * @param options - `{alerts, now}`：
 *   `alerts` 是共享的当前卡片仓库（与余额提醒共用，宿主浮层只放一张卡）；
 *   `now` 可注入，便于测试给定时刻。
 * @returns 见下方各方法；所有方法都不抛错 —— 它接在每次渲染与定时器上。
 */
export function createTariffWatcher(options) {
  const alerts = options?.alerts ?? createAlertStore()
  /** 提醒状态机（跨会话存活的关键：它住在这里，不住在组件 ref 里）。 */
  let alertState = createTariffAlertState()
  /** 最近一次快照；从未 tick 过时为 null。 */
  let last = null
  /** 最近一次 tick 的**真实时钟**读数；从未 tick 时为 0。 */
  let lastTickAt = 0
  /** 最近一次计算出的漂移；用于诊断与自愈判据。 */
  let lastDrift = { gapMs: 0, jumped: false }
  const readNow = typeof options?.now === 'function' ? options.now : () => Date.now()

  /**
   * 把调用方给的时刻归一。
   *
   * v1.4 修订：`input.now` 为有限数时**优先**使用。v1.3 里 `snapshot()` 只认
   * `input.now`，而 `tick()` 又会自己再算一次，两套口径在同一个函数里并存 ——
   * 验证台注入时钟时，`snapshot` 走注入值、`readNow()` 走真实值，读数就对不上了。
   *
   * @param value - 调用方传入的 `now`（可能是 undefined / NaN / 字符串）。
   * @returns epoch 毫秒。
   */
  function resolveNow(value) {
    const parsed = Number(value)
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(parsed)) return parsed
    return Number(readNow())
  }

  /**
   * 取当前时段快照（不推进提醒状态机）。
   *
   * `balance` / `ratePerHour` 只用于峰谷预估：余额给不出时快照里的
   * `remainingMs` / `offPeakRemainingMs` 为 null，界面必须能接受这一点。
   *
   * @param input - `{settings, balance, ratePerHour, now}`。
   */
  function snapshot(input) {
    const settings = input?.settings ?? {}
    return pricingSnapshot({
      now: resolveNow(input?.now),
      modelKey: settings.tariffModel,
      balance: input?.balance,
      ratePerHour: input?.ratePerHour
    })
  }

  /**
   * 推进一次：算快照、喂给状态机、必要时把卡片写进共享仓库。
   *
   * v1.4 起它会记录**真实时钟的漂移**（`drift()`）。关键是：漂移只用于判据与诊断，
   * **不改变状态机的推进** —— 时钟跳变恰恰意味着「可能已经跨过了一个或多个时段
   * 边界」，必须照常喂给 `advanceTariffAlert`（它只比较「上次的时段」与「现在的
   * 时段」，跳变不会让它算错，只会让它看到一次真实的跨档）。这正是自愈的含义：
   * 跳变之后的**第一拍**就产出正确的卡片。
   *
   * @param input - `{settings, balance, ratePerHour, now}`。
   * @returns 本次快照（调用方可以直接拿去渲染）。
   */
  function tick(input) {
    const settings = input?.settings ?? {}
    const now = resolveNow(input?.now)
    const current = snapshot({ ...input, settings, now })
    const outcome = advanceTariffAlert(
      alertState,
      {
        period: current.period,
        at: current.now,
        model: current.model?.label ?? '',
        outputPrice: current.isPeak
          ? current.model?.peak?.output
          : current.model?.offPeak?.output,
        // 提醒正文里的「可以留到 {time} 之后」需要一个确切的时刻：
        // 进入高峰时指的是下一个空闲时段，进入空闲时指的是下一个高峰。
        nextAt: current.isPeak ? current.nextOffPeakAt : current.nextPeakAt
      },
      { muted: settings.alertOnTariff !== true }
    )
    alertState = outcome.state
    if (outcome.alert !== null) alerts.set(outcome.alert)
    last = current
    // 漂移用**真实时钟**度量，与 current.now（可能来自注入）分开：
    // 调度看的是「这一拍实际隔了多久」，与「业务上认为现在几点」是两件事。
    const realNow = Number(readNow())
    lastDrift = lastTickAt === 0
      ? { gapMs: 0, jumped: false }
      : { gapMs: realNow - lastTickAt, jumped: realNow - lastTickAt > TARIFF_MAX_GAP_MS }
    lastTickAt = realNow
    return current
  }

  /**
   * 下一次唤醒还应等多久（毫秒，落在 `[0, TARIFF_TICK_MS]`）。
   *
   * 为什么需要它：固定 30 秒一拍会让提醒最多迟到 30 秒，而时段边界是**整点**、
   * 完全可以预知。对齐到边界那一拍既让卡片准时，又不会更费 CPU（间隔只减不增）。
   *
   * 已经到/过了边界时返回 **0**：调用方应立刻再 tick 一次，把刚刚跨过的那次切换
   * 当成一次正常切换处理 —— 这是 D1 自愈路径的另一半（除了跳变当拍，还要能
   * 「补上错过的边界」）。
   *
   * @param input - 同 `tick`。
   * @returns 毫秒；拿不到边界时退回 `TARIFF_TICK_MS`。
   */
  function nextTickDelay(input) {
    try {
      const current = snapshot(input)
      const boundary = Number(current?.nextChangeAt)
      if (!Number.isFinite(boundary)) return TARIFF_TICK_MS
      const distance = boundary - current.now
      if (distance <= 0) return 0
      if (distance <= TARIFF_TICK_MS) return distance
      return TARIFF_TICK_MS
    } catch {
      return TARIFF_TICK_MS
    }
  }

  return {
    tick,
    snapshot,
    nextTickDelay,
    /** 最近一次 tick 的快照（从未 tick 时 null）。 */
    latest: () => last,
    /** 当前提醒状态机的只读快照（诊断与测试用）。 */
    state: () => alertState,
    /** 最近一次 tick 的真实时钟读数（从未 tick 时为 0）。 */
    lastTickAt: () => lastTickAt,
    /**
     * 最近两拍之间的真实时钟漂移。
     *
     * `jumped` 为真说明这一拍之前发生过休眠 / 校时 / 长时间节流 ——
     * 验证台用它断言「自愈确实被触发过」，而不是靠观察卡片猜。
     */
    drift: () => lastDrift
  }
}
