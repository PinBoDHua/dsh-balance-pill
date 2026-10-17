/**
 * 余额徽章 —— 余额跨档提醒（纯逻辑）。
 *
 * 徽章一直在状态行里，但用户不会一直看它。真正会让人被动的是「余额掉到快没了」
 * 这一刻 —— 提醒必须发生在**跨档的瞬间**，而不是每次轮询都喊一遍。
 *
 * 因此这里是一个小的状态机：
 *  - 只在档位**变差**（ok→warn、warn→low、ok→low）时触发；
 *  - 触发一次后进入「已提醒」状态，直到档位**回升**才重新武装 ——
 *    这样余额在阈值附近抖动不会连环弹提示；
 *  - 首次观测不触发：页面刚打开时就已经是红色，说明它在你打开之前就红了，
 *    这时候弹窗只是噪音（面板上的红色徽章已经说明了）；
 *  - 冷却时间是第二道保险，挡住「充一点又花掉」这种快速往复。
 *
 * 状态是不可变对象，所有函数都是「旧状态 + 新读数 → 新状态 + 是否触发」，
 * 因此可以直接在 Node 里单测。
 */

/** 档位的严重程度；数值越大越糟。 */
const RANK = { ok: 0, warn: 1, low: 2 }

/** 触发提醒后，至少间隔这么久才允许下一次（毫秒）。 */
export const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000

/**
 * 初始状态：还没有观测过任何档位。
 *
 * `configKey` 记录这次档位是按哪套「口径 + 阈值 + 币种」算出来的。它不是
 * 渲染字段，只用于区分「余额真的掉了」与「用户改了显示口径」—— 后者会让
 * 金额与档位同时跳变，旧实现会把它当成一次真实的掉档并弹出「余额不足」。
 */
export function createAlertState() {
  return { level: null, alertedLevel: null, at: 0, alertedAt: 0, seq: 0, amount: null, configKey: null }
}

/** 档位是否比另一个更糟。 */
export function isWorse(level, than) {
  if (than === null || than === undefined) return false
  return (RANK[level] ?? 0) > (RANK[than] ?? 0)
}

/**
 * 用一次读数推进提醒状态机。
 *
 * @param state - 上一次的状态（`createAlertState()` 起手）。
 * @param reading - `{level, amount, currency, at, configKey}`：
 *   `level` 是视图模型给出的档位，`amount` 是触发时展示用的金额；
 *   `configKey` 可选，标识「口径 + 阈值 + 币种」，用于区分改配置与真掉档。
 * @param options - `{cooldownMs, muted}`；`muted` 为真时仍然推进状态但不触发
 *   （用户关掉了提醒，但等他打开时不应该补一串旧提醒）。
 * @returns `{state, alert}`：新状态；`alert` 为 null 表示本次不提醒，
 *   否则是 `{level, amount, currency, at, from}`。
 */
export function advanceAlert(state, reading, options) {
  const current = state ?? createAlertState()
  if (reading === null || reading === undefined) return { state: current, alert: null }
  const level = typeof reading.level === 'string' && RANK[reading.level] !== undefined ? reading.level : 'ok'
  const at = Number.isFinite(Number(reading.at)) ? Number(reading.at) : Date.now()
  const cooldownMs = Number.isFinite(Number(options?.cooldownMs)) ? Number(options.cooldownMs) : DEFAULT_COOLDOWN_MS
  const muted = options?.muted === true
  const amount = Number.isFinite(Number(reading.amount)) ? Number(reading.amount) : null
  const configKey = typeof reading.configKey === 'string' && reading.configKey !== '' ? reading.configKey : null

  const previousLevel = current.level
  const previousConfigKey = typeof current.configKey === 'string' && current.configKey !== '' ? current.configKey : null
  const next = { ...current, level, amount, configKey: configKey ?? previousConfigKey }

  // 首次观测：只记录，不提醒。
  if (previousLevel === null) return { state: { ...next, at }, alert: null }

  /**
   * 显示口径 / 阈值 / 币种变了，不该当成「余额掉档」。
   *
   * v0.1.6 新增 `configKey` 显式判定。v1.5 及更早只看「金额有没有变」：
   * 把徽章数字从「可用合计」切到「仅充值」时金额会变小、档位会从 ok 跳到 low，
   * 于是下一次轮询弹出一张「余额不足」—— 用户只是换了个显示口径，余额一分没少。
   * 配置变化时静默跟随档位，并把当前档位记成「已提醒」，避免下一拍补弹。
   */
  if (previousConfigKey !== null && configKey !== null && previousConfigKey !== configKey) {
    return { state: { ...next, at, alertedLevel: level }, alert: null }
  }

  /**
   * 阈值被改动时不该当成「余额掉档」。
   *
   * 档位由「余额」与「阈值」共同决定：用户把红色阈值从 ¥3 调到 ¥50 的那一瞬间，
   * 档位会从 ok 跳到 low，但余额一分钱没动 —— 这时候弹「余额不足」是错的，
   * 用户自己刚刚才把线画在那里。判定方式是看**金额有没有变**：
   * 档位变了而金额没变，说明是定义变了，不是余额变了，于是只跟随档位、不提醒。
   * 这条保留给没有传 `configKey` 的旧调用方；传了的话上一段更精确。
   */
  const amountUnchanged = current.amount !== null && amount !== null && current.amount === amount
  if (amountUnchanged && !isWorse(previousLevel, level)) {
    // 定义变化导致的「变差」：静默跟随，且重新武装，便于之后真实的掉档能提醒。
    return { state: { ...next, at, alertedLevel: null }, alert: null }
  }

  // 档位回升：重新武装。
  if (isWorse(previousLevel, level)) {
    return { state: { ...next, alertedLevel: null, at }, alert: null }
  }

  // 没有变差：不动提醒标记。
  if (!isWorse(level, previousLevel)) return { state: { ...next, at }, alert: null }

  // 变差了。已经为这个档位提醒过就不再重复。
  if (current.alertedLevel === level) return { state: { ...next, at }, alert: null }

  // 冷却窗口内不提醒。关键：这里**原样返回旧状态**，不推进 level 也不推进 at ——
  // 这样下一次读数仍然看到「从旧档位掉下来」这件事，冷却一过就会补上。
  // 若在这里推进 level，这次跨档就被静默吞掉了。
  //
  // 冷却计时从**上一次真正提醒**算起，而不是从上次观测算起：否则页面刚打开时
  // 的第一次观测会把计时器「用掉」，用户在半小时内遇到的第一次真实掉档会被
  // 无声吞掉 —— 那恰恰是最该提醒的一次。
  if (current.alertedAt !== 0 && at - current.alertedAt < cooldownMs) return { state: current, alert: null }

  if (muted) return { state: { ...next, alertedLevel: level, at }, alert: null }

  const seq = (Number(current.seq) || 0) + 1
  return {
    state: { ...next, alertedLevel: level, at, alertedAt: at, seq },
    alert: {
      level,
      from: previousLevel,
      amount,
      currency: typeof reading.currency === 'string' ? reading.currency : '',
      at,
      // 每次提醒一个自增序号：渲染方用它做 React key，同一张卡重新出现时
      // 淡出计时会从头开始，而不是被当成同一次提醒沿用旧计时器。
      seq
    }
  }
}

