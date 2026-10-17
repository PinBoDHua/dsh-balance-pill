/**
 * 余额徽章 —— 时段切换提醒（纯逻辑）。
 *
 * 计费时段每小时都在换：高峰（北京时间工作日 9:00–12:00、14:00–18:00）的输出单价
 * 是空闲时段的两倍。用户改不了价格表，但可以决定「这活现在跑，还是等一会儿」——
 * 提醒的价值恰好在**切换的那一刻**：高峰开始时说「现在贵了」，空闲开始时说「现在便宜了」。
 *
 * 与余额跨档提醒（alert.js）不同，时段是**周期性**的：每个工作日至少切四次，
 * 周末与节假日还会整天停在空闲。所以不能照搬「档位一变差就提醒」那套 ——
 * 那样一天要弹很多张卡。这里的三道闸门是：
 *  - 只在**跨越边界**时提醒（时段没变就一声不吭）；
 *  - 每个方向**每小时最多一次**（`DEFAULT_TARIFF_COOLDOWN_MS`）；
 *  - 首次观测只记录（页面打开时本来就在高峰里，弹「你刚进入高峰」是假消息）。
 *
 * 状态不可变，函数就是「旧状态 + 新读数 → 新状态 + 是否提醒」，
 * 因此可以直接在 Node 里单测；这个文件不认识价格表、也不需要任何 UI 运行时。
 */

/**
 * 时段的合法取值。
 *
 * 特意用带前缀的常量名：拼接式构建把所有模块拼进同一个函数作用域，
 * `PERIODS` 已经被 pricing.js 占用了，重名会让构建直接失败（这是构建脚本
 * 特意拦的经典坑）。
 */
const TARIFF_PERIODS = ['peak', 'off-peak']

/** 触发提醒后，每个方向至少间隔这么久才允许下一次（毫秒）：一小时。 */
export const DEFAULT_TARIFF_COOLDOWN_MS = 60 * 60 * 1000

/**
 * 初始状态：还没有观测过任何时段，也还没有提醒过。
 *
 * v1.5 起 `alertedAt` 按方向分账（`alertedAtPeak` / `alertedAtOffPeak`）：
 * 单一时间戳会让 11:30 的「进入高峰」卡把 12:00 的「进入空闲」卡堵在冷却里，
 * 而后者恰恰是用户最想看到的「现在便宜了」。
 * 旧字段 `alertedAt` 仍保留在状态里（向后兼容），但不再参与判定。
 */
export function createTariffAlertState() {
  return { period: null, alertedAt: 0, alertedAtPeak: 0, alertedAtOffPeak: 0, seq: 0 }
}

/**
 * 读一个时段值；不认识的一律当「没读到」。
 *
 * 不把非法值折成 'peak' 或 'off-peak'：折了就等于替调用方猜了一个时段，
 * 卡片会说反话（高峰时说「单价降为一半」）。宁可什么都不做。
 */
function tariffPeriodOf(value) {
  return typeof value === 'string' && TARIFF_PERIODS.includes(value) ? value : null
}

/**
 * 冷却时长归一。
 *
 * 非有限值（缺省、`'abc'`、NaN）回落到默认一小时；负值等于「没有冷却」，
 * 显式归零而不是留给 `at - alertedAt < 负数` 恒假这种要靠推敲才看得懂的写法。
 */
function tariffCooldownOf(value) {
  const ms = Number(value)
  if (!Number.isFinite(ms)) return DEFAULT_TARIFF_COOLDOWN_MS
  return ms > 0 ? ms : 0
}

/**
 * 把读数里的时间戳归一成 epoch 毫秒，取不到就用 `fallback`。
 *
 * 不走 `Number.isFinite(Number(x))` 那种隐式转换：`Number(null)` 与 `Number('')`
 * 都是 0，会把「缺省」悄悄变成 1970 年，而 0 在本状态机里又是「从未提醒」的哨兵。
 */
function tariffEpochOf(value, fallback) {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return fallback
}

/**
 * 下一次时段边界：只接受**正的有限数**，其余给 null。
 *
 * 0 与负数不是「一个很早的时间」，而是「算不出来」：epoch 0 是 1970 年，
 * 一旦放行，卡片会显示「不急的活可以留到 08:00 之后」这种看着很真、其实是假的时间。
 * 卡片拿到 null 时显示 `--`，这是全插件对「未知时间」的统一写法。
 */
function tariffNextAtOf(value) {
  const at = tariffEpochOf(value, null)
  return at !== null && at > 0 ? at : null
}

/**
 * 输出单价：正的有限数之外都给 null。
 *
 * 价格表里的输出单价都明显大于 0（4 / 8 / 13.5 / 27），所以 0 与负值只可能是
 * 「没给」，不是「免费」。同样不能用 `Number(null)` 隐式转换 —— 那会得到 0。
 */
function tariffPriceOf(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null
}

