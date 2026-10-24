/**
 * DeepSeek Harness 余额徽章 —— DeepSeek 计费时段（高峰 / 空闲）纯逻辑。
 *
 * ## 为什么需要它
 * DeepSeek 的 API 价格**不是常量**：空闲时段是高峰时段的一半。用户在余额不多时
 * 真正关心的问题有两个，而这两个都由「现在处于哪个时段」决定：
 *   1. 现在这一分钟烧钱快不快（高峰 = 双倍价）；
 *   2. 余额还能撑多久 —— 以及「如果等到空闲时段再用，同样的钱能多用多久」。
 * 徽章只知道余额，回答不了这两个问题；于是把时段判定做成一等公民。
 *
 * ## 规则（以开放平台文档为准，2026-10 抓取）
 * 北京时间**周一至周五**（不含中国法定节假日）的
 * **09:00–12:00、14:00–18:00** 为高峰时段；其余时间 —— 夜间、午休、
 * **周末全天、法定节假日全天** —— 都是空闲时段，价格减半。
 * 等价的 UTC 说法是 MON–FRI 01:00–04:00 与 06:00–10:00 UTC。
 *
 * ## 实现约束
 * - 本模块**不依赖 React / DOM / localStorage**，全部是「输入 → 输出」的纯函数，
 *   因此可以在 Node 里逐条单测（tests/runtime.test.mjs）。
 * - 时区判定基于**固定 UTC+08:00** 而不是运行机器的本地时区：计费时段由平台按
 *   北京时间划定，机器时区与它无关。把时区当参数注入也让测试与机器设置无关。
 * - 时间一律用 epoch 毫秒表示，**返回值里不放格式化文本** —— 文案与本地化在
 *   组件层（`format.js` + `locales.js`）完成，这一层只回答「是什么」。
 * - 节假日日历是**内置数据**（见下方 CHINA_HOLIDAYS）：判定必须离线可用，
 *   不能因为取不到网络就把「现在是不是空闲时段」算错。数据来源与更新方式
 *   写在 `calendars.js` 的注释里。
 */

import { CHINA_HOLIDAYS } from './calendars.js'

/**
 * 平台计费时区相对 UTC 的分钟偏移。北京时间 = UTC+08:00。
 * 注意这**不是**用户的本地时区：无论用户在哪，计费时段都按北京时间划。
 */
export const BILLING_TZ_OFFSET_MINUTES = 480

/** 一天、一小时、一分钟的毫秒数。 */
const DAY_MS = 86400000
const HOUR_MS = 3600000
const MINUTE_MS = 60000

/**
 * 高峰时段的窗口（北京时间，**当天的分钟数**，起点闭、终点开）。
 *
 * 09:00–12:00 与 14:00–18:00：中午 12:00–14:00 是空闲时段，
 * 这一点常被记成「白天都是高峰」，是最容易算错的地方。
 */
export const PEAK_WINDOWS = [
  { startMinute: 9 * 60, endMinute: 12 * 60 },
  { startMinute: 14 * 60, endMinute: 18 * 60 }
]

/** 时段标识。 */
export const PERIODS = ['peak', 'off-peak']

/**
 * 空闲时段的折扣倍数（相对高峰价）。
 *
 * 文档口径是「空闲时段价格为高峰时段价格的一半」，因此单价直接乘 0.5；
 * 这个常量被用来在面板上显示「空闲时段 5 折」以及推算省下的钱。
 */
export const OFF_PEAK_MULTIPLIER = 0.5

/**
 * 内置价格表（以平台文档为准，单位：元 / 百万 tokens）。
 *
 * 只内置**官方在售的两个模型**，避免把来路不明或已下线的价格写成事实。
 * 这两个模型的价格关系是干净的 2 倍（flash）与 3 倍（pro）：空闲 = 高峰 / 2，
 * 而 pro 的输入是 flash 的 4.5 倍、输出是 flash 的 3.375 倍 —— 因此三个数值
 * 都必须逐项列出，不能靠一个倍数推导。
 */
