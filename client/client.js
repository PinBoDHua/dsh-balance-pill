window.__ModuleLoader__.load({
	id: "dsh-balance-pill",
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
		const React = require("react")
		const ReactDOM = require("react-dom")

// ---- src/client/calendars.js ---------------------------------
/**
 * DeepSeek Harness 余额徽章 —— 中国大陆法定节假日日历（内置数据）。
 *
 * ## 为什么插件里要带一份日历
 * DeepSeek 的计费口径是「北京时间周一至周五（**不含中国法定节假日**）的高峰窗口内
 * 为高峰时段，其余时间为空闲时段」。这里的「不含法定节假日」不是细节：
 * 春节九天、国庆七天、以及每个小长假，全天都是空闲时段（价格减半）；
 * 反过来，官方**调休补班**的周六是工作日，那天照样有高峰时段。
 * 只按「周一到周五」判定会在两头都算错，而算错的后果直接是报价与预估错误。
 *
 * ## 数据形状
 * `'YYYY-MM-DD'(北京时间当天) → 0 | 1`
 *  - `1` = 法定节假日**放假**日（全天空闲）；
 *  - `0` = 官方调休**上班**日（按工作日计费，通常落在周末）。
 * 表里没有的日期走常规规则：周一至周五 = 工作日，周六周日 = 休息日。
 *
 * ## 数据来源
 * - 2026：国务院办公厅《关于2026年部分节假日安排的通知》
 *   （国办发明电〔2025〕7号，2025-11-04 发布）
 *   https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm
 * - 2025：国务院办公厅《关于2025年部分节假日安排的通知》
 *   （国办发明电〔2024〕7号，2024-11-12 发布）
 *   https://www.gov.cn/zhengce/content/202411/content_6986382.htm
 *
 * 保留 2025 不只是「顺手存档」：余额历史上限是 7 天，跨年的那段历史里
 * 采样点会落在 2025 的日期上，日历缺一年会让那些点的时段注记变成错的。
 *
 * ## 怎么更新
 * 每年 11 月国务院办公厅会发布下一年的安排。更新方式：
 *   1. 按上面两个来源把新一年的 `1`/`0` 补进本表（保持日期升序，便于核对）；
 *   2. 在 `tests/runtime.test.mjs` 里补一条断言（已有的断言是逐条抄公告的，
 *      补数据时顺手补断言，能挡住手抄错误）；
 *   3. 面板会展示「数据覆盖到哪一年」，用户看得见自己是不是需要更新。
 *
 * 数据是**内置而非联网抓取**的：时段判定必须在离线、无网络、接口挂掉时依然正确，
 * 而这是插件每次渲染都要用到的结论。内置一份可审阅的静态表，代价是每年更新一次。
 */

/** 日历覆盖的年份区间（面板据此提示「日历已过期」）。 */
const CALENDAR_YEARS = [2025, 2026]

/**
 * 法定节假日 / 调休上班日 → 标记。
 * @type {Record<string, 0 | 1>}
 */
const CHINA_HOLIDAYS = {
  // ---------------------------------------------------------------- 2025
  // 元旦：1 月 1 日放假 1 天。
  '2025-01-01': 1,
  // 春节：1 月 28 日至 2 月 4 日放假调休，共 8 天；1 月 26 日（周日）、
  //       2 月 8 日（周六）上班。
  '2025-01-26': 0,
  '2025-01-28': 1,
  '2025-01-29': 1,
  '2025-01-30': 1,
  '2025-01-31': 1,
  '2025-02-01': 1,
  '2025-02-02': 1,
  '2025-02-03': 1,
  '2025-02-04': 1,
  '2025-02-08': 0,
  // 清明节：4 月 4 日至 6 日放假，共 3 天（无调休）。
  '2025-04-04': 1,
  '2025-04-05': 1,
  '2025-04-06': 1,
  // 劳动节：5 月 1 日至 5 日放假调休，共 5 天；4 月 27 日（周日）上班。
  '2025-04-27': 0,
  '2025-05-01': 1,
  '2025-05-02': 1,
  '2025-05-03': 1,
  '2025-05-04': 1,
  '2025-05-05': 1,
  // 端午节：5 月 31 日至 6 月 2 日放假，共 3 天（无调休）。
  '2025-05-31': 1,
  '2025-06-01': 1,
  '2025-06-02': 1,
  // 国庆节、中秋节：10 月 1 日至 8 日放假调休，共 8 天；
  //       9 月 28 日（周日）、10 月 11 日（周六）上班。
  '2025-09-28': 0,
  '2025-10-01': 1,
  '2025-10-02': 1,
  '2025-10-03': 1,
  '2025-10-04': 1,
  '2025-10-05': 1,
  '2025-10-06': 1,
  '2025-10-07': 1,
  '2025-10-08': 1,
  '2025-10-11': 0,

  // ---------------------------------------------------------------- 2026
  // 元旦：1 月 1 日（周四）至 3 日（周六）放假调休，共 3 天；1 月 4 日（周日）上班。
  '2026-01-01': 1,
  '2026-01-02': 1,
  '2026-01-03': 1,
  '2026-01-04': 0,
  // 春节：2 月 15 日（腊月二十八）至 23 日（正月初七）放假调休，共 9 天；
  //       2 月 14 日（周六）、2 月 28 日（周六）上班。
  '2026-02-14': 0,
  '2026-02-15': 1,
  '2026-02-16': 1,
  '2026-02-17': 1,
  '2026-02-18': 1,
  '2026-02-19': 1,
  '2026-02-20': 1,
  '2026-02-21': 1,
  '2026-02-22': 1,
  '2026-02-23': 1,
  '2026-02-28': 0,
  // 清明节：4 月 4 日（周六）至 6 日（周一）放假，共 3 天（无调休）。
  '2026-04-04': 1,
  '2026-04-05': 1,
  '2026-04-06': 1,
  // 劳动节：5 月 1 日（周五）至 5 日（周二）放假调休，共 5 天；5 月 9 日（周六）上班。
  '2026-05-01': 1,
  '2026-05-02': 1,
  '2026-05-03': 1,
  '2026-05-04': 1,
  '2026-05-05': 1,
  '2026-05-09': 0,
  // 端午节：6 月 19 日（周五）至 21 日（周日）放假，共 3 天（无调休）。
  '2026-06-19': 1,
  '2026-06-20': 1,
  '2026-06-21': 1,
  // 中秋节：9 月 25 日（周五）至 27 日（周日）放假，共 3 天；9 月 20 日（周日）上班。
  '2026-09-20': 0,
  '2026-09-25': 1,
  '2026-09-26': 1,
  '2026-09-27': 1,
  // 国庆节：10 月 1 日（周四）至 7 日（周三）放假调休，共 7 天；10 月 10 日（周六）上班。
  '2026-10-01': 1,
  '2026-10-02': 1,
  '2026-10-03': 1,
  '2026-10-04': 1,
  '2026-10-05': 1,
  '2026-10-06': 1,
  '2026-10-07': 1,
  '2026-10-10': 0
}

/** 日历覆盖的最后一年；用于「日历需要更新」提示。 */
const CALENDAR_LAST_YEAR = Math.max(...CALENDAR_YEARS)

/** 日历覆盖的第一年。 */
const CALENDAR_FIRST_YEAR = Math.min(...CALENDAR_YEARS)

/**
 * 某个年份是否在日历覆盖范围内。
 * @param year - 四位年份。
 * @returns 是否覆盖。
 */
function calendarCovers(year) {
  return Number.isInteger(year) && year >= CALENDAR_FIRST_YEAR && year <= CALENDAR_LAST_YEAR
}

// ---- src/client/pricing.js -----------------------------------
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



/**
 * 平台计费时区相对 UTC 的分钟偏移。北京时间 = UTC+08:00。
 * 注意这**不是**用户的本地时区：无论用户在哪，计费时段都按北京时间划。
 */
const BILLING_TZ_OFFSET_MINUTES = 480

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
const PEAK_WINDOWS = [
  { startMinute: 9 * 60, endMinute: 12 * 60 },
  { startMinute: 14 * 60, endMinute: 18 * 60 }
]

/** 时段标识。 */
const PERIODS = ['peak', 'off-peak']

/**
 * 空闲时段的折扣倍数（相对高峰价）。
 *
 * 文档口径是「空闲时段价格为高峰时段价格的一半」，因此单价直接乘 0.5；
 * 这个常量被用来在面板上显示「空闲时段 5 折」以及推算省下的钱。
 */
const OFF_PEAK_MULTIPLIER = 0.5

/**
 * 内置价格表（以平台文档为准，单位：元 / 百万 tokens）。
 *
 * 只内置**官方在售的两个模型**，避免把来路不明或已下线的价格写成事实。
 * 这两个模型的价格关系是干净的 2 倍（flash）与 3 倍（pro）：空闲 = 高峰 / 2，
 * 而 pro 的输入是 flash 的 4.5 倍、输出是 flash 的 3.375 倍 —— 因此三个数值
 * 都必须逐项列出，不能靠一个倍数推导。
 */
const MODELS = [
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
const DEFAULT_MODEL_KEY = 'flash'

/**
 * 默认用量结构：缓存命中占比与输出 token 占比的经验值。
 *
 * 插件只看得见余额变化，看不见 token 用量，因此把「金额」折算成「等效 token」
 * 时必须假设一个用量结构。这两个数是**保守的常见值**（长会话里上下文重复度高，
 * 缓存命中占比通常不低；agent 场景输出占比通常低于 10%）。它们只用于把消耗速度
 * 折算成时长，结论以「大约」的形式展示。
 */
const DEFAULT_USAGE_MIX = { cacheHitShare: 0.5, outputShare: 0.1 }

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
function peakWindowsForDay(at, options) {
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
function periodAt(at, options) {
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
function nextTransition(at, options) {
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
 * @param at - 参照时刻。
 * @param tzOffsetMinutes - 计费时区偏移。
 * @param options - 同 `periodAt`，外加 `days` / `backDays` 覆盖跨度。
 * @returns 升序去重的边界数组。
 */
function boundaryCandidates(at, tzOffsetMinutes, options) {
  const days = Number.isFinite(Number(options?.days)) && Number(options.days) > 0
    ? Math.floor(Number(options.days))
    : DEFAULT_SEARCH_DAYS
  const backDays = Number.isFinite(Number(options?.backDays)) && Number(options.backDays) > 0
    ? Math.floor(Number(options.backDays))
    : DEFAULT_BACK_DAYS
  const base = epochDayOf(at, tzOffsetMinutes)
  const out = []
  for (let offset = -backDays; offset <= days; offset += 1) {
    const dayStart = dayStartMs(base + offset, tzOffsetMinutes)
    out.push(dayStart)
    for (const window of peakWindowsForDay(dayStart, options)) {
      out.push(window.start)
      out.push(window.end)
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
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
function nextPeriodStart(at, period, options) {
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
function currentOffPeakWindow(at, options) {
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
function priceOf(model, period, field) {
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
function tokensPerYuan(options, model, period) {
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
function pricingSnapshot(options) {
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
function selectModel(options) {
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
function isPeakAt(at, options) {
  return periodAt(at, options).period === 'peak'
}

// ---- src/client/settings.js ----------------------------------
/**
 * 余额徽章 —— 配置模型与持久化。
 *
 * ## 为什么是 localStorage 而不是宿主 configForms
 * 宿主的 `configForms` 面向的是「有宿主侧服务、由 cordis 配置块驱动」的插件
 * （它需要 package 声明配置 schema 并挂 Host 服务）。本插件的宿主侧只有空壳，
 * 全部行为在渲染层，因此配置存在浏览器里最贴合实际，也最不容易在宿主升级时炸掉。
 *
 * ## 兼容性
 * v1.0 只有 `dsh-balance-pill:thresholds` 一个键（`{low, warn}`）。v1.1 换成
 * 单个 `dsh-balance-pill:settings` 对象；读取时先看新键，没有就用旧键迁移，
 * 迁移后旧键保留不动（回滚到 v1.0 时用户的自定义阈值还在）。
 *
 * ## 硬约束
 * 任何一项解析失败都只回落到该项的默认值，绝不让配置把徽章打挂：
 * 这个模块的每个分支都对应 tests/runtime.test.mjs 里的一条用例。
 */



/** 插件 id，与 package.json 的 name 一致。 */
const NS = 'dsh-balance-pill'

/** v1.1 配置键。 */
const SETTINGS_KEY = `${NS}:settings`

/** v1.0 遗留的阈值键（读取时迁移，不删除）。 */
const LEGACY_THRESHOLDS_KEY = `${NS}:thresholds`

/** 徽章数字口径。 */
const FORMATS = ['total', 'recharge', 'bonus']

/** 币种选择；`auto` 表示优先人民币、其次美元。 */
const CURRENCIES = ['auto', 'CNY', 'USD']

/**
 * 面板价格口径的白名单。
 *
 * 从 `pricing.js` 的 `MODELS` 派生而不是再抄一份：价格表只有一处定义，
 * 设置层的白名单跟着它走，模型换代时不会出现「设置里能选、引擎里没有」的缝。
 */
const TARIFF_MODELS = MODELS.map((model) => model.key)

/** 轮询间隔的可选档位（毫秒）；0 表示只在手动与焦点事件时读取。 */
const POLL_CHOICES = [0, 30000, 60000, 300000]

/** 轮询间隔默认值：60 秒。 */
const DEFAULT_POLL_MS = 60000

/** 距离上次读取多久之内不再重复请求（手动刷新与自动刷新共用）。 */
const MIN_REFRESH_GAP_MS = 10000

/** 全部默认配置。 */
const DEFAULT_SETTINGS = {
  /** 徽章数字口径：可用总额 / 仅充值余额 / 仅赠金余额。 */
  format: 'total',
  /** 展示币种：auto / CNY / USD。 */
  currency: 'auto',
  /** 低于该金额判红。 */
  low: 3,
  /** 低于该金额判橙。 */
  warn: 10,
  /** 轮询间隔（毫秒）。 */
  pollMs: DEFAULT_POLL_MS,
  /** 是否显示消费速度与预估可用时长。 */
  showRate: true,
  /** 紧凑模式：不显示币种符号。 */
  compact: false,
  /** 面板里是否画余额趋势图（v1.2）。 */
  showTrend: true,
  /** 面板里是否显示「本轮会话消耗」（v1.2）。 */
  showSessionSpend: true,
  /** 余额跨档（变差）时是否提醒（v1.2）。 */
  alertOnCross: true,
  /** 状态行徽章上是否标出当前计费时段（高峰 / 空闲）（v1.3）。 */
  showTariff: true,
  /** 面板价格与预估使用的价格口径（v1.3）；取值来自 `TARIFF_MODELS`。 */
  tariffModel: DEFAULT_MODEL_KEY,
  /**
   * 时段切换（进入高峰 / 进入空闲）时是否提醒（v1.3）。
   *
   * 默认**关**：余额不足是「会打断你」的事件，值得主动弹卡；而时段切换是
   * 规律的、每天都会发生的事，默认弹卡会变成噪音。用户想要就被动打开。
   */
  alertOnTariff: false
}

/** 取一个可用的 localStorage；不可用时返回 undefined（隐私模式、Node 测试）。 */
function resolveStorage() {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/** 内部别名：本模块多处按「默认存储」语义使用它。 */
function defaultStorage() {
  return resolveStorage()
}

/** 解析存储里的 JSON 对象；任何异常返回 null。 */
function readObject(store, key) {
  if (store === undefined || store === null) return null
  try {
    const raw = store.getItem(key)
    if (typeof raw !== 'string' || raw === '') return null
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 读取一个有限非负数；非法返回 fallback。
 *
 * v1.5 修正：**不能**直接 `Number(value)` —— `Number(null)`、`Number('')`、
 * `Number(false)` 都是 0，会被当成一个合法的「0 元阈值」静默吞掉。用户把设置里
 * 的输入框清空（或存储里写进 `null`）时，阈值会变成 0，于是**任何余额都判红**，
 * 而界面上看不出任何异常。这与 `history.billingDayOf` / `tariff-alert` 里
 * 「null 不是 1970」是同一条教训：只接受数字，或**非空**的数字字符串。
 */
function numberOr(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : fallback
  if (typeof value !== 'string' || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** 读取一个枚举值；不在白名单内返回 fallback。 */
function enumOr(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/** 读取一个布尔值；非布尔返回 fallback。 */
function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 把一份原始配置归一化成完整配置。
 *
 * 单独导出是因为「归一化」是这层唯一有分支的逻辑，值得被直接单测；
 * `loadSettings` 只是它加上「找存储」。
 *
 * 关于写反的阀值：这里采用**对调**（`low:50, warn:10` → `low:10, warn:50`）。
 * 读到坏数据时对调能保住两个档位都还在，是对未知来源数据最无害的修复。
 * 注意这与设置面板里的编辑行为不同：那里用户意图明确（「我在改红色阈值」），
 * 因此改成推动兄弟字段而不是对调 —— 否则用户把红色阈值填到 42 会看到
 * 红色档位反而变成 1，语义被静默颠倒。见 `settings-row.js` 的 clampSibling。
 *
 * @param raw - 存储里读出来的对象（可能残缺、可能带非法类型）。
 * @param legacy - v1.0 的阈值对象，作为 low/warn 的兜底来源。
 * @returns 完整的配置对象。
 */
function normalizeSettings(raw, legacy) {
  const source = raw ?? {}
  const thresholds = legacy ?? {}
  const warn = numberOr(source.warn, numberOr(thresholds.warn, DEFAULT_SETTINGS.warn))
  const low = numberOr(source.low, numberOr(thresholds.low, DEFAULT_SETTINGS.low))
  return {
    format: enumOr(source.format, FORMATS, DEFAULT_SETTINGS.format),
    currency: enumOr(source.currency, CURRENCIES, DEFAULT_SETTINGS.currency),
    low: Math.min(low, warn),
    warn: Math.max(low, warn),
    pollMs: normalizePoll(source.pollMs),
    showRate: boolOr(source.showRate, DEFAULT_SETTINGS.showRate),
    compact: boolOr(source.compact, DEFAULT_SETTINGS.compact),
    showTrend: boolOr(source.showTrend, DEFAULT_SETTINGS.showTrend),
    showSessionSpend: boolOr(source.showSessionSpend, DEFAULT_SETTINGS.showSessionSpend),
    alertOnCross: boolOr(source.alertOnCross, DEFAULT_SETTINGS.alertOnCross),
    showTariff: boolOr(source.showTariff, DEFAULT_SETTINGS.showTariff),
    tariffModel: enumOr(source.tariffModel, TARIFF_MODELS, DEFAULT_SETTINGS.tariffModel),
    alertOnTariff: boolOr(source.alertOnTariff, DEFAULT_SETTINGS.alertOnTariff)
  }
}

/**
 * 保持 `low <= warn` 不变量的编辑补丁。
 *
 * 用户改红色阈值时，橙色阈值只往上让路；改橙色阈值时，红色阈值只往下让路。
 * 结果可能让某一个档位塌缩成空区间（例如两者都变成 42），但**语义不会被颠倒** ——
 * 空区间是用户一眼能看出来的，静默对调不是。
 *
 * @param settings - 当前配置。
 * @param patch - 待写入的补丁（只需含 low/warn 之一）。
 * @returns 补齐了兄弟字段的补丁。
 */
function clampThresholdPatch(settings, patch) {
  const next = { ...patch }
  if (patch.low !== undefined) {
    const low = numberOr(patch.low, settings.low)
    next.low = low
    // 只在用户没有同时编辑橙色阈值时才推动它。
    if (patch.warn === undefined && settings.warn < low) next.warn = low
  }
  if (patch.warn !== undefined) {
    const warn = numberOr(patch.warn, settings.warn)
    next.warn = warn
    if (patch.low === undefined && settings.low > warn) next.low = warn
  }
  return next
}

/**
 * 轮询间隔归一化：非法值回落默认，合法值对齐到最近的档位（允许任意非负值）。
 *
 * v0.1.6 修：`Number('')` / `Number(false)` 同样是 0，会被当成合法的
 * 「仅手动」档位。用户把存储写坏成空串时，插件会静默停止轮询，看起来像
 * 「余额不再更新」。这里与 `numberOr()` 用同一条规则：只接受数字或非空数字
 * 字符串；数值 0 仍然合法（那是明确的「仅手动」）。
 */
function normalizePoll(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return DEFAULT_SETTINGS.pollMs
  } else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SETTINGS.pollMs
    return normalizePollNumber(parsed)
  } else {
    return DEFAULT_SETTINGS.pollMs
  }
  return normalizePollNumber(value)
}

/** 轮询数值的档位修正：小于 5 秒会把宿主打到限流，视为误配。 */
function normalizePollNumber(value) {
  const parsed = Math.round(value)
  if (parsed > 0 && parsed < 5000) return 5000
  return parsed
}

/**
 * 读取配置：新键优先，其次迁移 v1.0 的阈值键，最后是默认值。
 * @param storage - 形如 localStorage 的对象；缺省读全局。
 */
function loadSettings(storage = defaultStorage()) {
  return normalizeSettings(readObject(storage, SETTINGS_KEY), readObject(storage, LEGACY_THRESHOLDS_KEY))
}

/**
 * 写入配置。
 * @param settings - 待写入的配置（会先归一化）。
 * @param storage - 形如 localStorage 的对象；缺省读全局。
 * @returns 实际写入的配置；存储不可用时返回归一化结果但不报错。
 */
function saveSettings(settings, storage = defaultStorage()) {
  const normalized = normalizeSettings(settings)
  if (storage !== undefined && storage !== null) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized))
    } catch {
      /* 配额或隐私模式：配置本次有效即可，不打断使用 */
    }
  }
  return normalized
}

/**
 * 一个极小的可订阅配置存储。
 *
 * 组件层用 `subscribe` + `get` 绑定到 React state：这样「设置里改了阈值，
 * 徽章立刻变红」不需要刷新页面，也不需要把配置塞进 cordis 服务。
 *
 * @param initial - 初始配置；缺省从 localStorage 读。
 * @param storage - 持久化目标；缺省 localStorage。
 */
function createSettingsStore(initial, storage = defaultStorage()) {
  let current = initial ?? loadSettings(storage)
  const listeners = new Set()
  return {
    /** 当前配置（只读快照）。 */
    get: () => current,
    /** 合并写入若干字段并通知订阅者；返回写入后的配置。 */
    update(patch) {
      const next = saveSettings({ ...current, ...patch }, storage)
      const changed = Object.keys(next).some((key) => next[key] !== current[key])
      current = next
      if (changed) for (const listener of [...listeners]) listener(current)
      return current
    },
    /** 恢复默认值并写入。 */
    reset() {
      return this.update(DEFAULT_SETTINGS)
    },
    /** 订阅变更；返回取消订阅函数。 */
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}

// ---- src/client/balance.js -----------------------------------
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



/**
 * 随每次账号调用上报的客户端版本。
 *
 * 宿主会把 `version / locale / timezoneOffsetSeconds` 归约成开放平台的五个
 * `x-client-*` 请求头（`@deepseek-ai/dsh-deepseek-account` 的
 * platformClientHeaders），它只用于平台侧统计界面来源，不参与鉴权。
 */
const CLIENT_VERSION = '0.2.0-rc.2'

/** 目标语言键 → 平台需要的 locale 前缀。 */
function platformLocale(active) {
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
function clientMetadata(active) {
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
function parseAmount(text) {
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
function normalizeWallets(wallets) {
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
function pickCurrency(recharge, bonus, preference = 'auto') {
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
function summarize(detail, options) {
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
function levelFor(amount, thresholds) {
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
function classifyBalance(result) {
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
const RATE_MAX_ELAPSED_MS = 6 * 3600 * 1000

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
function rateBaseline(previous, summary, at) {
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
function computeRate(previous, current) {
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
function viewModel(input) {
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
function amountFor(summary, format) {
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
function refreshedViewModel(input) {
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

// ---- src/client/account.js -----------------------------------
/**
 * 余额徽章 —— 账号能力的客户端桥。
 *
 * 余额不经过本插件自己的网络请求：宿主已经挂载了账号服务，并通过 Typert Remote
 * 把 `account` 命名空间暴露给渲染层（`@deepseek-ai/dsh-api-account-controller`
 * 的 `super(ctx, "accountController", { namespace: "account" })`）。客户端插件只要
 * 拿到 `ctx.remote.account` 就能调用它，凭据始终留在宿主进程里。
 *
 * 这里把「取服务 + 调用 + 失败降级」收在一处，让组件层只面对
 * `{available(), read()}` 两个方法，也方便在 Node 里用假对象测试。
 */



/**
 * 组装账号客户端。
 *
 * @param ctx - 客户端 cordis 上下文。
 * @returns `{available(): boolean, read(): Promise<{balance, state}>}`。
 */
function createAccountClient(ctx) {
  /**
   * 惰性解析 `remote.account`。
   *
   * 不在 apply 阶段硬注入这个服务名：`remote.account` 由 api-remotes 在
   * 运行时挂载，某些部署可能没有账号能力。惰性解析让插件照样加载，只是徽章
   * 自己进入「不可用」状态，而不是让整个插件卡在等待依赖里。
   */
  const resolve = () => {
    try {
      const direct = ctx.get('remote.account')
      if (direct !== null && direct !== undefined) return direct
    } catch {
      /* 服务未注册：继续尝试下面的回退路径 */
    }
    try {
      const remote = ctx.get('remote')
      if (remote !== null && remote !== undefined && remote.account !== undefined) return remote.account
    } catch {
      /* 同上 */
    }
    return null
  }

  /** 当前界面语言；locale 服务不可用时退回浏览器语言。 */
  const activeLocale = () => {
    try {
      const snapshot = ctx.locale.getSnapshot()
      if (snapshot !== null && typeof snapshot.active === 'string' && snapshot.active !== '') return snapshot.active
    } catch {
      /* locale 快照不可读 */
    }
    return globalThis.navigator?.language ?? 'zh-CN'
  }

  /**
   * 调一个 Remote 方法并把任何异常压成失败结果。
   *
   * Remote 的正常返回是 `{ok, value}|{ok, error}`；这里额外兜住三种情况：
   * 命名空间缺失、方法抛错、返回值不是 Result 形状。
   *
   * `available()` 与 `read()` 之间的竞态是真实存在的：插件加载时 `remote.account`
   * 可能还没挂载完成，等真的要读时它已经就绪（或反过来）。因此每次调用都重新
   * `resolve()`，而不是把结果缓存下来。
   */
  const call = async (method, ...args) => {
    const api = resolve()
    if (api === null) return { ok: false, error: { code: 'UNAVAILABLE' } }
    const fn = api[method]
    if (typeof fn !== 'function') return { ok: false, error: { code: 'UNAVAILABLE' } }
    try {
      const result = await fn.call(api, ...args)
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') return result
      return { ok: true, value: result }
    } catch (error) {
      return { ok: false, error: { code: 'THREW', message: String(error?.message ?? error) } }
    }
  }

  return {
    available: () => resolve() !== null,
    /** 当前界面语言（面板与设置的本地化都用它）。 */
    activeLocale,
    async read() {
      const metadata = clientMetadata(activeLocale())
      const [balance, state] = await Promise.all([
        call('getBalance', metadata),
        call('getState')
      ])
      return { balance, state }
    }
  }
}

// ---- src/client/alert.js -------------------------------------
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
const DEFAULT_COOLDOWN_MS = 30 * 60 * 1000

/**
 * 初始状态：还没有观测过任何档位。
 *
 * `configKey` 记录这次档位是按哪套「口径 + 阈值 + 币种」算出来的。它不是
 * 渲染字段，只用于区分「余额真的掉了」与「用户改了显示口径」—— 后者会让
 * 金额与档位同时跳变，旧实现会把它当成一次真实的掉档并弹出「余额不足」。
 */
function createAlertState() {
  return { level: null, alertedLevel: null, at: 0, alertedAt: 0, seq: 0, amount: null, configKey: null }
}

/** 档位是否比另一个更糟。 */
function isWorse(level, than) {
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
function advanceAlert(state, reading, options) {
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
function serializeAlertState(state) {
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
function deserializeAlertState(raw) {
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
function createAlertStore() {
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

// ---- src/client/format.js ------------------------------------
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
function resolveLocale(active) {
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
function formatAmount(value, options) {
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
function formatThreshold(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  if (Number.isInteger(value)) return formatAmount(value, { ...options, digits: 0 })
  return formatAmount(value, options)
}

/** 带正负号的金额，用于「已消耗 / 已充值」这类增减量。 */
function formatDelta(value, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const text = formatAmount(Math.abs(value), options)
  if (text === '--' || text.startsWith('<') || text.startsWith('>')) return text
  return value < 0 ? `-${text}` : `+${text}`
}

/** 带正负号的金额 + 币种符号，面板里的增减量都走这个（与其他行保持同一写法）。 */
function formatMoneyDelta(value, currency, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const text = formatAmount(Math.abs(value), options)
  if (text === '--' || text.startsWith('<') || text.startsWith('>')) return `${currencySymbol(currency)}${text}`
  return `${value < 0 ? '-' : '+'}${currencySymbol(currency)}${text}`
}

/** 币种符号：人民币 ¥，美元 $，未知币种沿用平台给的代码。 */
function currencySymbol(currency) {
  if (currency === 'CNY') return '¥'
  if (currency === 'USD') return '$'
  return typeof currency === 'string' && currency !== '' ? `${currency} ` : ''
}

/** 金额 + 币种符号。 */
function formatMoney(amount, currency, options) {
  return `${currencySymbol(currency)}${formatAmount(amount, options)}`
}

/** 时钟文本（HH:MM:SS，**本地时区**），面板里给出「更新于」。 */
function formatClock(at) {
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
function formatAge(at, t, now) {
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
function formatDuration(ms, t) {
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
const BEIJING_TZ_OFFSET_MINUTES = 480

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
function formatBeijingTime(at, tzOffsetMinutes) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return '--'
  const parts = beijingParts(at, tzOffsetMinutes)
  return `${pad2Text(parts.hours)}:${pad2Text(parts.minutes)}`
}

/**
 * 北京时间文本 `MM-DD HH:MM`（跨天的边界用得到）。
 * @param at - 时间戳；非法返回 `--`。
 * @param tzOffsetMinutes - 时区偏移（分钟），缺省 +480。
 */
function formatBeijingDateTime(at, tzOffsetMinutes) {
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
function formatBillingMoment(at, now, tzOffsetMinutes) {
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
function formatPeakWindow(window, tzOffsetMinutes, t) {
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
function formatCountdown(ms, t) {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return t('duration.unknown')
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
function formatPrice(value, currency, options) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
  const digits = options?.digits ?? 2
  const format = numberFormat(options?.locale ?? 'en-US', digits, digits)
  const text = format === null ? value.toFixed(digits) : format.format(value)
  return `${currencySymbol(currency ?? 'CNY')}${text}`
}

// ---- src/client/alert-toast.js -------------------------------
/**
 * 余额徽章 —— 跨档提醒。
 *
 * 余额掉进新档位时浮出一张提示卡，几秒后自动淡出，也可以手动关掉。
 *
 * ## 为什么走 `shell.overlay` + 宿主 `Toast`
 * 徽章挂在 `conversation.composer.dock`（**会话作用域**），而渲染器对会话作用域的
 * 条目按「会话代次」设 key —— 切换会话会把它整体卸载重挂，写在组件 state 里的提醒
 * 会被顺手清掉。提醒本身是账号级事件，所以它住在 `alert.js` 的共享 store 里，
 * 由 `shell.overlay` 上的独立条目渲染：那是宿主自己的浮层位置（`z-index:20`，
 * 条目自动获得 `pointer-events:auto`），不用自己往 body 上钉元素。
 *
 * 提示卡优先用宿主 primitives 的 `Toast`：它自带 portal、`z-index:1100`、
 * 淡出计时与无障碍语义，视觉上与本机其他提示完全一致。该模块在平台种子表里
 * （`react` / `react-dom` / `@deepseek-ai/*-ui-primitives` 等九个 id 之一），
 * 已装的第三方插件 `dsh-better-sidebar` 也直接 require 它。
 *
 * 万一解析失败（平台裁剪了种子表），这里退回自带的卡片：提示是「余额快没了」
 * 这种内容，宁可样式朴素一点，也不能整条提醒消失。
 *
 * ## v1.3：多一种卡（`kind: 'tariff'`）
 * 时段切换提醒与余额提醒共用这条通路（`service.alerts` 已经是共享仓库、浮层也
 * 已经挂好），数据形状多一个 `kind`：`kind` 缺省即 `'balance'`，v1.2 的形状与
 * 渲染一个字都不动。两种卡的区别只在**文案**：余额卡的正文由词条自己拼好
 * （`alert.low.withAmount`），时段卡是「标题 + 正文」两条独立词条，因此这里先用
 * `alertCopy()` 把文案归一，再由两条渲染路径各自呈现。
 */



/** 宿主 Toast 的停留时长（毫秒）；3 秒对一句话偏短，这里放宽到 9 秒。 */
const HOLD_MS = 9000

/**
 * 渲染一次提醒。
 *
 * @param props - `{alert, t, onDismiss}`：
 *   `alert` 是共享仓库里的一条提醒 —— 余额跨档是
 *   `{level, from, amount, currency, at, seq}`（`kind` 缺省），
 *   时段切换是 `{kind:'tariff', period, model, outputPrice, nextAt, at, seq}`。
 */
function BalanceAlert(props) {
  const { alert, t, onDismiss } = props
  const copy = alertCopy(alert, t)
  const dismiss = () => {
    onDismiss()
  }

  const actions = [
    {
      label: t('alert.dismiss'),
      onClick: dismiss
    }
  ]

  const Toast = globalThis.__DBP_TOAST__
  if (Toast !== null && Toast !== undefined) {
    return React.createElement(
      Toast,
      {
        // 用 key 绑定一次提醒：同一张卡重新出现时，淡出计时会从头开始。
        key: alert.seq ?? alert.at,
        text: copy.toastText,
        ...copy.toastProps,
        holdMs: HOLD_MS,
        actions,
        onDone: dismiss
      },
      alert.seq ?? alert.at
    )
  }

  return React.createElement(FallbackCard, {
    alert,
    title: copy.title,
    body: copy.body,
    actions
  })
}

/**
 * 一次提醒要显示什么。
 *
 * 两条渲染路径能拿到的空间不一样，所以这里返回三种形态：
 *  - `title` / `body`：自带卡片能分两行，标题一行、正文一行；
 *  - `toastText`：宿主 `Toast` 只有**一个文本槽**（`text` 是字符串，动作按钮像
 *    半个句子一样接在它后面），标题与正文必须先合成一句话；
 *  - `toastProps`：只剩视觉差异的部分（图标 / 语气），由调用方展开进 Toast。
 *
 * `body` 为 null 表示「只有一句话」—— 余额提醒就是这种形状，v1.2 的渲染不变。
 *
 * @param alert - 一条提醒（见 `BalanceAlert`）。
 * @param t - 本地化函数。
 */
function alertCopy(alert, t) {
  if (alert.kind === 'tariff') {
    // 契约里 period 只有两个取值，词条键却是驼峰的 `offPeak`，这里做一次映射；
    // 防御性地把「不是 peak」的写法都当空闲时段（正常数据走不到这一支）。
    const side = alert.period === 'peak' ? 'peak' : 'offPeak'
    const title = t(`alert.tariff.${side}.title`)
    const body = t(`alert.tariff.${side}.body`, {
      // 展示名缺失时给 `--`：契约里 model 是价格口径的展示名，卡片不该凭空
      // 编一个模型名出来（`--` 是全插件对「未知」的统一写法）。
      model: typeof alert.model === 'string' && alert.model !== '' ? alert.model : '--',
      // 词条里已经写死了 `¥`，所以这里只取数字 —— 直接用 formatPrice 会拼成 `¥¥8.00`。
      output: formatAmount(alert.outputPrice, { digits: 2 }),
      // nextAt 为 null（算不出边界）时 formatBeijingTime 给 `--`，句子照样成立。
      time: formatBeijingTime(alert.nextAt)
    })
    return {
      title,
      body,
      toastText: `${title}${titleSeparator(title)}${body}`,
      // 空闲时段对用户是好消息，用宿主 Toast 自带的绿色对勾（`tone="success"`，
      // 该语气下宿主会忽略 icon）；进入高峰则沿用余额提醒那只铃铛，宿主给它警示色。
      toastProps: alert.period === 'peak' ? { icon: React.createElement(AlertBell) } : { tone: 'success' }
    }
  }

  const amount = alert.amount === null || alert.amount === undefined
    ? null
    : formatMoney(alert.amount, alert.currency)
  const text = amount === null
    ? t(`alert.${alert.level}.title`)
    : t(`alert.${alert.level}.withAmount`, { amount, title: t(`alert.${alert.level}.title`) })

  return { title: text, body: null, toastText: text, toastProps: { icon: React.createElement(AlertBell) } }
}

/**
 * 合成一句话时，标题与正文之间的分隔符。
 *
 * 词条表把时段卡的标题与正文拆成了两条键（`alert.tariff.*.title` / `.body`），
 * 没有留分隔符的位置，而宿主 Toast 只能收一个字符串。中文用全角冒号、英文用
 * 半角冒号加空格 —— 沿用 `alert.low.withAmount` 那种「标题：正文」的写法，
 * 同时不让英文卡里冒出全角标点。判据是标题里有没有汉字：标题由本插件自己的
 * 词条提供，两种语言各一套，不会误判。
 */
function titleSeparator(title) {
  return /[\u3400-\u9fff]/.test(String(title)) ? '：' : ': '
}

/** 兜底卡片的自动收起时间：与宿主 Toast 的 hold + fade 大致对齐。 */
const FALLBACK_HOLD_MS = HOLD_MS + 1000

/**
 * 兜底卡片。
 *
 * 只在宿主 primitives 不可用时使用；自己管 portal 之外的定位由样式表负责。
 * 鼠标停上去暂停倒计时：用户正要读或正要动手时，卡片不该自己消失。
 *
 * 时段卡（`kind === 'tariff'`）多一行正文：正文嵌在同一个 `.dbp_alertText` 容器里
 * 当一个块级子元素 —— 卡片的样式是 `display:flex` 的横排，把两段文字做成兄弟节点
 * 会并排显示。复用现有的类名而不是新造一个，是因为样式表不归这里改。
 */
function FallbackCard(props) {
  const { alert, title, body, actions } = props
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    if (paused) return undefined
    const timer = setTimeout(() => {
      for (const action of actions) action.onClick()
    }, FALLBACK_HOLD_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [alert.at, paused, actions])

  // 余额卡依旧只带 data-level；时段卡给 data-balance-alert-kind / data-period，
  // 便于 GUI 验证直接断言是哪一种卡。`kind` 缺省时下面的分支与 v1.2 完全一致。
  const tariff = alert.kind === 'tariff'

  return React.createElement(
    'div',
    {
      className: 'dbp_alert',
      role: 'status',
      'aria-live': 'polite',
      'data-balance-alert': true,
      ...(tariff
        ? { 'data-balance-alert-kind': 'tariff', 'data-period': alert.period }
        : { 'data-level': alert.level }),
      onPointerEnter: () => {
        setPaused(true)
      },
      onPointerLeave: () => {
        setPaused(false)
      }
    },
    React.createElement(
      'div',
      { className: 'dbp_alertText' },
      title,
      tariff && body !== null
        ? React.createElement('div', { 'data-balance-alert-body': true }, body)
        : null
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dbp_alertAction',
        'data-balance-alert-close': true,
        onClick: () => {
          for (const action of actions) action.onClick()
        }
      },
      actions[0].label
    )
  )
}

/** 提醒图标：铃铛轮廓，跟随 `currentColor`。 */
function AlertBell() {
  return React.createElement(
    'svg',
    { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false },
    React.createElement('path', {
      d: 'M8 2.2c-2.1 0-3.4 1.5-3.4 3.5 0 2.6-.7 3.4-1.3 4.1-.2.2-.1.6.2.6h9c.3 0 .4-.4.2-.6-.6-.7-1.3-1.5-1.3-4.1 0-2-1.3-3.5-3.4-3.5Z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round'
    }),
    React.createElement('path', {
      d: 'M6.6 12.3a1.5 1.5 0 0 0 2.8 0',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    })
  )
}

// ---- src/client/locales.js -----------------------------------
/**
 * 余额徽章 —— 中英文案。
 *
 * 两套词典的键集必须完全一致：`tests/runtime.test.mjs` 会断言这一点，
 * 避免新增文案时只改一种语言而让另一种语言回落到 key。
 */

const zh = {
  'pill.title': '账户余额',
  'pill.ariaReady': '账户余额 {amount}，点击查看明细',
  'pill.ariaStale': '账户余额 {amount}（{age}的数据），点击查看明细',
  'pill.ariaSignedOut': '未登录 DeepSeek 账号，点击查看详情',
  'pill.ariaPlain': '账户余额，点击查看明细',
  'pill.loading': '--',
  'pill.signedOut': '未登录',
  'pill.runout': '按当前速度约 {time} 耗尽',

  'panel.title': '账户余额',
  'panel.refresh': '刷新',
  'panel.refreshing': '刷新中',
  'panel.recharge': '充值余额',
  'panel.bonus': '赠金余额',
  'panel.shown.total': '可用合计',
  'panel.shown.recharge': '按充值计',
  'panel.shown.bonus': '按赠金计',
  'panel.updated': '更新于 {time}（{age}）',
  'panel.auto': '每 {seconds} 秒自动刷新',
  'panel.manual': '仅手动刷新与窗口聚焦时读取',
  'panel.rule': '低于 ¥{low} 显示红色 · 低于 ¥{warn} 显示橙色',
  'panel.rate': '近期消耗 {amount}，按此速度约可用 {remaining}',
  'panel.rateOffPeak': '近期消耗 {amount}（空闲价），按此速度约可用 {remaining}',
  'panel.sessionSpend': '本轮会话已用 {amount}（自 {time} 起）',
  'panel.todaySpend': '今日已用 {amount}（自 {time} 起）',
  'panel.weekSpend': '本周已用 {amount}（自 {time} 起）',
  'panel.recentSpend': '近 7 天已用 {amount}（自 {time} 起）',
  'panel.trend.aria': '余额趋势：{points} 个采样点，从 {from} 到 {to}',
  'panel.others': '其他币种：{list}',
  'panel.stale': '⚠ 本次刷新失败，上面显示的是 {age}的数据',
  'panel.settingsHint': '档位与刷新间隔可在 设置 → 通用设置 中调整',
  'panel.topUp': '去充值',

  'alert.dismiss': '知道了',
  'alert.low.title': '余额不足',
  'alert.low.withAmount': '{title}：当前 {amount}，任务可能随时中断。',
  'alert.warn.title': '余额偏低',
  'alert.warn.withAmount': '{title}：当前 {amount}，建议尽快充值。',

  'age.now': '刚刚',
  'age.seconds': '{count} 秒前',
  'age.minutes': '{count} 分钟前',
  'age.hours': '{count} 小时前',
  'age.days': '{count} 天前',
  'age.never': '尚未读取',

  'duration.unknown': '暂时无法估算',
  'duration.seconds': '{count} 秒',
  'duration.minutes': '{count} 分钟',
  'duration.hours': '{count} 小时',
  'duration.days': '{count} 天',

  'hint.ok': '余额充足',
  'hint.warn': '余额偏低，建议尽快充值',
  'hint.low': '余额不足，任务可能随时中断',

  'error.signedOut': '尚未登录 DeepSeek 账号，登录后即可显示余额。',
  'error.failed': '读取失败，稍后会自动重试。',
  'error.unsupported': '当前客户端没有挂载账号能力（remote.account），余额徽章已停用。',

  'settings.title': '余额徽章',
  'settings.description': '在输入框下方状态行显示账户余额，颜色随余额档位变化；点击徽章可展开明细。',
  'settings.unavailable': '当前客户端没有挂载账号能力（remote.account），设置仍会保存，但徽章不会显示。',
  'settings.format.title': '徽章数字',
  'settings.format.description': '决定徽章上显示哪一项金额；展开面板里三项始终都会列出。',
  'settings.format.total': '可用合计（充值 + 赠金）',
  'settings.format.recharge': '仅充值余额',
  'settings.format.bonus': '仅赠金余额',
  'settings.currency.title': '展示币种',
  'settings.currency.description': '账号同时有多个币种钱包时优先显示哪一项；自动为人民币优先。',
  'settings.currency.auto': '自动（人民币优先）',
  'settings.currency.CNY': '人民币 ¥',
  'settings.currency.USD': '美元 $',
  'settings.thresholds.title': '预警档位',
  'settings.thresholds.description': '当前：低于 ¥{low} 红色，低于 ¥{warn} 橙色。填入金额后立即生效。',
  'settings.low': '红色阈值',
  'settings.warn': '橙色阈值',
  'settings.poll.title': '刷新间隔',
  'settings.poll.description': '窗口重新获得焦点、标签页重新可见时总会补一次读取。',
  'settings.poll.manual': '仅手动',
  'settings.poll.seconds': '每 {count} 秒',
  'settings.showRate.title': '显示消耗速度',
  'settings.showRate.description': '在展开面板里估算按当前速度还能使用多久。',
  'settings.showSessionSpend.title': '显示本轮会话消耗',
  'settings.showSessionSpend.description': '按会话记录基准余额，面板里给出这个对话已经花了多少。',
  'settings.showTrend.title': '显示余额趋势',
  'settings.showTrend.description': '在展开面板里画出最近 24 小时的余额折线（最多保留 7 天）。',
  'settings.alert.title': '余额跨档提醒',
  'settings.alert.description': '余额掉进更低的档位时浮出一张提示卡；同一档位只提醒一次，回升后重新武装。',
  'settings.compact.title': '紧凑模式',
  'settings.compact.description': '徽章只显示数字，不带币种符号。',
  'settings.reset': '恢复默认',
  'settings.historyHint': '历史与本轮会话数据只保存在本机浏览器存储中。',

  // ---- v1.3 计费时段（高峰 / 空闲）----
  'tariff.peak': '高峰',
  'tariff.offPeak': '空闲',
  'tariff.pill.peak': '高峰',
  'tariff.pill.offPeak': '空闲',
  'tariff.pill.aria': '当前处于高峰时段，单价为空闲时段的两倍',
  'tariff.pill.ariaOff': '当前处于空闲时段，单价为高峰时段的一半',

  'panel.tariff.peak': '高峰时段 · 单价为空闲的 2 倍',
  'panel.tariff.offPeak': '空闲时段 · 单价为高峰的一半（5 折）',
  'panel.tariff.untilPeak': '距下一个高峰 {duration}（{time} 起）',
  'panel.tariff.untilOffPeak': '距下一个空闲时段 {duration}（{time} 起）',
  'panel.tariff.window': '本段空闲：{from} – {to}（共 {duration}）',
  'panel.tariff.holiday': '今天是法定节假日，全天空闲时段',
  'panel.tariff.weekend': '周末全天空闲时段',
  'panel.tariff.makeup': '今天调休补班，按工作日计费',
  'panel.tariff.midday': '午休 12:00–14:00 也是空闲时段',
  'panel.tariff.price': '{model}：输出 ¥{output} / 百万 tokens（高峰 ¥{peakOutput}）',
  'panel.tariff.save': '高峰跑 2 小时约 ¥{amount}，留到空闲时段只花 ¥{half}',
  'panel.tariff.saveGeneric': '同样的钱在空闲时段能用约 {duration}',
  'panel.tariff.lasts': '按当前速度，余额够撑到下一个高峰',
  'panel.tariff.short': '按当前速度，余额撑不到下一个高峰（还差 {duration}）',
  'panel.tariff.calendar': '节假日日历覆盖 {years} 年',
  'panel.tariff.calendarStale': '节假日日历未覆盖 {year} 年，按常规周末规则判定',

  'settings.tariff.title': '计费时段',
  'settings.tariff.description': '高峰时段（北京时间周一至周五 9:00–12:00、14:00–18:00，节假日除外）单价为空闲时段的两倍。',
  'settings.showTariff.title': '显示计费时段',
  'settings.showTariff.description': '在徽章上标出当前是高峰还是空闲时段。',
  'settings.tariffModel.title': '价格口径',
  'settings.tariffModel.description': '面板里的价格与预估按哪个模型计算。',
  'settings.alertOnTariff.title': '时段切换提醒',
  'settings.alertOnTariff.description': '高峰开始与空闲时段开始时浮出一张提示卡，每小时最多一张。',

  'alert.tariff.peak.title': '进入高峰时段',
  'alert.tariff.peak.body': '单价已翻倍（{model} 输出 ¥{output}/百万 tokens）。不急的活可以留到 {time} 之后。',
  'alert.tariff.offPeak.title': '进入空闲时段',
  'alert.tariff.offPeak.body': '单价降为一半，同样的钱能用更久。',

  'tariff.windowNextDay': '{from} – 次日 {to}',
  'tariff.windowDays': '{from} – {count} 天后 {to}'
}

const en = {
  'pill.title': 'Account balance',
  'pill.ariaReady': 'Account balance {amount}. Click for details.',
  'pill.ariaStale': 'Account balance {amount} ({age} reading). Click for details.',
  'pill.ariaSignedOut': 'Not signed in to a DeepSeek account. Click for details.',
  'pill.ariaPlain': 'Account balance. Click for details.',
  'pill.loading': '--',
  'pill.signedOut': 'Signed out',
  'pill.runout': 'Runs out around {time} at this pace',

  'panel.title': 'Account balance',
  'panel.refresh': 'Refresh',
  'panel.refreshing': 'Refreshing',
  'panel.recharge': 'Topped-up',
  'panel.bonus': 'Granted',
  'panel.shown.total': 'Usable total',
  'panel.shown.recharge': 'Topped-up only',
  'panel.shown.bonus': 'Granted only',
  'panel.updated': 'Updated {time} ({age})',
  'panel.auto': 'Auto-refreshes every {seconds}s',
  'panel.manual': 'Reads only on manual refresh and window focus',
  'panel.rule': 'Red below ¥{low} · amber below ¥{warn}',
  'panel.rate': 'Recent burn {amount}; about {remaining} left at this pace',
  'panel.rateOffPeak': 'Recent burn {amount} (off-peak rate); about {remaining} left at this pace',
  'panel.sessionSpend': 'This conversation has used {amount} (since {time})',
  'panel.todaySpend': 'Used today {amount} (since {time})',
  'panel.weekSpend': 'Used this week {amount} (since {time})',
  'panel.recentSpend': 'Used in the last 7 days {amount} (since {time})',
  'panel.trend.aria': 'Balance trend: {points} samples, from {from} to {to}',
  'panel.others': 'Other currencies: {list}',
  'panel.stale': '⚠ This refresh failed; the figures above are from {age}',
  'panel.settingsHint': 'Thresholds and refresh interval live in Settings → General',
  'panel.topUp': 'Top up',

  'alert.dismiss': 'Got it',
  'alert.low.title': 'Balance is nearly empty',
  'alert.low.withAmount': '{title}: {amount} left — tasks may stop at any moment.',
  'alert.warn.title': 'Balance is running low',
  'alert.warn.withAmount': '{title}: {amount} left — consider topping up soon.',

  'age.now': 'just now',
  'age.seconds': '{count}s ago',
  'age.minutes': '{count}m ago',
  'age.hours': '{count}h ago',
  'age.days': '{count}d ago',
  'age.never': 'not read yet',

  'duration.unknown': 'not estimable yet',
  'duration.seconds': '{count}s',
  'duration.minutes': '{count}m',
  'duration.hours': '{count}h',
  'duration.days': '{count}d',

  'hint.ok': 'Balance is healthy',
  'hint.warn': 'Balance is running low',
  'hint.low': 'Balance is nearly empty — tasks may stop',

  'error.signedOut': 'Not signed in to a DeepSeek account yet; the balance appears after sign-in.',
  'error.failed': 'Read failed; it will retry automatically.',
  'error.unsupported': 'This client has no account capability (remote.account) mounted; the balance pill is disabled.',

  'settings.title': 'Balance pill',
  'settings.description': 'Shows the account balance in the composer status row, coloured by level. Click the pill for details.',
  'settings.unavailable': 'This client has no account capability (remote.account) mounted; settings still save, but the pill stays hidden.',
  'settings.format.title': 'Pill figure',
  'settings.format.description': 'Which amount the pill shows; the panel always lists all three.',
  'settings.format.total': 'Usable total (topped-up + granted)',
  'settings.format.recharge': 'Topped-up only',
  'settings.format.bonus': 'Granted only',
  'settings.currency.title': 'Display currency',
  'settings.currency.description': 'Which wallet to prefer when the account holds several currencies.',
  'settings.currency.auto': 'Automatic (CNY first)',
  'settings.currency.CNY': 'CNY ¥',
  'settings.currency.USD': 'USD $',
  'settings.thresholds.title': 'Warning thresholds',
  'settings.thresholds.description': 'Now: red below ¥{low}, amber below ¥{warn}. Changes apply immediately.',
  'settings.low': 'Red threshold',
  'settings.warn': 'Amber threshold',
  'settings.poll.title': 'Refresh interval',
  'settings.poll.description': 'Window focus and tab visibility always trigger an extra read.',
  'settings.poll.manual': 'Manual only',
  'settings.poll.seconds': 'Every {count}s',
  'settings.showRate.title': 'Show burn rate',
  'settings.showRate.description': 'Estimate how long the balance lasts at the current pace.',
  'settings.showSessionSpend.title': 'Show conversation spend',
  'settings.showSessionSpend.description': 'Baselines the balance per conversation and shows what this one has used.',
  'settings.showTrend.title': 'Show balance trend',
  'settings.showTrend.description': 'Draws the last 24 hours of balance in the panel (up to 7 days kept).',
  'settings.alert.title': 'Level-change alerts',
  'settings.alert.description': 'Raises a card when the balance drops into a lower level; once per level, re-armed after it recovers.',
  'settings.compact.title': 'Compact mode',
  'settings.compact.description': 'Show the number without the currency symbol.',
  'settings.reset': 'Restore defaults',
  'settings.historyHint': 'History and conversation data stay in this browser’s storage.',

  // ---- v1.3 billing windows (peak / off-peak) ----
  'tariff.peak': 'Peak',
  'tariff.offPeak': 'Off-peak',
  'tariff.pill.peak': 'Peak',
  'tariff.pill.offPeak': 'Off-peak',
  'tariff.pill.aria': 'Currently in peak hours; rates are double off-peak',
  'tariff.pill.ariaOff': 'Currently off-peak; rates are half of peak',

  'panel.tariff.peak': 'Peak hours · rates are 2× off-peak',
  'panel.tariff.offPeak': 'Off-peak · rates are half of peak (50% off)',
  'panel.tariff.untilPeak': 'Next peak in {duration} (from {time})',
  'panel.tariff.untilOffPeak': 'Next off-peak in {duration} (from {time})',
  'panel.tariff.window': 'Off-peak window: {from} – {to} ({duration})',
  'panel.tariff.holiday': 'Public holiday today — off-peak all day',
  'panel.tariff.weekend': 'Weekend — off-peak all day',
  'panel.tariff.makeup': 'Make-up workday — weekday rates apply',
  'panel.tariff.midday': 'Midday 12:00–14:00 is off-peak too',
  'panel.tariff.price': '{model}: output ¥{output}/M tokens (peak ¥{peakOutput})',
  'panel.tariff.save': '2h at peak ≈ ¥{amount}; off-peak it costs ¥{half}',
  'panel.tariff.saveGeneric': 'The same money lasts about {duration} off-peak',
  'panel.tariff.lasts': 'At this pace the balance lasts until the next peak',
  'panel.tariff.short': 'At this pace it falls short of the next peak by {duration}',
  'panel.tariff.calendar': 'Holiday calendar covers {years}',
  'panel.tariff.calendarStale': 'Holiday calendar has no {year} data; weekday/weekend rules apply',

  'settings.tariff.title': 'Billing window',
  'settings.tariff.description': 'Peak hours (Mon–Fri 09:00–12:00 and 14:00–18:00 Beijing time, excluding public holidays) cost double the off-peak rate.',
  'settings.showTariff.title': 'Show billing window',
  'settings.showTariff.description': 'Marks whether the pill currently sits in peak or off-peak hours.',
  'settings.tariffModel.title': 'Rate table',
  'settings.tariffModel.description': 'Which model the panel prices and estimates use.',
  'settings.alertOnTariff.title': 'Billing-window alerts',
  'settings.alertOnTariff.description': 'Raises a card when peak starts and when off-peak starts, at most one card per hour.',

  'alert.tariff.peak.title': 'Peak hours started',
  'alert.tariff.peak.body': 'Rates doubled ({model} output ¥{output}/M tokens). Non-urgent work can wait until {time}.',
  'alert.tariff.offPeak.title': 'Off-peak hours started',
  'alert.tariff.offPeak.body': 'Rates halved — the same balance lasts longer.',

  'tariff.windowNextDay': '{from} – next day {to}',
  'tariff.windowDays': '{from} – {to} ({count} days later)'
}

// ---- src/client/history.js -----------------------------------
/**
 * 余额徽章 —— 余额历史与趋势（纯逻辑）。
 *
 * 徽章只回答「现在有多少」，而「烧得快不快」需要一条时间线。这里把每次成功读数
 * 记成一枚样本，压在一个有界环形缓冲里（按条数与按时间双重设限），再给面板提供
 * 一条折线所需的几何数据。
 *
 * 设计约束：
 *  - **有界**：localStorage 是共享配额，历史绝不能无限增长。条数与年龄双限。
 *  - **可丢**：历史只用于画图，损坏/超限/被清空都不影响余额本身，一律静默降级。
 *  - **纯函数**：采样、裁剪、降采样、折线几何全部是「输入 → 输出」，
 *    因此可以在 Node 里直接单测（tests/runtime.test.mjs）。
 */



/** 历史存储键。与设置分开存，避免设置写入把历史覆盖掉。 */
const HISTORY_KEY = 'dsh-balance-pill:history'

/** 最多保留的样本条数。 */
const MAX_SAMPLES = 480

/** 最多保留的历史时长：7 天。 */
const MAX_AGE_MS = 7 * 24 * 3600 * 1000

/** 两条样本之间至少间隔多久才值得记录（更密的采样只会浪费配额）。 */
const MIN_SAMPLE_GAP_MS = 60000

/**
 * 「近 7 天已用」的统计窗口。
 *
 * 与 `MAX_AGE_MS` 相同不是巧合：历史本身就只保留 7 天，窗口再长也只能看到
 * 这 7 天。把它单独导出，避免面板把「历史保留时长」与「统计窗口」当成同一个
 * 概念 —— 将来若延长保留期，窗口仍可以独立决定。
 */
const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000

/**
 * 解析一枚样本；非法返回 null。
 * @param raw - 存储里读出来的一条记录。
 */
function parseSample(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const at = Number(raw.at)
  const amount = Number(raw.amount)
  if (!Number.isFinite(at) || at <= 0) return null
  if (!Number.isFinite(amount)) return null
  return {
    at,
    amount,
    currency: typeof raw.currency === 'string' ? raw.currency : '',
    // 记录这枚样本是按哪个口径取的数（可用合计 / 仅充值 / 仅赠金）。
    // v1.2 及更早的样本没有这个字段，回落到 'total'（v1.2 的默认口径）。
    basis: typeof raw.basis === 'string' && raw.basis !== '' ? raw.basis : 'total'
  }
}

/**
 * 归一化一整份历史：丢弃非法条目、按时间排序、去重、裁剪到上限。
 *
 * 时间乱序在真实场景里会出现（系统时间被调整、多标签页写入），因此这里**排序**
 * 而不是假设已经有序；同毫秒的重复样本只保留最后一条。
 *
 * @param raw - 存储里读出来的数组（可能不是数组、可能含垃圾）。
 * @param now - 便于测试的当前时间。
 * @returns 归一化后的样本数组（升序）。
 */
function normalizeHistory(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return []
  const samples = []
  for (const entry of raw) {
    const sample = parseSample(entry)
    if (sample === null) continue
    if (now - sample.at > MAX_AGE_MS) continue
    samples.push(sample)
  }
  samples.sort((a, b) => a.at - b.at)
  const deduped = []
  for (const sample of samples) {
    const last = deduped[deduped.length - 1]
    if (last !== undefined && last.at === sample.at) {
      deduped[deduped.length - 1] = sample
      continue
    }
    deduped.push(sample)
  }
  return deduped.length > MAX_SAMPLES ? deduped.slice(deduped.length - MAX_SAMPLES) : deduped
}

/**
 * 追加一枚样本。
 *
 * 规则：
 *  - 距上一枚样本不足 `MIN_SAMPLE_GAP_MS` 时**替换**而不是追加：
 *    手动连点刷新不该在图上打出一串竖直的假尖峰；
 *  - 币种变了直接丢弃整段历史（不同币种的金额不可比），从这枚样本重新开始；
 *  - 金额与时间都相同时不写入（避免无意义的重渲染与存储写入）。
 *
 * @param samples - 现有样本（升序）。
 * @param sample - 待写入的样本。
 * @param now - 便于测试的当前时间。
 * @returns 新的样本数组（升序）。
 */
function appendSample(samples, sample, now = Date.now()) {
  const parsed = parseSample(sample)
  if (parsed === null) return samples
  // `now - MAX_AGE_MS` 之外的老样本在这里就丢掉：normalizeHistory 只在**加载**时
  // 裁剪一次，而一个开着一周的会话会一直往数组里追加 —— 不做这一步，内存与
  // localStorage 里会攒下远超 7 天的样本（写入的 JSON 也会越来越大）。
  const current = normalizeHistory(samples, now).filter((item) => now - item.at <= MAX_AGE_MS)
  const last = current[current.length - 1]
  if (last === undefined) return [parsed]
  if (last.currency !== parsed.currency) return [parsed]
  if (last.amount === parsed.amount && last.at === parsed.at) return current
  if (parsed.at - last.at < MIN_SAMPLE_GAP_MS) {
    const next = current.slice(0, current.length - 1)
    next.push(parsed)
    return next
  }
  const next = [...current, parsed]
  return next.length > MAX_SAMPLES ? next.slice(next.length - MAX_SAMPLES) : next
}

/**
 * 取窗口内的样本。
 * @param samples - 样本数组（升序）。
 * @param windowMs - 窗口长度。
 * @param now - 当前时间。
 * @param basis - 只取该口径的样本；缺省不过滤。
 *   口径是必须区分的：把口径从「可用合计」改成「仅充值」后，同一张折线图里
 *   前半段是合计（¥11.17）、后半段是充值额（¥1.10），连起来是一条**假**的暴跌。
 */
function withinWindow(samples, windowMs, now = Date.now(), basis) {
  const from = now - windowMs
  return samples.filter((sample) => {
    if (sample.at < from) return false
    if (typeof basis === 'string' && basis !== '' && sample.basis !== basis) return false
    return true
  })
}

/**
 * 把样本按时间分桶降采样，供折线使用。
 *
 * 直接画几百个点是浪费：面板只有 200 多像素宽。按桶取**每个桶的最后一条**
 * （而不是平均值）——折线要表达的是「当时剩多少」，平均会把峰值抹平。
 *
 * @param samples - 样本数组（升序）。
 * @param buckets - 目标桶数。
 * @returns 每桶一个点的数组；样本不足时原样返回。
 */
function downsample(samples, buckets) {
  if (!Array.isArray(samples) || samples.length === 0) return []
  const count = Math.max(1, Math.floor(buckets))
  if (samples.length <= count) return [...samples]
  const first = samples[0].at
  const last = samples[samples.length - 1].at
  const span = Math.max(1, last - first)
  const out = []
  for (let index = 0; index < count; index += 1) {
    const from = first + (span * index) / count
    const to = index === count - 1 ? last + 1 : first + (span * (index + 1)) / count
    let pick = null
    for (const sample of samples) {
      if (sample.at < from || sample.at >= to) continue
      pick = sample
    }
    if (pick !== null) out.push(pick)
  }
  // 至少保留首尾，避免整体只剩一个点时折线退化成空。
  if (out.length === 0) return [samples[0], samples[samples.length - 1]]
  if (out[0].at !== first) out.unshift(samples[0])
  if (out[out.length - 1].at !== last) out.push(samples[samples.length - 1])
  return out
}

/**
 * 计算折线路径。
 *
 * 纵轴**不从 0 开始**：余额从 ¥1.20 掉到 ¥1.10 的斜率，在「0 到最大值」的坐标系里
 * 完全是平的，看不出任何趋势。因此纵轴贴合样本的实际区间，并把区间设一个最小高度
 * （`minSpan`），避免余额完全没变时把噪声放大成剧烈波动。
 *
 * @param points - 样本数组（升序）。
 * @param options - `{width, height, padding, minSpan}`。
 * @returns `{d, area, min, max, first, last, delta}`；样本为空时返回 null。
 */
function sparklinePath(points, options) {
  if (!Array.isArray(points) || points.length === 0) return null
  const width = Number(options?.width ?? 232)
  const height = Number(options?.height ?? 36)
  const padding = Number(options?.padding ?? 3)
  const minSpan = Number(options?.minSpan ?? 0.01)
  const innerWidth = Math.max(1, width - padding * 2)
  const innerHeight = Math.max(1, height - padding * 2)

  const amounts = points.map((point) => point.amount)
  const rawMin = Math.min(...amounts)
  const rawMax = Math.max(...amounts)
  const span = Math.max(rawMax - rawMin, minSpan)
  // 余额没变时把线放在中间，而不是贴着上边或下边。
  const center = (rawMin + rawMax) / 2
  const low = center - span / 2
  const high = center + span / 2

  const first = points[0]
  const last = points[points.length - 1]
  const timeSpan = Math.max(1, last.at - first.at)
  const x = (at) => padding + ((at - first.at) / timeSpan) * innerWidth
  const y = (amount) => padding + (1 - (amount - low) / (high - low)) * innerHeight

  const commands = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(point.at).toFixed(2)} ${y(point.amount).toFixed(2)}`)
  const baseline = (height - padding).toFixed(2)
  const area = `${commands[0]} L${x(last.at).toFixed(2)} ${baseline} L${x(first.at).toFixed(2)} ${baseline} Z`

  return {
    d: commands.join(' '),
    area,
    min: rawMin,
    max: rawMax,
    first: first.amount,
    last: last.amount,
    delta: last.amount - first.amount,
    points: points.length
  }
}

/**
 * 从历史里挑出「上一次读数」用于对比（找窗口内最早的样本）。
 * @param samples - 样本数组（升序）。
 * @param windowMs - 回看窗口。
 * @param now - 当前时间。
 */
function earliestWithin(samples, windowMs, now = Date.now()) {
  const windowed = withinWindow(samples, windowMs, now)
  return windowed.length === 0 ? null : windowed[0]
}

/**
 * 把某个时刻落到**计费日**（北京时间的自然日）的日序号。
 *
 * 「今日已用」要在面板上回答「今天花了多少」，而「今天」必须与计费时区一致 ——
 * 否则用户在北京时间凌晨 1 点看到的是「昨天」的账（机器的本地时区可能是别的）。
 * 固定用 +08:00，与 `pricing.js` 的 `BILLING_TZ_OFFSET_MINUTES` 同口径；
 * 这里刻意**不 import pricing.js**：历史模块不该为了一个常量把价格表拖进依赖。
 *
 * @param at - epoch 毫秒。
 * @param tzOffsetMinutes - 计费时区偏移（分钟）；缺省 +480。
 * @returns 整数日序号；`at` 非法时返回 null。
 */
function billingDayOf(at, tzOffsetMinutes = 480) {
  // 不能用 `Number.isFinite(Number(at))`：`Number(null)` 与 `Number('')` 都是 0，
  // 会把「没给」悄悄当成 1970-01-01。这与 tariff-alert.js 里 `tariffEpochOf`
  // 的教训是同一条 —— 显式只接受数字（或非空数字字符串）。
  const ms = typeof at === 'number'
    ? at
    : (typeof at === 'string' && at.trim() !== '' ? Number(at) : NaN)
  if (!Number.isFinite(ms)) return null
  const offset = Number.isFinite(Number(tzOffsetMinutes)) ? Number(tzOffsetMinutes) : 480
  return Math.floor((ms + offset * 60000) / 86400000)
}

/**
 * 把某个时刻落到**计费周**（北京时间的 ISO 周，周一为起点）的周序号。
 *
 * 与 `billingDayOf` 同口径：固定 +08:00，与计费时区一致。算法是标准 ISO 周：
 * 先按计费时区把毫秒换成「当地天数」，再对齐到周一。
 *
 * @param at - epoch 毫秒。
 * @param tzOffsetMinutes - 计费时区偏移（分钟）；缺省 +480。
 * @returns 整数周序号；`at` 非法时返回 null。
 */
function billingWeekOf(at, tzOffsetMinutes = 480) {
  const ms = typeof at === 'number'
    ? at
    : (typeof at === 'string' && at.trim() !== '' ? Number(at) : NaN)
  if (!Number.isFinite(ms)) return null
  const offset = Number.isFinite(Number(tzOffsetMinutes)) ? Number(tzOffsetMinutes) : 480
  const localMs = ms + offset * 60000
  const dayMs = 86400000
  // 当地日期（从 1970-01-01 起算的天数，整数）
  const dayNum = Math.floor(localMs / dayMs)
  // 1970-01-01 是周四（weekday=4）。把天数对齐到「周一为 0」：
  // 当地 weekday = (dayNum + 4) % 7（0=周日 … 6=周六），周一 = 1。
  const weekday = (dayNum + 4) % 7
  const mondayOffset = (weekday + 6) % 7 // 周一=0, 周二=1, … 周日=6
  return Math.floor((dayNum - mondayOffset) / 7)
}

/**
 * 把 epoch 输入显式归一成数字；`null` / 空串 / `false` 都算「没给」。
 *
 * v0.1.6 把这条规则收成一个函数：`Number(null)` 是 0、`Number('')` 也是 0，
 * 而 0 在时间语义里是 1970 年 —— 这正是 `billingDayOf` / `tariffEpochOf`
 * 反复踩过的坑。新增的窗口统计与已有的日/周统计共用它，避免再抄一份。
 *
 * @param value - 数字或非空数字字符串。
 * @returns 有限数字；否则 null。
 */
function epochOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * 相邻样本的**下降量**之和。
 *
 * v0.1.6 的核心修正：旧实现用「窗口最早金额 − 最晚金额」，一旦中间充值，
 * 差额会变成负数并被归零 —— 于是「今日已用」在充值当天显示 ¥0，而用户明明
 * 花了钱。正确的账本是逐段看的：每一对相邻样本里只把**下降**计入消耗，上升
 * （充值 / 赠金入账）直接跳过。这样「花了 5 → 充 10 → 又花 3」得到 8，而不是 0。
 *
 * 输入必须按时间升序；调用方（`spendOver`）负责排序与去重。
 *
 * @param samples - 升序样本。
 * @returns 非负消耗金额。
 */
function spentFromSamples(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return 0
  let spent = 0
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1]
    const current = samples[index]
    if (!Number.isFinite(previous?.amount) || !Number.isFinite(current?.amount)) continue
    if (current.at <= previous.at) continue
    const drop = previous.amount - current.amount
    if (drop > 0) spent += drop
  }
  return spent
}

/**
 * 按一个时间谓词汇总消耗（日 / 周 / 近 N 天共用）。
 *
 * 负责三件事，调用方只提供「哪些样本属于这个区间」：
 *  1. 丢弃垃圾样本与非法金额；
 *  2. 过滤口径（`basis`）与币种（`currency`，空串等同不传）；
 *  3. 排序、同毫秒去重（保留最后一条），再交给 `spentFromSamples`。
 *
 * 排序是必须的：历史可能被外部存储改乱，而「相邻下降」只有在时间有序时
 * 才等于真实消耗。
 *
 * @param samples - 原始样本数组。
 * @param at - 参照时刻。
 * @param options - `{basis, currency}`。
 * @param inPeriod - `(sampleAt) => boolean`。
 * @returns `{spent, currency, firstAt, lastAt, samples}` 或 null；少于两个样本
 *   时返回 null（一个点算不出消耗）。**绝不抛错。**
 */
function spendOver(samples, at, options, inPeriod) {
  if (!Array.isArray(samples)) return null
  if (epochOf(at) === null) return null
  const basis = options?.basis
  const currency = typeof options?.currency === 'string' && options.currency !== '' ? options.currency : null

  const picked = []
  for (const sample of samples) {
    if (sample === null || typeof sample !== 'object') continue
    const sampleAt = epochOf(sample.at)
    const amount = typeof sample.amount === 'number' ? sample.amount : NaN
    if (sampleAt === null || !Number.isFinite(amount)) continue
    if (inPeriod(sampleAt) !== true) continue
    if (typeof basis === 'string' && basis !== '' && sample.basis !== basis) continue
    if (currency !== null && sample.currency !== currency) continue
    picked.push({ at: sampleAt, amount, currency: typeof sample.currency === 'string' ? sample.currency : '' })
  }
  if (picked.length < 2) return null

  picked.sort((a, b) => a.at - b.at)
  const ordered = []
  for (const sample of picked) {
    const last = ordered[ordered.length - 1]
    if (last !== undefined && last.at === sample.at) ordered[ordered.length - 1] = sample
    else ordered.push(sample)
  }
  if (ordered.length < 2) return null

  const first = ordered[0]
  const last = ordered[ordered.length - 1]
  return {
    spent: spentFromSamples(ordered),
    currency: last.currency,
    firstAt: first.at,
    lastAt: last.at,
    samples: ordered.length
  }
}

/**
 * 算出某个计费周已经花了多少。
 *
 * 与 `spendInDay` 同一套规则：同周、同口径、同币种，消耗按**逐段下降**求和
 * （v0.1.6 起，充值不会再把这周已经花掉的钱归零）。
 * 历史只保留 7 天，所以「本周」在周日晚上与「最近 7 天」几乎重合；
 * 周一早上则只含周一当天 —— 这正是它存在的意义：周一对账不需要看上周。
 *
 * @param samples - 历史样本（升序）。
 * @param at - 「本周」的参照时刻。
 * @param options - `{tzOffsetMinutes, basis, currency}`。
 * @returns `{spent, currency, firstAt, lastAt, samples}` 或 null。**绝不抛错。**
 */
function spendInWeek(samples, at, options) {
  const week = billingWeekOf(at, options?.tzOffsetMinutes)
  if (week === null) return null
  return spendOver(samples, at, options, (sampleAt) => billingWeekOf(sampleAt, options?.tzOffsetMinutes) === week)
}

/**
 * 算出某个计费日已经花了多少。
 *
 * 这是面板「今日已用」的数据来源。它只读历史采样，不需要额外的存储：
 * v0.1.6 起消耗 = 当天相邻样本的**下降量之和**，而不是「最早 − 最晚」。
 * 后者在当天充值过一次时会把整天的账归零（见 `spentFromSamples` 的说明）。
 *
 * 必须守住的规则（每条都有对应测试）：
 *  1. **只算同一天**：跨天的样本一律不参与 —— 否则「今日」会被昨天的余额污染；
 *  2. **只算同口径**：口径（`basis`）从「可用合计」改成「仅充值」之后，
 *     前后两截不是同一个量，混在一起会算出一个假的日消耗；
 *  3. **只算同币种**：显式指定币种时，其它币种的样本不参与；
 *  4. **不为负**：只累加下降，充值（上升）不计入消耗。
 *
 * @param samples - 历史样本（升序，来自 `history.js`）。
 * @param at - 「今天」的参照时刻（通常是 Date.now()）。
 * @param options - `{tzOffsetMinutes, basis, currency}`：
 *   `basis` / `currency` 由调用方从当前视图模型传入，两者都可缺省（缺省即不过滤）。
 * @returns `{spent, currency, firstAt, lastAt, samples}`；当天样本不足两个
 *   或输入非法时返回 null。**绝不抛错。**
 */
function spendInDay(samples, at, options) {
  const day = billingDayOf(at, options?.tzOffsetMinutes)
  if (day === null) return null
  return spendOver(samples, at, options, (sampleAt) => billingDayOf(sampleAt, options?.tzOffsetMinutes) === day)
}

/**
 * 算出最近一个时间窗口里花了多少（面板「近 7 天已用」）。
 *
 * 与日/周统计共用同一套「逐段下降」账本：窗口内的充值不会被误算成消耗，
 * 也不会把窗口内已经花掉的钱抹掉。
 *
 * @param samples - 历史样本。
 * @param at - 窗口右端（通常是 Date.now()）。
 * @param options - `{windowMs, tzOffsetMinutes, basis, currency}`；
 *   `windowMs` 缺省为 `RECENT_WINDOW_MS`（7 天），非法或非正数返回 null。
 * @returns 与 `spendInDay` 同形状；窗口内少于两个样本时返回 null。
 */
function spendInWindow(samples, at, options) {
  const atMs = epochOf(at)
  if (atMs === null) return null
  const rawWindow = options?.windowMs === undefined ? RECENT_WINDOW_MS : epochOf(options.windowMs)
  if (rawWindow === null || rawWindow <= 0) return null
  return spendOver(samples, at, options, (sampleAt) => sampleAt >= atMs - rawWindow && sampleAt <= atMs)
}

/** 历史存储的读写：任何异常都静默降级成空历史。 */
function loadHistory(storage = resolveStorage()) {
  if (storage === undefined || storage === null) return []
  try {
    const raw = storage.getItem(HISTORY_KEY)
    if (typeof raw !== 'string' || raw === '') return []
    return normalizeHistory(JSON.parse(raw))
  } catch {
    return []
  }
}

/** 写入历史；配额不足或隐私模式下静默失败（历史不是关键路径）。 */
function saveHistory(samples, storage = resolveStorage()) {
  if (storage === undefined || storage === null) return false
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(samples))
    return true
  } catch {
    return false
  }
}

// ---- src/client/session-spend.js -----------------------------
/**
 * 余额徽章 —— 本轮会话花了多少（纯逻辑）。
 *
 * 动机很直接：余额是账号级的，但用户真正想知道的是「**这次**对话烧了多少钱」。
 * composer 状态行里的组件能拿到 `sessionId`（`conversation.composer.dock` 是
 * session 作用域，宿主会话标准 props 里带 `sessionId`），所以可以给每个会话记一个
 * 基准余额，用「当前余额 - 基准」得到本轮消耗。
 *
 * 语义边界：
 *  - 基准取「本会话第一次看到余额时」的值。切换会话只换基准，不清历史；
 *  - 余额**上升**（充值）时基准往前推，免得把充值算成负消耗；
 *  - 基准按会话 id 存，换币种或换账号时整份作废 —— 跨币种相减没有意义。
 */



/** 会话基准的存储键。 */
const SESSION_KEY = 'dsh-balance-pill:sessions'

/** 最多记住多少个会话的基准（按最近使用淘汰）。 */
const MAX_SESSIONS = 40

/**
 * 解析一条基准记录；非法返回 null。
 * @param raw - 存储里读出来的记录。
 */
function parseBaseline(raw) {
  if (raw === null || typeof raw !== 'object') return null
  const amount = Number(raw.amount)
  const at = Number(raw.at)
  if (!Number.isFinite(amount)) return null
  if (!Number.isFinite(at) || at <= 0) return null
  return {
    amount,
    at,
    currency: typeof raw.currency === 'string' ? raw.currency : ''
  }
}

/**
 * 归一化整份会话基准表。
 * @param raw - 存储里读出来的对象（会话 id → 记录）。
 * @returns 干净的 `{sessionId: baseline}` 对象。
 */
function normalizeBaselines(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out = {}
  for (const [key, value] of Object.entries(raw)) {
    if (typeof key !== 'string' || key === '') continue
    const baseline = parseBaseline(value)
    if (baseline === null) continue
    out[key] = baseline
  }
  return out
}

/**
 * 记录/更新一个会话的基准。
 *
 * @param baselines - 现有基准表。
 * @param sessionId - 会话 id；为空时不记录（没有会话时无从归属）。
 * @param reading - `{amount, currency, at}` 当前读数。
 * @returns 新的基准表（不修改入参）。
 */
function recordBaseline(baselines, sessionId, reading) {
  if (typeof sessionId !== 'string' || sessionId === '') return baselines
  if (reading === null || reading === undefined) return baselines
  const amount = Number(reading.amount)
  if (!Number.isFinite(amount)) return baselines
  const at = Number.isFinite(Number(reading.at)) ? Number(reading.at) : Date.now()
  const currency = typeof reading.currency === 'string' ? reading.currency : ''
  const existing = baselines[sessionId]
  // 已有基准且不是同一币种：跨币种相减没有意义，直接用新读数重置。
  if (existing !== undefined && existing.currency !== currency) {
    return { ...baselines, [sessionId]: { amount, at, currency } }
  }
  // 余额比基准高，说明中途充值了；把基准推到当前值，免得显示成负消耗。
  if (existing !== undefined && amount > existing.amount) {
    return { ...baselines, [sessionId]: { amount, at, currency } }
  }
  if (existing !== undefined) return baselines
  return { ...baselines, [sessionId]: { amount, at, currency } }
}

/**
 * 裁剪基准表，只保留最近使用的若干个会话。
 * @param baselines - 基准表。
 * @param max - 上限。
 */
function pruneBaselines(baselines, max = MAX_SESSIONS) {
  const entries = Object.entries(baselines)
  if (entries.length <= max) return baselines
  entries.sort((a, b) => b[1].at - a[1].at)
  return Object.fromEntries(entries.slice(0, max))
}

/**
 * 算出某个会话的消耗。
 *
 * @param baselines - 基准表。
 * @param sessionId - 会话 id。
 * @param reading - `{amount, currency, at}` 当前读数。
 * @returns `{spent, since, currency}`；没有基准、币种不符或没有读数时返回 null。
 *   `spent` 为正表示花掉的金额。
 */
function sessionSpend(baselines, sessionId, reading) {
  if (typeof sessionId !== 'string' || sessionId === '') return null
  const baseline = baselines[sessionId]
  if (baseline === undefined || baseline === null) return null
  if (reading === null || reading === undefined) return null
  const amount = Number(reading.amount)
  if (!Number.isFinite(amount)) return null
  const currency = typeof reading.currency === 'string' ? reading.currency : ''
  if (baseline.currency !== currency) return null
  const spent = baseline.amount - amount
  // 负消耗只可能来自「充值后又消费」的中间态；归零比显示负数更诚实。
  return {
    spent: spent > 0 ? spent : 0,
    since: baseline.at,
    currency
  }
}

/** 读取基准表；任何异常静默降级成空表。 */
function loadBaselines(storage = resolveStorage()) {
  if (storage === undefined || storage === null) return {}
  try {
    const raw = storage.getItem(SESSION_KEY)
    if (typeof raw !== 'string' || raw === '') return {}
    return normalizeBaselines(JSON.parse(raw))
  } catch {
    return {}
  }
}

/** 写入基准表；失败静默（基准丢了只会让「本轮消耗」暂时消失）。 */
function saveBaselines(baselines, storage = resolveStorage()) {
  if (storage === undefined || storage === null) return false
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(baselines))
    return true
  } catch {
    return false
  }
}

// ---- src/client/icons.js -------------------------------------
/**
 * 余额徽章 —— 内联图标。
 *
 * 不依赖 `@deepseek-ai/dsh-client-ui-primitives`：那一层确实可以被 bundle
 * require，但图标集里没有钱包/余额语义的图标，而自带两个 16px 线性图标
 * （钱包、警示）比拉一个 500KB 的包更合适。描边宽度与颜色都跟随
 * `currentColor`，因此主题令牌换色时图标自动跟着变。
 */

/** 钱包图标：卡包外框 + 翻盖线 + 卡扣。 */
function WalletIcon() {
  return React.createElement(
    'svg',
    {
      className: 'dbp_icon',
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      'aria-hidden': true,
      focusable: false
    },
    React.createElement('path', {
      d: 'M1.9 5.4c0-1.1.9-2 2-2h8.2c1.1 0 2 .9 2 2v5.2c0 1.1-.9 2-2 2H3.9c-1.1 0-2-.9-2-2V5.4Z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round'
    }),
    React.createElement('path', {
      d: 'M1.9 6.5h12.2',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    }),
    React.createElement('path', {
      d: 'M10.8 9.1h1.6',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    })
  )
}

/** 警示图标：三角叹号，用于余额不足与读取失败。 */
function AlertIcon() {
  return React.createElement(
    'svg',
    {
      className: 'dbp_icon',
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      'aria-hidden': true,
      focusable: false
    },
    React.createElement('path', {
      d: 'M8 2.7 14.1 13H1.9L8 2.7Z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round'
    }),
    React.createElement('path', {
      d: 'M8 6.6v3.1',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    }),
    React.createElement('path', {
      d: 'M8 11.6h.01',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round'
    })
  )
}

// ---- src/client/sparkline.js ---------------------------------
/**
 * 余额徽章 —— 趋势折线。
 *
 * 一段 SVG 折线 + 面积填充，纯展示：所有几何计算都在 `history.js` 的
 * `sparklinePath()` 里完成（并可单测），这里只负责把它铺成元素。
 *
 * 刻意不引图表库：面板宽 264px、数据几十个点，一条 path 足够；引库既会撑大产物，
 * 也会把第三方依赖带进宿主渲染进程。
 */



/** 折线画布尺寸；`viewBox` 用同一坐标系，宽度自适应由 CSS 负责。 */
const WIDTH = 232
const HEIGHT = 40

/**
 * 趋势折线。
 *
 * @param props - `{points, currency, t}`：
 *   `points` 是 `{at, amount}[]`（升序），`currency` 用于无障碍文本。
 */
function TrendSparkline(props) {
  const { points, currency, t } = props
  // 一个点画不出「趋势」：它只会渲染成一条贴边的短线或一个孤点，读者会误以为
  // 余额一直没变。少于两点时整个组件不渲染，由面板决定要不要给出别的说明。
  if (!Array.isArray(points) || points.length < 2) return null
  const geometry = sparklinePath(points, { width: WIDTH, height: HEIGHT })
  if (geometry === null) return null

  const rising = geometry.delta > 0
  const flat = geometry.delta === 0
  // 涨（充值）与跌（消耗）用不同色：跌用主题的 warning 色，涨用 success 色。
  const tone = flat ? 'flat' : rising ? 'up' : 'down'

  return React.createElement(
    'div',
    { className: 'dbp_trend', 'data-balance-trend': true, 'data-tone': tone },
    React.createElement(
      'svg',
      {
        className: 'dbp_spark',
        viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': t('panel.trend.aria', {
          points: geometry.points,
          from: `${currency ?? ''}${geometry.first.toFixed(2)}`,
          to: `${currency ?? ''}${geometry.last.toFixed(2)}`
        })
      },
      React.createElement('path', { className: 'dbp_sparkArea', d: geometry.area }),
      React.createElement('path', { className: 'dbp_sparkLine', d: geometry.d })
    ),
    React.createElement(
      'div',
      { className: 'dbp_trendFoot' },
      React.createElement('span', { className: 'dbp_trendRange', 'data-balance-trend-min': true }, `${currency ?? ''}${geometry.min.toFixed(2)}`),
      React.createElement('span', { className: 'dbp_trendRange', 'data-balance-trend-max': true }, `${currency ?? ''}${geometry.max.toFixed(2)}`)
    )
  )
}

// ---- src/client/version.js -----------------------------------
/**
 * 余额徽章 —— 插件版本号。
 *
 * 为什么单独一个模块：版本要同时出现在面板（诊断时一眼看到跑的是哪一版）与
 * 测试/构建断言里。写成常量而不是从 `package.json` 动态读 —— 客户端产物是
 * 经典脚本，没有文件系统；构建期注入又会把「源码测试」与「产物测试」拆成两套。
 *
 * 版本号在 v0.1.6 从 1.5.0 **重置**：项目还在 0.x（接口与行为仍可能调整），
 * 继续用 1.x 会让人误以为已经稳定。`tests/runtime.test.mjs` 有一条用例锁住
 * 它必须与 `package.json` 一致，改版本时不能只改一处。
 */

const PLUGIN_VERSION = '0.1.6'

// ---- src/client/pill.js --------------------------------------
/**
 * 余额徽章 —— 徽章与展开面板。
 *
 * 结构：徽章是一个按钮（图标 + 金额），挂在输入框下方状态行的最右侧；点击后在
 * `document.body` 上开一个气泡面板，展示充值/赠金拆分、读取时间与消耗速度。
 *
 * 为什么用 portal 而不是就地 absolute 定位：这一行位于输入框卡片下方，
 * 祖先里存在带 `overflow` 的布局容器，就地展开会被裁掉；宿主自己的两个统计
 * 气泡（TimePill / UsagePill）也是 portal 到 body 的，这里跟随同一约定。
 *
 * v1.1 的三处行为变化：
 *  1. 读取失败不再把余额抹成 `--`，而是继续显示上一次的读数并标成过期；
 *  2. 配置变化立刻重算（订阅式），轮询间隔由设置决定，支持「仅手动」；
 *  3. 面板给出「按当前速度还能用多久」，并在有其他币种时补一行提示。
 *
 * v1.3 增加计费时段（高峰 / 空闲）：徽章上挂一枚时段徽标，面板里补一组时段区块。
 * 时段判定全部来自 `pricing.js`（纯函数），这里只负责「什么时候重算」与「怎么显示」——
 * 面板打开时用秒级心跳重算倒计时，关着时按 30 秒分桶，别让徽章在后台白烧 CPU。
 */




// 只借 `priceOf` 读单价：时段快照一律走 `service.tariff.snapshot()`（见下方
// useTariffSnapshot），这里不自己拼装时段判定，免得出现两份口径。









/** 面板宽度，与宿主气泡面板一致。 */
const PANEL_WIDTH = 264

/** 面板与徽章之间的空隙。 */
const PANEL_GAP = 8

/**
 * 订阅一个小型 store 并跟随其变化重渲染。
 *
 * 不用 `useSyncExternalStore`：那是 React 18 才有的钩子，而这个组件在测试里
 * 由自带的微型 hook 运行时渲染（见 tests/runtime.test.mjs）。
 */
function useSettingValue(store) {
  const [value, setValue] = React.useState(() => store.get())
  React.useEffect(() => {
    setValue(store.get())
    return store.subscribe((next) => {
      setValue(next)
    })
  }, [store])
  return value
}

/** 币种前缀；紧凑模式返回空串。 */
function currencyPrefix(currency, settings) {
  if (settings.compact !== true) {
    if (currency === 'CNY') return '¥'
    if (currency === 'USD') return '$'
    if (typeof currency === 'string' && currency !== '') return `${currency} `
    return ''
  }
  return ''
}

/**
 * 秒级心跳：`enabled` 为真时每秒推一次重渲染。
 *
 * 用途只有一个 —— 面板展开时让时段倒计时走字。用 `setInterval` 而不是
 * `requestAnimationFrame`：后台标签页里 rAF 会被暂停，而倒计时是「什么时候
 * 变便宜」的时间信息，切回标签页时必须已经是最新值。`enabled` 为假时**不装**
 * 定时器，这也是契约里「未打开面板不浪费 CPU」的那条。
 *
 * 不用 `useSyncExternalStore`（React 18 专有，测试的微型运行时里没有）。
 *
 * @param enabled - 是否启用（面板展开）。
 * @returns 已走过的 tick 次数；把它放进依赖即可跟随心跳重算。
 */
function useSecondTick(enabled) {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    if (enabled !== true) return undefined
    const timer = setInterval(() => {
      setTick((value) => value + 1)
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [enabled])
  return tick
}

/**
 * 计费时段快照。
 *
 * 快照本身来自 `service.tariff.snapshot()`（tariff-service.js）：时段判定与
 * 提醒状态机共用同一份计算，组件层不重复实现，也不自己算「现在是不是高峰」。
 *
 * 重算时机：面板展开时跟着秒级心跳走；关着时按 30 秒分桶 —— 时段边界都是整点，
 * 30 秒内不可能跨过两次，而每次渲染都重算只是一遍遍得到同一个答案。
 *
 * @param service - 插件 service（缺 `tariff` 时返回 null，界面按「无时段数据」降级）。
 * @param settings - 当前配置（只用到 `tariffModel`）。
 * @param model - 余额视图模型（提供余额与消耗速度，用于峰谷预估）。
 * @param tick - `useSecondTick` 的计数值。
 * @param open - 面板是否展开。
 * @returns 时段快照，或 null（拿不到时段服务时）。
 */
function useTariffSnapshot(service, settings, model, tick, open) {
  const scale = open === true ? tick : Math.floor(Date.now() / 30000)
  const balance = model === null || model === undefined ? null : model.primary
  const ratePerHour = model?.rate?.perHour ?? null
  return React.useMemo(() => {
    const tariff = service.tariff
    if (tariff === undefined || tariff === null || typeof tariff.snapshot !== 'function') return null
    return tariff.snapshot({
      settings: { tariffModel: settings.tariffModel },
      balance,
      ratePerHour,
      now: Date.now()
    })
  }, [service, settings.tariffModel, balance, ratePerHour, scale])
}

/**
 * 余额读取与轮询，外加 v1.3 的四条派生线：历史采样、会话消耗、跨档提醒、计费时段。
 *
 * @param service - `{account, settings, storage, tariff}`，由插件入口构造一次。
 * @param sessionId - 当前会话 id（来自宿主会话标准 props）；为空表示不在会话里。
 * @param open - 面板是否展开（决定时段快照是按秒还是按 30 秒重算）。
 * @returns `{model, phase, busy, refresh(force?), derived}`；
 *   `derived` = `{trend, spend, pricing}`。
 */
function useBalance(service, sessionId, open) {
  const settings = useSettingValue(service.settings)
  // 时段心跳：只在面板展开时启用。它必须是根链上的无条件调用 —— 测试里的微型
  // hook 运行时只有一根游标，条件调用会把后面的钩子全部错位。
  const tariffTick = useSecondTick(open)
  const [snap, setSnap] = React.useState(() => ({
    phase: service.account.available() ? 'loading' : 'unsupported',
    model: null,
    busy: false
  }))
  const alive = React.useRef(true)
  const lastAt = React.useRef(0)
  const inflight = React.useRef(null)
  /** 上一次**成功**读数；失败时用它继续显示，而不是把数字抹掉。 */
  const previous = React.useRef(null)
  /** 余额历史（升序样本）。跨会话共享：它描述的是账号，不是某个对话。 */
  const history = React.useRef(null)
  /** 每个会话的基准余额，用于算「本轮花了多少」。 */
  const baselines = React.useRef(null)
  /** 跨档提醒的状态机。 */
  const alertState = React.useRef(createAlertState())
  /** 面板打开时才画趋势图，避免无人观看时也做降采样与重渲染。 */
  const [derived, setDerived] = React.useState({ trend: null, spend: null, today: null, week: null, recent: null })

  if (history.current === null) history.current = loadHistory(service.storage)
  if (baselines.current === null) baselines.current = loadBaselines(service.storage)

  const build = React.useCallback((balance, accountState, current) => {
    const now = Date.now()
    const model = viewModel({
      balance,
      state: accountState,
      previous: previous.current,
      thresholds: { low: current.low, warn: current.warn },
      format: current.format,
      currency: current.currency,
      at: now,
      now
    })
    // 只有拿到新读数时才推进 previous：stale 的 model 不能反过来污染基准，
    // 否则速度计算会把同一份旧数据算两次。
    //
    // v0.1.6 起不再「每次成功都覆盖」：金额没变时保留旧基准，否则下一次轮询
    // 会因为 `spent = 0` 判定不出速度，面板的「近期消耗」与徽章的耗尽预估
    // 会在一两次轮询后凭空空掉。`rateBaseline()` 负责这条规则（含 6 小时上限）。
    if (model.status === 'ready' && model.summary !== null) {
      previous.current = rateBaseline(previous.current, model.summary, model.at ?? now)
    }
    return model
  }, [])

  const publish = React.useCallback(
    (balance, accountState, current) => {
      if (!alive.current) return
      const model = build(balance, accountState, current)
      setSnap({ phase: 'done', model, busy: false })
      if (model.status !== 'ready' || model.summary === null || model.primary === null) return

      const reading = {
        at: model.at ?? Date.now(),
        amount: model.primary,
        currency: model.summary.currency ?? '',
        // 记录这条样本是按哪个口径取的（合计 / 仅充值 / 仅赠金）。口径一改，
        // 旧样本与新样本就不是同一个量，画进同一条折线会连出假的暴跌。
        basis: model.format
      }

      // 1) 历史采样：只有真正拿到新读数才写，且写入失败不影响主流程。
      history.current = appendSample(history.current ?? [], reading)
      saveHistory(history.current, service.storage)

      // 2) 会话基准：本会话第一次看到余额时记下，之后用「当前 - 基准」算本轮消耗。
      baselines.current = recordBaseline(baselines.current ?? {}, sessionId, reading)
      baselines.current = pruneBaselines(baselines.current)
      saveBaselines(baselines.current, service.storage)

      // 3) 跨档提醒：状态机只在档位变差且未提醒过时给出 alert。
      //    提醒写进共享 store（不是组件 state）—— 徽章是会话作用域的，
      //    切换会话会卸载重挂，放在组件里的提醒会被顺手清掉。
      //
      //    这三步都在 `.then()` 里执行，任何一处抛出都会被下面的 `.catch()`
      //    当成「读取失败」，把一次成功的读数显示成失败。因此这里逐项做了
      //    存在性检查：附属能力缺失不该污染主读数。
      if (service.alerts !== undefined && service.alerts !== null) {
        const outcome = advanceAlert(
          alertState.current,
          {
            level: model.level,
            amount: model.primary,
            currency: reading.currency,
            at: reading.at,
            // 口径 / 阈值 / 币种任一变化都会让「金额 + 档位」同时跳，必须与
            // 真实的余额下降区分开；v0.1.6 用它挡掉切换口径时的假「余额不足」。
            configKey: `${current.format}|${current.currency}|${current.low}|${current.warn}|${reading.currency}`
          },
          { muted: current.alertOnCross !== true }
        )
        alertState.current = outcome.state
        if (outcome.alert !== null) service.alerts.set(outcome.alert)
      }
    },
    [build, service, sessionId]
  )

  const refresh = React.useCallback(
    (force) => {
      if (!service.account.available()) {
        if (alive.current) setSnap({ phase: 'unsupported', model: null, busy: false })
        return Promise.resolve()
      }
      if (inflight.current !== null) return inflight.current
      const now = Date.now()
      // 防抖：焦点事件与可见性事件可能在几毫秒内连续到达。
      if (force !== true && now - lastAt.current < MIN_REFRESH_GAP_MS) return Promise.resolve()
      if (alive.current) setSnap((prev) => ({ ...prev, busy: true }))
      const current = service.settings.get()
      const run = service.account
        .read()
        .then(({ balance, state }) => {
          lastAt.current = Date.now()
          publish(balance, state, current)
        })
        .catch(() => {
          lastAt.current = Date.now()
          publish({ ok: false }, undefined, current)
        })
        .then(() => {
          inflight.current = null
        })
      inflight.current = run
      return run
    },
    [publish, service]
  )

  // 配置变化（阀值 / 口径 / 币种）时立刻用现有读数重算，不必等下一次轮询。
  //
  // 走 `refreshedViewModel` 而不是 `viewModel({balance: {ok: true, value: null}})`：
  // 后者会被当成「这次读取返回了空」，面板随即冒出「本次刷新失败」——
  // 而用户只是改了个阈值，根本没有刷新失败这回事。
  const settingsKey = `${settings.low}|${settings.warn}|${settings.format}|${settings.currency}`
  const recomputeKey = React.useRef(settingsKey)
  React.useEffect(() => {
    if (recomputeKey.current === settingsKey) return
    recomputeKey.current = settingsKey
    if (!alive.current || previous.current === null) return
    setSnap((prev) => {
      if (prev.model === null) return prev
      const rebuilt = refreshedViewModel({
        summary: previous.current.summary,
        at: previous.current.at,
        format: settings.format,
        thresholds: { low: settings.low, warn: settings.warn },
        topUpUrl: prev.model.topUpUrl,
        signedIn: prev.model.signedIn,
        // v0.1.6：直接沿用上一条视图模型算出的速度。旧实现只传 `previous`，
        // 而 `previous` 与 `summary` 是同一份读数（elapsed = 0），`computeRate`
        // 必然返回 null —— 改一次阈值，「近期消耗」那一行就消失到下一次轮询。
        rate: prev.model.rate,
        previous: previous.current,
        now: Date.now()
      })
      if (rebuilt === null) return prev
      return { ...prev, model: rebuilt }
    })
  }, [settingsKey, settings.low, settings.warn, settings.format, settings.currency])

  const pollMs = settings.pollMs

  React.useEffect(() => {
    alive.current = true
    refresh(true)
    const onFocus = () => {
      refresh(false)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(false)
    }
    // 手动模式（pollMs <= 0）不装定时器，只保留焦点/可见性触发。
    const timer = pollMs > 0
      ? setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          refresh(false)
        }, pollMs)
      : undefined
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      if (timer !== undefined) clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, pollMs])

  /**
   * 计费时段快照：面板展开时跟着秒级心跳重算（倒计时走字），关着时按 30 秒分桶。
   * 它只依赖时钟与余额读数、不依赖历史，因此用 useMemo 而不是塞进 `derived` state。
   */
  const pricing = useTariffSnapshot(service, settings, snap.model, tariffTick, open)

  /**
   * 派生趋势与会话消耗。
   *
   * 放在 effect 里而不是渲染期算：`history` 是 ref（采样在 publish 里发生），
   * 渲染期读 ref 不会触发重渲染，趋势图会停在旧数据上。
   * 窗口取「最近 24 小时」，与设置里的说明一致；并只取**同口径**样本 ——
   * 口径从「可用合计」改成「仅充值」之后，同一张图上前后两截不是同一个量。
   */
  React.useEffect(() => {
    const samples = history.current ?? []
    const model = snap.model
    // 一次取时，三条消耗统计共用同一个「现在」：分别调用 Date.now() 在午夜
    // 那一拍可能落到两个计费日，让「今日」与「本周」自相矛盾。
    const now = Date.now()
    const windowed = withinWindow(samples, 24 * 3600 * 1000, now, model?.format)
    const reading = model !== null && model.summary !== null && model.primary !== null
      ? { amount: model.primary, currency: model.summary.currency ?? '', at: model.at ?? now }
      : null
    setDerived({
      // 两个点才构成一条线；一个点画出来只是一个点，没有信息量。
      trend: normalizedTrend(windowed),
      spend: sessionSpend(baselines.current ?? {}, sessionId, reading),
      // 「今日已用」按**整份**历史算，而不是上面那个 24 小时窗口：计费日可能与
      // 「最近 24 小时」错开（凌晨时尤其明显），用窗口算会把昨天的样本算进今天。
      // 口径（basis）与币种都跟随当前视图模型，跨口径相减会得出假的日消耗。
      today: spendInDay(samples, now, {
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      }),
      // 「本周已用」：与「今日已用」同口径，只是按 ISO 周（北京时间周一为起点）切分。
      // 周一早上它只含周一当天 —— 这正是它存在的意义：周一对账不需要看上周。
      week: spendInWeek(samples, now, {
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      }),
      // 「近 7 天已用」：与「本周」互补 —— 周一只含一天时，这一行给出跨周的
      // 完整 7 天窗口；窗口按当前口径与币种过滤，不会把充值算成消耗。
      recent: spendInWindow(samples, now, {
        windowMs: RECENT_WINDOW_MS,
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      })
    })
  }, [snap.model, sessionId, snap.model?.format])

  const dismissAlert = React.useCallback(() => {
    service.alerts.set(null)
  }, [service])

  return {
    model: snap.model,
    phase: snap.phase,
    busy: snap.busy,
    refresh,
    // 时段快照跟 `derived` 一起交给面板：趋势/消耗是 state（异步派生），
    // 时段是每渲染可算的纯值，合成一个对象让面板只有一个数据入口。
    derived: { ...derived, pricing }
  }
}

/**
 * 趋势图数据点门槛。
 *
 * 少于两个样本时返回 null：一个点画不出趋势，硬画只会让人误以为「一直这么平」。
 * 同时做一次降采样，把几百个样本压到面板能表达的分辨率。
 */
function normalizedTrend(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null
  return downsample(samples, 60)
}

/**
 * 计算气泡面板的固定定位。
 *
 * 面板贴在徽章正上方、右边缘对齐，并夹在视口内；只算 `left / bottom`，
 * 因为高度由内容决定，而 `bottom` 定位不需要预先知道高度。
 */
function usePanelPosition(rootRef, open) {
  const [style, setStyle] = React.useState(null)

  const measure = React.useCallback(() => {
    const node = rootRef.current
    if (node === null || typeof window === 'undefined') return
    const rect = node.getBoundingClientRect()
    const width = Math.min(PANEL_WIDTH, window.innerWidth - PANEL_GAP * 2)
    const maxLeft = Math.max(PANEL_GAP, window.innerWidth - width - PANEL_GAP)
    const left = Math.min(Math.max(PANEL_GAP, rect.right - width), maxLeft)
    // 面板向上展开，可用高度就是徽章上方的空间。v0.1.6 起把上限写成内联值：
    // 窗口只有 600px 高、或设置页把界面字号调大时，面板内容会超过视口顶部，
    // 顶部标题与「刷新」按钮被裁掉（在 body 上又滚不动）。超过上限时面板
    // 自己滚动（CSS `overflow-y: auto`）。
    const maxHeight = Math.max(
      96,
      Math.round(Math.min(window.innerHeight - PANEL_GAP * 2, rect.top - PANEL_GAP * 2))
    )
    setStyle({
      left: `${Math.round(left)}px`,
      bottom: `${Math.round(window.innerHeight - rect.top + PANEL_GAP)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${maxHeight}px`
    })
  }, [rootRef])

  React.useEffect(() => {
    if (open !== true) {
      setStyle(null)
      return undefined
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure, open])

  return style
}

/** 数字格式化的公共参数。 */
function numberOptions(locale) {
  return { locale, digits: 2 }
}

/** 徽章上的金额文本。 */
function pillText(model, settings, locale, t) {
  if (model === null) return t('pill.loading')
  if (model.summary !== null) {
    const amount = formatAmount(model.primary, numberOptions(locale))
    return `${currencyPrefix(model.summary.currency, settings)}${amount}`
  }
  if (model.status === 'signed-out') return t('pill.signedOut')
  return t('pill.loading')
}

/** 徽章与面板共用的无障碍描述。 */
function ariaText(model, settings, locale, t) {
  if (model !== null && model.summary !== null) {
    const amount = `${currencyPrefix(model.summary.currency, settings)}${formatAmount(model.primary, numberOptions(locale))}`
    return model.stale
      ? t('pill.ariaStale', { amount, age: formatAge(model.at, t) })
      : t('pill.ariaReady', { amount })
  }
  if (model !== null && model.status === 'signed-out') return t('pill.ariaSignedOut')
  return t('pill.ariaPlain')
}

/**
 * 徽章上的「余额预估耗尽时刻」。
 *
 * 面板里早就有「按此速度约可用 {remaining}」这句话，但那要展开面板才看得到 ——
 * 而「今天就会用完」这种事最好在**不点开**的时候就能被察觉。这里不往徽章上加文字
 * （那会破坏 `data-balance-pill` 的既有断言与紧凑模式），只给一个属性与
 * `title` 的一句补充，展开面板后仍是原来的数字。
 *
 * 触发条件三选三，缺一不可：
 *  1. 有成功读数（`model.status === 'ready'`）；
 *  2. 有正的消耗速度（`model.rate.perHour > 0`）—— 没有速度就没有预估；
 *  3. 预估耗尽时刻落在**24 小时内**。
 * 任一不满足时返回 null，属性**不存在**（沿用 v1.3 对 `data-tariff` 的口径：
 * 「不知道」就不要冒充一个值）。
 *
 * 跟随 `showRate`：用户关掉「显示消耗速度」就是不想看这类预测，
 * 不该从徽章上绕回来（因此不新增设置项）。
 *
 * @param model - 余额视图模型。
 * @param settings - 当前配置（只用到 `showRate`）。
 * @returns `{at}` 或 null。
 */
function runoutOf(model, settings) {
  if (settings.showRate !== true) return null
  if (model === null || model.status !== 'ready') return null
  const perHour = model.rate?.perHour
  if (typeof perHour !== 'number' || !Number.isFinite(perHour) || perHour <= 0) return null
  const balance = model.primary
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return null
  const hours = balance / perHour
  const at = Date.now() + hours * 3600000
  // 只提示「24 小时内会耗尽」：更远的时间没有行动价值，天天挂着一句
  // 「约 3 天后耗尽」只是噪音，也会让 title 变长。
  if (hours * 3600000 > 24 * 3600000) return null
  return { at }
}

/** 面板在无数据时的说明文案。 */
function messageFor(model, t) {
  if (model === null) return t('age.never')
  if (model.status === 'signed-out') return t('error.signedOut')
  if (model.status === 'unsupported') return t('error.unsupported')
  return t('error.failed')
}

/** 面板里的一行「键 → 值」。 */
function row(key, label, value, classes) {
  return [
    React.createElement('dt', { key: `${key}-k`, className: classes?.key }, label),
    React.createElement('dd', { key: `${key}-v`, className: classes?.value, 'data-balance-field': key }, value)
  ]
}

// ---------------------------------------------------------------- 计费时段

/**
 * `reason` → 补充说明词条（契约第 3 节第 4 条）。
 *
 * `peak-window` 与 `night` 刻意不在表里：它们没有额外的话要说 ——
 * 「现在是高峰 / 现在是半夜」已经由上面那行徽标说清楚了，再说一遍只是噪音。
 */
const TARIFF_REASON_KEYS = {
  holiday: 'panel.tariff.holiday',
  weekend: 'panel.tariff.weekend',
  'makeup-workday': 'panel.tariff.makeup',
  midday: 'panel.tariff.midday'
}

/** 面板徽标上的字。 */
function tariffPeriodText(pricing, t) {
  return t(pricing.isPeak ? 'tariff.peak' : 'tariff.offPeak')
}

/** 状态行徽章上那枚徽标的字：比面板更短，塞得进状态行。 */
function tariffPillText(pricing, t) {
  return t(pricing.isPeak ? 'tariff.pill.peak' : 'tariff.pill.offPeak')
}

/** 徽标的无障碍描述：说清「现在贵还是便宜」，而不只是「高峰」两个字。 */
function tariffPillAria(pricing, t) {
  return t(pricing.isPeak ? 'tariff.pill.aria' : 'tariff.pill.ariaOff')
}

/** 面板里的一句话结论。 */
function tariffNoteText(pricing, t) {
  return t(pricing.isPeak ? 'panel.tariff.peak' : 'panel.tariff.offPeak')
}

/** 补充说明的词条键；没有可说的返回 null（此时不渲染该节点）。 */
function tariffReasonKey(pricing) {
  // 补班日的高峰时段 reason 是 `peak-window`（见 pricing.js 的 periodAt），
  // 而「周六怎么在收费」恰恰是那时候最需要解释的一句，因此 makeup 单独判一次。
  if (pricing.makeup === true) return TARIFF_REASON_KEYS['makeup-workday']
  return TARIFF_REASON_KEYS[pricing.reason] ?? null
}

/** 某个时刻在计费时区里的「日序号」，用来判断两个时刻是否同一天。 */
function billingDay(at, tzOffsetMinutes) {
  return Math.floor((at + tzOffsetMinutes * 60000) / 86400000)
}

/** 某个时刻在计费时区里的年份（日历覆盖提示用）。 */
function billingYear(at, tzOffsetMinutes) {
  return new Date(at + tzOffsetMinutes * 60000).getUTCFullYear()
}

/**
 * 面板里的时段区块（契约第 3 节的 1–8 项）。
 *
 * 做成「返回元素数组的纯函数」而不是组件：测试里的微型 hook 运行时会把函数组件
 * 就地展开、共用同一根钩子游标，带钩子的子组件会把它搅乱（见 createHarness 的注释）。
 * 这里一个钩子都没有，两条渲染路径下行为一致。
 *
 * 金额一律往词条里传**纯数字**：`panel.tariff.price` / `panel.tariff.save` 的模板
 * 自己带着 `¥`（价格表是人民币口径），再套一层 `formatMoney` 会打印成 `¥¥16.00`。
 * 币种不是人民币时走的 `panel.tariff.saveGeneric` 不含金额，这正是契约要的降级。
 *
 * @param props - `{pricing, summary, locale, t}`。
 * @returns 元素数组，顺序即契约表格的顺序。
 */
function tariffBlocks(props) {
  const { pricing, summary, locale, t } = props
  if (pricing === null || pricing === undefined) return []
  const options = numberOptions(locale)
  const tz = pricing.tzOffsetMinutes
  const blocks = []

  // 1. 徽标 + 一句话结论。
  blocks.push(
    React.createElement(
      'p',
      { className: 'dbp_tariffRow', key: 'tariff-row', 'data-balance-tariff-row': true },
      React.createElement(
        'span',
        { className: 'dbp_tariffBadge', 'data-tariff': pricing.period },
        tariffPeriodText(pricing, t)
      ),
      React.createElement('span', { className: 'dbp_tariffNote', 'data-balance-tariff-note': true }, tariffNoteText(pricing, t))
    )
  )

  // 2. 距下一个高峰 / 下一个空闲时段的倒计时。
  //    倒计时是**确定**的时刻差，用 formatCountdown（远期能给「2 天」这种粒度）；
  //    由速度推算的预测量才用 formatDuration —— 两者语义不同，别混。
  //    目标不在今天时把日期一并给出：只写「09:00 起」在跨天时会读成已经过去的那个 9 点。
  const nextAt = pricing.isPeak ? pricing.nextOffPeakAt : pricing.nextPeakAt
  const msUntil = pricing.isPeak ? pricing.msUntilOffPeak : pricing.msUntilPeak
  if (Number.isFinite(nextAt)) {
    const sameDay = billingDay(nextAt, tz) === billingDay(pricing.now, tz)
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-next', 'data-balance-tariff-next': true },
        t(pricing.isPeak ? 'panel.tariff.untilOffPeak' : 'panel.tariff.untilPeak', {
          duration: formatCountdown(msUntil, t),
          time: sameDay ? formatBeijingTime(nextAt, tz) : formatBeijingDateTime(nextAt, tz)
        })
      )
    )
  }

  // 3. 本段空闲区间（高峰时不渲染）。跨天的结束时刻带上日期：
  //    「18:00 – 09:00」会被读成倒序，而它其实是一整段 15 小时的空闲。
  const offPeakWindow = pricing.offPeakWindow
  if (pricing.isOffPeak && offPeakWindow !== null && offPeakWindow !== undefined) {
    const sameDay = billingDay(offPeakWindow.start, tz) === billingDay(offPeakWindow.end, tz)
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-window', 'data-balance-tariff-window': true },
        t('panel.tariff.window', {
          from: formatBeijingTime(offPeakWindow.start, tz),
          to: sameDay
            ? formatBeijingTime(offPeakWindow.end, tz)
            : formatBeijingDateTime(offPeakWindow.end, tz),
          duration: formatDuration(offPeakWindow.end - offPeakWindow.start, t)
        })
      )
    )
  }

  // 4. 依 reason 补一句解释（节假日 / 周末 / 补班 / 午休）。
  const reasonKey = tariffReasonKey(pricing)
  if (reasonKey !== null) {
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-reason', 'data-balance-tariff-reason': true },
        t(reasonKey)
      )
    )
  }

  // 5. 当前时段的输出单价，并把高峰价放在旁边作对照 ——
  //    用户真正想确认的是「现在这个价是不是贵的那个」。
  const output = priceOf(pricing.model, pricing.period, 'output')
  const peakOutput = priceOf(pricing.model, 'peak', 'output')
  if (output !== null && peakOutput !== null) {
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-price', 'data-balance-tariff-price': true },
        t('panel.tariff.price', {
          model: pricing.model?.label ?? '',
          output: formatAmount(output, options),
          peakOutput: formatAmount(peakOutput, options)
        })
      )
    )
  }

  // 6. 高峰时算一笔「这两小时的账」：按当前速度跑 2 小时要花多少，留到空闲只花一半。
  //    余额是别的币种时这笔账不成立（价格表是人民币），降级成「同样的钱能多用多久」。
  if (pricing.isPeak && pricing.remainingMs !== null && pricing.ratePerHour !== null) {
    const currency = summary?.currency ?? ''
    const amount = pricing.ratePerHour * 2
    const text = currency === 'CNY'
      ? t('panel.tariff.save', {
          amount: formatAmount(amount, options),
          half: formatAmount(amount / 2, options)
        })
      : t('panel.tariff.saveGeneric', { duration: formatDuration(pricing.offPeakRemainingMs, t) })
    blocks.push(
      React.createElement('p', { className: 'dbp_tariffMeta', key: 'tariff-save', 'data-balance-tariff-save': true }, text)
    )
  }

  // 7. 空闲时回答真正要决策的那个问题：这点钱撑得到下一个高峰吗。
  if (pricing.isOffPeak && pricing.lastsUntilNextPeak !== null) {
    const shortfall = pricing.msUntilPeak === null ? null : pricing.msUntilPeak - pricing.remainingMs
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-lasts', 'data-balance-tariff-lasts': true },
        pricing.lastsUntilNextPeak === true
          ? t('panel.tariff.lasts')
          : t('panel.tariff.short', { duration: formatDuration(shortfall, t) })
      )
    )
  }

  // 8. 日历覆盖提示：日历过期意味着「节假日全天空闲」这条会静默失效。
  const year = billingYear(pricing.now, tz)
  blocks.push(
    React.createElement(
      'p',
      { className: 'dbp_tariffMeta', key: 'tariff-calendar', 'data-balance-tariff-calendar': true },
      calendarCovers(year)
        ? t('panel.tariff.calendar', { years: `${CALENDAR_FIRST_YEAR}–${CALENDAR_LAST_YEAR}` })
        : t('panel.tariff.calendarStale', { year })
    )
  )

  return blocks
}

/**
 * 展开面板。
 *
 * 纯展示组件：内部一个 hook 都不用 —— 它会被测试里的微型运行时就地展开，
 * 带钩子就会搅乱根组件的钩子游标。
 *
 * @param props - `{model, settings, locale, t, busy, onRefresh, position, panelRef, derived, pricing}`。
 */
function BalancePanel(props) {
  const { model, settings, locale, t, busy, onRefresh, position, panelRef, derived, pricing } = props
  const options = numberOptions(locale)
  const summary = model?.summary ?? null
  const spend = derived?.spend ?? null
  const today = derived?.today ?? null
  const week = derived?.week ?? null
  const recent = derived?.recent ?? null
  const trend = derived?.trend ?? null
  const children = [
    React.createElement(
      'div',
      { className: 'dbp_panelHead', key: 'head' },
      React.createElement('span', { className: 'dbp_panelTitle' }, t('panel.title')),
      // 版本号放在标题旁边而不是设置页：用户报问题时第一眼就能看到跑的是哪一版。
      React.createElement(
        'span',
        { className: 'dbp_panelVersion', 'data-balance-version': true, title: `dsh-balance-pill v${PLUGIN_VERSION}` },
        `v${PLUGIN_VERSION}`
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbp_refresh',
          onClick: () => {
            onRefresh(true)
          },
          disabled: busy
        },
        busy ? t('panel.refreshing') : t('panel.refresh')
      )
    )
  ]

  if (model !== null && model.stale) {
    children.push(
      React.createElement(
        'p',
        { className: 'dbp_stale', key: 'stale', role: 'status', 'data-balance-stale': true },
        t('panel.stale', { age: formatAge(model.at, t) })
      )
    )
  }

  children.push(React.createElement('div', { className: 'dbp_rule', key: 'rule-1' }))

  if (summary !== null) {
    children.push(
      React.createElement(
        'dl',
        { className: 'dbp_rows', key: 'rows' },
        row('recharge', t('panel.recharge'), formatMoney(summary.recharge, summary.currency, options))
          .concat(row('bonus', t('panel.bonus'), formatMoney(summary.bonus, summary.currency, options)))
          .concat(
            row('shown', t(`panel.shown.${model.format}`), formatMoney(model.primary, summary.currency, options), {
              key: 'dbp_totalKey',
              value: 'dbp_totalValue'
            })
          )
      )
    )

    // 计费时段：插在金额明细之后、档位提示之前（契约第 3 节第 1 条给的锚点）。
    // 先说明「现在这个价是贵还是便宜」，再由档位提示回答「钱还够不够」。
    children.push(...tariffBlocks({ pricing, summary, locale, t }))

    children.push(
      React.createElement('p', { className: 'dbp_hint', key: 'hint', 'data-level': model.level }, t(`hint.${model.level}`))
    )

    // 本轮会话消耗：余额是账号级的，用户更关心「这次对话花了多少」。
    // v1.5 起把「3 分钟前」改成「自 HH:MM 起」——「多久以前」每秒都在贬值，
    // 而「从几点开始」是稳定的；与下面「今日已用」的写法一致。
    if (settings.showSessionSpend && spend !== null && spend.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_spend', key: 'spend', 'data-balance-spend': true },
          t('panel.sessionSpend', {
            amount: formatMoney(spend.spent, spend.currency, options),
            // 会话可能跨天；只写「自 08:20 起」会让跨天的起点读成今天。
            time: formatBillingMoment(spend.since, Date.now())
          })
        )
      )
    }

    // 今日已用：本轮消耗回答「这次对话」，这一行回答「今天一共」。
    // 它**不**受 `showTrend` 控制 —— 只依赖历史采样，与折线图是两件事。
    // 当天样本不足两个时 `spendInDay` 返回 null，这一行不渲染（而不是显示 ¥0）。
    if (today !== null && today.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_today', key: 'today', 'data-balance-today-spend': true },
          t('panel.todaySpend', {
            amount: formatMoney(today.spent, today.currency, options),
            // 起点用**北京时间**而不是 formatClock：这一行是按北京时间的自然日
            // 切出来的（spendInDay 的口径），用本地时区显示时刻会在非 +08:00
            // 的机器上给出一个与「今天」对不上的钟点。
            time: formatBeijingTime(today.firstAt)
          })
        )
      )
    }

    // 本周已用（v1.5）：与「今日已用」同口径，按北京时间 ISO 周（周一为起点）。
    // 样本不足两个时不渲染 —— 周一早上通常就是这种情况。
    if (week !== null && week.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_week', key: 'week', 'data-balance-week-spend': true },
          t('panel.weekSpend', {
            amount: formatMoney(week.spent, week.currency, options),
            // 本周可能从周一就开始了；只写时刻会把它读成今天早上。
            time: formatBillingMoment(week.firstAt, Date.now())
          })
        )
      )
    }

    // 近 7 天已用（v0.1.6）：与「本周」互补。周一只含一天时，这一行仍然给出
    // 跨周的完整 7 天窗口；样本不足两个时不渲染。
    if (recent !== null && recent.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_recent', key: 'recent', 'data-balance-recent-spend': true },
          t('panel.recentSpend', {
            amount: formatMoney(recent.spent, recent.currency, options),
            time: formatBillingMoment(recent.firstAt, Date.now())
          })
        )
      )
    }

    if (settings.showTrend && trend !== null) {
      children.push(
        React.createElement(TrendSparkline, {
          key: 'trend',
          points: trend,
          currency: currencyPrefix(summary.currency, { compact: false }),
          t
        })
      )
    }

    if (settings.showRate && model.rate !== null) {
      const hours = model.rate.perHour > 0 ? (model.primary / model.rate.perHour) * 3600000 : 0
      // v1.5：标注这是按**当前**时段单价折算的速度。
      // 跨峰/谷切换时这个数会跳，不标注会让用户以为是余额算错了。
      const rateKey = pricing !== null && pricing.isPeak === false ? 'panel.rateOffPeak' : 'panel.rate'
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_meta', key: 'rate', 'data-balance-rate': true },
          t(rateKey, {
            amount: formatMoneyDelta(-model.rate.spent, summary.currency, options),
            remaining: formatDuration(hours, t)
          })
        )
      )
    }

    if (summary.otherWallets.length > 0) {
      const others = []
      const seen = []
      for (const wallet of summary.otherWallets) {
        if (seen.includes(wallet.currency)) continue
        seen.push(wallet.currency)
        others.push(`${wallet.currency} ${formatAmount(wallet.amount, options)}`)
      }
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_meta', key: 'others', 'data-balance-others': true },
          t('panel.others', { list: others.join(' · ') })
        )
      )
    }
  } else {
    children.push(React.createElement('p', { className: 'dbp_message', key: 'message' }, messageFor(model, t)))
  }

  children.push(
    React.createElement('div', { className: 'dbp_rule', key: 'rule-2' }),
    React.createElement(
      'p',
      { className: 'dbp_meta', key: 'updated', 'data-balance-updated': true },
      model === null || model.at === null
        ? t('age.never')
        : t('panel.updated', { time: formatClock(model.at), age: formatAge(model.at, t) })
    ),
    React.createElement(
      'p',
      { className: 'dbp_meta', key: 'auto' },
      settings.pollMs <= 0 ? t('panel.manual') : t('panel.auto', { seconds: Math.round(settings.pollMs / 1000) })
    ),
    React.createElement(
      'p',
      { className: 'dbp_meta', key: 'rule-text' },
      t('panel.rule', { low: formatThreshold(settings.low), warn: formatThreshold(settings.warn) })
    ),
    React.createElement('p', { className: 'dbp_meta', key: 'settings-hint' }, t('panel.settingsHint'))
  )

  if (model !== null && model.topUpUrl !== null) {
    children.push(
      React.createElement(
        'a',
        { className: 'dbp_topUp', key: 'topup', href: model.topUpUrl, target: '_blank', rel: 'noreferrer noopener' },
        t('panel.topUp')
      )
    )
  }

  return React.createElement(
    'div',
    {
      className: 'dbp_panel',
      role: 'dialog',
      'aria-label': t('panel.title'),
      'data-balance-panel': true,
      ref: panelRef,
      style: position ?? {
        visibility: 'hidden',
        left: '0px',
        bottom: '0px',
        width: `${PANEL_WIDTH}px`,
        maxHeight: 'calc(100vh - 24px)'
      }
    },
    children
  )
}

/**
 * 状态行里的余额徽章。
 *
 * @param props - 渲染器注入的 props：`t`（本插件词条）、`service`
 *   （`{account, settings, activeLocale, storage, tariff}`）与宿主会话标准 props
 *   （`sessionId` 用于「本轮会话消耗」）。
 */
function BalancePill(props) {
  const { t, service, sessionId } = props
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef(null)
  const panelRef = React.useRef(null)
  const settings = useSettingValue(service.settings)
  const locale = React.useMemo(() => {
    try {
      return String(service.activeLocale?.() ?? 'zh-CN')
    } catch {
      return 'zh-CN'
    }
  }, [service])
  const { model, phase, busy, refresh, derived } = useBalance(service, sessionId, open)
  const position = usePanelPosition(rootRef, open)
  /** 时段快照；拿不到时段服务（旧测试替身）时为 null，界面按「无时段数据」降级。 */
  const pricing = derived?.pricing ?? null

  React.useEffect(() => {
    if (open !== true) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event) => {
      const target = event.target
      if (rootRef.current !== null && rootRef.current.contains(target)) return
      if (panelRef.current !== null && panelRef.current.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  // 没有账号能力时不留噪音：整枚徽章不出现（诊断走 console）。
  if (phase === 'unsupported') {
    if (globalThis.__DBP_WARNED__ !== true) {
      globalThis.__DBP_WARNED__ = true
      console.warn('[dsh-balance-pill] remote.account 未挂载，余额徽章已停用')
    }
    return null
  }

  const level = model?.level ?? 'ok'
  const status = model?.status ?? 'loading'
  const text = pillText(model, settings, locale, t)
  const label = ariaText(model, settings, locale, t)
  const lowish = level === 'low' || (model !== null && model.summary === null && status === 'failed')
  const Icon = lowish ? AlertIcon : WalletIcon
  /** 余额预估耗尽（24 小时内才有）；拿不到时为 null。 */
  const runout = runoutOf(model, settings)

  /** 时段徽标的无障碍描述：给读屏用户一句「现在贵还是便宜」。 */
  const badgeLabel = pricing === null ? '' : tariffPillAria(pricing, t)
  // `settings.showTariff` 关掉时这个元素**必须不存在**（契约第 3 节的硬要求，
  // 也是 GUI 验证里「关掉后徽标消失」那条断言的依据）。
  const tariffBadge =
    settings.showTariff === true && pricing !== null
      ? React.createElement(
          'span',
          {
            className: 'dbp_tariff',
            'data-balance-tariff': pricing.period,
            title: badgeLabel,
            'aria-label': badgeLabel
          },
          tariffPillText(pricing, t)
        )
      : null

  const trigger = React.createElement(
    'button',
    {
      type: 'button',
      className: 'dbp_trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'aria-label': label,
      // 耗尽预估作为一个**补充**追加在标题末尾，而不是替换原有内容：
      // title 原本是「账户余额 · ¥3.02」，两件事各说各的。
      title:
        runout === null
          ? `${t('pill.title')} · ${text}`
          : `${t('pill.title')} · ${text} · ${t('pill.runout', { time: formatBeijingDateTime(runout.at) })}`,
      onClick: () => {
        setOpen((prev) => !prev)
      }
    },
    React.createElement(Icon, null),
    React.createElement('span', { className: 'dbp_text' }, text),
    tariffBadge
  )

  const panel = open
    ? ReactDOM.createPortal(
        React.createElement(BalancePanel, {
          model,
          settings,
          locale,
          t,
          busy,
          onRefresh: refresh,
          position,
          panelRef,
          derived,
          pricing
        }),
        document.body
      )
    : null

  // 跨档提醒不在这里渲染：它是账号级事件，但徽章是会话作用域的（切会话会卸载
  // 重挂），因此提醒由 `shell.overlay` 上的独立条目渲染。见 index.js 的注册。

  return React.createElement(
    'span',
    {
      className: 'dbp_root',
      'data-balance-pill': true,
      'data-level': level,
      'data-status': status,
      // 当前计费时段：**始终输出**（哪怕徽标被设置关掉），样式与验证都靠它定位。
      // 拿不到时段服务时为 undefined，元素上就不出现这个属性 —— 那是「不知道」，
      // 不是「空闲」，不该冒充一个档位。
      'data-tariff': pricing?.period,
      'data-tariff-reason': pricing?.reason,
      // 余额预估耗尽时刻（ISO 字符串）。只在「有读数 + 有正的消耗速度 +
      // 24 小时内」三个条件都满足时才输出；否则**属性不存在**（不是空串）——
      // 与 data-tariff 同一口径：「不知道」不该冒充一个值。
      'data-balance-runout': runout === null ? undefined : new Date(runout.at).toISOString(),
      'data-stale': model?.stale === true ? 'true' : undefined,
      'data-compact': settings.compact === true ? 'true' : undefined,
      // 当前会话 id：宿主自己也在 DOM 上暴露了同一个值
      // （`data-conversation-session`），这里跟随该约定。
      // 它让「本轮消耗为什么没显示」这类问题可以被直接看出来，而不必猜。
      'data-balance-session': typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined,
      ref: rootRef
    },
    trigger,
    panel
  )
}

// ---- src/client/settings-row.js ------------------------------
/**
 * 余额徽章 —— 设置行组件。
 *
 * 挂进宿主的「设置 → 通用设置」里的 `settings.general.item`（list 槽），与宿主
 * 自己的「外观 / 字号大小 / 显示代码工作视图」并排，因此必须沿用宿主的行版式：
 * 左侧标题 + 描述，右侧控件，上下 16px 内边距、底部 0.5px 分隔线。
 * （宿主的分区中文标签是「通用设置」，不是「常规」。）
 *
 * 控件刻意用原生 `select` / `input[type=number]` / `input[type=checkbox]` 而不是
 * 宿主 primitives 里的封装件：本插件的构建是零依赖拼接，引用
 * `@deepseek-ai/dsh-client-ui-primitives` 会把产物绑到该包的内部导出上，
 * 而这里需要的三个控件用原生元素 + 主题令牌就能做到视觉一致。
 *
 * v1.3 的「计费时段」三行（显示徽标 / 价格口径 / 时段切换提醒）插在「显示余额趋势」
 * 之后，前面另给一句规则说明 —— 开关自己解释不了「为什么会有两个价」。
 */





/**
 * 订阅一个小型 store 并跟随其变化重渲染。
 *
 * 不用 `useSyncExternalStore`：那是 React 18 才有的钩子，而这个组件在测试里
 * 由自带的微型 hook 运行时渲染（见 tests/runtime.test.mjs），
 * useState + 订阅 + 卸载清理这一组合在任何 React 16.8+ 上都成立。
 *
 * @param store - `{get, subscribe}`。
 * @returns 当前值。
 */
function useStoreValue(store) {
  const [value, setValue] = React.useState(() => store.get())
  React.useEffect(() => {
    setValue(store.get())
    return store.subscribe((next) => {
      setValue(next)
    })
  }, [store])
  return value
}

/** 一行设置：左侧标题+描述，右侧控件。 */
function Row(props) {
  const { title, description, disabled, children, testId } = props
  return React.createElement(
    'div',
    { className: 'dbp_setRow', 'data-balance-setting': testId, 'data-disabled': disabled === true ? 'true' : undefined },
    React.createElement(
      'div',
      { className: 'dbp_setCopy' },
      React.createElement('div', { className: 'dbp_setTitle' }, title),
      description === undefined || description === null
        ? null
        : React.createElement('div', { className: 'dbp_setDescription' }, description)
    ),
    React.createElement('div', { className: 'dbp_setControl' }, children)
  )
}

/** 下拉选择。 */
function Select(props) {
  const { value, options, onChange, label, testId } = props
  return React.createElement(
    'select',
    {
      className: 'dbp_select',
      'aria-label': label,
      value,
      'data-balance-control': testId,
      onChange: (event) => {
        onChange(event.target.value)
      }
    },
    options.map((option) =>
      React.createElement('option', { key: option.value, value: option.value }, option.label)
    )
  )
}

/** 复选框。 */
function Checkbox(props) {
  const { checked, onChange, label, testId } = props
  return React.createElement(
    'label',
    { className: 'dbp_check' },
    React.createElement('input', {
      type: 'checkbox',
      checked,
      'aria-label': label,
      'data-balance-control': testId,
      onChange: (event) => {
        onChange(event.target.checked)
      }
    })
  )
}

/**
 * 数字输入：受控但允许中间态。
 *
 * 直接把输入框绑到数值上会让「想输入 10 却先删成空」时立刻弹回旧值，
 * 因此这里维护一个本地草稿串，只在能解析成合法数字时才写回配置。
 */
function NumberInput(props) {
  const { value, min, step, onCommit, label, testId } = props
  const [draft, setDraft] = React.useState(() => String(value))
  const focused = React.useRef(false)

  // 外部改了值（例如点了「恢复默认」）而用户没有正在编辑时，跟随外部。
  React.useEffect(() => {
    if (focused.current !== true) setDraft(String(value))
  }, [value])

  return React.createElement('input', {
    type: 'number',
    className: 'dbp_number',
    inputMode: 'decimal',
    min,
    step,
    value: draft,
    'aria-label': label,
    'data-balance-control': testId,
    onFocus: () => {
      focused.current = true
    },
    onBlur: () => {
      focused.current = false
      setDraft(String(value))
    },
    onChange: (event) => {
      const next = event.target.value
      setDraft(next)
      if (next.trim() === '') return
      const parsed = Number(next)
      if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed)
    }
  })
}

/**
 * 设置行。
 *
 * @param props - 渲染器注入的 props：`t`（本插件词条）与 `service`
 *   （`{settings, account, pollMs 语义由 settings.pollMs 决定}`）。
 */
function BalanceSettingsRow(props) {
  const { t, service } = props
  const settings = useStoreValue(service.settings)
  const available = service.account.available()

  const set = (patch) => {
    service.settings.update(patch)
  }

  return React.createElement(
    'div',
    { className: 'dbp_setRoot', 'data-balance-settings': true },
    React.createElement(
      'div',
      { className: 'dbp_setHead' },
      React.createElement('div', { className: 'dbp_setTitle dbp_setHeadTitle' }, t('settings.title')),
      React.createElement('div', { className: 'dbp_setDescription' }, t('settings.description'))
    ),

    !available &&
      React.createElement('div', { className: 'dbp_setNotice', role: 'status', 'data-balance-setting': 'unavailable' }, t('settings.unavailable')),

    React.createElement(
      Row,
      { title: t('settings.format.title'), description: t('settings.format.description'), testId: 'format' },
      React.createElement(Select, {
        value: settings.format,
        label: t('settings.format.title'),
        testId: 'format',
        onChange: (value) => {
          set({ format: value })
        },
        options: FORMATS.map((value) => ({ value, label: t(`settings.format.${value}`) }))
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.currency.title'), description: t('settings.currency.description'), testId: 'currency' },
      React.createElement(Select, {
        value: settings.currency,
        label: t('settings.currency.title'),
        testId: 'currency',
        onChange: (value) => {
          set({ currency: value })
        },
        options: CURRENCIES.map((value) => ({ value, label: t(`settings.currency.${value}`) }))
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.thresholds.title'),
        description: t('settings.thresholds.description', {
          low: formatThreshold(settings.low),
          warn: formatThreshold(settings.warn)
        }),
        testId: 'thresholds'
      },
      React.createElement(
        'div',
        { className: 'dbp_setPair' },
        React.createElement(NumberInput, {
          value: settings.low,
          min: 0,
          step: 1,
          label: t('settings.low'),
          testId: 'low',
          onCommit: (value) => {
            // 用 clampThresholdPatch 而不是直接写 low：否则把红色阈值填到 42
            // 会被归一化对调成 low:1/warn:42，红色档位的语义被静默颠倒。
            set(clampThresholdPatch(settings, { low: value }))
          }
        }),
        React.createElement(NumberInput, {
          value: settings.warn,
          min: 0,
          step: 1,
          label: t('settings.warn'),
          testId: 'warn',
          onCommit: (value) => {
            set(clampThresholdPatch(settings, { warn: value }))
          }
        })
      )
    ),

    React.createElement(
      Row,
      { title: t('settings.poll.title'), description: t('settings.poll.description'), testId: 'poll' },
      React.createElement(Select, {
        value: String(settings.pollMs),
        label: t('settings.poll.title'),
        testId: 'poll',
        onChange: (value) => {
          set({ pollMs: Number(value) })
        },
        options: POLL_CHOICES.map((ms) => ({
          value: String(ms),
          label: ms === 0 ? t('settings.poll.manual') : t('settings.poll.seconds', { count: ms / 1000 })
        }))
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.showRate.title'), description: t('settings.showRate.description'), testId: 'showRate' },
      React.createElement(Checkbox, {
        checked: settings.showRate,
        label: t('settings.showRate.title'),
        testId: 'showRate',
        onChange: (value) => {
          set({ showRate: value })
        }
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.showSessionSpend.title'),
        description: t('settings.showSessionSpend.description'),
        testId: 'showSessionSpend'
      },
      React.createElement(Checkbox, {
        checked: settings.showSessionSpend,
        label: t('settings.showSessionSpend.title'),
        testId: 'showSessionSpend',
        onChange: (value) => {
          set({ showSessionSpend: value })
        }
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.showTrend.title'), description: t('settings.showTrend.description'), testId: 'showTrend' },
      React.createElement(Checkbox, {
        checked: settings.showTrend,
        label: t('settings.showTrend.title'),
        testId: 'showTrend',
        onChange: (value) => {
          set({ showTrend: value })
        }
      })
    ),

    // ---- v1.3 计费时段（高峰 / 空闲）----
    // 三行设置前面先给一句总说明：高峰/空闲的规则本身要在界面上讲清楚一次，
    // 否则「显示计费时段」这个开关打开后用户仍然不知道为什么会有两个价。
    React.createElement(
      'div',
      { className: 'dbp_setGroup', 'data-balance-setting': 'tariff' },
      React.createElement('div', { className: 'dbp_setTitle dbp_setGroupTitle' }, t('settings.tariff.title')),
      React.createElement('div', { className: 'dbp_setDescription' }, t('settings.tariff.description'))
    ),

    React.createElement(
      Row,
      { title: t('settings.showTariff.title'), description: t('settings.showTariff.description'), testId: 'showTariff' },
      React.createElement(Checkbox, {
        checked: settings.showTariff,
        label: t('settings.showTariff.title'),
        testId: 'showTariff',
        onChange: (value) => {
          set({ showTariff: value })
        }
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.tariffModel.title'),
        description: t('settings.tariffModel.description'),
        testId: 'tariffModel'
      },
      React.createElement(Select, {
        value: settings.tariffModel,
        label: t('settings.tariffModel.title'),
        testId: 'tariffModel',
        onChange: (value) => {
          set({ tariffModel: value })
        },
        // 选项名直接用价格表里的 `label`（deepseek-flash / deepseek-v4-pro）：
        // 它是官方模型名，翻译成中文反而对不上文档里的叫法。
        options: MODELS.map((model) => ({ value: model.key, label: model.label }))
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.alertOnTariff.title'),
        description: t('settings.alertOnTariff.description'),
        testId: 'alertOnTariff'
      },
      React.createElement(Checkbox, {
        checked: settings.alertOnTariff,
        label: t('settings.alertOnTariff.title'),
        testId: 'alertOnTariff',
        onChange: (value) => {
          set({ alertOnTariff: value })
        }
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.alert.title'), description: t('settings.alert.description'), testId: 'alert' },
      React.createElement(Checkbox, {
        checked: settings.alertOnCross,
        label: t('settings.alert.title'),
        testId: 'alertOnCross',
        onChange: (value) => {
          set({ alertOnCross: value })
        }
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.compact.title'), description: t('settings.compact.description'), testId: 'compact' },
      React.createElement(Checkbox, {
        checked: settings.compact,
        label: t('settings.compact.title'),
        testId: 'compact',
        onChange: (value) => {
          set({ compact: value })
        }
      })
    ),

    React.createElement(
      'div',
      { className: 'dbp_setFoot' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbp_setButton',
          'data-balance-control': 'reset',
          onClick: () => {
            service.settings.update(DEFAULT_SETTINGS)
          }
        },
        t('settings.reset')
      ),
      React.createElement('span', { className: 'dbp_setHint' }, t('settings.historyHint'))
    )
  )
}

// ---- src/client/styles.generated.js --------------------------
/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 修改样式请编辑 src/client/styles.css，然后运行 `node scripts/build.mjs`。
 */
const STYLES = "/*\n * 余额徽章 —— 样式表。\n *\n * 视觉目标是「看起来像宿主自己画的」：徽章沿用 ContextMeter 触发器与\n * StatsPills 胶囊的同一套尺寸（13px 字号、20px 行高、1px 8px 内边距、\n * tabular-nums），展开面板沿用宿主统计气泡面板的同一套表面与阴影令牌。\n * 唯一新增的是档位配色：正常绿、偏低橙、不足红。\n */\n\n/*\n * 档位色定义在 `:root` 上，而不是只挂在 `.dbp_root` 上。\n *\n * 原因：展开面板是 portal 到 `document.body` 的，**不在 `.dbp_root` 子树里** ——\n * 只在徽章上定义这三个变量，面板里的 `var(--dbp-warn)` 就会解析失败，而\n * `color-mix(in srgb, var(--x) 14%, transparent)` 在变量无效时整条声明被丢弃，\n * SVG 于是回落到继承色（黑板一样的黑色）。这在 v1.2 画趋势图时暴露出来。\n *\n * 挂到 `:root` 后徽章与面板共享同一份定义；`body[data-ds-dark-theme]` 的覆盖\n * 本来就在根级，优先级仍然正确。\n */\n:root {\n  /* 档位色：优先用主题令牌，令牌缺失时回落到自带色值。 */\n  --dbp-ok: var(--dsw-alias-state-success-primary, #1f8f5f);\n  --dbp-warn: #c07a12;\n  --dbp-low: var(--dsw-alias-state-error-primary, #d93a45);\n  /*\n   * 时段色（v1.3）：高峰 = 贵，用暖色；空闲 = 便宜，用绿色。\n   *\n   * 同样必须定义在 `:root` 上：面板 portal 到 `body`，`.dbp_tariffBadge` 不在\n   * `.dbp_root` 子树里，把变量挂在徽章上会让面板里的 `var()` 解析失败。\n   */\n  --dbp-peak: #c07a12;\n  --dbp-offpeak: var(--dsw-alias-state-success-primary, #1f8f5f);\n}\n\nbody[data-ds-dark-theme] {\n  --dbp-ok: #4bbf8b;\n  --dbp-warn: #e2a13c;\n  --dbp-low: #f06a6a;\n  --dbp-peak: #e2a13c;\n  --dbp-offpeak: #4bbf8b;\n}\n\n.dbp_root {\n  /* 行内顺序：宿主两个统计胶囊是 order 0，上下文环（ContextMeter）也是 0，\n     这里用 order:1 把自己排到它们右侧，即整行末尾。 */\n  order: 1;\n  flex: none;\n  display: inline-flex;\n}\n\n.dbp_trigger {\n  box-sizing: border-box;\n  border: none;\n  background: 0 0;\n  padding: 1px 8px;\n  border-radius: var(--dsw-radius-sm);\n  font-family: inherit;\n  font-size: var(--dsh-content-font-size-secondary, 13px);\n  font-variant-numeric: tabular-nums;\n  line-height: calc(20px + var(--dsh-content-font-delta-secondary, 0px));\n  white-space: nowrap;\n  cursor: pointer;\n  flex: none;\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  color: var(--dsw-alias-label-tertiary);\n  transition: color 0.15s ease, background-color 0.15s ease;\n}\n\n.dbp_trigger:focus-visible {\n  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n\n.dbp_text {\n  font-weight: 500;\n}\n\n.dbp_icon {\n  flex: none;\n  display: block;\n}\n\n/* ---------------------------------------------------------------- 档位配色 */\n\n.dbp_root[data-status='loading'] .dbp_trigger,\n.dbp_root[data-status='signed-out'] .dbp_trigger,\n.dbp_root[data-status='failed'] .dbp_trigger {\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* ready 与 stale 用同一套档位色：stale 只是「这个数字可能过期」，\n   颜色仍然表达余额本身的高低，否则一次网络抖动会让红色警示凭空消失。 */\n.dbp_root[data-level='ok'][data-status='ready'] .dbp_trigger,\n.dbp_root[data-level='ok'][data-status='stale'] .dbp_trigger {\n  color: var(--dbp-ok);\n}\n\n.dbp_root[data-level='warn'][data-status='ready'] .dbp_trigger,\n.dbp_root[data-level='warn'][data-status='stale'] .dbp_trigger {\n  color: var(--dbp-warn);\n  background-color: color-mix(in srgb, var(--dbp-warn) 10%, transparent);\n}\n\n.dbp_root[data-level='low'][data-status='ready'] .dbp_trigger,\n.dbp_root[data-level='low'][data-status='stale'] .dbp_trigger {\n  color: var(--dbp-low);\n  background-color: color-mix(in srgb, var(--dbp-low) 12%, transparent);\n  font-weight: 600;\n}\n\n/* 过期态：档位色保留，但整体降一点不透明度，并给个虚线下划线，\n   让「数字还在、但不是最新」这件事在颜色之外还有第二个信号。 */\n.dbp_root[data-status='stale'] .dbp_trigger {\n  opacity: 0.75;\n}\n\n.dbp_root[data-status='stale'] .dbp_text {\n  text-decoration: underline dotted currentColor;\n  text-underline-offset: 3px;\n}\n\n.dbp_root[data-status='failed'] .dbp_trigger {\n  color: var(--dbp-warn);\n}\n\n.dbp_trigger:hover {\n  background-color: color-mix(in srgb, currentColor 14%, transparent);\n}\n\n.dbp_root[data-level='low'][data-status='ready'] .dbp_trigger:hover,\n.dbp_root[data-level='low'][data-status='stale'] .dbp_trigger:hover,\n.dbp_root[data-level='warn'][data-status='ready'] .dbp_trigger:hover,\n.dbp_root[data-level='warn'][data-status='stale'] .dbp_trigger:hover {\n  background-color: color-mix(in srgb, currentColor 20%, transparent);\n}\n\n/* ---------------------------------------------------------------- 展开面板 */\n\n.dbp_panel {\n  box-sizing: border-box;\n  position: fixed;\n  z-index: 1100;\n  /* 内容随历史/时段变多；小窗口或大字号下必须自己滚动，否则顶部会被视口裁掉。\n     内联样式会再按徽章上方的实际空间收紧 max-height（见 pill.js usePanelPosition）。 */\n  max-height: calc(100vh - 24px);\n  overflow-y: auto;\n  overscroll-behavior: contain;\n  padding: 12px;\n  border: 0;\n  border-radius: var(--dsw-radius-lg);\n  background: var(--dsw-specific-menu);\n  backdrop-filter: var(--dsw-menu-backdrop-filter);\n  --dsw-elevation-stroke-color: var(--dsw-alias-border-l1);\n  box-shadow: var(--dsw-elevation-prominent);\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 20px;\n  cursor: default;\n}\n\n.dbp_panelHead {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.dbp_panelTitle {\n  color: var(--dsw-alias-label-primary);\n  font-size: 13px;\n  font-weight: 500;\n}\n\n/* 面板标题旁的版本号：诊断用，弱化到不抢标题与刷新按钮。 */\n.dbp_panelVersion {\n  flex: none;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n}\n\n.dbp_refresh {\n  box-sizing: border-box;\n  margin-left: auto;\n  padding: 0 8px;\n  height: 24px;\n  border: 0.5px solid var(--dsw-alias-border-l2);\n  border-radius: var(--dsw-radius-sm);\n  background: 0 0;\n  color: var(--dsw-alias-label-secondary);\n  font-family: inherit;\n  font-size: 12px;\n  line-height: 22px;\n  cursor: pointer;\n}\n\n.dbp_refresh:hover:not(:disabled) {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dbp_refresh:disabled {\n  color: var(--dsw-alias-label-caption, var(--dsw-alias-label-tertiary));\n  cursor: default;\n}\n\n.dbp_refresh:focus-visible {\n  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n\n.dbp_rule {\n  height: 1px;\n  margin: 10px 0;\n  background: var(--dsw-alias-border-l1);\n}\n\n.dbp_rows {\n  display: grid;\n  grid-template-columns: 1fr auto;\n  gap: 4px 12px;\n  margin: 0;\n}\n\n.dbp_rows dt {\n  color: var(--dsw-alias-label-tertiary);\n  font-weight: 400;\n}\n\n.dbp_rows dd {\n  margin: 0;\n  text-align: right;\n  font-variant-numeric: tabular-nums;\n  color: var(--dsw-alias-label-primary);\n}\n\n.dbp_totalKey {\n  padding-top: 4px;\n  color: var(--dsw-alias-label-secondary) !important;\n}\n\n.dbp_totalValue {\n  padding-top: 4px;\n  font-weight: 600;\n}\n\n.dbp_hint {\n  margin: 10px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n.dbp_hint[data-level='ok'] {\n  color: var(--dbp-ok);\n}\n\n.dbp_hint[data-level='warn'] {\n  color: var(--dbp-warn);\n}\n\n.dbp_hint[data-level='low'] {\n  color: var(--dbp-low);\n}\n\n.dbp_message {\n  margin: 0;\n  color: var(--dsw-alias-label-secondary);\n}\n\n.dbp_stale {\n  margin: 0 0 8px;\n  padding: 5px 8px;\n  border-radius: var(--dsw-radius-sm);\n  background: color-mix(in srgb, var(--dbp-warn) 12%, transparent);\n  color: var(--dbp-warn);\n}\n\n.dbp_meta {\n  margin: 2px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n}\n\n/* ------------------------------------------------------------ 会话消耗与趋势 */\n\n.dbp_spend {\n  margin: 8px 0 0;\n  padding: 5px 8px;\n  border-radius: var(--dsw-radius-sm);\n  background: var(--dsw-alias-interactive-bg-hover);\n  color: var(--dsw-alias-label-secondary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 今日已用：与「本轮会话」同一族信息，但**不加底纹** —— 底纹在面板里是\n   「这是你刚问的那件事」的强调，日消耗是背景信息，跟着一起高亮会稀释重点。 */\n.dbp_today {\n  margin: 6px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 本周已用：与「今日已用」同族同样式，仅 margin 与上一行拉开一点。 */\n.dbp_week {\n  margin: 4px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n/* 近 7 天已用：与「本周」同族；再轻一点，避免三行消耗挤在一起抢注意力。 */\n.dbp_recent {\n  margin: 2px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n.dbp_trend {\n  margin: 10px 0 0;\n}\n\n.dbp_spark {\n  display: block;\n  width: 100%;\n  height: 40px;\n}\n\n.dbp_sparkLine {\n  fill: none;\n  stroke: var(--dsw-alias-label-tertiary);\n  stroke-width: 1.5;\n  stroke-linejoin: round;\n  stroke-linecap: round;\n  vector-effect: non-scaling-stroke;\n}\n\n.dbp_sparkArea {\n  fill: color-mix(in srgb, var(--dsw-alias-label-tertiary) 14%, transparent);\n  stroke: none;\n}\n\n/* 余额在涨（充值）用 success 色，在跌（消耗）用 warning 色。 */\n.dbp_trend[data-tone='up'] .dbp_sparkLine {\n  stroke: var(--dbp-ok);\n}\n\n.dbp_trend[data-tone='up'] .dbp_sparkArea {\n  fill: color-mix(in srgb, var(--dbp-ok) 16%, transparent);\n}\n\n.dbp_trend[data-tone='down'] .dbp_sparkLine {\n  stroke: var(--dbp-warn);\n}\n\n.dbp_trend[data-tone='down'] .dbp_sparkArea {\n  fill: color-mix(in srgb, var(--dbp-warn) 14%, transparent);\n}\n\n.dbp_trendFoot {\n  display: flex;\n  justify-content: space-between;\n  margin-top: 2px;\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 11px;\n  font-variant-numeric: tabular-nums;\n}\n\n/* ---------------------------------------------------------------- 计费时段 */\n\n/*\n * 状态行徽章上的时段标签。11px 是「比徽章数字小一档、但仍看得清」的尺寸。\n *\n * 底色只用一成多的透明度：档位色（绿/橙/红）说的是「钱还够不够」，时段色说的是\n * 「这个价贵不贵」，两件事不该混成一片抢注意力的色块，因此时段只做淡底 + 同色字。\n * 颜色取自 `:root` 的 `--dbp-peak` / `--dbp-offpeak`（面板 portal 到 body，\n * 变量挂在 `.dbp_root` 上的话面板里的徽标会取不到）。\n */\n.dbp_tariff {\n  flex: none;\n  padding: 0 5px;\n  border-radius: var(--dsw-radius-sm);\n  font-size: 11px;\n  line-height: 16px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.dbp_root[data-tariff='peak'] .dbp_tariff {\n  color: var(--dbp-peak);\n  background-color: color-mix(in srgb, var(--dbp-peak) 14%, transparent);\n}\n\n.dbp_root[data-tariff='off-peak'] .dbp_tariff {\n  color: var(--dbp-offpeak);\n  background-color: color-mix(in srgb, var(--dbp-offpeak) 14%, transparent);\n}\n\n/* 面板里的时段行：一枚徽标 + 一句结论，排在金额明细与档位提示之间。 */\n.dbp_tariffRow {\n  display: flex;\n  align-items: center;\n  gap: 6px;\n  margin: 8px 0 0;\n}\n\n.dbp_tariffBadge {\n  flex: none;\n  padding: 0 5px;\n  border-radius: var(--dsw-radius-sm);\n  font-size: 11px;\n  line-height: 16px;\n  font-weight: 500;\n  white-space: nowrap;\n}\n\n.dbp_tariffBadge[data-tariff='peak'] {\n  color: var(--dbp-peak);\n  background: color-mix(in srgb, var(--dbp-peak) 14%, transparent);\n}\n\n.dbp_tariffBadge[data-tariff='off-peak'] {\n  color: var(--dbp-offpeak);\n  background: color-mix(in srgb, var(--dbp-offpeak) 14%, transparent);\n}\n\n/* 徽标后面那句结论：长句要能换行，因此允许收缩（flex 默认 min-width:auto 会撑破面板）。 */\n.dbp_tariffNote {\n  min-width: 0;\n}\n\n/* 时段明细行：倒计时、本段区间、价格、峰谷预估、日历覆盖。 */\n.dbp_tariffMeta {\n  margin: 2px 0 0;\n  color: var(--dsw-alias-label-tertiary);\n  font-variant-numeric: tabular-nums;\n}\n\n.dbp_topUp {\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  justify-content: center;\n  width: 100%;\n  height: 32px;\n  margin-top: 10px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-md);\n  color: var(--dsw-alias-brand-text, var(--dsw-alias-state-business-primary));\n  text-decoration: none;\n}\n\n.dbp_topUp:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dbp_topUp:focus-visible {\n  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 2px;\n}\n\n/* ---------------------------------------------------------------- 设置行 */\n\n/*\n * 版式对齐宿主「设置 → 常规」里的行：上下 16px 内边距、底部 0.5px 分隔线、\n * 左侧标题 14px + 描述 12px、右侧控件。最后一行由宿主的\n * `[data-slot] > :last-child { border-bottom: none }` 处理，这里不用管。\n */\n.dbp_setRoot {\n  display: flex;\n  flex-direction: column;\n  width: 100%;\n}\n\n.dbp_setHead {\n  padding: 4px 0 12px;\n}\n\n.dbp_setHeadTitle {\n  font-size: 14px;\n  font-weight: 600;\n}\n\n/* 计费时段三行前面的分组说明：与根标题同版式，但要和上一行拉开距离（v1.3）。 */\n.dbp_setGroup {\n  padding: 14px 0 4px;\n}\n\n.dbp_setGroupTitle {\n  font-weight: 600;\n}\n\n.dbp_setRow {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 24px;\n  padding: 16px 0;\n  border-bottom: 0.5px solid var(--dsw-alias-border-l2);\n}\n\n.dbp_setRow[data-disabled='true'] {\n  opacity: 0.6;\n}\n\n.dbp_setCopy {\n  min-width: 0;\n}\n\n.dbp_setTitle {\n  color: var(--dsw-alias-label-primary);\n  font-size: 14px;\n  line-height: 20px;\n}\n\n.dbp_setDescription {\n  margin-top: 4px;\n  color: var(--dsw-alias-label-secondary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dbp_setControl {\n  display: flex;\n  flex: none;\n  align-items: center;\n  gap: 8px;\n}\n\n.dbp_setPair {\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.dbp_setNotice {\n  margin-bottom: 4px;\n  padding: 8px 12px;\n  border-radius: var(--dsw-radius-md);\n  background: color-mix(in srgb, var(--dbp-warn) 12%, transparent);\n  color: var(--dbp-warn);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n.dbp_select,\n.dbp_number {\n  box-sizing: border-box;\n  height: 32px;\n  padding: 0 8px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-md);\n  background: var(--dsw-specific-input-major, var(--dsw-alias-bg-layer-1));\n  color: var(--dsw-alias-label-primary);\n  font-family: inherit;\n  font-size: 13px;\n  font-variant-numeric: tabular-nums;\n}\n\n.dbp_select {\n  min-width: 168px;\n  max-width: 260px;\n}\n\n.dbp_number {\n  width: 72px;\n  text-align: right;\n}\n\n.dbp_select:hover,\n.dbp_number:hover {\n  border-color: var(--dsw-alias-border-l4);\n}\n\n.dbp_select:focus-visible,\n.dbp_number:focus-visible {\n  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n\n.dbp_check {\n  display: inline-flex;\n  align-items: center;\n}\n\n.dbp_check input {\n  width: 16px;\n  height: 16px;\n  margin: 0;\n  accent-color: var(--dsw-alias-state-business-primary);\n  cursor: pointer;\n}\n\n.dbp_setFoot {\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  padding-top: 14px;\n}\n\n.dbp_setButton {\n  box-sizing: border-box;\n  height: 32px;\n  padding: 0 14px;\n  border: 0.5px solid var(--dsw-alias-border-l3);\n  border-radius: var(--dsw-radius-md);\n  background: 0 0;\n  color: var(--dsw-alias-label-primary);\n  font-family: inherit;\n  font-size: 13px;\n  cursor: pointer;\n}\n\n.dbp_setButton:hover {\n  background: var(--dsw-alias-interactive-bg-hover);\n}\n\n.dbp_setButton:focus-visible {\n  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n\n.dbp_setHint {\n  color: var(--dsw-alias-label-tertiary);\n  font-size: 12px;\n  line-height: 18px;\n}\n\n/* 紧凑模式：徽章不带币种符号，去掉一点横向内边距。 */\n.dbp_root[data-compact='true'] .dbp_trigger {\n  padding: 1px 6px;\n}\n\n/* ---------------------------------------------------------------- 提醒卡片 */\n\n/*\n * 只在宿主 primitives 的 Toast 拿不到时才出现（见 alert-toast.js）。\n * 宿主 Toast 自己 portal 到 body 并占 z-index:1100；这张兜底卡片挂在\n * `shell.overlay` 里（z-index:20 的浮层，子元素自带 pointer-events:auto），\n * 因此定位用 absolute 贴右下角即可，不必自己抬层级。\n */\n.dbp_alert {\n  position: absolute;\n  right: 16px;\n  bottom: 16px;\n  box-sizing: border-box;\n  display: flex;\n  align-items: center;\n  gap: 12px;\n  max-width: min(420px, calc(100vw - 32px));\n  padding: 10px 12px;\n  border-radius: var(--dsw-radius-lg);\n  background: var(--dsw-alias-toast-bg, var(--dsw-specific-menu));\n  color: var(--dsw-alias-toast-label, #fff);\n  box-shadow: var(--dsw-elevation-prominent);\n  font-size: 13px;\n  line-height: 20px;\n}\n\n.dbp_alertText {\n  min-width: 0;\n}\n\n.dbp_alertAction {\n  flex: none;\n  height: 26px;\n  padding: 0 10px;\n  border: 0.5px solid currentColor;\n  border-radius: var(--dsw-radius-sm);\n  background: 0 0;\n  color: inherit;\n  font-family: inherit;\n  font-size: 12px;\n  cursor: pointer;\n}\n\n.dbp_alertAction:hover {\n  background: rgba(255, 255, 255, 0.14);\n}\n\n.dbp_alertAction:focus-visible {\n  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));\n  outline-offset: 1px;\n}\n\n.dbp_alert[data-level='low'] .dbp_alertAction {\n  color: var(--dbp-low);\n}\n\n@media (prefers-reduced-motion: reduce) {\n  .dbp_trigger {\n    transition: none;\n  }\n}\n"

// ---- src/client/tariff-alert.js ------------------------------
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
const DEFAULT_TARIFF_COOLDOWN_MS = 60 * 60 * 1000

/**
 * 初始状态：还没有观测过任何时段，也还没有提醒过。
 *
 * v1.5 起 `alertedAt` 按方向分账（`alertedAtPeak` / `alertedAtOffPeak`）：
 * 单一时间戳会让 11:30 的「进入高峰」卡把 12:00 的「进入空闲」卡堵在冷却里，
 * 而后者恰恰是用户最想看到的「现在便宜了」。
 * 旧字段 `alertedAt` 仍保留在状态里（向后兼容），但不再参与判定。
 */
function createTariffAlertState() {
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
function advanceTariffAlert(state, input, options) {
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

// ---- src/client/tariff-service.js ----------------------------
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





/** tick 的最小间隔：时段边界都是整点，30 秒的检测粒度绰绰有余。 */
const TARIFF_TICK_MS = 30000

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
const TARIFF_MAX_GAP_MS = TARIFF_TICK_MS * 2

/**
 * 组装时段看门狗。
 *
 * @param options - `{alerts, now}`：
 *   `alerts` 是共享的当前卡片仓库（与余额提醒共用，宿主浮层只放一张卡）；
 *   `now` 可注入，便于测试给定时刻。
 * @returns 见下方各方法；所有方法都不抛错 —— 它接在每次渲染与定时器上。
 */
function createTariffWatcher(options) {
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

// ---- src/client/readings.js ----------------------------------
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
function recordReading(reading) {
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
function latestReading() {
  return latest
}

/**
 * 清空槽位。
 *
 * 只在单测里用：模块级状态会跨用例泄漏，测试必须能重置它。
 * 生产代码里余额只会因为「换账号」而失效，而那时下一次轮询会立刻覆盖它。
 */
function resetReading() {
  latest = null
}

// ---- src/client/index.js -------------------------------------
/**
 * 余额徽章 —— 客户端插件入口。
 *
 * 这个文件是 bundle 的入口：`scripts/build.mjs` 会把它与同目录的模块拼成一个
 * `window.__ModuleLoader__.load({ id, factory })` 经典脚本。宿主模块加载器只保证
 * `react`、`react/jsx-runtime`、`react-dom` 与少数 `@deepseek-ai/*` 可 require，
 * 本插件的代码不依赖任何第三方包，因此一套零依赖的拼接式构建就够，
 * 产物也能逐行审阅。
 *
 * v1.1 起本插件提供两个挂载点：
 *  1. `conversation.composer.dock` —— 状态行末尾的余额徽章；
 *  2. `settings.general.item`       —— 「设置 → 通用设置」里的配置行，
 *     与宿主自己的「外观 / 字号大小 / 显示代码工作视图」并排。
 * 三者共用同一个配置 store，改完立刻生效。
 *
 * v1.2 增加第三个：`shell.overlay` 上的跨档提醒。它必须独立于徽章 ——
 * 徽章是会话作用域的（切会话会卸载重挂），而提醒是账号级事件。
 *
 * v1.3 让浮层同时承载**时段提醒**（进入高峰 / 进入空闲）：宿主浮层里只放一张卡，
 * 因此余额提醒与时段提醒共用 `service.alerts` 这一个「当前卡片」仓库 ——
 * 两张卡同时挂在浮层上会互相压住，看谁先渲染毫无道理。
 */












/** 插件 id，必须与 package.json 的 name 一致 —— 加载器用它做模块登记。 */
const name = NS

/**
 * 依赖的客户端服务。
 *
 * 只声明 `slots`（挂载点）与 `locale`（文案），**不**声明 `remote.account`：
 * 账号命名空间在某些部署里可能不存在，硬注入会让整个插件卡在等待依赖上，
 * 而徽章更合适的降级是「自己进入不可用状态」。账号客户端在 account.js 里惰性解析。
 */
const inject = ['slots', 'locale']

/** 样式标签的归属标记：HMR 与卸载按它清点并回收。 */
const STYLE_TAG_ID = `${NS}/client.css`

/**
 * 幂等注入样式表。
 *
 * 与其他客户端包一致：用一个 `<style data-plugin data-plugin-css>` 承载 CSS，
 * 重复调用不会产生第二个标签。返回本次是否由自己创建，便于卸载时精确回收。
 */
function mountStyles() {
  if (typeof document === 'undefined') return false
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`)
  if (existing !== null) return false
  const tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = STYLES
  document.head.appendChild(tag)
  return true
}

/**
 * 取宿主 primitives 的 `Toast` 组件。
 *
 * 用 try 包住：模块解析失败在任何部署里都不该让整个插件加载失败。
 * 返回 null 时 `alert-toast.js` 会退回自带卡片。
 */
function resolveToastPrimitive() {
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const Toast = primitives?.Toast
    return typeof Toast === 'function' ? Toast : null
  } catch {
    return null
  }
}

/**
 * 客户端插件体。
 * @param ctx - 客户端 cordis 上下文。
 */
function apply(ctx) {
  // 样式层：注入一次，卸载时把自己创建的那个标签摘掉。
  ctx.effect(() => {
    const created = mountStyles()
    return () => {
      if (!created) return
      const tag = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`)
      if (tag !== null) tag.remove()
    }
  }, `${NS}: 样式表`)

  // 词典：两套语言键集一致。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: 词典`)

  /**
   * 宿主 `Toast` primitive。
   *
   * 它在平台种子表里（`@deepseek-ai/dsh-client-ui-primitives` 是九个可 require 的
   * 平台模块之一），已装的第三方插件也直接 require 它。这里仍然做成「拿不到就
   * 退回自带卡片」：提示的内容是「余额快没了」，宁可样式朴素一点也不能整条消失。
   * 通过 `globalThis` 传到渲染组件，避免让组件直接依赖模块解析。
   */
  globalThis.__DBP_TOAST__ = resolveToastPrimitive()

  const account = createAccountClient(ctx)
  /**
   * 持久化目标。
   *
   * 只在这里解析一次 `localStorage`：设置、历史、会话基准共用同一个 store，
   * 也让测试可以注入内存替身（浏览器隐私模式下 `localStorage` 访问本身会抛错，
   * 因此必须包一层而不是直接用 `globalThis.localStorage`）。
   */
  const storage = resolveStorage()
  // 账号客户端、配置与语言读取器只构造一次：它们跨轮询保持不变，
  // 避免每次渲染都造新对象（也会让 React 的依赖比较失效）。
  const service = {
    account,
    storage,
    settings: createSettingsStore(loadSettings(storage), storage),
    /**
     * 宿主浮层上**当前显示的那张卡**（与组件生命周期无关，见 alert.js）。
     *
     * v1.3 起它承载两种卡片：余额跨档（`kind: 'balance'`，v1.2 形状不变）与
     * 时段切换（`kind: 'tariff'`，见 tariff-alert.js）。共用一个槽位是因为
     * 宿主浮层只该出现一张卡。
     *
     * 它必须提供 `getSnapshot`（而不只是 `get`）：宿主的挂载点渲染器用
     * `useSyncExternalStoreWithSelector(subscribe, () => store.getSnapshot(), …)`
     * 订阅快照，只给 `get` 会让条目首次渲染就抛错并被宿主永久摘掉 ——
     * 表现是「提醒永远不出现」，而不是一条明显的报错。详见 alert.js 的注释。
     */
    alerts: createAlertStore(),
    activeLocale: () => {
      try {
        return account.activeLocale()
      } catch {
        return 'zh-CN'
      }
    }
  }

  // 时段看门狗：算快照、推进时段提醒、把卡片写进上面的共享仓库。
  // 它**必须**在这里构造（而不是在组件里）：提醒状态机要跨会话存活，
  // 而徽章所在的槽位是会话作用域的。
  service.tariff = createTariffWatcher({ alerts: service.alerts })

  // 挂到输入框下方的状态行末尾（宿主自己的统计胶囊是 order 0，上下文环也是 0，
  // 本条目 order 50 先排在它们之后，再由样式表里的 flex `order:1` 落到最右侧）。
  //
  // 不显式注入 `sessionId`：它是该槽位（scope: "session"）的宿主标准 props，
  // 渲染器会直接传给组件（session.client.js 的 BUILTIN_SOURCE）。
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: NS,
        order: 50,
        locale: NS,
        inject: () => ({ service })
      },
      BalancePill
    )
  )

  // 设置行：挂进「设置 → 通用设置」。order 20 让它落在宿主的「键盘快捷键/网页链接(17)」
  // 之后、「性能与用量(30)」之前，即整页中部靠后的位置。
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      {
        name: 'settings.general.item',
        id: NS,
        order: 20,
        locale: NS,
        inject: () => ({ service })
      },
      BalanceSettingsRow
    )
  )

  // 跨档提醒 + 时段提醒：挂到宿主的浮层（`shell.overlay`，root 作用域）。
  // 必须独立于徽章条目：徽章是会话作用域的，切换会话会卸载重挂，
  // 而「余额掉档」与「进入高峰」都是账号级事件，不该跟着会话走。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: `${NS}:alert`,
        order: 60,
        locale: NS,
        inject: () => ({
          hooks: { alert: service.alerts },
          settings: service.settings,
          tariff: service.tariff,
          dismiss: () => {
            service.alerts.set(null)
          }
        })
      },
      BalanceAlertHost
    )
  )
}

/**
 * 浮层里的提醒宿主。
 *
 * 它同时负责**驱动**时段看门狗：这里是 root 作用域，跨会话不卸载，
 * 正是「记住上一次是什么时段」需要的生命周期。徽章那边只读快照、不推进状态机，
 * 否则切换会话会把「首次观测」重来一遍，本该提醒的切换被吞掉。
 *
 * ## v1.4：从 `setInterval` 改成自愈的链式调度（D1）
 *
 * v1.3 用的是 `setInterval(run, TARIFF_TICK_MS)`，配 `[settings, tariff]` 依赖数组。
 * 两个恒定引用意味着**时钟前进本身永远不触发重算**，于是：
 *  - 机器从休眠唤醒后，看门狗要等定时器「补上一拍」才可能发现跨时段；
 *  - 定时器被后台节流到几分钟一次时，跨边界会被漏掉；
 *  - 真实 GUI 验证台注入时钟后，`offpeak` 相位 75 秒内 `latest().now` 冻在上一段，
 *    一张卡都没出（见 docs/V14-DEFECTS.md 的 D1）。
 *
 * 现在改成三件事：
 *  1. **链式 `setTimeout`**：每次 tick 后用 `nextTickDelay()` 重排 ——
 *     它会**对齐到下一个时段边界**（边界是整点，可预知），既不迟到也不更费；
 *  2. **可见性/焦点补拍**：`visibilitychange` 与 `focus` 立刻 tick 一次，
 *     覆盖休眠唤醒与切回标签页；
 *  3. **依赖里带订阅到的设置值**（修 D2）：用户改「时段切换提醒」后立刻生效，
 *     而不是等下一个 30 秒拍子。
 *
 * `nextTickDelay()` 返回 0 表示「已经跨过边界」，此时立刻再 tick 一次 ——
 * 这是「补上错过的边界」那条自愈路径。
 *
 * @param props - 渲染器注入的 props：`useAlert`（`hooks: {alert}` 变成的钩子）、
 *   `settings`（配置 store）、`tariff`（时段看门狗）、`dismiss` 与本地化函数 `t`。
 */
function BalanceAlertHost(props) {
  const { useAlert, settings, tariff, dismiss, t } = props
  const alert = useAlert((value) => value)

  // 订阅配置值：effect 依赖里必须出现**值**而不是 store 对象，否则改设置不会重跑
  // （D2）。只订阅这一个字段，避免「改阈值也把看门狗重排一次」。
  const alertOnTariff = useAlertOnTariff(settings)

  React.useEffect(() => {
    if (tariff === undefined || tariff === null || settings === undefined || settings === null) return undefined
    let timer = null
    let disposed = false

    const run = () => {
      try {
        // 余额只用于「同样的钱在空闲时段能用多久」这类换算，取徽章写进共享槽位的
        // 最近一次成功读数即可；还没读到过时快照照样可用，只是预估为空。
        const last = latestReading()
        tariff.tick({ settings: settings.get(), balance: last?.amount, ratePerHour: last?.perHour })
      } catch {
        /* 时段看门狗的任何异常都不该影响提醒卡本身的渲染 */
      }
    }

    /**
     * tick 一次并按「距下一个边界的剩余时间」重排下一次唤醒。
     *
     * 用 `setTimeout` 而不是 `setInterval`：间隔是每次算出来的（可能对齐到边界那一拍），
     * 固定间隔做不到这一点。`delay === 0` 时用 0 毫秒再排一拍，而不是同步递归 ——
     * 同步递归会在时钟被推很远、连续跨多个边界时把渲染线程占满。
     */
    const schedule = () => {
      if (disposed) return
      run()
      if (disposed) return
      let delay = TARIFF_TICK_MS
      try {
        delay = tariff.nextTickDelay({ settings: settings.get() })
      } catch {
        /* 算不出间隔就退回默认拍子 */
      }
      timer = setTimeout(schedule, Math.max(0, Math.min(TARIFF_TICK_MS, Number(delay) || 0)))
    }

    /** 立刻补一拍（可见性/焦点变化），并把已有的定时器重置到新的节奏上。 */
    const tickNow = () => {
      if (disposed) return
      if (timer !== null) clearTimeout(timer)
      schedule()
    }

    schedule()

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tickNow()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.addEventListener('focus', tickNow)

    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      if (typeof window !== 'undefined') window.removeEventListener('focus', tickNow)
    }
  }, [settings, tariff, alertOnTariff])

  if (alert === null || alert === undefined) return null
  return React.createElement(BalanceAlert, { alert, t, onDismiss: dismiss })
}

/**
 * 订阅「时段切换提醒」这个开关的值。
 *
 * 把 effect 的依赖从 store 对象换成**值**：store 的引用恒定，放进依赖数组等于
 * 什么都没依赖；用户在设置里勾上「时段切换提醒」后，本条目应当立刻重排看门狗，
 * 而不是等下一个 30 秒拍子（v1.3 契约里「也由它负责在设置变化时 tick」这句
 * 直到 v1.4 才真正成立）。
 *
 * store 不可用（测试替身）时退回 `undefined`：此时 effect 的依赖恒为 undefined，
 * 与 v1.3 的行为一致，不会因为「值从 undefined 变成 undefined」而反复重排。
 *
 * @param store - 配置 store（`{get, subscribe}`）；可能为 undefined。
 * @returns 当前 `alertOnTariff` 值，或 undefined。
 */
function useAlertOnTariff(store) {
  const read = () => {
    try {
      return store?.get()?.alertOnTariff
    } catch {
      return undefined
    }
  }
  const [value, setValue] = React.useState(read)
  React.useEffect(() => {
    if (store === undefined || store === null || typeof store.subscribe !== 'function') return undefined
    setValue(read())
    return store.subscribe(() => {
      setValue(read())
    })
  }, [store])
  return value
}

		exports.apply = apply
		exports.inject = inject
		exports.name = name
		return module.exports
	}
})
