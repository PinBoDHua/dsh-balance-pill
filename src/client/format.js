/**
 * 余额徽章 —— 数字与时间的展示格式化。
 *
 * v1.1 起金额不再用 `toFixed` 硬拼：界面语言切换成英文时 `¥1.234,56` 这种写法
 * 会看起来像坏了，所以走 `Intl.NumberFormat`，并在 Intl 不可用或抛错时回落到
 * 朴素实现（插件跑在渲染进程里，任何平台差异都不该让徽章白屏）。
 *
 * v1.3 起这里多了「计费时段」需要的几个格式化函数。它们有一条容易写错的约束：
 * **时段固定按北京时间（UTC+08:00）标注，与运行机器的本地时区无关** ——
 * 平台按北京时间划窗口，用 `getHours()` 这类本地时区 API 会让 UTC 时区的用户
 * 看到整体偏移 8 小时的错误窗口，而插件自身没有任何线索能察觉这件事。
 *
 * 这里全部是纯函数：locale 与偏移量显式传入，测试才不会被运行机器的系统语言
 * 或时区影响。
 */

/** 界面语言（locale 服务的 active 值）归一到 BCP-47 标签。 */
export function resolveLocale(active) {
  const raw = String(active ?? '').trim()
  if (raw === '') return 'zh-CN'
  const lower = raw.toLowerCase()
  if (lower.startsWith('zh')) {
    // 繁体（zh-TW / zh-HK / zh-Hant）单独成标签，数字与日期分组规则不同。
    if (/hant|tw|hk|mo/.test(lower)) return 'zh-TW'
    return 'zh-CN'
  }
  if (lower.startsWith('en')) return 'en-US'
  return raw
}

/** Intl.NumberFormat 的构造是热点（每次渲染都会调用），按参数缓存。 */
const numberFormats = new Map()

/**
 * 取一个缓存的 NumberFormat；任何异常都返回 null，由调用方回落。
 * @param locale - BCP-47 标签。
 * @param minimumFractionDigits - 最少小数位。
 * @param maximumFractionDigits - 最多小数位。
 */
function numberFormat(locale, minimumFractionDigits, maximumFractionDigits) {
  const key = `${locale}|${minimumFractionDigits}|${maximumFractionDigits}`
  if (numberFormats.has(key)) return numberFormats.get(key)
  let format = null
  try {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits, maximumFractionDigits })
  } catch {
    format = null
  }
  numberFormats.set(key, format)
  return format
}

/**
 * 金额文本：固定两位小数，按界面语言分组。
 *
 * 语义边界必须保留：
 *  - 正数但不足一分钱显示 `<0.01`，而不是被舍入成 `0.00`（会被误读成没钱了）；
 *  - 非有限数显示 `--`，绝不用 `NaN` 污染界面。
 *
 * @param value - 金额。
 * @param options - `{locale, digits}`；缺省 en-US / 2 位，保证测试稳定。
 * @returns 展示文本。
 */
export function formatAmount(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const digits = options?.digits ?? 2
  if (digits === 2) {
    if (value > 0 && value < 0.01) return '<0.01'
    if (value < 0 && value > -0.01) return '>-0.01'
  }
  if (value === 0) {
    const zero = numberFormat(options?.locale ?? 'en-US', digits, digits)
    return zero === null ? (0).toFixed(digits) : zero.format(0)
  }
  const format = numberFormat(options?.locale ?? 'en-US', digits, digits)
  if (format === null) return value.toFixed(digits)
  try {
    return format.format(value)
  } catch {
    return value.toFixed(digits)
  }
}

/** 整数不带小数（阈值展示用：`3` 而不是 `3.00`）。 */
export function formatThreshold(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  if (Number.isInteger(value)) return formatAmount(value, { ...options, digits: 0 })
  return formatAmount(value, options)
}

/** 带正负号的金额，用于「已消耗 / 已充值」这类增减量。 */
export function formatDelta(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const text = formatAmount(Math.abs(value), options)
  if (text === '--' || text.startsWith('<') || text.startsWith('>')) return text
  return value < 0 ? `-${text}` : `+${text}`
}

/** 带正负号的金额 + 币种符号，面板里的增减量都走这个（与其他行保持同一写法）。 */
export function formatMoneyDelta(value, currency, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const text = formatAmount(Math.abs(value), options)
  if (text === '--' || text.startsWith('<') || text.startsWith('>')) return `${currencySymbol(currency)}${text}`
  return `${value < 0 ? '-' : '+'}${currencySymbol(currency)}${text}`
}

/** 币种符号：人民币 ¥，美元 $，未知币种沿用平台给的代码。 */
export function currencySymbol(currency) {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return typeof currency === 'string' && currency !== '' ? `${currency} ` : ''
}

/** 金额 + 币种符号。 */
export function formatMoney(amount, currency, options) {
  return `${currencySymbol(currency)}${formatAmount(amount, options)}`
}