export const MODELS = [
  {
    key: 'flash',
    /** 面板上展示的名字，也是设置里下拉项的名字。 */
    label: 'deepseek-flash',
    note: 'DeepSeek-V4.1-Flash',
    /** 数据来源（面板「价格」行的提示文本与 README 引用同一处）。 */
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    peak: { cacheHit: 0.04, cacheMiss: 2, output: 8 },
    offPeak: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
  },
  {
    key: 'pro',
    label: 'deepseek-v4-pro',
    note: 'DeepSeek-V4-Pro-0813',
    source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
    peak: { cacheHit: 0.3, cacheMiss: 9, output: 27 },
    offPeak: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
  }
]

/** 默认展示的模型：`auto` 表示「跟随内置默认」。 */
export const DEFAULT_MODEL_KEY = 'flash'

/**
 * 默认用量结构：缓存命中占比与输出 token 占比的经验值。
 *
 * 插件只看得见余额变化，看不见 token 用量，因此把「金额」折算成「等效 token」
 * 时必须假设一个用量结构。这两个数是**保守的常见值**（长会话里上下文重复度高，
 * 缓存命中占比通常不低；agent 场景输出占比通常低于 10%）。它们只用于把消耗速度
 * 折算成时长，结论以「大约」的形式展示。
 */
export const DEFAULT_USAGE_MIX = { cacheHitShare: 0.5, outputShare: 0.1 }

// --------------------------------------------------------------- 时间换算

/** 把某个时刻的日序号（epochDay）转成对应的 epoch 毫秒（该日 00:00 UTC）。 */
function epochDayToMs(epochDay) {
  return epochDay * DAY_MS
}

/** 取某个时刻的日序号：以 UTC+tzOffsetMinutes 为「当地日」的基准。 */
function epochDayOf(at, tzOffsetMinutes) {
  return Math.floor((at + tzOffsetMinutes * MINUTE_MS) / DAY_MS)
}

/** 1970-01-01 是周四；返回 0=周日 … 6=周六。 */
function weekdayOfEpochDay(epochDay) {
  return (((epochDay + 4) % 7) + 7) % 7
}

/** 某个 epochDay 的当地 00:00（epoch 毫秒）。 */
function dayStartMs(epochDay, tzOffsetMinutes) {
  return epochDayToMs(epochDay) - tzOffsetMinutes * MINUTE_MS
}

/** 两位数补零。 */
function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 把 epoch 毫秒按给定偏移格式化成 `YYYY-MM-DD`。 */
function isoDate(at, tzOffsetMinutes) {
  const local = new Date(at + tzOffsetMinutes * MINUTE_MS)
  return `${local.getUTCFullYear()}-${pad2(local.getUTCMonth() + 1)}-${pad2(local.getUTCDate())}`
}

/** 某个时刻在当地的「当天第几分钟」（0 … 1439）。 */
function minuteOfDay(at, tzOffsetMinutes) {
  const local = new Date(at + tzOffsetMinutes * MINUTE_MS)
  return local.getUTCHours() * 60 + local.getUTCMinutes()
}

/**
 * 判定某个时刻在计费上算不算「工作日」。
 *
 * 优先级：官方调休上班日（0）> 法定节假日（1）> 常规周末规则。
 * 顺序不能颠倒：调休上班的周六可能是节假日期间补班，那天按工作日计费。
 *
 * @param at - epoch 毫秒。
 * @param tzOffsetMinutes - 计费时区偏移（分钟）。
 * @param options - `{holidays, useCalendar}`：自定义日历与「是否考虑节假日」。
 * @returns `{workday, holiday, reason}`。
 */
function classifyDay(at, tzOffsetMinutes, options) {
  const epochDay = epochDayOf(at, tzOffsetMinutes)
  const weekend = weekdayOfEpochDay(epochDay) === 0 || weekdayOfEpochDay(epochDay) === 6
  const calendar = options?.holidays ?? CHINA_HOLIDAYS
  const key = isoDate(at, tzOffsetMinutes)
  const flag = options?.useCalendar === false ? undefined : calendar[key]
  if (flag === 0) return { workday: true, holiday: false, weekend, reason: 'makeup-workday' }
  if (flag === 1) return { workday: false, holiday: true, weekend, reason: 'holiday' }
  return { workday: !weekend, holiday: false, weekend, reason: weekend ? 'weekend' : 'weekday' }
}

