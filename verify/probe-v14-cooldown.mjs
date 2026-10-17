/**
 * v1.4 诊断探针：复现验证台注入序列下的时段提醒冷却行为。
 *
 * 目的：解释 v13-tariff 变体里「进入空闲方向」为什么超时 75 秒也等不到卡片。
 * 只读，不写任何存储。
 */

import { advanceTariffAlert, createTariffAlertState, DEFAULT_TARIFF_COOLDOWN_MS } from '../src/client/tariff-alert.js'

const T = (s) => Date.parse(s)
const H = 3600000

console.log('冷却窗口 =', DEFAULT_TARIFF_COOLDOWN_MS, 'ms =', DEFAULT_TARIFF_COOLDOWN_MS / H, '小时')
console.log('')

const step = (state, label, input, muted) => {
  const out = advanceTariffAlert(state, input, { muted })
  const got = out.alert === null ? 'null' : out.alert.period
  console.log(
    `${label.padEnd(26)} period=${String(input.period).padEnd(9)} alert=${String(got).padEnd(9)} state=${JSON.stringify(out.state)}`
  )
  return out.state
}

// 验证台 v13-tariff 变体的真实序列：
//   tick1 真实时刻（周五 02:3x，空闲）→ 首次观测，只记录
//   tick2 注入 10:30（高峰）        → 跨档，提醒
//   tick3 注入 12:30（午休空闲）    → 跨档，距上次提醒 2 小时 > 1 小时冷却 → 应该提醒
console.log('=== 序列 A：按真实注入序列（每段只 tick 一次）===')
let st = createTariffAlertState()
st = step(st, '1) real 02:30 off-peak', {
  period: 'off-peak', at: T('2026-10-16T02:30:00+08:00'), model: 'deepseek-flash', outputPrice: 4, nextAt: T('2026-10-16T09:00:00+08:00')
})
st = step(st, '2) inject 10:30 peak', {
  period: 'peak', at: T('2026-10-16T10:30:00+08:00'), model: 'deepseek-flash', outputPrice: 8, nextAt: T('2026-10-16T12:00:00+08:00')
})
st = step(st, '3) inject 12:30 off-peak', {
  period: 'off-peak', at: T('2026-10-16T12:30:00+08:00'), model: 'deepseek-flash', outputPrice: 4, nextAt: T('2026-10-16T14:00:00+08:00')
})

console.log('')
console.log('=== 序列 B：同一时刻连续 tick（看门狗 30 秒一次，注入后 clock 冻结）===')
st = createTariffAlertState()
const at0230 = T('2026-10-16T02:30:00+08:00')
const at1030 = T('2026-10-16T10:30:00+08:00')
const at1230 = T('2026-10-16T12:30:00+08:00')
// 真实时刻：看门狗在注入生效前可能已经 tick 过多次（都是空闲、同一时刻附近）
st = step(st, '1a) real off-peak', { period: 'off-peak', at: at0230, model: 'm', outputPrice: 4, nextAt: null })
st = step(st, '1b) real off-peak again', { period: 'off-peak', at: at0230 + 30000, model: 'm', outputPrice: 4, nextAt: null })
// 注入 10:30 后 clock 冻结在 10:30，看门狗每 30 秒 tick，但 now 恒为 10:30
st = step(st, '2a) inject peak (t)', { period: 'peak', at: at1030, model: 'm', outputPrice: 8, nextAt: null })
st = step(st, '2b) inject peak (t+0s)', { period: 'peak', at: at1030, model: 'm', outputPrice: 8, nextAt: null })
// 注入 12:30，clock 冻结在 12:30
st = step(st, '3a) inject off (t)', { period: 'off-peak', at: at1230, model: 'm', outputPrice: 4, nextAt: null })
st = step(st, '3b) inject off (t+0s)', { period: 'off-peak', at: at1230, model: 'm', outputPrice: 4, nextAt: null })

console.log('')
console.log('=== 序列 C：第二次提醒与第一次提醒的真实间隔 ===')
console.log('第一次提醒 at =', new Date(at1030).toISOString(), '(注入 10:30)')
console.log('第二次提醒 at =', new Date(at1230).toISOString(), '(注入 12:30)')
console.log('间隔 =', (at1230 - at1030) / H, '小时；冷却 =', DEFAULT_TARIFF_COOLDOWN_MS / H, '小时')
console.log('结论：2 小时 > 1 小时，冷却**不该**挡住它。')
