import { currentOffPeakWindow, periodAt, pricingSnapshot } from '../src/client/pricing.js'

// D4: 是否存在 end <= start 的退化区间
// 扫描一整个工作日的每一分钟，找 offPeakWindow 里 end <= start 的时刻
const day = Date.parse('2026-10-16T00:00:00+08:00')
let bad = []
let checked = 0
for (let m = 0; m < 1440; m++) {
  const at = day + m * 60000
  const w = currentOffPeakWindow(at)
  checked++
  if (w !== null && !(w.end > w.start)) {
    bad.push({ at: new Date(at).toISOString(), start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString(), period: periodAt(at).period })
  }
}
console.log('=== D4 扫描 2026-10-16（周五）全天每分钟 ===')
console.log('checked =', checked, ' 退化区间(end<=start) 数量 =', bad.length)
console.log(JSON.stringify(bad.slice(0, 10), null, 2))

// 边界时刻逐秒扫描：高峰窗口起止的 ±5 秒
console.log('')
console.log('=== D4b 高峰窗口边界 ±5 秒逐秒扫描 ===')
const edges = []
for (const [h, mm] of [[9,0],[12,0],[14,0],[18,0]]) {
  edges.push(day + (h*60+mm)*60000)
}
let bad2 = []
for (const e of edges) {
  for (let d = -5; d <= 5; d++) {
    const at = e + d*1000
    const w = currentOffPeakWindow(at)
    if (w !== null && !(w.end > w.start)) bad2.push({ at: new Date(at).toISOString(), start: new Date(w.start).toISOString(), end: new Date(w.end).toISOString() })
  }
}
console.log('退化区间数量 =', bad2.length)
console.log(JSON.stringify(bad2.slice(0, 10), null, 2))