/**
 * 取出某个工作日的全部高峰区间。
 *
 * 调休上班的周六会带上 `makeup: true`：面板据此说明「今天补班，所以有高峰时段」，
 * 否则用户看到周六却在收费会以为插件算错了。
 *
 * @param at - 该工作日内的任意时刻。
 * @param options - `{tzOffsetMinutes, holidays, useCalendar}`。
 * @returns `{start, end, minuteStart, minuteEnd, makeup}[]`（epoch 毫秒，升序）；
 *   休息日返回空数组。
 */
export function peakWindowsForDay(at, options) {
  const tzOffsetMinutes = options?.tzOffsetMinutes ?? BILLING_TZ_OFFSET_MINUTES
  const day = classifyDay(at, tzOffsetMinutes, options)
  if (!day.workday) return []
  const epochDay = epochDayOf(at, tzOffsetMinutes)
  const dayStart = dayStartMs(epochDay, tzOffsetMinutes)
  return PEAK_WINDOWS.map((window) => ({
    start: dayStart + window.startMinute * MINUTE_MS,
    end: dayStart + window.endMinute * MINUTE_MS,
    minuteStart: window.startMinute,
    minuteEnd: window.endMinute,
    makeup: day.reason === 'makeup-workday'
  }))
}

/**
 * 判定某个时刻是高峰还是空闲，并给出这次判定的依据。
 *
 * @param at - epoch 毫秒。
 * @param options - `{holidays, useCalendar, tzOffsetMinutes}`。
 * @returns `{period, reason, workday, holiday, weekend, makeup, window}`；
 *   `window` 是当前所在的高峰区间（空闲时段为 null）。
 */
export function periodAt(at, options) {
  const tzOffsetMinutes = options?.tzOffsetMinutes ?? BILLING_TZ_OFFSET_MINUTES
  const day = classifyDay(at, tzOffsetMinutes, options)
  const minute = minuteOfDay(at, tzOffsetMinutes)
  if (day.workday) {
    // 窗口的当日分钟区间直接来自 PEAK_WINDOWS；`window` 额外给出绝对起止，
    // 便于组件显示「本段高峰 09:00–12:00」。
    for (const window of PEAK_WINDOWS) {
      if (minute >= window.startMinute && minute < window.endMinute) {
        const dayStart = dayStartMs(epochDayOf(at, tzOffsetMinutes), tzOffsetMinutes)
        return {
          period: 'peak',
          reason: 'peak-window',
          workday: day.workday,
          holiday: day.holiday,
          weekend: day.weekend,
          makeup: day.reason === 'makeup-workday',
          window: {
            start: dayStart + window.startMinute * MINUTE_MS,
            end: dayStart + window.endMinute * MINUTE_MS,
            makeup: day.reason === 'makeup-workday'
          }
        }
      }
    }
  }
  // 空闲时段的「原因」决定文案：节假日 / 周末 / 午休 / 夜间 / 调休补班。
  //
  // 「调休补班」必须在这里也能出现（而不是只藏在 `makeup` 布尔里）：周六补班时
  // 用户看到的是一枚「空闲」徽标，而当天 09:00 起又会开始收费 —— 不解释这一句，
  // 用户会以为插件算错了。因此补班日的任何空闲时段都以 makeup-workday 为原因。
  let reason = 'night'
  if (day.reason === 'makeup-workday') reason = 'makeup-workday'
  else if (!day.workday) reason = day.holiday ? 'holiday' : 'weekend'
  else if (minute >= PEAK_WINDOWS[0].endMinute && minute < PEAK_WINDOWS[1].startMinute) reason = 'midday'
  return {
    period: 'off-peak',
    reason,
    workday: day.workday,
    holiday: day.holiday,
    weekend: day.weekend,
    makeup: day.reason === 'makeup-workday',
    window: null
  }
}