/** 时钟文本（HH:MM:SS，**本地时区**），面板里给出「更新于」。 */
export function formatClock(at) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '--'
  const date = new Date(at)
  const pad = (value) => String(value).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/**
 * 相对时间文本：刚刚 / N 秒前 / N 分钟前 / N 小时前 / N 天前。
 *
 * 分钟以上用 `Math.floor`：`Math.round` 会把 59.6 分钟说成「60 分钟前」，
 * 那是读者一眼就能看出不对的文案。
 *
 * @param at - 读取时间戳。
 * @param t - 本地化函数。
 * @param now - 便于测试的当前时间。
 */
export function formatAge(at, t, now) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return t('age.never')
  const seconds = Math.max(0, Math.round(((now ?? Date.now()) - at) / 1000))
  if (seconds < 5) return t('age.now')
  if (seconds < 60) return t('age.seconds', { count: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return t('age.minutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('age.hours', { count: hours })
  return t('age.days', { count: Math.floor(hours / 24) })
}

/**
 * 时长文本，用于「按当前速度还能用多久」。
 *
 * 刻意只给一个数量级：分钟级看两位有效数字会让人误以为预测很准，
 * 而余额消耗速度本身波动很大。
 *
 * @param ms - 毫秒时长。
 * @param t - 本地化函数。
 */
export function formatDuration(ms, t) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return t('duration.unknown')
  const minutes = ms / 60000
  if (minutes < 1) return t('duration.seconds', { count: Math.max(1, Math.round(ms / 1000)) })
  if (minutes < 60) return t('duration.minutes', { count: Math.round(minutes) })
  const hours = minutes / 60
  if (hours < 24) return t('duration.hours', { count: Math.round(hours * 10) / 10 })
  return t('duration.days', { count: Math.round(hours / 24) })
}

// ------------------------------------------------------- v1.3 计费时段

/**
 * 计费时段固定用北京时间（UTC+08:00），与运行机器的时区无关。
 *
 * 这一点必须写死在展示层：用户可能在任何一个时区，但平台按北京时间划计费窗口。
 * 如果这里用 `new Date(at).getHours()`（本地时区），一个在 UTC 的用户会看到
 * 偏移 8 小时的错误窗口，而插件本身没法让他察觉。
 */
export const BEIJING_TZ_OFFSET_MINUTES = 480

/** 取「北京时间」的日期部件；偏移作为参数便于单测覆盖别的时区。 */
function beijingParts(at, tzOffsetMinutes) {
  const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : BEIJING_TZ_OFFSET_MINUTES
  const local = new Date(at + offset * 60000)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hours: local.getUTCHours(),
    minutes: local.getUTCMinutes(),
    seconds: local.getUTCSeconds()
  }
}

/** 两位数补零（`pad2` 这个名字已被 pricing.js 占用 —— 拼接式构建里顶层名不能重）。 */
function pad2Text(value) {
  return String(value).padStart(2, '0')
}

/**
 * 北京时间文本 `HH:MM`。
 * @param at - 时间戳；非法返回 `--`。
 * @param tzOffsetMinutes - 时区偏移（分钟），缺省 +480。
 */
export function formatBeijingTime(at, tzOffsetMinutes) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '--'
  const parts = beijingParts(at, tzOffsetMinutes)
  return `${pad2Text(parts.hours)}:${pad2Text(parts.minutes)}`
}

/**
 * 北京时间文本 `MM-DD HH:MM`（跨天的边界用得到）。
 * @param at - 时间戳；非法返回 `--`。
 * @param tzOffsetMinutes - 时区偏移（分钟），缺省 +480。
 */
export function formatBeijingDateTime(at, tzOffsetMinutes) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '--'
  const parts = beijingParts(at, tzOffsetMinutes)
  return `${pad2Text(parts.month)}-${pad2Text(parts.day)} ${pad2Text(parts.hours)}:${pad2Text(parts.minutes)}`
}

/**
 * 「自某时刻起」里的那个时刻：同一天给 `HH:MM`，跨天补上 `MM-DD`。
 *
 * 这是 v0.1.6 修掉的一处歧义：「本周已用 ¥1.86（自 08:20 起）」在周五看起来
 * 像是今天早上 8:20 花的，但本周其实从周一就开始了。只显示时刻会把**起点**
 * 读成今天；补上日期才与「本周 / 近 7 天」的窗口对得上。
 *
 * @param at - 起点时刻。
 * @param now - 参照时刻（通常是当前时间）；缺省取 `Date.now()`。
 * @param tzOffsetMinutes - 计费时区偏移（分钟），缺省 +480。
 * @returns `HH:MM` 或 `MM-DD HH:MM`；非法输入返回 `--`。
 */
export function formatBillingMoment(at, now, tzOffsetMinutes) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '--'
  const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : BEIJING_TZ_OFFSET_MINUTES
  const nowMs = typeof now === 'number' && Number.isFinite(now) ? now : Date.now()
  const dayOf = (value) => Math.floor((value + offset * 60000) / 86400000)
  return dayOf(at) === dayOf(nowMs)
    ? formatBeijingTime(at, offset)
    : formatBeijingDateTime(at, offset)
}