/**
 * 用一次时段读数推进提醒状态机。
 *
 * @param state - 上一次的状态（`createTariffAlertState()` 起手）。
 * @param input - `{period, at, model, outputPrice, nextAt}`：
 *   `period` 来自 pricing.js 的当前时段；`at` 是这次读数的时间；
 *   `model` 是价格口径的**展示名**（`MODELS[].label`，如 `'deepseek-flash'`）；
 *   `outputPrice` 是当前时段的输出单价（元 / 百万 tokens）；`nextAt` 是下一次边界。
 * @param options - `{muted, cooldownMs}`；`muted` 为真时仍然推进状态但不产出提醒
 *   （用户关掉了提醒；等他打开时不该补一叠他不想看的旧切换）。静音判定排在冷却**之前**：
 *   没打算打扰用户的一次切换，不该被「防打扰」的冷却窗口挡在门外。
 * @returns `{state, alert}`：`alert` 为 null 表示本次不提醒，否则是契约冻结的
 *   `{kind:'tariff', period, model, outputPrice, nextAt, at, seq}`。
 */
export function advanceTariffAlert(state, input, options) {
  const current = state ?? createTariffAlertState()
  if (input === null || input === undefined) return { state: current, alert: null }

  const period = tariffPeriodOf(input.period)
  // 读不到合法时段就原地不动。若把它当成一次「观测」推进下去，
  // 下一次合法读数会被误判成首次观测，白白丢掉一次真实的切换。
  if (period === null) return { state: current, alert: null }

  const at = tariffEpochOf(input.at, Date.now())
  const muted = options?.muted === true
  const cooldownMs = tariffCooldownOf(options?.cooldownMs)
  // 旧时段读不出来（首次观测，或状态被外部写坏）时按「首次观测」处理：
  // 宁可不提醒，也不要拿 undefined 去比出一次假切换。
  const previousPeriod = tariffPeriodOf(current.period)

  // 规则 1：首次观测只记录不提醒。页面打开时可能已经在高峰里待了两小时，
  // 那不是「刚进入高峰」；面板上的时段徽标已经说明了现状。
  if (previousPeriod === null) return { state: { ...current, period }, alert: null }

  // 规则 2：时段没变不提醒。这里连对象都不重建 —— 状态里没有随时间变化的字段，
  // 返回同一个引用能让下游（共享 store 的 set / 视图层的重渲染）直接跳过。
  if (previousPeriod === period) return { state: current, alert: null }

  // 静音（契约规则 4）：推进状态，但不产出提醒。判定必须排在冷却**之前** ——
  // 冷却的意义是「别连续打扰」，而静音时根本不存在打扰：让静音去走冷却分支，
  // 等于用一个「防打扰」的闸门去挡一次「不打扰」的状态推进，结果是插件连
  // 「现在是什么时段」都没跟上（state.period 停在旧值），而那正是判断下一次切换
  // 的唯一依据 —— 取消静音后的第一次切换会被误判成「首次观测」而静默丢弃，
  // 用户等了半天也等不到卡。
  //
  // 这里**不推进 alertedAt**：没有真正提醒过就不该占用冷却窗口（契约规则 6）。
  // 推进 period 是刻意的：取消静音后不补一叠静音期间发生的旧切换。
  if (muted) return { state: { ...current, period }, alert: null }

  // 冷却（契约规则 3）：距上次**同方向**真正提醒还不到窗口 → **原样返回旧 state，
  // 绝不推进 period**。这是 v1.2 用真实缺陷换来的教训：一旦在这里把 period 推进了，
  // 这次切换就被永久吞掉，用户再也等不到补上的那张卡。保持旧 period，下一次读数
  // 依旧会看到「变了」，冷却一过自然补上。
  //
  // v1.5 修订：冷却按**方向**分账。v1.4 及更早用单一 `alertedAt`：
  // 11:30 提醒了「进入高峰」，12:00 的「进入空闲」就被同一窗口挡掉 ——
  // 而「现在便宜了」恰恰是用户最想看到的卡。现在 `alertedAtPeak` 与
  // `alertedAtOffPeak` 各走各的冷却，一个方向提醒不影响另一个方向。
  //
  // 契约规则 6：计时从上次**真正提醒**算起，而不是从上次读数算起 ——
  // 否则页面刚打开的那次观测就把冷却窗口用掉了，用户在第一个小时内遇到的
  // 第一次切换会被无声吞掉，而那恰恰是最该提醒的一次。
  const lastAlertedAt = period === 'peak'
    ? (Number(current.alertedAtPeak) || 0)
    : (Number(current.alertedAtOffPeak) || 0)
  if (lastAlertedAt !== 0 && at - lastAlertedAt < cooldownMs) return { state: current, alert: null }

  const seq = (Number(current.seq) || 0) + 1
  // 只推进本方向的时间戳；另一方向的冷却不受这次提醒影响。
  const nextAlerted = period === 'peak'
    ? { alertedAtPeak: at }
    : { alertedAtOffPeak: at }
  return {
    // `alertedAt` 保留为「最近一次任何方向的提醒」供旧代码读，不再参与判定。
    state: { ...current, ...nextAlerted, period, alertedAt: at, seq },
    alert: {
      kind: 'tariff',
      period,
      // 展示名原样透传：这个状态机不认识价格表，也不该 import pricing.js，
      // 否则纯逻辑模块就被拖上了价格表这层依赖。
      model: typeof input.model === 'string' ? input.model.trim() : '',
      outputPrice: tariffPriceOf(input.outputPrice),
      // 契约规则 5：边界算不出来就给 null，渲染层必须接得住（卡片显示 `--`）。
      nextAt: tariffNextAtOf(input.nextAt),
      at,
      // 自增序号：渲染方拿它当列表 key 与淡出计时基准，同一张卡重新出现时
      // 计时从头开始，而不是被当成同一次提醒沿用旧计时器。
      seq
    }
  }
}