/**
 * 从某个时刻起，下一次**真正改变时段**的时刻。
 *
 * 注意「边界」与「切换」不是一回事：晚上 23:30 的下一个边界是 00:00 的日界，
 * 但跨越日界前后都还是空闲时段 —— 那不是切换。因此这里逐个边界比较时段，
 * 只有时段确实变了的那个才算。要问「下一个高峰/空闲什么时候开始」，
 * 用 `nextPeriodStart` 更直接。
 *
 * @param at - 起点（epoch 毫秒）。
 * @param options - 同 `periodAt`，外加 `days` 覆盖搜索跨度。
 * @returns `{at, period, reason, windows}`：`at` 是切换时刻，
 *   `period` 是切换**之后**的时段。跨度内找不到时退回「下一天日界」。
 */
export function nextTransition(at, options) {
  const tzOffsetMinutes = options?.tzOffsetMinutes ?? BILLING_TZ_OFFSET_MINUTES
  const before = periodAt(at, options)
  for (const candidate of boundaryCandidates(at, tzOffsetMinutes, options)) {
    if (candidate <= at) continue
    const after = periodAt(candidate, options)
    if (after.period === before.period) continue
    return { at: candidate, period: after.period, reason: after.reason, windows: peakWindowsForDay(candidate, options) }
  }
  // 理论上不可达（30 天里一定有高峰窗口）；真到了这里也返回一个自洽的答案。
  const fallback = dayStartMs(epochDayOf(at, tzOffsetMinutes) + 1, tzOffsetMinutes)
  const after = periodAt(fallback, options)
  return { at: fallback, period: after.period, reason: after.reason, windows: peakWindowsForDay(fallback, options) }
}

/** 候选边界的默认搜索跨度（天，向前）。见 `boundaryCandidates` 的说明。 */
const DEFAULT_SEARCH_DAYS = 30

/**
 * 候选边界的默认回看跨度（天，向后）。
 *
 * 必须与向前跨度一样长：`currentOffPeakWindow` 要往前找「这段空闲从哪一刻开始」，
 * 而一段空闲可以长到 9 天（春节）。只回看 1 天时，长假与「周末第二天」这类场景
 * 找不到任何「前一刻是高峰」的候选点，函数就会退回当天日界 —— 于是又低报了
 * 那几天的免费时长（这正是 v1.3 修的那个缺陷，第一次修只改了向前、没改向后）。
 */
const DEFAULT_BACK_DAYS = 30

/**
 * 候选边界时刻（升序去重）：日界，加上跨度内每个高峰窗口的起止。
 *
 * 时段只可能在这些点上变化，因此「下一次进入某个时段」只需在这些点里找。
 *
 * 跨度必须**两个方向**都够长 —— 这是 v1.3 被实测抓出来的一个真缺陷：
 * 原来只取今天与明天的边界（`[-1..2]` 天），于是
 *  - 向前：「周五 17:00 的下一个高峰」要去到周一 09:00（距今 2 天多）就已经找不到，
 *    `nextPeriodStart` 返回 null，面板上「距下一个高峰」整行消失；
 *  - 向后：「这段空闲从什么时候开始」在长假里要回看 8 天以上，找不到变化点就
 *    退回当天日界，把整段免费时长截短。
 * 中国法定节假日最长是 9 天（春节），所以两个方向都取 30 天有余量。
 *
 * ## v0.2.0：单槽缓存
 * `pricingSnapshot` 一次要查 5 个边界问题（下一次切换、下一个高峰、下一个空闲、
 * 完整空闲区间的两端），每次都会走到这里 —— 也就是**同一份 61 天 × 每天 2 个
 * classifyDay 的候选表被重复生成了 5 次**；面板展开时快照跟着秒级心跳走，
 * 这 5 次重复就发生在每一秒里。候选只由「基准日 + 时区 + 跨度 + 日历」决定，
 * 同一个计费日内结果逐毫秒不变，因此按这些维度做单槽缓存：同一天内的后续 4 次
 * 调用直接命中。**自定义日历（`options.holidays`）不缓存**：两张不同的自定义表
 * 在缓存键里区分不开，宁可慢也不能错。返回数组只读，调用方不修改它。
 *
 * @param at - 参照时刻。
 * @param tzOffsetMinutes - 计费时区偏移。
 * @param options - 同 `periodAt`，外加 `days` / `backDays` 覆盖跨度。
 * @returns 升序去重的边界数组。
 */
let boundaryCandidatesCache = null