/** 把提醒状态压成可持久化的形状（只保留必要字段）。 */
export function serializeAlertState(state) {
  const current = state ?? createAlertState()
  return {
    level: typeof current.level === 'string' ? current.level : null,
    alertedLevel: typeof current.alertedLevel === 'string' ? current.alertedLevel : null,
    at: Number.isFinite(Number(current.at)) ? Number(current.at) : 0,
    alertedAt: Number.isFinite(Number(current.alertedAt)) ? Number(current.alertedAt) : 0,
    seq: Number.isFinite(Number(current.seq)) && Number(current.seq) >= 0 ? Number(current.seq) : 0,
    amount: Number.isFinite(Number(current.amount)) ? Number(current.amount) : null,
    configKey: typeof current.configKey === 'string' && current.configKey !== '' ? current.configKey : null
  }
}

/** 从存储里恢复提醒状态；损坏时回到初始状态。 */
export function deserializeAlertState(raw) {
  if (raw === null || typeof raw !== 'object') return createAlertState()
  const level = typeof raw.level === 'string' && RANK[raw.level] !== undefined ? raw.level : null
  const alertedLevel = typeof raw.alertedLevel === 'string' && RANK[raw.alertedLevel] !== undefined ? raw.alertedLevel : null
  const at = Number.isFinite(Number(raw.at)) ? Number(raw.at) : 0
  const alertedAt = Number.isFinite(Number(raw.alertedAt)) ? Number(raw.alertedAt) : 0
  const seq = Number.isFinite(Number(raw.seq)) && Number(raw.seq) >= 0 ? Number(raw.seq) : 0
  const amount = Number.isFinite(Number(raw.amount)) ? Number(raw.amount) : null
  const configKey = typeof raw.configKey === 'string' && raw.configKey !== '' ? raw.configKey : null
  return { level, alertedLevel, at, alertedAt, seq, amount, configKey }
}

/**
 * 「当前要显示的提醒」的小仓库。
 *
 * 之所以要有它，而不是把提醒直接放在徽章组件的 state 里：徽章挂在
 * `conversation.composer.dock`（**会话作用域**），切换会话会把它整体卸载重挂 ——
 * 放在组件 state 里的提醒会被会话切换顺手清掉。提醒本质上是账号级的事件，
 * 因此它住在一个与组件生命周期无关的共享仓库里，由 `shell.overlay` 的
 * 独立条目渲染（那才是宿主的浮层位置）。
 *
 * ## 为什么同时提供 `get` 与 `getSnapshot`（v1.3 修）
 * 宿主的挂载点渲染器会把 `inject` 返回的 `hooks: {alert}` 交给它自己的
 * `bindSnapshotSelector()`，而那个函数**只认 `getSnapshot`**：
 *
 * ```js
 * const subscribe = (fn) => w.subscribe(fn)
 * const getSnapshot = () => w.getSnapshot()          // ← 宿主只调这个名字
 * return (sel, eq) => useSyncExternalStoreWithSelector(subscribe, getSnapshot, ...)
 * ```
 *
 * 只提供 `get` 时，条目第一次渲染就抛 `TypeError: ...getSnapshot is not a function`，
 * 宿主把它当作**条目崩溃**并 `abdicate`（永久摘掉该条目）—— 于是提醒卡再也不会
 * 出现，而且控制台里只有一条不显眼的错误。这不是本插件独有的坑：`getSnapshot`
 * 是 `useSyncExternalStore` 的契约名，任何往挂载点注入「可订阅快照」的插件都必须
 * 用这个名字。`get` 保留给插件内部与测试使用（同一个函数，不是两份状态）。
 *
 * @returns `{get, getSnapshot, set, subscribe}`
 */
export function createAlertStore() {
  let current = null
  const listeners = new Set()
  const read = () => current
  return {
    get: read,
    /** 宿主 `bindSnapshotSelector` 需要的名字，语义与 `get` 完全相同。 */
    getSnapshot: read,
    set(next) {
      if (next === current) return
      current = next
      for (const listener of [...listeners]) listener(current)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
