/**
 * 余额徽章 —— 钱包投影与视图模型（纯逻辑）。
 *
 * 这里刻意不出现 React 与任何宿主对象：所有函数都是「输入 → 输出」的纯函数，
 * 因此可以在 Node 里直接单测（tests/runtime.test.mjs），组件层只负责把它们接到
 * 渲染与轮询上。
 *
 * v1.1 的核心变化是**视图模型不再只看本次请求**：组件把上一次成功的读数一起传进来，
 * 于是「一次网络抖动就把余额变成 `--`」不再发生 —— 旧值会被标记成 `stale` 继续显示，
 * 而不是被抹掉。
 */

import { DEFAULT_SETTINGS } from './settings.js'

/**
 * 随每次账号调用上报的客户端版本。
 *
 * 宿主会把 `version / locale / timezoneOffsetSeconds` 归约成开放平台的五个
 * `x-client-*` 请求头（`@deepseek-ai/dsh-deepseek-account` 的
 * platformClientHeaders），它只用于平台侧统计界面来源，不参与鉴权。
 */
export const CLIENT_VERSION = '0.2.0-rc.2'

/** 目标语言键 → 平台需要的 locale 前缀。 */
export function platformLocale(active) {
  return String(active ?? '').toLowerCase().startsWith('zh') ? 'zh-CN' : 'en'
}

/**
 * 组一次账号调用所需的调用方元数据。
 *
 * 字段名与语义必须和宿主 `AccountClientMetadata` 一致：
 * `timezoneOffsetSeconds` 是「本地时间相对 UTC 的秒数」（东八区为 +28800），
 * 注意它与 JS `getTimezoneOffset()` 的符号相反。
 *
 * @param active - 当前界面语言（locale 服务的 active 值）。
 * @returns {{version: string, locale: string, timezoneOffsetSeconds: number}}
 */
export function clientMetadata(active) {
  return {
    version: CLIENT_VERSION,
    locale: platformLocale(active),
    timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60
  }
}

/**
 * 解析平台返回的金额字符串。
 *
 * 平台钱包金额是十进制字符串，文法和 big.js 一致（允许省略整数或小数部分、
 * 允许十进制指数，例如 `0E-16`、`5.0000000000000000`），因此不能只用
 * `parseFloat` 的宽松规则，这里先按文法校验再转数值。
 *
 * @param text - 平台返回的金额字符串。
 * @returns 数值；非法文本返回 null。
 */
