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
  // v0.3.1（审计 P3-10）：充值把基准前推时，把「已经花掉的钱」记进 carry。
  // 旧实现直接重置基准，面板上的「本轮已用」会从 ¥3.2 跳回 ¥0。
  // 两个字段都只在存储里是有限数字时才采纳，旧记录没有它们就回落 0 / 基准金额。
  const carry = typeof raw.carry === 'number' && Number.isFinite(raw.carry) && raw.carry > 0 ? raw.carry : 0
  const lastAmount = typeof raw.lastAmount === 'number' && Number.isFinite(raw.lastAmount) ? raw.lastAmount : amount
  return {
    amount,
    at,
    currency: typeof raw.currency === 'string' ? raw.currency : '',
    carry,
    lastAmount
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
    return { ...baselines, [sessionId]: { amount, at, currency, carry: 0, lastAmount: amount } }
  }
  if (existing === undefined) {
    return { ...baselines, [sessionId]: { amount, at, currency, carry: 0, lastAmount: amount } }
  }
  const carry = typeof existing.carry === 'number' && Number.isFinite(existing.carry) && existing.carry > 0
    ? existing.carry
    : 0
  const previousAmount = typeof existing.lastAmount === 'number' && Number.isFinite(existing.lastAmount)
    ? existing.lastAmount
    : existing.amount
  // 余额比基准高，说明中途充值了。旧实现把基准推到当前值 —— 「本轮已用」
  // 因此从 ¥3.2 跳回 ¥0（P3-10）。现在把「充值前已经花掉的钱」累加进 carry，
  // 面板上的消耗只增不减；`lastAmount` 记住上一拍读数，用来算充值前的那一刻。
  if (amount > existing.amount) {
    const spentBeforeTopUp = Math.max(0, existing.amount - previousAmount)
    return {
      ...baselines,
      [sessionId]: { amount, at, currency, carry: carry + spentBeforeTopUp, lastAmount: amount }
    }
  }
  // 余额在基准之下：基准不动，只更新「上一拍读数」。
  if (amount === previousAmount) return baselines
  return { ...baselines, [sessionId]: { ...existing, lastAmount: amount } }
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
  // v0.3.1（P3-10）：carry 是充值前已经花掉的钱；基准与当前值只量「上一次充值之后」
  // 的那一段。两者相加才是本会话的累计消耗。
  const carry = typeof baseline.carry === 'number' && Number.isFinite(baseline.carry) && baseline.carry > 0
    ? baseline.carry
    : 0
  const spent = carry + (baseline.amount - amount)
  // 负消耗只可能来自「充值后又消费」的中间态；归零比显示负数更诚实。
  return {
    spent: spent > 0 ? spent : 0,
    since: baseline.at,
    currency
  }
}

/**
 * 合并同一条会话在两份基准表里的记录。
 *
 * 冲突只可能来自「两个窗口先后看到同一会话」：
 *  - **币种不同**：以较新的记录为准（换币种是有意的重置）；
 *  - **基准金额不同**：取较大的那个。基准金额只会在「第一次看到会话」与
 *    「充值后前推」两种时机变大；较大的那个一定更接近真实起点 / 最近一次充值，
 *    取较小的会把会话消耗算多或把 carry 丢掉；
 *  - **金额相同**：取 carry 较大的（信息更完整），再取 `at` 较早的（起点更真实）。
 *
 * @param left - 已有记录（已归一化）。
 * @param right - 另一份记录（已归一化）。
 * @returns 合并后的记录。
 */
function mergeBaselineRecord(left, right) {
  if (left.currency !== right.currency) return right.at >= left.at ? right : left
  if (left.amount !== right.amount) return left.amount > right.amount ? left : right
  const leftCarry = left.carry ?? 0
  const rightCarry = right.carry ?? 0
  if (leftCarry !== rightCarry) return leftCarry > rightCarry ? left : right
  if (left.at !== right.at) return left.at <= right.at ? left : right
  // 基准、carry、起点都相同：`lastAmount` 更小说明这一份看到了更新的消费，
  // 下次充值时能算出更完整的「充值前已花」。旧记录没有该字段时按基准金额算。
  const leftLast = Number.isFinite(left.lastAmount) ? left.lastAmount : left.amount
  const rightLast = Number.isFinite(right.lastAmount) ? right.lastAmount : right.amount
  return leftLast <= rightLast ? left : right
}

/**
 * 合并两份会话基准表（审计 P2-7）。
 *
 * 按 sessionId 求并集；同一条会话按 `mergeBaselineRecord` 的规则收敛，最后按
 * 最近使用裁剪到 `MAX_SESSIONS`。这个函数是纯函数，多窗口交错写入的行为可以
 * 直接单测，不必真的开两个浏览器窗口。
 *
 * @param existing - 存储里已有的基准表。
 * @param incoming - 本次要写入的基准表。
 * @returns 合并后的新表。
 */
export function mergeBaselines(existing, incoming) {
  const left = normalizeBaselines(existing)
  const right = normalizeBaselines(incoming)
  const out = { ...left }
  for (const [sessionId, record] of Object.entries(right)) {
    const current = out[sessionId]
    out[sessionId] = current === undefined ? record : mergeBaselineRecord(current, record)
  }
  return pruneBaselines(out)
}

/**
 * 合并「存储里的原始 JSON」与本次基准表；坏数据静默降级成只保留本次记录。
 * @param rawText - `storage.getItem(SESSION_KEY)` 的原始字符串。
 * @param incoming - 本次要写入的基准表。
 * @returns 合并后的新表。
 */
export function mergeStoredBaselines(rawText, incoming) {
  if (typeof rawText !== 'string' || rawText === '') return normalizeBaselines(incoming)
  try {
    return mergeBaselines(JSON.parse(rawText), incoming)
  } catch {
    return normalizeBaselines(incoming)
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
