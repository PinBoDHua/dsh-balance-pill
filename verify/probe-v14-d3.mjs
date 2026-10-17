import { pricingSnapshot, OFF_PEAK_MULTIPLIER } from '../src/client/pricing.js'

// D3: offPeakRemainingMs 的语义
const now = Date.parse('2026-10-16T10:30:00+08:00') // 周五高峰
const snap = pricingSnapshot({ now, modelKey: 'flash', balance: 12, ratePerHour: 2 })
console.log('=== D3 验证 ===')
console.log('period            =', snap.period)
console.log('balance           =', snap.balance, ' ratePerHour =', snap.ratePerHour)
console.log('remainingMs       =', snap.remainingMs, 'ms =', snap.remainingMs/3600000, 'h   (余额按当前速度能用多久)')
console.log('offPeakRemainingMs=', snap.offPeakRemainingMs, 'ms =', snap.offPeakRemainingMs/3600000, 'h')
console.log('OFF_PEAK_MULTIPLIER =', OFF_PEAK_MULTIPLIER)
console.log('1/0.5 - 1 =', 1/OFF_PEAK_MULTIPLIER - 1, '  <- 实现用的系数')
console.log('remainingMs/0.5 =', snap.remainingMs/OFF_PEAK_MULTIPLIER, 'ms =', snap.remainingMs/OFF_PEAK_MULTIPLIER/3600000, 'h  <- 「同样的钱在空闲能用多久」应为这个')
console.log('')
console.log('字段名/用法要的是「能用多久」=', snap.remainingMs/OFF_PEAK_MULTIPLIER)
console.log('实现给出的是              ', snap.offPeakRemainingMs)
console.log('倍数差 =', (snap.remainingMs/OFF_PEAK_MULTIPLIER) / snap.offPeakRemainingMs)