function boundaryCandidates(at, tzOffsetMinutes, options) {
  const days = Number.isFinite(Number(options?.days)) && Number(options.days) > 0
    ? Math.floor(Number(options.days))
    : DEFAULT_SEARCH_DAYS
  const backDays = Number.isFinite(Number(options?.backDays)) && Number(options.backDays) > 0
    ? Math.floor(Number(options.backDays))
    : DEFAULT_BACK_DAYS
  const base = epochDayOf(at, tzOffsetMinutes)
  const customCalendar = options?.holidays !== undefined && options?.holidays !== null
  const cacheKey = customCalendar
    ? null
    : `${base}|${tzOffsetMinutes}|${days}|${backDays}|${options?.useCalendar === false ? 'off' : 'on'}`
  if (cacheKey !== null && boundaryCandidatesCache?.key === cacheKey) return boundaryCandidatesCache.value
  const out = []
  for (let offset = -backDays; offset <= days; offset += 1) {
    const dayStart = dayStartMs(base + offset, tzOffsetMinutes)
    out.push(dayStart)
    for (const window of peakWindowsForDay(dayStart, options)) {
      out.push(window.start)
      out.push(window.end)
    }
  }
  const value = [...new Set(out)].sort((a, b) => a - b)
  if (cacheKey !== null) boundaryCandidatesCache = { key: cacheKey, value }
  return value
}

/**
 * 下一次**进入**指定时段的时刻。
 *
 * 与 `nextTransition` 的区别很重要：晚上 23:30 的下一次「切换」只是 00:00 的日界，
 * 切换前后都还是空闲时段 —— 对用户没有意义。用户想知道的是「下一个高峰什么时候
 * 开始」（还能白用多久）或者「下一个空闲时段什么时候开始」（该不该现在收手），
 * 因此需要这个函数。
 *
 * @param at - 起点（epoch 毫秒）。
 * @param period - `'peak'` / `'off-peak'`。
 * @param options - 同 `periodAt`，外加 `days` 覆盖搜索跨度（默认 30 天）。
 * @returns 时刻（epoch 毫秒）；跨度内找不到时返回 null（30 天覆盖得住任何
 *   节假日长度，因此实际不会发生，返回值仍是 null 而不是抛错）。
 */
export function nextPeriodStart(at, period, options) {
  const tzOffsetMinutes = options?.tzOffsetMinutes ?? BILLING_TZ_OFFSET_MINUTES
  for (const candidate of boundaryCandidates(at, tzOffsetMinutes, options)) {
    if (candidate <= at) continue
    if (periodAt(candidate, options).period === period) return candidate
  }
  return null
}

/**
 * 某个时刻所在的**整段**空闲时段（向前向后各探一次切换点）。
 *
 * 用途是回答「等到空闲时段能省多少」：只有给出完整区间，用户才能判断
 * 「现在歇一会儿，等 18:00 之后再干」是不是划算。
 *
 * @param at - 空闲时段内的任意时刻；处于高峰时返回 null。
 * @returns `{start, end}`（epoch 毫秒）；高峰时段返回 null。
 */
export function currentOffPeakWindow(at, options) {
  if (periodAt(at, options).period !== 'off-peak') return null
  const tzOffsetMinutes = options?.tzOffsetMinutes ?? BILLING_TZ_OFFSET_MINUTES
  // 向后：第一个「进入高峰」的边界就是这段空闲的结束。
  const end = nextPeriodStart(at, 'peak', options) ?? nextTransition(at, options).at
  // 向前：往回找**真正的变化点** —— 「前一刻还在高峰」的那个时刻。
  //
  // 这一步不能用「最后一个 <= now 的候选点」：长假期间连着好几天整天都是空闲，
  // 期间那些 00:00 日界只是日历换页、并不是时段变化。用日界当起点会把整段空闲
  // 截成「从今天 0 点开始」，而用户昨天傍晚就已在半价里了 —— 面板会低报这段
  // 免费时长（国庆那种长度下少报好几天）。
  //
  // 而时段变化**只可能**发生在边界候选点上（高峰窗口的起止、或日界）：从「高峰」
  // 变成「空闲」要么是某个高峰窗口结束，要么是跨过日界（新的一天是休息日）。
  // 因此只需要在候选点上回扫，找最后一个「前一刻是高峰」的点 —— 既精确又是
  // O(候选数)，不必逐分钟地扫过整个长假。
  let start = null
  const candidates = boundaryCandidates(at, tzOffsetMinutes, options)
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const point = candidates[index]
    if (point > at) continue
    if (periodAt(point - 1, options).period === 'peak') {
      start = point
      break
    }
  }
  // 理论上不可达（空闲一定始于某个高峰的结束）。真到了这里就退回当天日界 ——
  // 宁可少报，也不要报一个查不出依据的起点。
  if (start === null) start = dayStartMs(epochDayOf(at, tzOffsetMinutes), tzOffsetMinutes)
  return { start: Math.min(start, at), end }
}

