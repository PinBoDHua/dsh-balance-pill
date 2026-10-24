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

import { resolveStorage } from './settings.js'

/** 历史存储键。与设置分开存，避免设置写入把历史覆盖掉。 */
export const HISTORY_KEY = 'dsh-balance-pill:history'

/** 最多保留的样本条数。 */
export const MAX_SAMPLES = 480

/** 最多保留的历史时长：7 天。 */
export const MAX_AGE_MS = 7 * 24 * 3600 * 1000

/** 两条样本之间至少间隔多久才值得记录（更密的采样只会浪费配额）。 */
export const MIN_SAMPLE_GAP_MS = 60000

/**
 * 允许的时钟前偏误差：样本时刻最多允许落在「现在」之后 5 分钟。
 *
 * v0.3.0 新增。历史的输入不可全信：外部存储可以被写坏，系统时钟也可能被回拨
 * （NTP 校时、手动改表、双系统时间漂移）。一枚**落在未来**的样本会排在序列末尾，
 * 让折线在「现在」之后多出一段、让下一次追加因 `parsed.at - last.at < 0` 永远
 * 走进「替换最后一枚」的分支（历史从此不再前进）。留 5 分钟余量是给「写样本的
 * 机器」与「读样本的机器」时钟不一致的情形，超过它的只可能是坏数据。
 */
export const FUTURE_SKEW_MS = 5 * 60000

/**
 * 「近 7 天已用」的统计窗口。
 *
 * 与 `MAX_AGE_MS` 相同不是巧合：历史本身就只保留 7 天，窗口再长也只能看到
 * 这 7 天。把它单独导出，避免面板把「历史保留时长」与「统计窗口」当成同一个
 * 概念 —— 将来若延长保留期，窗口仍可以独立决定。
 */
export const RECENT_WINDOW_MS = 7 * 24 * 3600 * 1000

/**
 * 「余额跑道」（`runwayOf`）的最大展示窗口：30 天。
 *
 * 与耗尽预估只看 24 小时内是同一条纪律——预测只在有行动价值时出现；
 * 「还能用三个月」不值得占面板一行。
 */
export const RUNWAY_MAX_DAYS = 30

/**
 * 解析一枚样本；非法返回 null。
 * @param raw - 存储里读出来的一条记录。
 */