/**
 * 时段区间的展示文本。
 *
 * 同一段区间里结束时刻可能是**第二天**甚至更久以后（周五 18:00 → 周一 09:00
 * 是一整段 63 小时的空闲），只说「18:00 – 09:00」会让人以为跨越了午夜反了。
 * 因此跨日时按天数标注「次日 / N 天后」。
 *
 * @param window - `{start, end}`（epoch 毫秒）。
 * @param tzOffsetMinutes - 时区偏移（分钟）。
 * @param t - 本地化函数；给出时跨天用 `tariff.windowNextDay` / `tariff.windowDays`。
 * @returns 文本；输入非法返回 `--`。
 */
export function formatPeakWindow(window, tzOffsetMinutes, t) {
  if (window === null || window === undefined) return '--'
  const { start, end } = window
  if (typeof start !== 'number' || typeof end !== 'number' || !Number.isFinite(start) || !Number.isFinite(end)) return '--'
  const from = formatBeijingTime(start, tzOffsetMinutes)
  const to = formatBeijingTime(end, tzOffsetMinutes)
  const offset = Number.isFinite(tzOffsetMinutes) ? tzOffsetMinutes : BEIJING_TZ_OFFSET_MINUTES
  const dayOf = (at) => Math.floor((at + offset * 60000) / 86400000)
  const span = dayOf(end) - dayOf(start)
  if (span <= 0) return `${from}–${to}`
  if (t === undefined || t === null) return `${from}–${to}+${span}`
  return span === 1
    ? t('tariff.windowNextDay', { from, to })
    : t('tariff.windowDays', { from, to, count: span })
}

/**
 * 倒计时文本：`1 天 2 小时 13 分钟` / `2 小时 13 分钟` / `13 分钟` / `45 秒`。
 *
 * 与 `formatDuration` 的区别：那个只给一个数量级（「约 2.3 小时」），因为它描述的是
 * 由速度推算出来的**预测**；倒计时是**确定**的时刻差，用户会盯着它走字，
 * 因此这里给到「小时 + 分钟」两级；v0.1.6 起跨天也带「天 + 小时 + 分钟」，
 * 不再一整天停在「1 天」。剩余不足一分钟按秒显示（否则会一直停在 0 分钟）。
 *
 * @param ms - 剩余毫秒。
 * @param t - 本地化函数。
 */
export function formatCountdown(ms, t) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return t('duration.unknown')
  // v0.2.0：恰好为 0 不再显示「暂时无法估算」。`msUntil*` 都是 `Math.max(0, …)`，
  // 边界的那一拍会得到 0 —— 旧实现把它与 NaN 一起归进 unknown，于是倒计时在
  // 跨过边界的前后各有一拍闪出「暂时无法估算」，看起来像算崩了。
  // 0 意味着「就在此刻」，按剩余 1 秒显示最接近读者的直觉；负数仍视为不可估算
  // （那不是倒计时，是调用方传错了）。
  if (ms === 0) return t('duration.seconds', { count: 1 })
  if (ms < 0) return t('duration.unknown')
  const totalMinutes = Math.floor(ms / 60000)
  if (totalMinutes < 1) return t('duration.seconds', { count: Math.max(1, Math.round(ms / 1000)) })
  const days = Math.floor(totalMinutes / 1440)
  if (days >= 1) {
    // v0.1.6：跨天时也把小时 / 分钟带上。旧实现只给整数天，面板会整整一天
    // 停在「距下一个高峰 1 天」不动 —— 读者会以为倒计时坏了；而且「1 天」
    // 与真实剩余（可能是 1 天 23 小时）差近一天。
    const restMinutes = totalMinutes - days * 1440
    const restHours = Math.floor(restMinutes / 60)
    const restRemainder = restMinutes - restHours * 60
    const dayText = t('duration.days', { count: days })
    if (restMinutes === 0) return dayText
    if (restHours === 0) return `${dayText} ${t('duration.minutes', { count: restRemainder })}`
    if (restRemainder === 0) return `${dayText} ${t('duration.hours', { count: restHours })}`
    return `${dayText} ${t('duration.hours', { count: restHours })} ${t('duration.minutes', { count: restRemainder })}`
  }
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes - hours * 60
  if (hours === 0) return t('duration.minutes', { count: minutes })
  return `${t('duration.hours', { count: hours })} ${t('duration.minutes', { count: minutes })}`
}

/**
 * 单价文本：¥0.04 / ¥4.50 这类。
 *
 * 之所以不直接复用 `formatAmount`：后者在不足一分钱时会输出「<0.01」这种
 * **相对**语义，而单价必须是绝对值 —— 价格表里 0.02 元/百万 tokens 是一个
 * 精确的数，不能被写成「小于一分钱」。
 *
 * @param value - 单价（元 / 百万 tokens）。
 * @param currency - 币种（价格表是人民币口径，缺省 CNY）。
 * @param options - `{locale, digits}`；`digits` 缺省 2。
 */
export function formatPrice(value, currency, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const digits = options?.digits ?? 2
  const format = numberFormat(options?.locale ?? 'en-US', digits, digits)
  const text = format === null ? value.toFixed(digits) : format.format(value)
  return `${currencySymbol(currency ?? 'CNY')}${text}`
}