/**
 * 把价格口径换算成「每元能买多少输出 token」之类的可比指标。
 * 这里只做一件事：按当前时段取单价。
 *
 * @param model - `MODELS` 里的一项，或形如 `{peak, offPeak}` 的自定义价格。
 * @param period - `'peak'` / `'off-peak'`。
 * @param field - `'cacheHit'` / `'cacheMiss'` / `'output'`。
 * @returns 数值；输入非法返回 null。
 */
export function priceOf(model, period, field) {
  if (model === null || model === undefined) return null
  const table = period === 'peak' ? model.peak : model.offPeak
  const value = table?.[field]
  return Number.isFinite(value) ? value : null
}

/**
 * 由历史消耗速度推算金额 → token 的换算比例。
 *
 * 说明白这个估算的边界很重要：插件只看得见**余额变化**，看不见 token 用量。
 * 因此这里用一个「典型用量结构」把金额折算成等效 token，再用单价算时长。
 * 结论写成「同价位下大约能多用多久」而不是「精确到分钟」——
 * 前者对决策足够，后者是假精度。
 *
 * @param options - `{cacheHitShare, outputShare}`：缓存命中占比与输出 token 占比。
 * @param model - 价格表。
 * @param period - 时段。
 * @returns 每元对应的 `{input, output, total}` token 数；无法计算时返回 null。
 */
export function tokensPerYuan(options, model, period) {
  const cacheHitShare = clamp01(options?.cacheHitShare ?? 0.5)
  const outputShare = clamp01(options?.outputShare ?? 0.1)
  const inputPrice = priceOf(model, period, 'cacheHit')
  const missPrice = priceOf(model, period, 'cacheMiss')
  const outputPrice = priceOf(model, period, 'output')
  if (inputPrice === null || missPrice === null || outputPrice === null) return null
  const inputPriceAvg = (1 - cacheHitShare) * missPrice + cacheHitShare * inputPrice
  // 1 元 = 1e6 / 单价 个「百万 tokens」；按占比摊到输入与输出上。
  const inputTokens = inputPriceAvg > 0 ? ((1 - outputShare) * 1e6) / inputPriceAvg : null
  const outputTokens = outputPrice > 0 ? (outputShare * 1e6) / outputPrice : null
  if (inputTokens === null || outputTokens === null) return null
  return { input: inputTokens, output: outputTokens, total: inputTokens + outputTokens }
}

/**
 * 只接受数字或非空数字字符串；其余（`null` / `''` / `false` / `{}`）返回 null。
 *
 * 不能用 `Number.isFinite(Number(value))`：`Number(null)` 与 `Number('')` 都是 0，
 * 而 0 在这里分别意味着「1970 年」「余额为零」「UTC 时区」—— 三个都会让面板
 * 显示一个看似正常、实际错误的结果。这是 v0.1.6 对 `pricingSnapshot` 的修订，
 * 与 `billingDayOf` / `numberOr` 是同一条「null 不是 0」的规则。
 */