export function parseSample(raw) {
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
export function normalizeHistory(raw, now = Date.now()) {
  if (!Array.isArray(raw)) return []
  const samples = []
  for (const entry of raw) {
    const sample = parseSample(entry)
    if (sample === null) continue
    if (now - sample.at > MAX_AGE_MS) continue
    // 未来时刻的样本只可能是坏数据（时钟回拨 / 存储写坏），见 FUTURE_SKEW_MS。
    if (sample.at > now + FUTURE_SKEW_MS) continue
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
export function appendSample(samples, sample, now = Date.now()) {
  const parsed = parseSample(sample)
  if (parsed === null) return samples
  // 未来时刻的新样本直接拒绝：normalizeHistory 只清**已有**的历史，写坏的时刻
  // 若从这里溜进去，会一直排在序列末尾（见 FUTURE_SKEW_MS 的说明）。
  if (parsed.at > now + FUTURE_SKEW_MS) return samples
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
export function withinWindow(samples, windowMs, now = Date.now(), basis) {
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
export function downsample(samples, buckets) {
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
export function sparklinePath(points, options) {
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
export function earliestWithin(samples, windowMs, now = Date.now()) {
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
export function billingDayOf(at, tzOffsetMinutes = 480) {
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
export function billingWeekOf(at, tzOffsetMinutes = 480) {
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
export function spentFromSamples(samples) {
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
export function spendInWeek(samples, at, options) {
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
export function spendInDay(samples, at, options) {
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
export function spendInWindow(samples, at, options) {
  const atMs = epochOf(at)
  if (atMs === null) return null
  const rawWindow = options?.windowMs === undefined ? RECENT_WINDOW_MS : epochOf(options.windowMs)
  if (rawWindow === null || rawWindow <= 0) return null
  const result = spendOver(samples, at, options, (sampleAt) => sampleAt >= atMs - rawWindow && sampleAt <= atMs)
  if (result === null) return null
  // 日均消耗（v0.2.0）：分母是**覆盖天数**而不是固定 7 —— 窗口里只有两小时样本时，
  // 除以 7 会把日均压低 84%，读者会以为「其实花得不多」。覆盖不足一天按一天算。
  const DAY_MS = 86400000
  const coveredDays = Math.max(1, Math.ceil((result.lastAt - result.firstAt) / DAY_MS))
  return { ...result, dailyAverage: result.spent / coveredDays }
}

/**
 * 从历史里找出**最近一次入账**（充值 / 赠金到账）。
 *
 * v0.2.0 新增：`spentFromSamples` 把「下降」记成消耗，对称地，「上升」就是入账。
 * 面板据此显示「最近充值 +¥20.00（10-22 14:03）」—— 用户充完值最想确认的就是
 * 「到账了没有、到的是多少」，这一行不需要新增任何存储，只是把历史里已有的
 * 那一跳读出来。
 *
 * 与消耗统计同一条纪律：只认**同口径 + 同币种**的相邻样本（口径切换或币种切换
 * 造成的跳变不是充值），输入先排序去重再扫描；`at` 是入账那一跳**之后**的样本
 * 时刻（充值是在两次采样之间发生的，能看到的最早时刻就是后一枚样本）。
 *
 * @param samples - 历史样本（顺序不限，函数内会排序）。
 * @param options - `{basis, currency}`；语义与 `spendInDay` 等相同，都可缺省。
 * @returns `{amount, at, currency}`（`amount` 恒为正）；没有可识别的入账时
 *   返回 null。**绝不抛错。**
 */
export function lastTopUpFromSamples(samples, options) {
  if (!Array.isArray(samples)) return null
  const basis = options?.basis
  const currency = typeof options?.currency === 'string' && options.currency !== '' ? options.currency : null

  const picked = []
  for (const sample of samples) {
    if (sample === null || typeof sample !== 'object') continue
    const sampleAt = epochOf(sample.at)
    const amount = typeof sample.amount === 'number' ? sample.amount : NaN
    if (sampleAt === null || !Number.isFinite(amount)) continue
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

  let topUp = null
  for (let index = 1; index < ordered.length; index += 1) {
    const rise = ordered[index].amount - ordered[index - 1].amount
    if (rise > 0) topUp = { amount: rise, at: ordered[index].at, currency: ordered[index].currency }
  }
  return topUp
}

/**
 * 按日均消耗估算「余额还能撑多少天」（面板「余额跑道」行，v0.3.0）。
 *
 * 动机：「按当前速度约可用 X」依赖**瞬时**消耗速度，只在账号正在烧钱时存在；
 * 而用户 idle 时最想问的恰是「这点钱不跑任务能撑几天」。近 7 天日均
 * （`spendInWindow().dailyAverage`）是已有的统计，除一下就是跑道：
 *
 * ```
 * 余额 ¥19.10，日均 ¥1.91 → 约 10 天
 * ```
 *
 * 展示窗口刻意封顶在 `RUNWAY_MAX_DAYS` 天：更远的跑道没有行动价值，
 * 天天挂一句「还能用 300 天」只是噪音 —— 与「耗尽预估只看 24 小时内」
 * 是同一条纪律（预测只在值得行动时才出现）。
 *
 * @param balance - 当前余额（当前口径的展示金额）。
 * @param dailyAverage - 近 7 天日均消耗；来自 `spendInWindow().dailyAverage`。
 * @returns 天数（可能带小数）；任一输入非法 / 非正，或超出展示窗口时返回 null。
 *   **绝不抛错。**
 */
export function runwayOf(balance, dailyAverage) {
  const amount = typeof balance === 'number' && Number.isFinite(balance) ? balance : null
  const average = typeof dailyAverage === 'number' && Number.isFinite(dailyAverage) ? dailyAverage : null
  if (amount === null || average === null || amount <= 0 || average <= 0) return null
  const days = amount / average
  if (days > RUNWAY_MAX_DAYS) return null
  return days
}

/** 历史存储的读写：任何异常都静默降级成空历史。 */
export function loadHistory(storage = resolveStorage()) {
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
export function saveHistory(samples, storage = resolveStorage()) {
  if (storage === undefined || storage === null) return false
  try {
    storage.setItem(HISTORY_KEY, JSON.stringify(samples))
    return true
  } catch {
    return false
  }
}
