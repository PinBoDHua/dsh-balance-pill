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

import { resolveStorage } from './settings.js'

/** 会话基准的存储键。 */
export const SESSION_KEY = 'dsh-balance-pill:sessions'

/** 最多记住多少个会话的基准（按最近使用淘汰）。 */
export const MAX_SESSIONS = 40

/**
 * 解析一条基准记录；非法返回 null。
 * @param raw - 存储里读出来的记录。
 */
export function parseBaseline(raw) {
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
export function normalizeBaselines(raw) {
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
export function recordBaseline(baselines, sessionId, reading) {
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
export function pruneBaselines(baselines, max = MAX_SESSIONS) {
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
export function sessionSpend(baselines, sessionId, reading) {
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
export function loadBaselines(storage = resolveStorage()) {
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
export function saveBaselines(baselines, storage = resolveStorage()) {
  if (storage === undefined || storage === null) return false
  try {
    storage.setItem(SESSION_KEY, JSON.stringify(baselines))
    return true
  } catch {
    return false
  }
}