function finiteInput(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** 把数值夹到 [0, 1]。 */
function clamp01(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 0
  return Math.min(1, Math.max(0, parsed))
}

/**
 * 一次组装出面板与徽章需要的全部时段信息。
 *
 * 这是本模块的主入口：组件只调用它，不自己拼装。
 *
 * @param options - `{now, modelKey, models, tzOffsetMinutes, holidays, useCalendar,
 *   ratePerHour, currency, usageMix}`：
 *   - `now`：当前时刻（epoch 毫秒），便于测试注入；
 *   - `modelKey`：`MODELS` 里的 key 或 `'auto'`；
 *   - `ratePerHour`：近期消耗速度（元/小时，来自 `balance.js` 的 `computeRate`），
 *     给出时额外推算「余额还能用多久」与「空闲时段能多用多久」；
 *   - `usageMix`：金额 → token 的用量结构假设。
 * @returns 时段快照（见 README「计费时段」一节）；输入非法时也返回结构完整的
 *   结果，绝不抛错 —— 它会被接在每次渲染的路径上。
 */
export function pricingSnapshot(options) {
  // v0.1.6：`null` / `''` 不再被当成 0。`now: null` 曾会落到 1970 年，
  // `tzOffsetMinutes: null` 会落到 UTC（整体偏移 8 小时），而 `balance: null`
  // 会变成余额 0 并推出「撑不到下一个高峰」这种吓人的假结论。
  const now = finiteInput(options?.now) ?? Date.now()
  const tzOffsetMinutes = finiteInput(options?.tzOffsetMinutes) ?? BILLING_TZ_OFFSET_MINUTES
  const timeOptions = {
    tzOffsetMinutes,
    holidays: options?.holidays,
    useCalendar: options?.useCalendar
  }
  const state = periodAt(now, timeOptions)
  const transition = nextTransition(now, timeOptions)
  const offPeakWindow = currentOffPeakWindow(now, timeOptions)
  // 用户真正关心的两个「下一次」：还能白用多久（下一个高峰），
  // 以及该不该现在收手（下一个空闲时段）。注意与 nextChangeAt 不同：
  // 23:30 的下一次切换只是 00:00 的日界，前后都是空闲，对用户没有意义。
  const nextPeakAt = nextPeriodStart(now, 'peak', timeOptions)
  const nextOffPeakAt = nextPeriodStart(now, 'off-peak', timeOptions)
  const model = selectModel(options)
  const tokens = tokensPerYuan(options?.usageMix ?? DEFAULT_USAGE_MIX, model, state.period)
  const balance = finiteInput(options?.balance)
  const rateInput = finiteInput(options?.ratePerHour)
  const ratePerHour = rateInput !== null && rateInput > 0 ? rateInput : null
  const remainingMs = balance === null || ratePerHour === null ? null : (balance / ratePerHour) * HOUR_MS

  return {
    now,
    tzOffsetMinutes,
    /** `'peak'` / `'off-peak'`。 */
    period: state.period,
    reason: state.reason,
    isPeak: state.period === 'peak',
    isOffPeak: state.period === 'off-peak',
    workday: state.workday,
    holiday: state.holiday,
    weekend: state.weekend,
    /** 今天是否因为官方调休补班而成为工作日（周六/周日却有高峰时段）。 */
    makeup: state.makeup,
    /** 当前所在高峰区间的起止（空闲时段为 null）。 */
    window: state.window === null ? null : { start: state.window.start, end: state.window.end },
    /** 下一次时段切换的绝对时刻，以及切换**之后**的时段。 */
    nextChangeAt: transition.at,
    nextPeriod: transition.period,
    nextReason: transition.reason,
    /** 距下一次切换还有多久（毫秒），恒为正。 */
    msUntilChange: Math.max(0, transition.at - now),
    /**
     * 下一个高峰时段的开始时刻与倒计时。
     *
     * 处于空闲时段时，这就是「还能按半价用多久」；处于高峰时段时，
     * 它是「这一轮高峰结束后下一轮何时开始」（通常就是明天同一时间）。
     */
    nextPeakAt,
    msUntilPeak: nextPeakAt === null ? null : Math.max(0, nextPeakAt - now),
    /** 下一个空闲时段的开始时刻与倒计时（高峰时段里最该看的一个数）。 */
    nextOffPeakAt,
    msUntilOffPeak: nextOffPeakAt === null ? null : Math.max(0, nextOffPeakAt - now),
    /** 当前所在的完整空闲区间（高峰时段为 null）。 */
    offPeakWindow,
    /** 空闲时段折扣（0.5 = 5 折）。 */
    offPeakMultiplier: OFF_PEAK_MULTIPLIER,
    /** 生效的价格表（选中的模型或自定义价格）。 */
    model,
    tokensPerYuan: tokens,
    balance,
    ratePerHour,
    /** 按当前速度，余额还能用多久（毫秒）；缺速度或余额时 null。 */
    remainingMs,
    /** 按当前速度，余额能撑到下一个高峰开始吗？空闲时段里这个问题最有价值。 */
    lastsUntilNextPeak:
      state.period === 'off-peak' && remainingMs !== null && nextPeakAt !== null
        ? remainingMs >= nextPeakAt - now
        : null,
    /**
     * 同样的钱在空闲时段**能用多久**（不是「省下多久」，两者差一倍）。
     *
     * 只有处在高峰时段才有意义（空闲时它等于「现在就能省」）。算法很直接：
     * 空闲单价是高峰的一半，因此同样的钱在空闲时段可以买到**两倍**的 token，
     * 也就是同样的消耗速度下**时长翻倍** —— 所以要除以折扣倍数，而不是乘
     * 「省下的比例」。
     *
     * v1.4 修正（v1.3 的实现差 2 倍，见 docs/V14-DEFECTS.md 的 D3）：
     * 原来写的是 `remainingMs * (1 / OFF_PEAK_MULTIPLIER - 1)`，代入 0.5 得系数 1，
     * 于是它**恰好等于** `remainingMs` 本身。而字段名（`offPeakRemaining`）
     * 与唯一使用点（面板的 `panel.tariff.saveGeneric`「同样的钱在空闲时段能用约
     * {duration}」）要的都是**能用多久**。语义、名字、用法三者统一到「能用多久」，
     * 「省下多少」另立 `offPeakSavingMs`。
     */
    offPeakRemainingMs:
      state.period === 'peak' && remainingMs !== null ? remainingMs / OFF_PEAK_MULTIPLIER : null,
    /**
     * 改用空闲时段能**省下多少时间**（高峰才有）。
     *
     * 与上一个是两个不同的数：「能用 12 小时」和「省下 6 小时」。面板当前的文案
     * 用不到它，但它是「留到空闲再跑划算吗」这个问题的直接答案，且把两个数的关系
     * 显式写出来，避免以后再有人把 `remainingMs` 当成其中一个。
     */
    offPeakSavingMs:
      state.period === 'peak' && remainingMs !== null
        ? remainingMs / OFF_PEAK_MULTIPLIER - remainingMs
        : null,
    /** 数据来源，面板「价格」行给出，便于用户核对。 */
    /**
     * 价格数据来源。
     *
     * 用**生效的那张表**自己的 source，而不是回落到内置 URL —— 传入自定义价格表
     * （没有 source）时，回落会把「这份价格来自官方文档」这句话安到一份用户自己
     * 填的价格上。拿不到就返回 null，面板据此不渲染来源那一行。
     */
    priceSource: typeof model?.source === 'string' && model.source !== '' ? model.source : null
  }
}

/**
 * 选出要展示价格的模型。
 *
 * `auto` 的语义：插件看不见「你正在用哪个模型」（宿主不暴露该信息），
 * 因此不猜；`auto` 直接等于 `DEFAULT_MODEL_KEY`，把选择权留给设置里的下拉框。
 * 之所以保留 `auto` 这个选项值，是为了让配置在模型换代后仍能有一个明确的
 * 「跟随默认」语义。
 *
 * @param options - `{modelKey, models}`。
 * @returns 价格表对象。
 */
export function selectModel(options) {
  const list = Array.isArray(options?.models) && options.models.length > 0 ? options.models : MODELS
  const key = options?.modelKey
  if (typeof key === 'string' && key !== 'auto') {
    const found = list.find((item) => item.key === key)
    if (found !== undefined) return found
  }
  return list.find((item) => item.key === DEFAULT_MODEL_KEY) ?? list[0]
}

/**
 * 便捷包装：某个时刻是不是高峰（测试与探针用）。
 * @param at - epoch 毫秒。
 * @param options - 同 `periodAt`。
 */
export function isPeakAt(at, options) {
  return periodAt(at, options).period === 'peak'
}