export function parseAmount(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  if (trimmed === '' || !/^-?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(trimmed)) return null
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/**
 * 归一化一个钱包数组。
 * @param wallets - 平台投影里的钱包数组（可能为 undefined）。
 * @returns {{currency: string, amount: number, raw: string}[]}
 */
export function normalizeWallets(wallets) {
  if (!Array.isArray(wallets)) return []
  const out = []
  for (const wallet of wallets) {
    if (wallet === null || typeof wallet !== 'object') continue
    const amount = parseAmount(wallet.balance)
    if (amount === null) continue
    out.push({ currency: String(wallet.currency ?? ''), amount, raw: String(wallet.balance) })
  }
  return out
}

/**
 * 选出要展示的币种。
 * @param recharge - 归一化后的充值钱包。
 * @param bonus - 归一化后的赠金钱包。
 * @param preference - 用户偏好：`auto` / `CNY` / `USD`。
 * @returns 币种代码；一个钱包都没有时返回 null。
 */
export function pickCurrency(recharge, bonus, preference = 'auto') {
  const wallets = [...recharge, ...bonus]
  const codes = []
  for (const wallet of wallets) {
    if (!codes.includes(wallet.currency)) codes.push(wallet.currency)
  }
  if (codes.length === 0) return null
  // 显式指定币种时尊重用户选择，但要有该币种的钱包才生效（否则会显示 0）。
  if (preference !== 'auto' && codes.includes(preference)) return preference
  if (codes.includes('CNY')) return 'CNY'
  if (codes.includes('USD')) return 'USD'
  return codes[0]
}

/** 求同币种钱包之和。 */
function sumOf(wallets, currency) {
  let total = 0
  for (const wallet of wallets) if (wallet.currency === currency) total += wallet.amount
  return total
}

/**
 * 把 `getBalance` 的投影压成展示模型。
 *
 * 口径说明：徽章上的数字默认是**该币种的可用总额**（充值 + 赠金），因为
 * 「任务会不会被中断」取决于总额；充值/赠金拆分放在展开面板里，也可以在设置里
 * 把徽章改成只看其中一项。
 *
 * @param detail - `getBalance` 成功时的值，形如
 *   `{status:'ready', value:[...], bonusWallets:[...]}`。
 * @param options - `{currency}`：币种偏好。
 * @returns 展示模型；`detail` 不可用时返回 null。
 */
export function summarize(detail, options) {
  if (detail === null || typeof detail !== 'object') return null
  if (detail.status !== 'ready') return null
  const rawRecharge = Array.isArray(detail.value) ? detail.value : []
  const rawBonus = Array.isArray(detail.bonusWallets) ? detail.bonusWallets : []
  const recharge = normalizeWallets(rawRecharge)
  const bonus = normalizeWallets(rawBonus)
  // 有解析不了的条目时整份作废：与宿主「读取失败绝不退化成零余额」的口径一致，
  // 宁可显示读取失败，也不显示一个可能严重偏低的数字。
  if (recharge.length !== rawRecharge.length || bonus.length !== rawBonus.length) return null
  const currency = pickCurrency(recharge, bonus, options?.currency ?? DEFAULT_SETTINGS.currency)
  if (currency === null) {
    // 平台返回了 ready，但钱包列表是空的：合法状态（例如额度已全部过期）。
    return {
      currency: null,
      recharge: 0,
      bonus: 0,
      total: 0,
      primary: 0,
      wallets: [],
      bonusWallets: [],
      otherWallets: []
    }
  }
  const rechargeSum = sumOf(recharge, currency)
  const bonusSum = sumOf(bonus, currency)
  const total = rechargeSum + bonusSum
  // 同币种之外还有别的币种时，面板里补一行提示，避免用户以为余额只有这一点。
  const otherWallets = [...recharge, ...bonus].filter((wallet) => wallet.currency !== currency)
  return {
    currency,
    recharge: rechargeSum,
    bonus: bonusSum,
    total,
    primary: total,
    wallets: recharge,
    bonusWallets: bonus,
    otherWallets
  }
}

/**
 * 按金额分档。
 * @param amount - 参与分档的金额（口径由设置决定）。
 * @param thresholds - `{low, warn}`。
 * @returns `'low'`（红）/`'warn'`（橙）/`'ok'`（正常）。
 */
export function levelFor(amount, thresholds) {
  const low = thresholds?.low ?? DEFAULT_SETTINGS.low
  const warn = thresholds?.warn ?? DEFAULT_SETTINGS.warn
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return 'ok'
  if (amount < low) return 'low'
  if (amount < warn) return 'warn'
  return 'ok'
}

/**
 * 判定 Remote 调用结果。
 * @param result - `ctx.remote.account.getBalance()` 的返回值。
 * @returns `'ready'`（拿到了投影）/`'signed-out'`（没有授权）/
 *   `'failed'`（读取失败，平台侧保留凭据）。
 */
export function classifyBalance(result) {
  if (result === null || typeof result !== 'object') return 'failed'
  if (result.ok !== true) return 'failed'
  if (result.value === null || result.value === undefined) return 'signed-out'
  return result.value.status === 'ready' ? 'ready' : 'failed'
}

/**
 * 消耗速度允许回看的最长时间：6 小时。
 *
 * 余额可能一段时间不变（没有请求、平台按批结算），如果只拿「上一次轮询」当
 * 基准，速度行会在下一次轮询时因为 `spent <= 0` 消失，用户会以为插件坏了。
 * 因此 v0.1.6 起基准会跨过「金额相同的读数」，一直保留到金额真正变化，最多
 * 回看 6 小时；超过这个跨度再拿旧基准算瞬时速度已经没有意义（那是半天前的
 * 平均值），直接放弃，等下一次变化重新起步。
 */
export const RATE_MAX_ELAPSED_MS = 6 * 3600 * 1000

/**
 * 决定下一次算速度时用哪个基准。
 *
 * - 金额与币种都没变：**保留旧基准**。这样「余额连续几次轮询都一样、随后掉了」
 *   仍然能以「从上次变化到现在」的跨度算出速度，而不是因为中间那一拍
 *   `spent = 0` 把整行清空。
 * - 金额变了（消耗或充值）或币种变了：用本次读数做新基准。
 *
 * 注意它只影响**速度估算**；`viewModel` 的展示仍用本次读数（`summary` 单独传入）。
 *
 * @param previous - 上一次基准 `{summary, at}`，可能为 null。
 * @param summary - 本次成功读数里的钱包汇总。
 * @param at - 本次读数时刻。
 * @returns 新的基准对象；输入非法时返回 null。
 */
export function rateBaseline(previous, summary, at) {
  if (summary === null || summary === undefined) return previous ?? null
  const currentAt = typeof at === 'number' && Number.isFinite(at) ? at : Date.now()
  if (previous === null || previous === undefined) return { summary, at: currentAt }
  const before = previous.summary
  if (before === null || before === undefined) return { summary, at: currentAt }
  if (before.currency !== summary.currency) return { summary, at: currentAt }
  // 金额没变：保持旧基准（含旧的 at），让速度跨过这段平台静默期。
  if (before.total === summary.total && before.primary === summary.primary) return previous
  return { summary, at: currentAt }
}

/**
 * 用两次读数算消耗速度。
 *
 * 只在「两次都就绪、币种一致、时间确实前进、余额确实下降」时给结论：
 * 余额上升（充值）或不变时返回 null —— 那不是消耗速度，标出来只会误导。
 *
 * @param previous - 上一次成功读数 `{summary, at}`。
 * @param current - 本次读数 `{summary, at}`。
 * @returns `{perHour, spent, elapsedMs}` 或 null。
 */
export function computeRate(previous, current) {
  if (previous === undefined || previous === null || current === undefined || current === null) return null
  const before = previous.summary
  const after = current.summary
  if (before === null || after === null || before === undefined || after === undefined) return null
  if (before.currency !== after.currency) return null
  const elapsedMs = current.at - previous.at
  // 少于 30 秒的间隔里，噪声（四舍五入、赠金波动）比信号大；超过 6 小时
  // 的跨度是「半天平均」，不是「近期速度」。
  if (!Number.isFinite(elapsedMs) || elapsedMs < 30000 || elapsedMs > RATE_MAX_ELAPSED_MS) return null
  const spent = before.primary - after.primary
  if (!Number.isFinite(spent) || spent <= 0) return null
  return { perHour: spent / (elapsedMs / 3600000), spent, elapsedMs }
}

/**
 * 组装徽章要显示的一整个视图模型。
 *
 * v1.1 的 `stale` 语义：只要手上还有上一次成功的读数，就**继续显示它**，
 * 同时用 `stale: true` + `ageMs` 让 UI 把它表现成「这个数字可能过期了」，
 * 而不是把整枚徽章变成一个没有信息量的 `--`。
 *
 * @param input - `{balance, state, previous, thresholds, format, currency, at, now}`：
 *   `balance` 是本次 `getBalance` 的结果，`previous` 是上一次成功读数
 *   `{summary, at}`，`format` 决定徽章数字取哪一项。
 * @returns 视图模型，字段与 UI 一一对应。
 */
export function viewModel(input) {
  const { balance, state, previous, thresholds, format, currency, at, now } = input ?? {}
  const resolvedThresholds = thresholds ?? { low: DEFAULT_SETTINGS.low, warn: DEFAULT_SETTINGS.warn }
  const resolvedFormat = ['total', 'recharge', 'bonus'].includes(format) ? format : DEFAULT_SETTINGS.format
  const topUpUrl = state?.ok === true && typeof state.value?.links?.topUpUrl === 'string'
    ? state.value.links.topUpUrl
    : null
  const stateStatus = state !== undefined && state?.ok === true ? state.value?.status : undefined

  const status = classifyBalance(balance)
  const fresh = status === 'ready' ? summarize(balance.value, { currency }) : null
  const usable = fresh ?? (previous?.summary ?? null)
  const stale = fresh === null && usable !== null
  const at_ = fresh !== null ? (typeof at === 'number' ? at : null) : (previous?.at ?? null)
  const ageMs = at_ === null ? null : Math.max(0, (typeof now === 'number' ? now : Date.now()) - at_)
  const primary = usable === null ? null : amountFor(usable, resolvedFormat)
  const level = fresh === null && usable === null ? 'ok' : levelFor(primary, resolvedThresholds)

  return {
    // 有旧值可显示时把状态标成 stale，让 UI 走「数字 + 过期提示」分支而不是错误分支。
    status: stale ? 'stale' : status,
    signedIn: stateStatus === undefined ? status !== 'signed-out' : stateStatus === 'credential-stored',
    summary: usable,
    format: resolvedFormat,
    primary,
    level,
    thresholds: resolvedThresholds,
    topUpUrl,
    at: at_,
    ageMs,
    stale,
    /** 上一次读数与本次的距离，供面板估算速度。 */
    rate: computeRate(previous, fresh === null ? null : { summary: fresh, at }),
    /**
     * v1.3：这条视图模型是「本次真的读到了」还是「沿用旧读数重算的」。
     *
     * `viewModel()` 拿到新的 `getBalance` 结果，因此恒为 true。
     * `refreshedViewModel()` 才是会给出 false 的那个分支 —— 两者分开，
     * 「数据来源」与「数据新鲜度（stale）」就不会再被混为一谈。
     */
    effective: true
  }
}

/** 按口径取金额：总额 / 仅充值 / 仅赠金。 */
export function amountFor(summary, format) {
  if (summary === null || summary === undefined) return null
  if (format === 'recharge') return summary.recharge
  if (format === 'bonus') return summary.bonus
  return summary.total
}

/**
 * 用**已有的读数**重算视图模型：改阈值 / 改口径 / 改币种时走这条路。
 *
 * 存在的理由是一个 v1.3 修掉的真实缺陷：设置一改就重算，而重算时手上只有
 * 上一次成功的读数、没有新的 `getBalance` 结果。如果把它当成「这次读取返回了
 * 空」送进 `viewModel`，`status` 会变成 `signed-out`、`stale` 会变成 `true`，
 * 面板顶部随即显示「⚠ 本次刷新失败，上面显示的是 N 分钟前的数据」——
 * 而这次刷新根本没有发生。用户只是改了一个阈值，却被告知读取失败。
 *
 * 因此这里显式走「有可用读数」的分支：`summary` 原样沿用，只重算与设置相关的
 * 部分 —— 口径（`format`）、档位（`level`）、阈值、以及速度。`status` 固定为
 * `'ready'`、`stale` 固定为 `false`：这是**我们手上确实有读数**的事实，
 * 与最近一次网络调用成功与否无关（那个事实由 `effective` 标记携带）。
 *
 * @param input - `{summary, at, format, thresholds, topUpUrl, signedIn, effective,
 *   previous, rate, now}`：
 *   `previous` 是「上一次成功读数的读数」`{summary, at}`，给出时用它重算速度
 *   （面板的「按此速度约可用…」在改阈值后不该消失）；
 *   `rate` 若显式给出则直接采用（优先于 `previous`）。
 * @returns 与 `viewModel` 同形状的视图模型；`summary` 为空时返回 null。
 */
export function refreshedViewModel(input) {
  const { summary, at, format, thresholds, topUpUrl, signedIn, effective, previous, rate, now } = input ?? {}
  if (summary === null || summary === undefined) return null
  const resolvedThresholds = thresholds ?? { low: DEFAULT_SETTINGS.low, warn: DEFAULT_SETTINGS.warn }
  const resolvedFormat = ['total', 'recharge', 'bonus'].includes(format) ? format : DEFAULT_SETTINGS.format
  const primary = amountFor(summary, resolvedFormat)
  const at_ = typeof at === 'number' && Number.isFinite(at) ? at : null
  const ageMs = at_ === null ? null : Math.max(0, (typeof now === 'number' ? now : Date.now()) - at_)
  const resolvedRate = rate !== undefined
    ? rate
    : computeRate(previous, at_ === null ? null : { summary, at: at_ })
  return {
    status: 'ready',
    signedIn: signedIn !== false,
    summary,
    format: resolvedFormat,
    primary,
    level: levelFor(primary, resolvedThresholds),
    thresholds: resolvedThresholds,
    topUpUrl: typeof topUpUrl === 'string' ? topUpUrl : null,
    at: at_,
    ageMs,
    stale: false,
    rate: resolvedRate ?? null,
    /**
     * 这条数据是「本次刷新真的读到的」还是「沿用上一次读数重算的」。
     *
     * 用**语义**而不是调用方传参来定这个值：调用 `refreshedViewModel` 这个事实本身
     * 就说明了「没有新的读取」，因此默认 `false`。让它默认 true 会给出一条
     * 自相矛盾的记录（用户只改了阈值，却显示「刚刚刷新的读数」）。
     */
    effective: effective === true
  }
}
