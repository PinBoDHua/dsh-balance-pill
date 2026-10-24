/**
 * 余额徽章 —— 运行时测试。
 *
 * 分四层：
 *  1. 纯逻辑（取值、分档、格式化、配置归一化）—— 直接 import 源码模块；
 *  2. bundle 契约 —— 在 vm 沙箱里执行构建产物，用假 require 物化 factory，
 *     再用假 ctx 跑一次 apply，确认三个挂载点都注册成功；
 *  3. 组件行为 —— 断言组件导出形状与纯逻辑一致性；
 *  4. 样式与文档一致性 —— 关键选择器、深浅色、README 提到的旋钮都真的存在。
 *
 * > 重建说明（2026-10-17）：原 3878 行测试文件在一次编辑事故中损坏到不可恢复
 * > （672 行被替换成 U+FFFD，且行尾换行被吞掉 316 处），本文件按源码重新构建。
 * > 覆盖范围对标 v1.5：v1.2 的历史/趋势/会话、v1.3 的时段引擎与日历、
 * > v1.4 的今日已用/耗尽预估/看门狗自愈、v1.5 的本周已用/分方向冷却/口径过滤。
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client')
const BUNDLE = join(ROOT, 'client', 'client.js')

/** 极简 React 替身（仅供模块加载期不炸，不用于真实渲染）。 */
const fakeReact = {
  Fragment: Symbol('Fragment'),
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  useEffect() {},
  useMemo: (fn) => fn()
}

globalThis.React = fakeReact
const fakeReactDom = { createPortal: (node) => node }
globalThis.ReactDOM = fakeReactDom

/** 组件会挂 window/document 事件；测试进程里没有 DOM，给一份最小替身。 */
const listeners = { window: new Set(), document: new Set() }
globalThis.window = {
  addEventListener: (type, handler) => listeners.window.add(`${type}:${String(handler)}`),
  removeEventListener: (type, handler) => listeners.window.delete(`${type}:${String(handler)}`),
  innerWidth: 1280,
  innerHeight: 800
}
globalThis.document = {
  visibilityState: 'visible',
  body: {},
  addEventListener: (type, handler) => listeners.document.add(`${type}:${String(handler)}`),
  removeEventListener: (type, handler) => listeners.document.delete(`${type}:${String(handler)}`)
}

const balance = await import(pathToFileURL(join(SRC, 'balance.js')).href)
const pricing = await import(pathToFileURL(join(SRC, 'pricing.js')).href)
const calendars = await import(pathToFileURL(join(SRC, 'calendars.js')).href)
const format = await import(pathToFileURL(join(SRC, 'format.js')).href)
const settingsModule = await import(pathToFileURL(join(SRC, 'settings.js')).href)
const history = await import(pathToFileURL(join(SRC, 'history.js')).href)
const spendModule = await import(pathToFileURL(join(SRC, 'session-spend.js')).href)
const alertModule = await import(pathToFileURL(join(SRC, 'alert.js')).href)
const tariffAlert = await import(pathToFileURL(join(SRC, 'tariff-alert.js')).href)
const tariffService = await import(pathToFileURL(join(SRC, 'tariff-service.js')).href)
const { createAccountClient } = await import(pathToFileURL(join(SRC, 'account.js')).href)
const { PLUGIN_VERSION } = await import(pathToFileURL(join(SRC, 'version.js')).href)
const { BalancePill, BalancePanel } = await import(pathToFileURL(join(SRC, 'pill.js')).href)
const { TrendSparkline } = await import(pathToFileURL(join(SRC, 'sparkline.js')).href)
const { BalanceAlert } = await import(pathToFileURL(join(SRC, 'alert-toast.js')).href)
const { zh, en } = await import(pathToFileURL(join(SRC, 'locales.js')).href)
const { BalanceSettingsRow } = await import(pathToFileURL(join(SRC, 'settings-row.js')).href)
// 宿主侧入口（lib/index.js）：版本一致性校验要用它（v0.3.0 起导出 version）。
const libEntry = await import(pathToFileURL(join(ROOT, 'lib', 'index.js')).href)

/** 测试用本地化函数：直接查词典并做 `{name}` 插值。 */
function translator(dict = zh) {
  return (key, params) => {
    const template = dict[key] ?? key
    if (params === undefined) return template
    return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
  }
}

const t = translator()

/** 从组件树里按 props 选择器找节点。 */
function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findAll(node.props?.children ?? null, predicate, out)
  return out
}

/** 内存版 localStorage 替身。 */
function memoryStorage(initial) {
  const map = new Map(Object.entries(initial ?? {}))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => {
      map.set(key, String(value))
    },
    removeItem: (key) => {
      map.delete(key)
    },
    size: () => map.size
  }
}

/** 北京时间 → epoch 毫秒（测试里到处都要造时刻）。 */
function bj(text) {
  const match = String(text).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/)
  assert.ok(match, `不支持的时间文本：${text}`)
  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6] ?? 0)
  ) - pricing.BILLING_TZ_OFFSET_MINUTES * 60000
}

/** 造一条历史样本。 */
const sample = (at, amount, currency = 'CNY', basis = 'total') => ({ at, amount, currency, basis })

// =================================================================== 历史

test('normalizeHistory 丢弃垃圾、排序、去重并裁剪', () => {
  const now = 1_000_000_000
  const raw = [
    sample(now - 5000, 10),
    { at: 'nope', amount: 1 },
    { at: now - 4000, amount: 'x' },
    null,
    sample(now - 6000, 12),
    sample(now - 5000, 11),
    { at: now - 7 * 24 * 3600 * 1000 - 1, amount: 99 }
  ]
  const normalized = history.normalizeHistory(raw, now)
  // 非法条目被丢弃、时间升序、同毫秒保留最后一条、超龄的被剔除。
  assert.deepEqual(normalized.map((s) => [s.at, s.amount]), [
    [now - 6000, 12],
    [now - 5000, 11]
  ])
})

test('normalizeHistory 对非数组输入返回空数组', () => {
  assert.deepEqual(history.normalizeHistory(null), [])
  assert.deepEqual(history.normalizeHistory('nope'), [])
  assert.deepEqual(history.normalizeHistory({}), [])
})

test('normalizeHistory 按条数上限裁剪，保留最近的', () => {
  const now = 1_000_000_000
  const raw = []
  for (let index = 0; index < history.MAX_SAMPLES + 50; index += 1) {
    raw.push(sample(now - (history.MAX_SAMPLES + 50 - index) * 120000, index))
  }
  const normalized = history.normalizeHistory(raw, now)
  assert.equal(normalized.length, history.MAX_SAMPLES)
  assert.equal(normalized[normalized.length - 1].amount, history.MAX_SAMPLES + 49)
})

test('appendSample 在间隔过近时替换而不是追加', () => {
  const now = 1_000_000_000
  let samples = history.appendSample([], sample(now - 100000, 10), now)
  assert.equal(samples.length, 1)

  // 10 秒后：属于「同一段时间」，替换掉上一枚，避免手动连点刷出假尖峰。
  samples = history.appendSample(samples, sample(now - 90000, 9.5), now)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].amount, 9.5)

  // 两分钟后：正常追加。
  samples = history.appendSample(samples, sample(now, 9), now)
  assert.equal(samples.length, 2)
  assert.deepEqual(samples.map((s) => s.amount), [9.5, 9])
})

test('appendSample 在币种变化时重开历史', () => {
  const now = 1_000_000_000
  let samples = history.appendSample([], sample(now - 100000, 10, 'CNY'), now)
  samples = history.appendSample(samples, sample(now, 3, 'USD'), now)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].currency, 'USD')
})

test('appendSample 忽略金额与时间都相同的重复读数', () => {
  const now = 1_000_000_000
  const first = history.appendSample([], sample(now, 10), now)
  const second = history.appendSample(first, sample(now, 10), now)
  // 内容不变即可：断言的是「没有多出一枚样本」，而不是引用相等。
  assert.equal(second.length, 1)
  assert.deepEqual(second[0], first[0])
})

test('appendSample 写入时按 MAX_AGE_MS 裁剪', () => {
  const now = 10 * 24 * 3600 * 1000
  const old = now - history.MAX_AGE_MS - 60000
  const samples = history.appendSample([sample(old, 99)], sample(now - 60000, 5), now)
  assert.equal(samples.length, 1)
  assert.equal(samples[0].amount, 5)
})

test('withinWindow 只留窗口内的样本', () => {
  const now = 1_000_000_000
  const samples = [sample(now - 7200000, 1), sample(now - 3600000, 2), sample(now - 600000, 3)]
  // 窗口是闭区间 [now - windowMs, now]：正好卡在边界上的那一枚也算在内。
  assert.equal(history.withinWindow(samples, 3600 * 1000, now).length, 2)
  assert.deepEqual(history.withinWindow(samples, 3600 * 1000, now).map((s) => s.amount), [2, 3])
  // 比最新样本还短的窗口什么都不剩。
  assert.equal(history.withinWindow(samples, 1000, now).length, 0)
})

test('withinWindow 按口径过滤样本', () => {
  const now = 1_000_000_000
  const samples = [
    sample(now - 3000, 10, 'CNY', 'total'),
    sample(now - 2000, 1, 'CNY', 'recharge'),
    sample(now - 1000, 2, 'CNY', 'total')
  ]
  assert.equal(history.withinWindow(samples, 60000, now, 'total').length, 2)
  assert.equal(history.withinWindow(samples, 60000, now, 'recharge').length, 1)
})

test('downsample 保留首尾并压到目标桶数', () => {
  const now = 1_000_000_000
  const samples = []
  for (let index = 0; index < 200; index += 1) samples.push(sample(now + index * 60000, 100 - index))
  const down = history.downsample(samples, 20)
  assert.ok(down.length <= 22, `桶数应接近 20，实际 ${down.length}`)
  assert.equal(down[0].at, samples[0].at)
  assert.equal(down[down.length - 1].at, samples[samples.length - 1].at)
  // 桶内取「该桶最后一条」，不是平均：折线要表达当时剩多少。
  assert.ok(down.every((point, index) => index === 0 || point.at > down[index - 1].at))
})

test('downsample 对空样本与少量样本的退化处理', () => {
  assert.deepEqual(history.downsample([], 10), [])
  assert.deepEqual(history.downsample(null, 10), [])
  const one = [sample(1000, 5)]
  assert.deepEqual(history.downsample(one, 10), one)
})

test('sparklinePath 给出可用的折线几何', () => {
  const points = [sample(0, 10), sample(60000, 9), sample(120000, 8)]
  const geometry = history.sparklinePath(points, { width: 100, height: 40 })
  assert.ok(geometry.d.startsWith('M'), 'path 必须以 M 开头')
  assert.equal((geometry.d.match(/L/g) ?? []).length, 2, '三个点应有两条线段')
  assert.equal(geometry.first, 10)
  assert.equal(geometry.last, 8)
  assert.equal(geometry.delta, -2)
  assert.equal(geometry.min, 8)
  assert.equal(geometry.max, 10)
  // 面积路径必须闭合，否则 SVG 会画出敞开的色块。
  assert.ok(geometry.area.endsWith('Z'))
})

test('sparklinePath 在余额不变时不放大噪声（minSpan 撑开纵轴）', () => {
  const points = [sample(0, 5), sample(60000, 5), sample(120000, 5)]
  const geometry = history.sparklinePath(points, { width: 100, height: 40, minSpan: 0.01 })
  // 纵轴区间被撑到 minSpan，值落在中间 —— y 应在画布中部附近。
  const y = Number(geometry.d.split(' ')[1])
  assert.ok(y > 3 && y < 40 - 3, `y 应落在内边距之间，实际 ${y}`)
})

test('sparklinePath 对空输入返回 null', () => {
  assert.equal(history.sparklinePath([]), null)
  assert.equal(history.sparklinePath(null), null)
})

test('earliestWithin 找窗口内最早的样本', () => {
  const now = 1_000_000_000
  const samples = [sample(now - 7200000, 1), sample(now - 3600000, 2), sample(now - 600000, 3)]
  assert.equal(history.earliestWithin(samples, 3600 * 1000, now).amount, 2)
  assert.equal(history.earliestWithin([], 3600 * 1000, now), null)
})

// ---------------------------------------------------------- 计费日 / 计费周

test('billingDayOf 按北京时间切日，跨零点不串天', () => {
  // 北京时间 2026-10-15 23:59 与 2026-10-16 00:01 必须是两个计费日。
  const before = history.billingDayOf(bj('2026-10-15 23:59'))
  const after = history.billingDayOf(bj('2026-10-16 00:01'))
  assert.notEqual(before, after)
  assert.equal(before + 1, after)
  assert.equal(history.billingDayOf(bj('2026-10-15 00:00')), before, '同一天的零点与深夜同属一天')
  // 时区必须是 +08:00，与机器的本地时区无关（测试机可能是任意时区）。
  assert.equal(history.billingDayOf(bj('2026-10-16 00:30'), 480), after)
  assert.equal(history.billingDayOf(bj('2026-10-16 00:30'), 0), before, '换成 UTC 口径就是另一个日序号')
})

test('billingDayOf 对垃圾输入返回 null（不把 null 当成 1970）', () => {
  for (const bad of [null, undefined, '', 'abc', Number.NaN, {}, []]) {
    assert.equal(history.billingDayOf(bad), null, `${String(bad)} 应为 null`)
  }
  assert.equal(history.billingDayOf(0), 0, '数值 0 是合法的 epoch')
  assert.equal(history.billingDayOf('0'), 0, '非空数字字符串也合法')
})

test('billingWeekOf 按北京时间 ISO 周（周一为起点）切周', () => {
  // 2026-10-12 是周一，2026-10-18 是周日；2026-10-19 是下周一。
  const beforeMonday = history.billingWeekOf(bj('2026-10-11 23:30'))
  const monday = history.billingWeekOf(bj('2026-10-12 00:30'))
  const sunday = history.billingWeekOf(bj('2026-10-18 23:30'))
  const nextMonday = history.billingWeekOf(bj('2026-10-19 00:30'))
  assert.equal(monday, sunday, '同一 ISO 周')
  assert.equal(nextMonday, monday + 1)
  assert.equal(beforeMonday, monday - 1, '上周日属于上一周')
  // 同一瞬间用两种时区口径会落到不同的周：北京时间 2026-10-18 23:30 是周日，
  // 而 8 小时后的 UTC 口径是 10-18 15:30，两者都属同一周 —— 这里用**跨年边界**处的
  // 差异来锁住「口径生效」这件事：北京时间 2026-10-19 00:30 已进入下一周。
  const sundayNight = bj('2026-10-18 23:30') // 北京 周日 23:30
  assert.equal(history.billingWeekOf(sundayNight), monday, '北京周日 23:30 仍是本周')
  assert.equal(history.billingWeekOf(bj('2026-10-19 00:30')), nextMonday, '北京周一 00:30 已是下一周')
  // 同一瞬间换成 UTC 口径（偏移 0）就是 10-18 15:30，仍是本周 —— 两种口径结论不同。
  assert.equal(history.billingWeekOf(sundayNight, 0), monday)
})

test('billingWeekOf 对垃圾输入返回 null', () => {
  for (const bad of [null, '', 'abc', Number.NaN]) {
    assert.equal(history.billingWeekOf(bad), null)
  }
})

test('spendInDay 算出当天消耗，并守住「同日 / 同口径 / 同币种 / 不为负」四条规则', () => {
  const day = bj('2026-10-15 12:00')
  const samples = [
    sample(bj('2026-10-15 08:00'), 10),
    sample(bj('2026-10-15 09:00'), 8),
    sample(bj('2026-10-15 10:00'), 5.5),
    // 昨天与明天的样本都不该参与。
    sample(bj('2026-10-14 10:00'), 99),
    sample(bj('2026-10-16 10:00'), 88)
  ]
  const today = history.spendInDay(samples, day)
  assert.equal(today.spent, 4.5)
  assert.equal(today.samples, 3)
  assert.equal(today.firstAt, bj('2026-10-15 08:00'))
  assert.equal(today.lastAt, bj('2026-10-15 10:00'))

  // 规则 2：口径不同的样本被排除。
  const mixed = [
    sample(bj('2026-10-15 08:00'), 10, 'CNY', 'total'),
    sample(bj('2026-10-15 09:00'), 8, 'CNY', 'total'),
    sample(bj('2026-10-15 09:30'), 1.5, 'CNY', 'recharge'),
    sample(bj('2026-10-15 10:00'), 5.5, 'CNY', 'recharge')
  ]
  assert.equal(history.spendInDay(mixed, day, { basis: 'total' }).spent, 2)
  assert.equal(history.spendInDay(mixed, day, { basis: 'recharge' }).spent, 0, '充值口径当天金额在涨 → 归零')

  // 规则 3：币种不一致时返回 null（跨币种相减没有意义）。
  assert.equal(history.spendInDay(samples, day, { currency: 'USD' }), null)

  // 规则 4：当天充值过时差额为负，归零。
  const refilled = [
    sample(bj('2026-10-15 08:00'), 5),
    sample(bj('2026-10-15 09:00'), 20)
  ]
  assert.equal(history.spendInDay(refilled, day).spent, 0, '充值过的当天不能说成负消耗')
})

test('spentFromSamples 只累加下降，充值那一跳被跳过（v0.1.6 主线）', () => {
  const start = bj('2026-10-15 08:00')
  const samples = [
    sample(start, 20),
    sample(start + 3600000, 15), // 花 5
    sample(start + 7200000, 35), // 充 20：不能把这天的账归零
    sample(start + 10800000, 32) // 又花 3
  ]
  assert.equal(history.spentFromSamples(samples), 8)
  // 只有上升：没有消耗。
  assert.equal(history.spentFromSamples([sample(start, 5), sample(start + 3600000, 20)]), 0)
  // 空数组 / 单点 / 垃圾输入不抛错。
  assert.equal(history.spentFromSamples([]), 0)
  assert.equal(history.spentFromSamples([sample(start, 5)]), 0)
  assert.equal(history.spentFromSamples(null), 0)
})

test('spendInDay / spendInWeek 在充值和乱序样本下仍然算对（v0.1.6）', () => {
  const day = bj('2026-10-15 12:00')
  const withTopUp = [
    sample(bj('2026-10-15 08:00'), 20),
    sample(bj('2026-10-15 09:00'), 15), // 花 5
    sample(bj('2026-10-15 10:00'), 35), // 充 20
    sample(bj('2026-10-15 11:00'), 32) // 花 3
  ]
  assert.equal(history.spendInDay(withTopUp, day).spent, 8, '充过值也不能把当天已花掉的钱抹掉')

  // 周统计使用同一本账：周一花 5、周二充值、周三再花 3。
  const week = [
    sample(bj('2026-10-12 09:00'), 20),
    sample(bj('2026-10-12 10:00'), 15),
    sample(bj('2026-10-13 10:00'), 50),
    sample(bj('2026-10-14 10:00'), 47)
  ]
  assert.equal(history.spendInWeek(week, bj('2026-10-14 12:00'), {}).spent, 8)

  // 外部存储可能把样本写乱：排序后再按相邻下降计算。
  const shuffled = [
    sample(bj('2026-10-15 10:00'), 5),
    sample(bj('2026-10-15 08:00'), 10),
    sample(bj('2026-10-15 09:00'), 8)
  ]
  assert.equal(history.spendInDay(shuffled, day).spent, 5, '10→8→5 共 5')

  // 同一毫秒的重复样本保留最后一条，不能把两条都当成相邻下降。
  const t = bj('2026-10-15 08:00')
  const duplicated = [
    sample(t, 10),
    sample(t, 8),
    sample(t + 3600000, 7)
  ]
  const deduped = history.spendInDay(duplicated, day)
  assert.equal(deduped.spent, 1, '8→7 共 1，而不是 10→8→7 的 3')
  assert.equal(deduped.samples, 2)
})

test('spendInDay 对「样本不足 / 垃圾输入」返回 null 而不是抛错或给 0', () => {
  const day = bj('2026-10-15 12:00')
  // 规则 5：当天只有一个样本 —— 算不出消耗。
  assert.equal(history.spendInDay([sample(bj('2026-10-15 09:00'), 5)], day), null)
  assert.equal(history.spendInDay([], day), null)
  // 全部样本都在昨天。
  assert.equal(history.spendInDay([sample(bj('2026-10-14 09:00'), 5), sample(bj('2026-10-14 10:00'), 4)], day), null)
  for (const bad of [null, undefined, 'x', 42, {}]) {
    assert.equal(history.spendInDay(bad, day), null, `${String(bad)} 应为 null`)
  }
  assert.equal(history.spendInDay([sample(bj('2026-10-15 09:00'), 5)], 'x'), null, '非法 at 应为 null')
  // 混入一条垃圾样本不影响其余正常样本的计算。
  const dirty = [sample(bj('2026-10-15 08:00'), 8), null, sample(bj('2026-10-15 09:00'), 5)]
  assert.equal(history.spendInDay(dirty, day).spent, 3)
})

test('spendInWeek 守住「同周 / 同口径 / 同币种 / 不为负」四条规则', () => {
  // 2026-10-12 周一 … 2026-10-18 周日；2026-10-11 是上周日。
  const samples = [
    sample(bj('2026-10-11 20:00'), 99), // 上周日：不参与
    sample(bj('2026-10-12 09:00'), 20),
    sample(bj('2026-10-14 09:00'), 15),
    sample(bj('2026-10-16 20:00'), 12)
  ]
  const out = history.spendInWeek(samples, bj('2026-10-16 20:00'), { basis: 'total', currency: 'CNY' })
  assert.equal(out.spent, 8)
  assert.equal(out.samples, 3)

  // 「本周」在周一只含周一当天的样本；到了周中才开始有可比的落差。
  const mondaySamples = [
    sample(bj('2026-10-12 09:00'), 20),
    sample(bj('2026-10-12 23:00'), 15)
  ]
  assert.equal(
    history.spendInWeek(mondaySamples, bj('2026-10-12 23:00'), { basis: 'total', currency: 'CNY' }).spent,
    5,
    '周一当天就能算（本周 = 当天）'
  )
  const onlyOne = [sample(bj('2026-10-12 09:00'), 20)]
  assert.equal(history.spendInWeek(onlyOne, bj('2026-10-12 23:00'), { basis: 'total' }), null, '只有一个样本算不出消耗')
  const weekEnd = history.spendInWeek(samples, bj('2026-10-18 23:00'), { basis: 'total', currency: 'CNY' })
  assert.equal(weekEnd.spent, 8, '周日已含整周（上周日的样本仍被排除）')
  assert.equal(weekEnd.samples, 3)

  // 口径与币种过滤。
  const crossBasis = [
    sample(bj('2026-10-12 09:00'), 20, 'CNY', 'total'),
    sample(bj('2026-10-13 09:00'), 10, 'CNY', 'recharge'),
    sample(bj('2026-10-14 09:00'), 18, 'CNY', 'total')
  ]
  assert.equal(history.spendInWeek(crossBasis, bj('2026-10-14 10:00'), { basis: 'total' }).spent, 2)
  assert.equal(history.spendInWeek(crossBasis, bj('2026-10-14 10:00'), { currency: 'USD' }), null)

  // 本周充值过：归零而不是负数。
  const refilled = [
    sample(bj('2026-10-12 09:00'), 5),
    sample(bj('2026-10-14 09:00'), 50)
  ]
  assert.equal(history.spendInWeek(refilled, bj('2026-10-14 10:00'), {}).spent, 0)
})

test('spendInWeek 对垃圾输入返回 null', () => {
  const monday = bj('2026-10-12 09:00')
  assert.equal(history.spendInWeek(null, monday), null)
  assert.equal(history.spendInWeek('x', monday), null)
  assert.equal(history.spendInWeek([sample(monday, 5)], null), null)
  assert.equal(history.spendInWeek([sample(monday, 5), sample(monday + 3600000, 4)], 'bad'), null)
})

test('spendInWindow 汇总近 7 天消耗，并沿用「充值不清零」的账本（v0.1.6）', () => {
  const now = bj('2026-10-17 12:00')
  const day = 86400000
  const samples = [
    // 8 天前：窗口外，不参与。
    sample(now - 8 * day, 99),
    // 6 天前花 5，4 天前充值，2 天前又花 3。
    sample(now - 6 * day, 20),
    sample(now - 6 * day + 3600000, 15),
    sample(now - 4 * day, 50),
    sample(now - 2 * day, 47)
  ]
  const recent = history.spendInWindow(samples, now, { windowMs: history.RECENT_WINDOW_MS })
  assert.equal(recent.spent, 8)
  assert.equal(recent.samples, 4)
  assert.equal(recent.firstAt, now - 6 * day)
  assert.equal(recent.lastAt, now - 2 * day)

  // 口径 / 币种过滤与日/周统计一致。
  const mixed = [
    sample(now - 2 * day, 20, 'CNY', 'total'),
    sample(now - 1 * day, 18, 'CNY', 'total'),
    sample(now - 1 * day + 3600000, 30, 'USD', 'total'),
    sample(now - 3600000, 15, 'CNY', 'total')
  ]
  assert.equal(history.spendInWindow(mixed, now, { windowMs: history.RECENT_WINDOW_MS, basis: 'total', currency: 'CNY' }).spent, 5)
  assert.equal(history.spendInWindow(mixed, now, { windowMs: history.RECENT_WINDOW_MS, currency: 'USD' }), null, 'USD 只有一个样本')

  // 窗口边界：正好落在 from 上的样本参与，from 之前一毫秒不参与。
  const boundary = [
    sample(now - history.RECENT_WINDOW_MS - 1, 50),
    sample(now - history.RECENT_WINDOW_MS, 10),
    sample(now, 8)
  ]
  const clipped = history.spendInWindow(boundary, now, { windowMs: history.RECENT_WINDOW_MS })
  assert.equal(clipped.spent, 2, '只算窗口内 10→8')

  // 样本不足 / 非法窗口 / 非法 at 都返回 null，绝不抛错。
  assert.equal(history.spendInWindow([sample(now, 10)], now, { windowMs: history.RECENT_WINDOW_MS }), null)
  for (const bad of [0, -1, Number.NaN, 'x', null]) {
    assert.equal(history.spendInWindow(samples, now, { windowMs: bad }), null, `windowMs=${String(bad)}`)
  }
  assert.equal(history.spendInWindow(samples, 'x', {}), null)
  assert.equal(history.spendInWindow(null, now, {}), null)
})

test('spendInWindow 带 dailyAverage，分母是覆盖天数（v0.2.0）', () => {
  const now = bj('2026-10-17 12:00')
  const day = 86400000
  // 覆盖 6 天（firstAt=now-6d，lastAt=now-2d 之后再无样本）：跨度整 4 天 → 4 天。
  const four = [
    sample(now - 6 * day, 20),
    sample(now - 6 * day + 3600000, 15),
    sample(now - 4 * day, 50),
    sample(now - 2 * day, 47)
  ]
  const a = history.spendInWindow(four, now, { windowMs: history.RECENT_WINDOW_MS })
  assert.equal(a.spent, 8)
  assert.equal(a.dailyAverage, 2, '8 / 4 天 = 2')

  // 覆盖不足一天按一天算：两小时花 6，日均是 6 而不是被摊薄成 0.03。
  const hour = [sample(now - 7200000, 10), sample(now, 4)]
  const b = history.spendInWindow(hour, now, { windowMs: history.RECENT_WINDOW_MS })
  assert.equal(b.dailyAverage, 6)

  // 只跌不涨时 spent=0，dailyAverage 同步为 0（行不渲染，但形状必须自洽）。
  const flat = [sample(now - day, 10), sample(now, 10)]
  const c = history.spendInWindow(flat, now, { windowMs: history.RECENT_WINDOW_MS })
  assert.equal(c.spent, 0)
  assert.equal(c.dailyAverage, 0)
})

test('lastTopUpFromSamples 找出最近一次入账（v0.2.0）', () => {
  const now = bj('2026-10-17 12:00')
  const day = 86400000
  // 花 5 → 充 20（10-15）→ 又充 10（10-16）→ 花 3：最近一次入账是 +10。
  const samples = [
    sample(now - 4 * day, 20),
    sample(now - 4 * day + 3600000, 15),
    sample(now - 2 * day - 3600000, 35),
    sample(now - 1 * day - 3600000, 45),
    sample(now, 42)
  ]
  const topUp = history.lastTopUpFromSamples(samples, {})
  assert.equal(topUp.amount, 10)
  assert.equal(topUp.at, now - 1 * day - 3600000)
  assert.equal(topUp.currency, 'CNY')

  // 只跌不涨：没有可识别的入账。
  const dropping = [sample(now - day, 20), sample(now, 15)]
  assert.equal(history.lastTopUpFromSamples(dropping, {}), null)

  // 口径过滤：口径切换造成的跳变不是充值。
  const mixed = [sample(now - day, 20, 'CNY', 'total'), sample(now, 2, 'CNY', 'recharge')]
  assert.equal(history.lastTopUpFromSamples(mixed, { basis: 'total' }), null)
  // 币种过滤：换币种重开历史也不是充值。
  const switched = [sample(now - day, 20, 'CNY'), sample(now, 50, 'USD')]
  assert.equal(history.lastTopUpFromSamples(switched, { currency: 'CNY' }), null)

  // 乱序输入先排序再扫；同毫秒去重保留最后一条。
  const shuffled = [sample(now, 42), sample(now - day, 45), sample(now - day - 1000, 35)]
  const fromShuffled = history.lastTopUpFromSamples(shuffled, {})
  assert.equal(fromShuffled.amount, 10)

  // 垃圾输入与不足两个样本：null，绝不抛错。
  assert.equal(history.lastTopUpFromSamples(null, {}), null)
  assert.equal(history.lastTopUpFromSamples([sample(now, 10)], {}), null)
  assert.equal(history.lastTopUpFromSamples([sample(now, 10), null, 'x'], {}), null)
})

test('spendInDay / spendInWeek 在缺省 basis/currency 时不做过滤（v1.5 E 组）', () => {
  const t1 = bj('2026-10-15 09:00')
  const t2 = bj('2026-10-15 10:00')
  const samples = [
    sample(t1, 10, 'CNY', 'total'),
    sample(t2 - 1000, 8, 'USD', 'bonus'),
    sample(t2, 7.5, 'CNY', 'recharge')
  ]
  // 不传 basis：跨口径也接受（语义：调用方不在乎口径）。
  const noBasis = history.spendInDay(samples, t2 + 1000, {})
  assert.ok(noBasis !== null)
  assert.equal(noBasis.spent, 2.5)
  // 空字符串等同不传。
  const emptyBasis = history.spendInDay(samples, t2 + 1000, { basis: '', currency: '' })
  assert.deepEqual(emptyBasis, noBasis)
  // 显式指定后过滤：当天各口径只有一个样本。
  assert.equal(history.spendInDay(samples, t2 + 1000, { basis: 'recharge' }), null)
  assert.equal(history.spendInDay(samples, t2 + 1000, { basis: 'bonus' }), null)
  // spendInWeek 同口径。
  const week = history.spendInWeek(samples, t2 + 1000, {})
  assert.equal(week.spent, 2.5)
})

// ================================================================ 钱包投影

test('parseAmount 按 big.js 文法解析，拒绝其它写法', () => {
  assert.equal(balance.parseAmount('12.34'), 12.34)
  assert.equal(balance.parseAmount('0E-16'), 0)
  assert.equal(balance.parseAmount('.5'), 0.5)
  assert.equal(balance.parseAmount('5.'), 5)
  assert.equal(balance.parseAmount('1e3'), 1000)
  assert.equal(balance.parseAmount(' 7 '), 7)
  for (const bad of ['', 'abc', '1,5', '--1', null, undefined, {}, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(balance.parseAmount(bad), null, `${String(bad)} 应解析失败`)
  }
  assert.equal(balance.parseAmount(3.5), 3.5, '数字也接受')
})

test('normalizeWallets 丢弃非法条目并保留原文', () => {
  const wallets = balance.normalizeWallets([
    { currency: 'CNY', balance: '1.10' },
    { currency: 'USD', balance: 'nope' },
    null,
    { currency: 'USD', balance: '2' }
  ])
  assert.equal(wallets.length, 2)
  assert.deepEqual(wallets[0], { currency: 'CNY', amount: 1.1, raw: '1.10' })
  assert.deepEqual(balance.normalizeWallets(undefined), [])
})

test('pickCurrency 尊重偏好并回落到人民币', () => {
  const cny = [{ currency: 'CNY', amount: 1, raw: '1' }]
  const usd = [{ currency: 'USD', amount: 1, raw: '1' }]
  assert.equal(balance.pickCurrency(cny, usd, 'auto'), 'CNY')
  assert.equal(balance.pickCurrency(usd, [], 'auto'), 'USD')
  assert.equal(balance.pickCurrency(cny, usd, 'USD'), 'USD', '显式偏好生效')
  assert.equal(balance.pickCurrency(usd, [], 'CNY'), 'USD', '没有该币种时回落')
  assert.equal(balance.pickCurrency([], [], 'auto'), null)
})

test('summarize 把投影压成展示模型', () => {
  const detail = {
    status: 'ready',
    value: [{ currency: 'CNY', balance: '1.10' }],
    bonusWallets: [{ currency: 'CNY', balance: '10.07' }]
  }
  const summary = balance.summarize(detail, { currency: 'auto' })
  assert.equal(summary.currency, 'CNY')
  assert.equal(summary.recharge, 1.1)
  assert.equal(summary.bonus, 10.07)
  assert.equal(summary.total, 11.17)
  assert.equal(summary.primary, 11.17)
  assert.deepEqual(summary.otherWallets, [])
})

test('summarize 在有解析不了的条目时整份作废', () => {
  // 与宿主「读取失败绝不退化成零余额」的口径一致。
  const detail = {
    status: 'ready',
    value: [{ currency: 'CNY', balance: '1.10' }, { currency: 'CNY', balance: 'garbage' }],
    bonusWallets: []
  }
  assert.equal(balance.summarize(detail), null)
})

test('summarize 在非 ready 时为 null，空钱包列表是合法的 0', () => {
  assert.equal(balance.summarize({ status: 'pending' }), null)
  assert.equal(balance.summarize(null), null)
  const empty = balance.summarize({ status: 'ready', value: [], bonusWallets: [] })
  assert.equal(empty.currency, null)
  assert.equal(empty.total, 0)
})

test('summarize 记录其他币种的钱包', () => {
  const detail = {
    status: 'ready',
    value: [{ currency: 'CNY', balance: '5' }, { currency: 'USD', balance: '2' }],
    bonusWallets: []
  }
  const summary = balance.summarize(detail)
  assert.equal(summary.currency, 'CNY')
  assert.equal(summary.otherWallets.length, 1)
  assert.equal(summary.otherWallets[0].currency, 'USD')
})

test('levelFor 按阈值分档', () => {
  assert.equal(balance.levelFor(2.99, { low: 3, warn: 10 }), 'low')
  assert.equal(balance.levelFor(3, { low: 3, warn: 10 }), 'warn')
  assert.equal(balance.levelFor(9.99, { low: 3, warn: 10 }), 'warn')
  assert.equal(balance.levelFor(10, { low: 3, warn: 10 }), 'ok')
  assert.equal(balance.levelFor(Number.NaN, { low: 3, warn: 10 }), 'ok')
})

test('classifyBalance 判定三种结果', () => {
  assert.equal(balance.classifyBalance({ ok: true, value: { status: 'ready' } }), 'ready')
  assert.equal(balance.classifyBalance({ ok: true, value: null }), 'signed-out')
  assert.equal(balance.classifyBalance({ ok: false, error: {} }), 'failed')
  assert.equal(balance.classifyBalance(null), 'failed')
  assert.equal(balance.classifyBalance({ ok: true, value: { status: 'pending' } }), 'failed')
})

test('computeRate 只在两次都就绪、同币种、时间前进且余额下降时给结论', () => {
  const before = { summary: { currency: 'CNY', primary: 10 }, at: 1_000_000 }
  const after = { summary: { currency: 'CNY', primary: 9 }, at: 1_000_000 + 3600000 }
  const rate = balance.computeRate(before, after)
  assert.equal(rate.spent, 1)
  assert.equal(rate.perHour, 1)
  // 间隔不足 30 秒：噪声比信号大。
  assert.equal(balance.computeRate(before, { summary: after.summary, at: before.at + 1000 }), null)
  // 余额上升（充值）不是消耗速度。
  assert.equal(balance.computeRate(after, before), null)
  // 币种不同不可比。
  assert.equal(balance.computeRate(before, { summary: { currency: 'USD', primary: 9 }, at: after.at }), null)
  assert.equal(balance.computeRate(null, after), null)
  // 超过 6 小时的跨度是「半天平均」，不是「近期速度」。
  assert.equal(
    balance.computeRate(before, { summary: after.summary, at: before.at + balance.RATE_MAX_ELAPSED_MS + 1 }),
    null
  )
})

test('rateBaseline 越过「金额没变」的轮询，让速度行不闪没（v0.1.6）', () => {
  const summary = { currency: 'CNY', total: 10, primary: 10, recharge: 10, bonus: 0 }
  const same = { ...summary }
  const first = balance.rateBaseline(null, summary, 1000)
  assert.deepEqual(first, { summary, at: 1000 })
  // 金额与币种都没变：保留旧基准（旧 at），速度才能跨过平台静默期。
  assert.equal(balance.rateBaseline(first, same, 61000), first)
  // 金额变化：用新读数做基准。
  const dropped = { ...summary, total: 9, primary: 9 }
  assert.deepEqual(balance.rateBaseline(first, dropped, 62000), { summary: dropped, at: 62000 })
  // 币种变化：重置。
  const usd = { ...summary, currency: 'USD' }
  assert.deepEqual(balance.rateBaseline(first, usd, 63000), { summary: usd, at: 63000 })
  // 非法 summary 不把旧基准弄丢。
  assert.equal(balance.rateBaseline(first, null, 64000), first)
})

test('viewModel 组装徽章模型并遵守 stale 语义', () => {
  const detail = { status: 'ready', value: [{ currency: 'CNY', balance: '1.10' }], bonusWallets: [] }
  const model = balance.viewModel({
    balance: { ok: true, value: detail },
    at: 1700000000000,
    now: 1700000000000,
    thresholds: { low: 3, warn: 10 }
  })
  assert.equal(model.status, 'ready')
  assert.equal(model.stale, false)
  assert.equal(model.level, 'low')
  assert.equal(model.primary, 1.1)
  assert.equal(model.ageMs, 0)

  const signedOut = balance.viewModel({ balance: { ok: true, value: null }, at: 1 })
  assert.equal(signedOut.status, 'signed-out')
  assert.equal(signedOut.signedIn, false)
  assert.equal(signedOut.topUpUrl, null)

  const failed = balance.viewModel({ balance: { ok: false, error: {} }, at: 2 })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.summary, null)
})

test('viewModel 在读取失败时保留上一次读数并标记过期', () => {
  const previous = {
    summary: { currency: 'CNY', recharge: 1, bonus: 0, total: 1, primary: 1 },
    at: 1700000000000
  }
  const model = balance.viewModel({
    balance: { ok: false, error: {} },
    previous,
    at: 1700000000000 + 60000,
    now: 1700000000000 + 60000
  })
  assert.equal(model.status, 'stale')
  assert.equal(model.stale, true)
  assert.equal(model.primary, 1, '旧读数继续显示，而不是抹成 --')
  assert.equal(model.ageMs, 60000)
})

test('amountFor 按口径取金额', () => {
  const summary = { total: 11.17, recharge: 1.1, bonus: 10.07 }
  assert.equal(balance.amountFor(summary, 'total'), 11.17)
  assert.equal(balance.amountFor(summary, 'recharge'), 1.1)
  assert.equal(balance.amountFor(summary, 'bonus'), 10.07)
  assert.equal(balance.amountFor(summary, 'weird'), 11.17, '未知口径回落总额')
  assert.equal(balance.amountFor(null, 'total'), null)
})

test('refreshedViewModel 重算设置口径而不伪装成刷新失败', () => {
  // v1.3 的真实缺陷：改阈值会把面板标成「本次刷新失败」。
  const summary = { currency: 'CNY', recharge: 1, bonus: 0, total: 1, primary: 1 }
  const model = balance.refreshedViewModel({
    summary,
    at: 1700000000000,
    thresholds: { low: 3, warn: 10 },
    now: 1700000000000 + 5000
  })
  assert.equal(model.status, 'ready', '不应该是 failed / signed-out')
  assert.equal(model.stale, false)
  assert.equal(model.effective, false, '沿用旧读数重算，不是真的读到了')
  assert.equal(model.level, 'low')
  assert.equal(model.ageMs, 5000)
  assert.equal(balance.refreshedViewModel({ summary: null }), null)
})

test('refreshedViewModel 能保留已有速度（v0.1.6：改设置后速度行不消失）', () => {
  const summary = { currency: 'CNY', recharge: 1, bonus: 0, total: 1, primary: 1 }
  const rate = { perHour: 2, spent: 1, elapsedMs: 1800000 }
  const model = balance.refreshedViewModel({
    summary,
    at: 1700000000000,
    rate,
    thresholds: { low: 3, warn: 10 },
    now: 1700000000000 + 5000
  })
  assert.equal(model.rate, rate, '显式给出的速度应原样保留，而不是拿同一份读数重算成 null')
})

test('refreshedViewModel 按给定口径重算金额与档位', () => {
  const summary = { currency: 'CNY', recharge: 1.1, bonus: 10.07, total: 11.17 }
  const asBonus = balance.refreshedViewModel({ summary, format: 'bonus', thresholds: { low: 3, warn: 10 } })
  assert.equal(asBonus.primary, 10.07)
  assert.equal(asBonus.level, 'ok')
  const asRecharge = balance.refreshedViewModel({ summary, format: 'recharge', thresholds: { low: 3, warn: 10 } })
  assert.equal(asRecharge.primary, 1.1)
  assert.equal(asRecharge.level, 'low')
})

test('clientMetadata 与 platformLocale 的口径', () => {
  const meta = balance.clientMetadata('zh-CN')
  assert.equal(meta.locale, 'zh-CN')
  assert.equal(meta.version, balance.CLIENT_VERSION)
  assert.equal(balance.platformLocale('zh-TW'), 'zh-CN')
  assert.equal(balance.platformLocale('en-US'), 'en')
  assert.equal(balance.platformLocale(undefined), 'en')
})

// ================================================================== 会话消耗

test('sessionSpend 用基准与当前读数算本轮消耗', () => {
  const baselines = { s1: { amount: 20, at: 1700000000000, currency: 'CNY' } }
  const out = spendModule.sessionSpend(baselines, 's1', { amount: 13.3, currency: 'CNY' })
  // 浮点减法：6.7 在实际实现里是 6.699999999999999，这里按金额精度断言。
  assert.ok(Math.abs(out.spent - 6.7) < 1e-9, `本轮消耗应约为 6.7，实际 ${out.spent}`)
  assert.equal(out.since, 1700000000000)
  assert.equal(out.currency, 'CNY')
  // 充值后余额高于基准：归零而不是显示负数。
  assert.equal(spendModule.sessionSpend(baselines, 's1', { amount: 25, currency: 'CNY' }).spent, 0)
  // 币种不符：不可比。
  assert.equal(spendModule.sessionSpend(baselines, 's1', { amount: 1, currency: 'USD' }), null)
  // 没有这个会话、没有读数、空 id。
  assert.equal(spendModule.sessionSpend(baselines, 's2', { amount: 1, currency: 'CNY' }), null)
  assert.equal(spendModule.sessionSpend(baselines, 's1', null), null)
  assert.equal(spendModule.sessionSpend(baselines, '', { amount: 1, currency: 'CNY' }), null)
})

test('recordBaseline 只在需要时更新基准', () => {
  let baselines = spendModule.recordBaseline({}, 's1', { amount: 10, currency: 'CNY', at: 1000 })
  assert.equal(baselines.s1.amount, 10)
  // 余额下降：基准不动（否则「本轮消耗」永远为 0）。
  baselines = spendModule.recordBaseline(baselines, 's1', { amount: 9, currency: 'CNY', at: 2000 })
  assert.equal(baselines.s1.amount, 10)
  // 充值：基准前推。
  baselines = spendModule.recordBaseline(baselines, 's1', { amount: 20, currency: 'CNY', at: 3000 })
  assert.equal(baselines.s1.amount, 20)
  // 换币种：整条重置。
  baselines = spendModule.recordBaseline(baselines, 's1', { amount: 3, currency: 'USD', at: 4000 })
  assert.equal(baselines.s1.currency, 'USD')
  // 空 id 不记录。
  assert.deepEqual(spendModule.recordBaseline({}, '', { amount: 1, currency: 'CNY' }), {})
})

test('normalizeBaselines 与 pruneBaselines', () => {
  const raw = {
    s1: { amount: 5, at: 1000, currency: 'CNY' },
    s2: { amount: 'x', at: 2000 },
    s3: null,
    '': { amount: 1, at: 3000 }
  }
  const clean = spendModule.normalizeBaselines(raw)
  assert.deepEqual(Object.keys(clean), ['s1'])
  assert.deepEqual(spendModule.normalizeBaselines(null), {})

  const many = {}
  for (let index = 0; index < 60; index += 1) many[`s${index}`] = { amount: 1, at: index, currency: 'CNY' }
  assert.equal(Object.keys(spendModule.pruneBaselines(many, 10)).length, 10)
})

test('loadBaselines / saveBaselines 走存储且容忍损坏', () => {
  const storage = memoryStorage()
  assert.deepEqual(spendModule.loadBaselines(storage), {})
  assert.equal(spendModule.saveBaselines({ s1: { amount: 1, at: 1, currency: 'CNY' } }, storage), true)
  assert.equal(spendModule.loadBaselines(storage).s1.amount, 1)
  storage.setItem(spendModule.SESSION_KEY, '{broken')
  assert.deepEqual(spendModule.loadBaselines(storage), {})
  assert.equal(spendModule.saveBaselines({}, null), false)
})

// ================================================================ 余额提醒

test('advanceAlert 首次观测只记录不提醒', () => {
  const outcome = alertModule.advanceAlert(alertModule.createAlertState(), { level: 'low', amount: 1, at: 1000 }, {})
  assert.equal(outcome.state.level, 'low')
  assert.equal(outcome.alert, null)
})

test('advanceAlert 只在档位变差时提醒一次', () => {
  let state = alertModule.createAlertState()
  // 先到 ok。
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 1000 }, {}).state
  // 掉到 warn：提醒。
  const toWarn = alertModule.advanceAlert(state, { level: 'warn', amount: 7.5, at: 4000 }, {})
  assert.ok(toWarn.alert !== null)
  assert.equal(toWarn.alert.level, 'warn')
  assert.equal(toWarn.alert.from, 'ok')
  state = toWarn.state
  // 同一档位再来一次：不再提醒。
  const repeated = alertModule.advanceAlert(state, { level: 'warn', amount: 7.5, at: 5000 }, {})
  assert.equal(repeated.alert, null)
  // 继续掉到 low：30 分钟冷却挡着（这是刻意的防打扰）；冷却一过就补上。
  const blocked = alertModule.advanceAlert(repeated.state, { level: 'low', amount: 1, at: 6000 }, {})
  assert.equal(blocked.alert, null, '冷却期内不连环弹卡')
  const later = alertModule.advanceAlert(blocked.state, {
    level: 'low',
    amount: 0.5,
    at: 4000 + alertModule.DEFAULT_COOLDOWN_MS + 1
  }, {})
  assert.ok(later.alert !== null, '冷却一过补上这次掉档')
  assert.equal(later.alert.level, 'low')
})

test('advanceAlert 在档位回升时重新武装', () => {
  let state = alertModule.createAlertState()
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 1000 }, {}).state
  state = alertModule.advanceAlert(state, { level: 'low', amount: 1, at: 2000 }, {}).state
  // 回升：不提醒，但清掉「已提醒」标记。
  const recovered = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 3000 }, {})
  assert.equal(recovered.alert, null)
  assert.equal(recovered.state.alertedLevel, null, '回升后重新武装')
  // 再掉下去：又能提醒（冷却已过）。
  const again = alertModule.advanceAlert(recovered.state, {
    level: 'low',
    amount: 1,
    at: 2000 + alertModule.DEFAULT_COOLDOWN_MS + 1
  }, {})
  assert.ok(again.alert !== null)
})

test('advanceAlert 把「阈值改动」与「余额掉档」区分开', () => {
  // 金额没变而档位变差 = 用户自己调了阈值，不该弹「余额不足」。
  let state = alertModule.createAlertState()
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 8, at: 1000 }, {}).state
  const moved = alertModule.advanceAlert(state, { level: 'low', amount: 8, at: 2000 }, {})
  assert.equal(moved.alert, null)
  assert.equal(moved.state.level, 'low', '档位仍然跟随')
})

test('advanceAlert 在切换口径 / 阈值时不弹假的「余额不足」（v0.1.6）', () => {
  const totalKey = 'total|auto|3|10|CNY'
  const rechargeKey = 'recharge|auto|3|10|CNY'
  let state = alertModule.createAlertState()
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 1000, configKey: totalKey }, {}).state
  // 用户把徽章数字从「可用合计」切到「仅充值」：金额从 20 变 2、档位从 ok 变 low，
  // 但余额一分没少，不能弹卡。
  const switched = alertModule.advanceAlert(
    state,
    { level: 'low', amount: 2, at: 2000, configKey: rechargeKey },
    {}
  )
  assert.equal(switched.alert, null, '配置变化不是余额掉档')
  assert.equal(switched.state.level, 'low', '档位仍然跟随新口径')
  assert.equal(switched.state.configKey, rechargeKey)
  // 新配置下先回升，再真实掉档：仍能正常提醒。
  const recovered = alertModule.advanceAlert(
    switched.state,
    { level: 'ok', amount: 20, at: 3000, configKey: rechargeKey },
    {}
  )
  const realDrop = alertModule.advanceAlert(
    recovered.state,
    { level: 'low', amount: 1, at: 4000, configKey: rechargeKey },
    {}
  )
  assert.ok(realDrop.alert !== null, '配置稳定后的真实掉档必须提醒')
})

test('advanceAlert 的冷却从上次真正提醒起算，且不吞掉跨档', () => {
  let state = alertModule.createAlertState()
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 0 }, {}).state
  const first = alertModule.advanceAlert(state, { level: 'warn', amount: 7, at: 1_000_000 }, {})
  assert.ok(first.alert !== null)
  state = first.state
  // 冷却窗口内回到 ok 再掉到 low：这次被冷却挡住，但不推进状态。
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 1_000_000 + 1000 }, {}).state
  const blocked = alertModule.advanceAlert(state, { level: 'low', amount: 1, at: 1_000_000 + 2000 }, {})
  assert.equal(blocked.alert, null)
  assert.equal(blocked.state.level, 'ok', '冷却期内原样返回旧状态，不推进档位')
  // 冷却一过：补上。
  const late = alertModule.advanceAlert(blocked.state, {
    level: 'low',
    amount: 1,
    at: 1_000_000 + alertModule.DEFAULT_COOLDOWN_MS + 1000
  }, {})
  assert.ok(late.alert !== null)
  assert.equal(late.alert.level, 'low')
})

test('advanceAlert 在静音时推进状态但不提醒', () => {
  let state = alertModule.createAlertState()
  state = alertModule.advanceAlert(state, { level: 'ok', amount: 20, at: 1000 }, {}).state
  const muted = alertModule.advanceAlert(state, { level: 'low', amount: 1, at: 2000 }, { muted: true })
  assert.equal(muted.alert, null)
  assert.equal(muted.state.level, 'low')
  // 静音期间不该占用冷却窗口。
  assert.equal(muted.state.alertedAt, 0)
})

test('提醒状态的序列化往返与损坏恢复', () => {
  const state = { level: 'low', alertedLevel: 'low', at: 100, alertedAt: 200, seq: 3, amount: 1.5, configKey: 'total|auto|3|10|CNY' }
  const restored = alertModule.deserializeAlertState(alertModule.serializeAlertState(state))
  assert.deepEqual(restored, state)
  assert.deepEqual(alertModule.deserializeAlertState(null), alertModule.createAlertState())
  assert.deepEqual(alertModule.deserializeAlertState({ level: 'nope' }).level, null)
})

test('createAlertStore 提供 get / getSnapshot / subscribe', () => {
  const store = alertModule.createAlertStore()
  assert.equal(store.get(), null)
  assert.equal(store.getSnapshot(), null, '宿主浮层只认 getSnapshot 这个名字')
  const seen = []
  const unsubscribe = store.subscribe((value) => seen.push(value))
  store.set({ level: 'low' })
  assert.equal(store.getSnapshot().level, 'low')
  store.set(store.getSnapshot())
  assert.equal(seen.length, 1, '同一个引用不重复通知')
  unsubscribe()
  store.set({ level: 'warn' })
  assert.equal(seen.length, 1)
})

// ================================================================ 时段提醒

test('advanceTariffAlert 首次观测只记录不提醒', () => {
  const outcome = tariffAlert.advanceTariffAlert(tariffAlert.createTariffAlertState(), { period: 'peak', at: 1000 }, {})
  assert.equal(outcome.state.period, 'peak')
  assert.equal(outcome.alert, null)
})

test('advanceTariffAlert 在时段切换时产出契约形状的卡片', () => {
  const state = tariffAlert.advanceTariffAlert(
    tariffAlert.createTariffAlertState(),
    { period: 'peak', at: 1_000_000 },
    {}
  ).state
  const outcome = tariffAlert.advanceTariffAlert(
    state,
    { period: 'off-peak', at: 1_000_000 + 3600000, model: 'deepseek-flash', outputPrice: 4, nextAt: 1_000_000 + 7200000 },
    {}
  )
  assert.ok(outcome.alert !== null)
  assert.equal(outcome.alert.kind, 'tariff')
  assert.equal(outcome.alert.period, 'off-peak')
  assert.equal(outcome.alert.model, 'deepseek-flash')
  assert.equal(outcome.alert.outputPrice, 4)
  assert.equal(outcome.alert.nextAt, 1_000_000 + 7200000)
  assert.equal(outcome.alert.seq, 1)
})

test('advanceTariffAlert 对非法时段原地不动', () => {
  const state = tariffAlert.createTariffAlertState()
  for (const bad of [undefined, null, 'peakish', 42, '']) {
    const outcome = tariffAlert.advanceTariffAlert(state, { period: bad, at: 1000 }, {})
    assert.equal(outcome.alert, null)
    assert.equal(outcome.state, state, '返回同一个引用')
  }
})

test('advanceTariffAlert 的冷却按方向分账（v1.5）', () => {
  const base = 1_000_000
  let state = tariffAlert.advanceTariffAlert(tariffAlert.createTariffAlertState(), { period: 'off-peak', at: base }, {}).state

  // 进入高峰：提醒（off-peak → peak）。
  const peak = tariffAlert.advanceTariffAlert(state, { period: 'peak', at: base + 1000 }, {})
  assert.ok(peak.alert !== null, '进入高峰应提醒')
  state = peak.state

  // 一分钟后进入空闲：不该被「进入高峰」的冷却挡掉。
  const offpeak = tariffAlert.advanceTariffAlert(state, { period: 'off-peak', at: base + 61000 }, {})
  assert.ok(offpeak.alert !== null, '相反方向的切换不应被另一方向的冷却挡住')
  state = offpeak.state

  // 再做一次进入高峰：距上次高峰提醒只有 61 秒 → 被本方向的冷却挡住。
  const blocked = tariffAlert.advanceTariffAlert(state, { period: 'peak', at: base + 62000 }, {})
  assert.equal(blocked.alert, null, '同方向冷却生效')
  assert.equal(blocked.state.period, 'off-peak', '冷却期内原样返回旧状态，不吞掉这次切换')
  // 冷却一过就补上（proves 两个方向各走各的窗口）。
  const laterPeak = tariffAlert.advanceTariffAlert(blocked.state, {
    period: 'peak',
    at: base + 1000 + tariffAlert.DEFAULT_TARIFF_COOLDOWN_MS
  }, {})
  assert.ok(laterPeak.alert !== null, '高峰方向冷却一过就补上')
})

test('advanceTariffAlert 在冷却过后补上切换', () => {
  const base = 1_000_000
  const cooldown = tariffAlert.DEFAULT_TARIFF_COOLDOWN_MS
  let state = tariffAlert.createTariffAlertState()
  state = tariffAlert.advanceTariffAlert(state, { period: 'off-peak', at: base }, {}).state
  const firstPeak = tariffAlert.advanceTariffAlert(state, { period: 'peak', at: base + 1000 }, {})
  assert.ok(firstPeak.alert !== null)
  // 回到空闲：本方向从未提醒过，可以立刻提醒。
  const offpeak = tariffAlert.advanceTariffAlert(firstPeak.state, { period: 'off-peak', at: base + 2000 }, {})
  assert.ok(offpeak.alert !== null)
  // 冷却窗口内再次进入高峰：被挡住，且原样返回旧 period。
  const blocked = tariffAlert.advanceTariffAlert(offpeak.state, { period: 'peak', at: base + 3000 }, {})
  assert.equal(blocked.alert, null)
  assert.equal(blocked.state.period, 'off-peak', '冷却期内不推进 period，避免吞掉这次切换')
  // 冷却一过就补上。
  const retried = tariffAlert.advanceTariffAlert(blocked.state, { period: 'peak', at: base + 1000 + cooldown }, {})
  assert.ok(retried.alert !== null, '冷却一过就补上')
})

test('advanceTariffAlert 静音时推进状态但不提醒', () => {
  const state = tariffAlert.advanceTariffAlert(tariffAlert.createTariffAlertState(), { period: 'peak', at: 1000 }, {}).state
  const muted = tariffAlert.advanceTariffAlert(state, { period: 'off-peak', at: 2000 }, { muted: true })
  assert.equal(muted.alert, null)
  assert.equal(muted.state.period, 'off-peak', '状态仍然跟上，取消静音后不会补旧卡')
  assert.equal(muted.state.alertedAtOffPeak, 0, '静音不占用冷却窗口')
})

test('advanceTariffAlert 的反方向不被另一方向的冷却挡掉（v1.5 D1 主线）', () => {
  // 真实时序：11:30 进入高峰（提醒）→ 12:00 进入空闲（30 分钟后）。
  // 单一时钟的实现会把 12:00 的卡静默丢掉，而「现在便宜了」正是最该提醒的一次。
  const cooldown = tariffAlert.DEFAULT_TARIFF_COOLDOWN_MS
  const elevenThirty = 1_000_000
  const noon = elevenThirty + 30 * 60000
  assert.ok(noon - elevenThirty < cooldown, '这个时序必须落在同一小时冷却窗口内')

  let state = tariffAlert.createTariffAlertState()
  state = tariffAlert.advanceTariffAlert(state, { period: 'off-peak', at: elevenThirty - 1000 }, {}).state
  const toPeak = tariffAlert.advanceTariffAlert(state, { period: 'peak', at: elevenThirty }, {})
  assert.ok(toPeak.alert !== null, '11:30 进入高峰应提醒')
  const toOffPeak = tariffAlert.advanceTariffAlert(toPeak.state, { period: 'off-peak', at: noon }, {})
  assert.ok(toOffPeak.alert !== null, '12:00 进入空闲**必须**提醒（分方向冷却）')
  assert.equal(toOffPeak.alert.period, 'off-peak')
  // 再回到高峰：高峰方向距 11:30 只有 31 分钟 → 仍受本方向冷却保护。
  const backToPeak = tariffAlert.advanceTariffAlert(toOffPeak.state, { period: 'peak', at: noon + 60000 }, {})
  assert.equal(backToPeak.alert, null, '同方向仍然防连环弹卡')
})

test('advanceTariffAlert 用 v1.5 的分方向状态字段推进', () => {
  // 手工构造的状态：高峰方向的冷却已经用掉（alertedAtPeak = 1000），空闲方向从未提醒。
  // 现在切到**空闲**：这是另一个方向，不该被高峰的冷却挡住。
  const handMade = { period: 'peak', alertedAt: 1000, alertedAtPeak: 1000, alertedAtOffPeak: 0, seq: 1 }
  const outcome = tariffAlert.advanceTariffAlert(handMade, { period: 'off-peak', at: 2000 }, {})
  assert.ok(outcome.alert !== null, '另一方向的冷却不影响本方向')
  assert.equal(outcome.alert.seq, 2)
  assert.equal(outcome.state.alertedAtOffPeak, 2000, '只推进本方向的时间戳')
  assert.equal(outcome.state.alertedAtPeak, 1000, '另一方向不动')
  // 反方向对照：切到高峰时，高峰的 1000 距 2000 只有 1 秒 → 被挡。
  const blocked = tariffAlert.advanceTariffAlert(
    { period: 'off-peak', alertedAt: 0, alertedAtPeak: 1000, alertedAtOffPeak: 0, seq: 1 },
    { period: 'peak', at: 2000 },
    {}
  )
  assert.equal(blocked.alert, null, '同方向冷却生效')
})

test('advanceTariffAlert 对「算不出来的边界/单价」给 null 而不是 0', () => {
  const state = tariffAlert.advanceTariffAlert(tariffAlert.createTariffAlertState(), { period: 'peak', at: 1000 }, {}).state
  const outcome = tariffAlert.advanceTariffAlert(state, { period: 'off-peak', at: 2000, outputPrice: 0, nextAt: 0 }, {})
  assert.equal(outcome.alert.outputPrice, null)
  assert.equal(outcome.alert.nextAt, null)
})

// ================================================================ 计费时段

test('periodAt 判定高峰 / 空闲并给出依据', () => {
  // 2026-10-16 是周五。
  assert.equal(pricing.periodAt(bj('2026-10-16 10:30')).period, 'peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 10:30')).reason, 'peak-window')
  // 午休 12:00–14:00 是空闲 —— 最容易算错的地方。
  const midday = pricing.periodAt(bj('2026-10-16 12:30'))
  assert.equal(midday.period, 'off-peak')
  assert.equal(midday.reason, 'midday')
  assert.equal(pricing.periodAt(bj('2026-10-16 14:30')).period, 'peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 18:30')).period, 'off-peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 03:00')).reason, 'night')
})

test('periodAt 的窗口边界：起点闭、终点开', () => {
  assert.equal(pricing.periodAt(bj('2026-10-16 09:00')).period, 'peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 08:59')).period, 'off-peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 11:59')).period, 'peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 12:00')).period, 'off-peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 14:00')).period, 'peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 17:59')).period, 'peak')
  assert.equal(pricing.periodAt(bj('2026-10-16 18:00')).period, 'off-peak')
})

test('periodAt 在周末与法定节假日全天空闲', () => {
  // 2026-10-17 是周六。
  const weekend = pricing.periodAt(bj('2026-10-17 10:30'))
  assert.equal(weekend.period, 'off-peak')
  assert.equal(weekend.reason, 'weekend')
  // 2026-10-01 国庆（周四）。
  const holiday = pricing.periodAt(bj('2026-10-01 10:30'))
  assert.equal(holiday.period, 'off-peak')
  assert.equal(holiday.reason, 'holiday')
})

test('periodAt 在调休补班的周末按工作日计费并解释原因', () => {
  const makeup = Object.entries(calendars.CHINA_HOLIDAYS)
    .filter(([, flag]) => flag === 0)
    .map(([date]) => date)
  assert.ok(makeup.length > 0, '日历里应有调休上班日')
  const date = makeup.find((day) => pricing.periodAt(bj(`${day} 10:30`)).period === 'peak')
  assert.ok(date !== undefined, '应有某天补班日的 10:30 是高峰')
  const peak = pricing.periodAt(bj(`${date} 10:30`))
  assert.equal(peak.makeup, true)
  // 补班日的空闲时段也要给出 makeup-workday 这个原因（v1.3 修的缺陷）。
  const off = pricing.periodAt(bj(`${date} 12:30`))
  assert.equal(off.period, 'off-peak')
  assert.equal(off.reason, 'makeup-workday')
})

test('peakWindowsForDay 给出当天的两段高峰', () => {
  const windows = pricing.peakWindowsForDay(bj('2026-10-16 10:30'))
  assert.equal(windows.length, 2)
  assert.equal(windows[0].start, bj('2026-10-16 09:00'))
  assert.equal(windows[0].end, bj('2026-10-16 12:00'))
  assert.equal(windows[1].start, bj('2026-10-16 14:00'))
  assert.equal(windows[1].end, bj('2026-10-16 18:00'))
  // 休息日没有高峰窗口。
  assert.deepEqual(pricing.peakWindowsForDay(bj('2026-10-17 10:30')), [])
})

test('nextTransition 跳过「换日但不换时段」的边界', () => {
  // 23:30 的下一个边界是 00:00，但前后都是空闲 —— 那不算切换。
  const next = pricing.nextTransition(bj('2026-10-15 23:30'))
  assert.equal(next.at, bj('2026-10-16 09:00'))
  assert.equal(next.period, 'peak')
})

test('nextPeriodStart 找到下一个高峰与下一个空闲', () => {
  // 周五 17:00 → 下一个高峰是周一 09:00（跨过整个周末，需要足够的搜索跨度）。
  const friday = bj('2026-10-16 17:00')
  assert.equal(pricing.nextPeriodStart(friday, 'peak'), bj('2026-10-19 09:00'))
  // 高峰中 → 下一个空闲是 18:00 之后的下一段（12:00 午休）。
  assert.equal(pricing.nextPeriodStart(bj('2026-10-16 10:30'), 'off-peak'), bj('2026-10-16 12:00'))
})

test('currentOffPeakWindow 给出整段空闲区间（含长假）', () => {
  // 国庆中段：09-30 18:00 – 10-08 09:00。
  const national = pricing.currentOffPeakWindow(bj('2026-10-02 12:00'))
  assert.equal(national.start, bj('2026-09-30 18:00'))
  assert.equal(national.end, bj('2026-10-08 09:00'))
  // 周末第二天：10-16 18:00 – 10-19 09:00。
  const weekend = pricing.currentOffPeakWindow(bj('2026-10-18 12:00'))
  assert.equal(weekend.start, bj('2026-10-16 18:00'))
  assert.equal(weekend.end, bj('2026-10-19 09:00'))
  // 高峰时段返回 null。
  assert.equal(pricing.currentOffPeakWindow(bj('2026-10-16 10:30')), null)
})

test('currentOffPeakWindow 的端点不变量：起点前一刻是高峰、终点是高峰', () => {
  for (const text of ['2026-10-02 12:00', '2026-10-18 12:00', '2026-10-16 20:00', '2026-10-16 13:00']) {
    const window = pricing.currentOffPeakWindow(bj(text))
    assert.ok(window !== null, `${text} 应处在空闲时段`)
    assert.equal(pricing.periodAt(window.start - 1).period, 'peak', `${text} 的起点前一刻应是高峰`)
    assert.equal(pricing.periodAt(window.end).period, 'peak', `${text} 的终点应是高峰`)
    assert.ok(window.end > window.start, '不能是退化区间')
  }
})

test('priceOf 按时段取单价', () => {
  const flash = pricing.MODELS.find((model) => model.key === 'flash')
  assert.equal(pricing.priceOf(flash, 'peak', 'output'), 8)
  assert.equal(pricing.priceOf(flash, 'off-peak', 'output'), 4)
  assert.equal(pricing.priceOf(flash, 'peak', 'nope'), null)
  assert.equal(pricing.priceOf(null, 'peak', 'output'), null)
})

test('价格表：空闲 = 高峰 / 2，且来源是官方文档', () => {
  for (const model of pricing.MODELS) {
    for (const field of ['cacheHit', 'cacheMiss', 'output']) {
      assert.equal(
        model.offPeak[field],
        model.peak[field] * pricing.OFF_PEAK_MULTIPLIER,
        `${model.label} 的 ${field} 应满足空闲 = 高峰的一半`
      )
    }
    assert.match(model.source, /api-docs\.deepseek\.com/)
  }
})

test('tokensPerYuan 把金额折算成等效 token', () => {
  const flash = pricing.MODELS.find((model) => model.key === 'flash')
  const peak = pricing.tokensPerYuan({ cacheHitShare: 0.5, outputShare: 0.1 }, flash, 'peak')
  const off = pricing.tokensPerYuan({ cacheHitShare: 0.5, outputShare: 0.1 }, flash, 'off-peak')
  assert.ok(peak.total > 0)
  assert.ok(off.total > peak.total, '空闲时段同样的钱能买到更多 token')
  // 一半的价格 → 两倍的 token（同一用量结构下）。
  assert.equal(Math.round(off.total / peak.total), 2)
  assert.equal(pricing.tokensPerYuan({}, null, 'peak'), null)
})

test('pricingSnapshot 组装面板需要的全部字段', () => {
  const snap = pricing.pricingSnapshot({
    now: bj('2026-10-16 10:30'),
    modelKey: 'flash',
    balance: 9,
    ratePerHour: 2
  })
  assert.equal(snap.period, 'peak')
  assert.equal(snap.isPeak, true)
  assert.equal(snap.model.key, 'flash')
  assert.equal(snap.nextOffPeakAt, bj('2026-10-16 12:00'))
  assert.equal(snap.msUntilOffPeak, 90 * 60000)
  assert.equal(snap.msUntilChange, 90 * 60000)
  assert.equal(snap.nextChangeAt, bj('2026-10-16 12:00'))
  assert.equal(snap.offPeakMultiplier, 0.5)
  assert.ok(snap.priceSource !== null)
})

test('pricingSnapshot 的峰谷预估满足 v1.4 D3 的不变量', () => {
  const snap = pricing.pricingSnapshot({ now: bj('2026-10-16 10:30'), balance: 9, ratePerHour: 2 })
  // 余额 9 / 速度 2 = 4.5 小时。
  assert.equal(snap.remainingMs, 4.5 * 3600000)
  // 空闲时段能用两倍时长（不是相等 —— 那是 v1.3 的差 2 倍缺陷）。
  assert.equal(snap.offPeakRemainingMs, 9 * 3600000)
  assert.equal(snap.offPeakRemainingMs, snap.remainingMs * 2)
  // 省下的时间 = 能用的 − 原来的。
  assert.equal(snap.offPeakSavingMs, snap.offPeakRemainingMs - snap.remainingMs)
  assert.equal(snap.offPeakSavingMs, 4.5 * 3600000)
  assert.ok(snap.offPeakSavingMs >= 0)
})

test('pricingSnapshot 在空闲时段与缺速度时把峰谷预估置空', () => {
  const off = pricing.pricingSnapshot({ now: bj('2026-10-16 20:00'), balance: 9, ratePerHour: 2 })
  assert.equal(off.offPeakRemainingMs, null, '空闲时段没有「等到空闲」这回事')
  assert.equal(off.offPeakSavingMs, null)
  const noRate = pricing.pricingSnapshot({ now: bj('2026-10-16 10:30'), balance: 9 })
  assert.equal(noRate.remainingMs, null)
  assert.equal(noRate.offPeakRemainingMs, null)
  assert.equal(noRate.offPeakSavingMs, null)
})

test('pricingSnapshot 对垃圾输入也返回结构完整的结果', () => {
  for (const input of [undefined, null, {}, { now: Number.NaN }, { now: 'x', balance: 'y' }]) {
    const snap = pricing.pricingSnapshot(input)
    assert.ok(pricing.PERIODS.includes(snap.period))
    assert.equal(typeof snap.msUntilChange, 'number')
    assert.ok(snap.offPeakSavingMs === null || snap.offPeakSavingMs >= 0)
  }
})

test('pricingSnapshot 不把 null 当成 0（余额 / 时区 / 时刻）（v0.1.6）', () => {
  const at = bj('2026-10-16 10:30')
  // null 余额不是 ¥0：不能据此推出「撑不到下一个高峰」。
  const noBalance = pricing.pricingSnapshot({ now: at, balance: null, ratePerHour: 2 })
  assert.equal(noBalance.balance, null)
  assert.equal(noBalance.remainingMs, null)
  assert.equal(noBalance.offPeakRemainingMs, null)
  assert.equal(noBalance.lastsUntilNextPeak, null)
  // 数值 0 是合法的「余额为零」，仍要保留。
  const zero = pricing.pricingSnapshot({ now: at, balance: 0, ratePerHour: 2 })
  assert.equal(zero.balance, 0)
  assert.equal(zero.remainingMs, 0)
  // null 时区不是 UTC：仍按北京时间判定。
  const noTz = pricing.pricingSnapshot({ now: at, tzOffsetMinutes: null })
  assert.equal(noTz.tzOffsetMinutes, pricing.BILLING_TZ_OFFSET_MINUTES)
  assert.equal(noTz.period, 'peak')
  // null / 空串的 now 不是 1970 年。
  const noNow = pricing.pricingSnapshot({ now: null })
  assert.ok(noNow.now > 1_000_000_000_000)
  // 显式 0 时区仍然被尊重。
  assert.equal(pricing.pricingSnapshot({ now: at, tzOffsetMinutes: 0 }).tzOffsetMinutes, 0)
})

test('selectModel 尊重 key 并回落到内置默认', () => {
  assert.equal(pricing.selectModel({ modelKey: 'pro' }).key, 'pro')
  assert.equal(pricing.selectModel({ modelKey: 'flash' }).key, 'flash')
  assert.equal(pricing.selectModel({ modelKey: 'nope' }).key, pricing.DEFAULT_MODEL_KEY)
  assert.equal(pricing.selectModel({ modelKey: 'auto' }).key, pricing.DEFAULT_MODEL_KEY)
})

test('isPeakAt 便捷包装', () => {
  assert.equal(pricing.isPeakAt(bj('2026-10-16 10:00')), true)
  assert.equal(pricing.isPeakAt(bj('2026-10-16 20:00')), false)
})

test('节假日日历：覆盖年份、来源与关键安排', () => {
  assert.deepEqual(calendars.CALENDAR_YEARS, [2025, 2026])
  assert.equal(calendars.calendarCovers(2026), true)
  assert.equal(calendars.calendarCovers(2027), false)
  // 逐条抄公告：2026 元旦 / 国庆。
  assert.equal(calendars.CHINA_HOLIDAYS['2026-01-01'], 1)
  assert.equal(calendars.CHINA_HOLIDAYS['2026-10-01'], 1)
  // 所有键都是合法日期且标记只有 0/1。
  for (const [date, flag] of Object.entries(calendars.CHINA_HOLIDAYS)) {
    assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
    assert.ok(flag === 0 || flag === 1)
  }
})

// ==================================================================== 格式化

test('formatAmount 的边界：不足一分钱、零、非法', () => {
  assert.equal(format.formatAmount(0.004, { locale: 'en-US' }), '<0.01')
  assert.equal(format.formatAmount(-0.004, { locale: 'en-US' }), '>-0.01')
  assert.equal(format.formatAmount(0, { locale: 'en-US' }), '0.00')
  assert.equal(format.formatAmount(11.17, { locale: 'en-US' }), '11.17')
  assert.equal(format.formatAmount(Number.NaN), '--')
  assert.equal(format.formatAmount('3'), '--')
})

test('formatThreshold / formatDelta / formatMoneyDelta', () => {
  assert.equal(format.formatThreshold(3), '3')
  assert.equal(format.formatThreshold(2.5), '2.50')
  assert.equal(format.formatDelta(1.5, { locale: 'en-US' }), '+1.50')
  assert.equal(format.formatDelta(-1.5, { locale: 'en-US' }), '-1.50')
  assert.equal(format.formatMoneyDelta(-1.5, 'CNY', { locale: 'en-US' }), '-¥1.50')
  assert.equal(format.formatMoneyDelta(1.5, 'USD', { locale: 'en-US' }), '+$1.50')
})

test('currencySymbol / formatMoney', () => {
  assert.equal(format.currencySymbol('CNY'), '¥')
  assert.equal(format.currencySymbol('USD'), '$')
  assert.equal(format.currencySymbol('EUR'), 'EUR ')
  assert.equal(format.currencySymbol(null), '')
  assert.equal(format.formatMoney(3.5, 'CNY', { locale: 'en-US' }), '¥3.50')
})

test('resolveLocale 把界面语言归一到 BCP-47', () => {
  assert.equal(format.resolveLocale('zh-CN'), 'zh-CN')
  assert.equal(format.resolveLocale('zh-Hant'), 'zh-TW')
  assert.equal(format.resolveLocale('zh-TW'), 'zh-TW')
  assert.equal(format.resolveLocale('en'), 'en-US')
  assert.equal(format.resolveLocale(''), 'zh-CN')
  assert.equal(format.resolveLocale(undefined), 'zh-CN')
})

test('formatAge 的时间分档与取整', () => {
  const now = 1_000_000_000
  assert.equal(format.formatAge(now - 1000, t, now), t('age.now'))
  assert.equal(format.formatAge(now - 30000, t, now), t('age.seconds', { count: 30 }))
  // 59.6 分钟不能被说成「60 分钟前」。
  assert.equal(format.formatAge(now - 59.6 * 60000, t, now), t('age.minutes', { count: 59 }))
  assert.equal(format.formatAge(now - 2 * 3600000, t, now), t('age.hours', { count: 2 }))
  assert.equal(format.formatAge(now - 2 * 86400000, t, now), t('age.days', { count: 2 }))
  assert.equal(format.formatAge(null, t, now), t('age.never'))
})

test('formatDuration 只给数量级', () => {
  assert.equal(format.formatDuration(90 * 1000, t), t('duration.minutes', { count: 2 }))
  assert.equal(format.formatDuration(2.34 * 3600000, t), t('duration.hours', { count: 2.3 }))
  assert.equal(format.formatDuration(4.5 * 3600000, t), t('duration.hours', { count: 4.5 }))
  assert.equal(format.formatDuration(0, t), t('duration.unknown'))
  assert.equal(format.formatDuration(Number.NaN, t), t('duration.unknown'))
})

test('formatClock 用本地时区给 HH:MM:SS', () => {
  const at = Date.UTC(2026, 9, 16, 12, 34, 56)
  assert.match(format.formatClock(at), /^\d{2}:\d{2}:\d{2}$/)
  assert.equal(format.formatClock(null), '--')
})

test('formatBeijingTime / formatBeijingDateTime 固定 +08:00', () => {
  const at = bj('2026-10-16 09:05')
  assert.equal(format.formatBeijingTime(at), '09:05')
  assert.equal(format.formatBeijingTime(at, 0), '01:05', '偏移可注入，便于测试其它时区')
  assert.equal(format.formatBeijingDateTime(at), '10-16 09:05')
  assert.equal(format.formatBeijingTime('x'), '--')
})

test('formatBillingMoment 同一天给时刻，跨天补日期（v0.1.6）', () => {
  const at = bj('2026-10-16 09:05')
  assert.equal(format.formatBillingMoment(at, bj('2026-10-16 20:00')), '09:05')
  assert.equal(format.formatBillingMoment(at, bj('2026-10-17 20:00')), '10-16 09:05')
  // 北京时间 00:05 与前一天 23:55 在本地时区可能同一天，但计费日必须分开。
  assert.equal(
    format.formatBillingMoment(bj('2026-10-15 23:55'), bj('2026-10-16 00:05')),
    '10-15 23:55'
  )
  assert.equal(format.formatBillingMoment(null, Date.now()), '--')
})

test('formatCountdown 给到「小时 + 分钟」两级', () => {
  assert.equal(
    format.formatCountdown(2 * 3600000 + 13 * 60000, t),
    `${t('duration.hours', { count: 2 })} ${t('duration.minutes', { count: 13 })}`
  )
  assert.equal(format.formatCountdown(13 * 60000, t), t('duration.minutes', { count: 13 }))
  assert.equal(format.formatCountdown(45000, t), t('duration.seconds', { count: 45 }))
  // 跨天也带小时 / 分钟（v0.1.6）：旧实现只给「1 天」，会一整天不走字。
  assert.equal(
    format.formatCountdown(26 * 3600000, t),
    `${t('duration.days', { count: 1 })} ${t('duration.hours', { count: 2 })}`
  )
  assert.equal(
    format.formatCountdown(26 * 3600000 + 13 * 60000, t),
    `${t('duration.days', { count: 1 })} ${t('duration.hours', { count: 2 })} ${t('duration.minutes', { count: 13 })}`
  )
  assert.equal(
    format.formatCountdown(24 * 3600000 + 30 * 60000, t),
    `${t('duration.days', { count: 1 })} ${t('duration.minutes', { count: 30 })}`
  )
  assert.equal(format.formatCountdown(24 * 3600000, t), t('duration.days', { count: 1 }))
  // v0.2.0：恰好为 0 不再闪「暂时无法估算」—— `msUntil*` 都是 Math.max(0, …)，
  // 边界那一拍会得到 0，旧实现把它与 NaN 一起归进 unknown。
  assert.equal(format.formatCountdown(0, t), t('duration.seconds', { count: 1 }))
  assert.equal(format.formatCountdown(-1, t), t('duration.unknown'))
  assert.equal(format.formatCountdown(NaN, t), t('duration.unknown'))
})

test('formatPeakWindow 跨天时带上「次日 / N 天后」', () => {
  const same = { start: bj('2026-10-16 09:00'), end: bj('2026-10-16 12:00') }
  assert.equal(format.formatPeakWindow(same, 480, t), '09:00–12:00')
  const cross = { start: bj('2026-10-16 18:00'), end: bj('2026-10-19 09:00') }
  assert.equal(
    format.formatPeakWindow(cross, 480, t),
    t('tariff.windowDays', { from: '18:00', to: '09:00', count: 3 })
  )
  const nextDay = { start: bj('2026-10-16 18:00'), end: bj('2026-10-17 09:00') }
  assert.equal(format.formatPeakWindow(nextDay, 480, t), t('tariff.windowNextDay', { from: '18:00', to: '09:00' }))
  assert.equal(format.formatPeakWindow(null, 480, t), '--')
})

test('formatPrice 输出绝对值而不是「小于一分钱」', () => {
  assert.equal(format.formatPrice(0.02, 'CNY', { locale: 'en-US' }), '¥0.02')
  assert.equal(format.formatPrice(4, 'CNY', { locale: 'en-US' }), '¥4.00')
  assert.equal(format.formatPrice(Number.NaN), '--')
})

// ================================================================ 配置归一化

test('normalizeSettings 对合法配置原样保留', () => {
  const settings = settingsModule.normalizeSettings({ ...settingsModule.DEFAULT_SETTINGS })
  assert.deepEqual(settings, settingsModule.DEFAULT_SETTINGS)
})

test('normalizeSettings 对每一项非法值单独回落默认', () => {
  const settings = settingsModule.normalizeSettings({
    format: 'weird',
    currency: 'EUR',
    low: 'abc',
    warn: null,
    pollMs: 100,
    showRate: 'yes',
    compact: 1,
    showTrend: 'no',
    showSessionSpend: null,
    alertOnCross: 'true',
    showTariff: 'x',
    tariffModel: 'gpt',
    alertOnTariff: 'on'
  })
  const defaults = settingsModule.DEFAULT_SETTINGS
  assert.equal(settings.format, defaults.format)
  assert.equal(settings.currency, defaults.currency)
  assert.equal(settings.low, defaults.low)
  assert.equal(settings.warn, defaults.warn)
  // 过密的轮询被抬到 5 秒。
  assert.equal(settings.pollMs, 5000)
  assert.equal(settings.showRate, defaults.showRate)
  assert.equal(settings.compact, defaults.compact)
  assert.equal(settings.showTrend, defaults.showTrend)
  assert.equal(settings.showSessionSpend, defaults.showSessionSpend)
  assert.equal(settings.alertOnCross, defaults.alertOnCross)
  assert.equal(settings.showTariff, defaults.showTariff)
  assert.equal(settings.tariffModel, defaults.tariffModel)
  assert.equal(settings.alertOnTariff, defaults.alertOnTariff)
})

test('normalizeSettings 不接受隐式的 0 阈值（v1.5 D2）', () => {
  // `Number(null)` / `Number('')` / `Number(false)` 全是 0 —— 一旦放行，
  // 任何余额都会判红，而界面上看不出异常。
  for (const bad of [null, '', '   ', false, {}, [], Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const settings = settingsModule.normalizeSettings({ low: bad, warn: bad })
    assert.equal(settings.low, settingsModule.DEFAULT_SETTINGS.low, `low=${String(bad)} 应回落默认`)
    assert.equal(settings.warn, settingsModule.DEFAULT_SETTINGS.warn, `warn=${String(bad)} 应回落默认`)
  }
  // 数值 0 是合法输入，不能被误判成「没给」。
  const zero = settingsModule.normalizeSettings({ low: 0, warn: 10 })
  assert.equal(zero.low, 0)
  assert.equal(zero.warn, 10)
  // 非空数字字符串正常采用。
  const text = settingsModule.normalizeSettings({ low: '3', warn: '10' })
  assert.equal(text.low, 3)
  assert.equal(text.warn, 10)
})

test('normalizeSettings 不把空串 / 布尔当成合法的「仅手动」轮询（v0.1.6）', () => {
  // `Number('')` 与 `Number(false)` 都是 0，而 0 是合法的「仅手动」档位。
  // 若放行，用户存储被写坏后插件会静默停止轮询，看起来像余额不再更新。
  for (const bad of ['', '   ', false, true, {}, [], null, undefined, 'abc']) {
    assert.equal(
      settingsModule.normalizeSettings({ pollMs: bad }).pollMs,
      settingsModule.DEFAULT_SETTINGS.pollMs,
      `pollMs=${String(bad)} 应回落默认`
    )
  }
  // 数字 0 与字符串 '0' 都是明确的「仅手动」。
  assert.equal(settingsModule.normalizeSettings({ pollMs: 0 }).pollMs, 0)
  assert.equal(settingsModule.normalizeSettings({ pollMs: '0' }).pollMs, 0)
  assert.equal(settingsModule.normalizeSettings({ pollMs: '30000' }).pollMs, 30000)
})

test('normalizeSettings 对写反的阈值做对调', () => {
  const settings = settingsModule.normalizeSettings({ low: 50, warn: 10 })
  assert.equal(settings.low, 10)
  assert.equal(settings.warn, 50)
})

test('loadSettings 迁移 v1.0 的阈值键且不删旧键', () => {
  const storage = memoryStorage({ 'dsh-balance-pill:thresholds': JSON.stringify({ low: 8, warn: 20 }) })
  const settings = settingsModule.loadSettings(storage)
  assert.equal(settings.low, 8)
  assert.equal(settings.warn, 20)
  // 旧键保留（回滚到 v1.0 时用户的自定义阈值还在）。
  assert.ok(storage.getItem('dsh-balance-pill:thresholds') !== null)
})

test('loadSettings 优先新键，存储损坏时回落默认', () => {
  const storage = memoryStorage({
    'dsh-balance-pill:settings': JSON.stringify({ low: 6, warn: 30 }),
    'dsh-balance-pill:thresholds': JSON.stringify({ low: 1, warn: 2 })
  })
  assert.equal(settingsModule.loadSettings(storage).low, 6)
  storage.setItem('dsh-balance-pill:settings', '{broken')
  // 新键损坏时回落到 v1.0 的阈值键（那是合法来源），而不是直接跳到默认值。
  const fallback = settingsModule.loadSettings(storage)
  assert.equal(fallback.low, 1)
  assert.equal(fallback.warn, 2)
})

test('clampThresholdPatch 推动兄弟字段而不是对调', () => {
  const settings = { low: 3, warn: 10 }
  // 用户把红灯阈值填到 42：橙灯让路，红灯仍是 42（语义不被颠倒）。
  assert.deepEqual(settingsModule.clampThresholdPatch(settings, { low: 42 }), { low: 42, warn: 42 })
  // 改橙灯到 1：红灯往下让路。
  assert.deepEqual(settingsModule.clampThresholdPatch(settings, { warn: 1 }), { warn: 1, low: 1 })
  // 两者都改时互不推挤。
  assert.deepEqual(settingsModule.clampThresholdPatch(settings, { low: 5, warn: 7 }), { low: 5, warn: 7 })
})

test('createSettingsStore 的订阅、写入与重置', () => {
  const storage = memoryStorage()
  const store = settingsModule.createSettingsStore(undefined, storage)
  assert.equal(store.get().low, settingsModule.DEFAULT_SETTINGS.low)
  const seen = []
  const unsubscribe = store.subscribe((value) => seen.push(value.low))
  store.update({ low: 7 })
  assert.equal(store.get().low, 7)
  assert.deepEqual(seen, [7])
  // 写入后落盘。
  assert.equal(JSON.parse(storage.getItem(settingsModule.SETTINGS_KEY)).low, 7)
  // 同一个值不触发通知。
  store.update({ low: 7 })
  assert.equal(seen.length, 1)
  store.reset()
  assert.equal(store.get().low, settingsModule.DEFAULT_SETTINGS.low)
  assert.equal(seen.length, 2)
  unsubscribe()
  store.update({ low: 9 })
  assert.equal(seen.length, 2)
})

test('saveSettings 在存储不可用时不抛错', () => {
  assert.equal(settingsModule.saveSettings({ low: 5 }, null).low, 5)
  assert.equal(settingsModule.resolveStorage(), undefined, 'Node 里没有 localStorage')
})

// ==================================================================== 词条

test('中英词典的键集完全一致', () => {
  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(enKeys, zhKeys)
  assert.ok(zhKeys.length > 60, `词条数量偏少：${zhKeys.length}`)
})

test('每个词条的占位符在中英两版里一致', () => {
  const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
  for (const key of Object.keys(zh)) {
    assert.deepEqual(placeholders(en[key]), placeholders(zh[key]), `${key} 的占位符不一致`)
  }
})

test('v1.5 / v0.1.6 / v0.2.0 新增词条存在且参数完整', () => {
  for (const key of [
    'panel.weekSpend',
    'panel.rateOffPeak',
    'panel.todaySpend',
    'pill.runout',
    'panel.recentSpend',
    // v0.2.0
    'panel.lastTopUp',
    'panel.runoutAt'
  ]) {
    assert.ok(zh[key] !== undefined, `缺少中文词条 ${key}`)
    assert.ok(en[key] !== undefined, `缺少英文词条 ${key}`)
  }
  assert.deepEqual(
    [...String(zh['panel.weekSpend']).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
    ['amount', 'time']
  )
  // v0.2.0：「近 7 天」行多了日均。
  assert.deepEqual(
    [...String(zh['panel.recentSpend']).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(),
    ['amount', 'daily', 'time']
  )
  assert.deepEqual([...String(zh['pill.runout']).matchAll(/\{(\w+)\}/g)].map((m) => m[1]), ['time'])
  assert.deepEqual([...String(zh['panel.lastTopUp']).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), ['amount', 'time'])
  assert.deepEqual([...String(zh['panel.runoutAt']).matchAll(/\{(\w+)\}/g)].map((m) => m[1]), ['time'])
})

test('词典没有空值', () => {
  for (const [key, value] of Object.entries(zh)) {
    assert.equal(typeof value, 'string', `${key} 的类型不对`)
    assert.ok(value.length > 0, `${key} 的中文为空`)
  }
  for (const [key, value] of Object.entries(en)) {
    assert.ok(String(value).length > 0, `${key} 的英文为空`)
  }
})

// ============================================================== 样式与文档

test('styles.css 把档位与时段色变量定义在 :root（portal 到 body 也能解析）', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  for (const name of ['--dbp-ok', '--dbp-warn', '--dbp-low', '--dbp-peak', '--dbp-offpeak']) {
    assert.match(css, new RegExp(`:root\\s*\\{[^}]*${name}`), `${name} 应定义在 :root 上`)
  }
})

test('styles.css 覆盖深色主题并含全部关键类名', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  assert.match(css, /body\[data-ds-dark-theme\]/)
  for (const cls of ['.dbp_root', '.dbp_trigger', '.dbp_panel', '.dbp_tariff', '.dbp_spark', '.dbp_alert', '.dbp_today', '.dbp_week', '.dbp_recent', '.dbp_topup', '.dbp_panelVersion']) {
    assert.ok(css.includes(cls), `样式表缺少 ${cls}`)
  }
  // v0.1.6：小窗口下面板自己滚动，而不是把顶部裁掉。
  assert.match(css, /\.dbp_panel\s*\{[^}]*overflow-y:\s*auto/)
  assert.match(css, /\.dbp_panel\s*\{[^}]*max-height:/)
})

test('styles.css 的花括号配平（构建期也会再查一次）', () => {
  const css = readFileSync(join(SRC, 'styles.css'), 'utf8')
  let depth = 0
  let inComment = false
  for (let index = 0; index < css.length; index += 1) {
    const two = css.slice(index, index + 2)
    if (!inComment && two === '/*') {
      inComment = true
      index += 1
      continue
    }
    if (inComment && two === '*/') {
      inComment = false
      index += 1
      continue
    }
    if (inComment) continue
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
  }
  assert.equal(depth, 0)
})

// ============================================================== bundle 契约

/** 在 vm 沙箱里物化构建产物的 factory，返回插件导出。 */
function loadBundle() {
  const code = readFileSync(BUNDLE, 'utf8')
  const registered = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load(entry) {
          registered.push(entry)
        }
      }
    },
    // apply 会注入样式标签：document 需要能建元素、能挂 head。
    document: {
      createElement: () => ({ dataset: {}, textContent: '' }),
      head: { appendChild() {} },
      querySelector: () => null
    },
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Date,
    Math,
    JSON
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  new vm.Script(code, { filename: 'client.js' }).runInContext(sandbox)
  assert.equal(registered.length, 1, '产物必须只登记一个模块')
  const expectedId = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name
  assert.equal(registered[0].id, expectedId, '插件 id 必须与 package.json 的 name 一致')
  const fakeRequire = (id) => {
    if (id === 'react') return fakeReact
    if (id === 'react-dom') return fakeReactDom
    throw new Error(`unexpected require: ${id}`)
  }
  return { exports: registered[0].factory(fakeRequire), code }
}

test('产物可以被宿主加载器物化成合法插件', () => {
  const { exports } = loadBundle()
  assert.equal(exports.name, 'dsh-balance-pill')
  assert.equal(typeof exports.apply, 'function')
  // 注意：产物在 vm 沙箱里求值，数组来自另一个 realm，
  // 因此不能直接 deepEqual（原型不同），按内容比较。
  assert.deepEqual([...exports.inject], ['slots', 'locale'])
})

test('apply 注册三个挂载点，且浮层条目提供 getSnapshot 契约', () => {
  const { exports } = loadBundle()
  const registered = []
  const effects = []
  const ctx = {
    effect: (fn) => {
      effects.push(fn())
    },
    locale: { register: () => () => {}, getSnapshot: () => ({ active: 'zh-CN' }) },
    slots: {
      inject: (_name, register) => register(),
      register: (descriptor, component) => {
        registered.push({ descriptor, component })
      }
    },
    get: () => null
  }
  exports.apply(ctx)
  const names = registered.map((entry) => entry.descriptor.name).sort()
  assert.deepEqual(names, ['conversation.composer.dock', 'settings.general.item', 'shell.overlay'])
  // 浮层条目注入的提醒仓库必须同时提供 get 与 getSnapshot。
  const overlay = registered.find((entry) => entry.descriptor.name === 'shell.overlay')
  const injected = overlay.descriptor.inject()
  assert.equal(typeof injected.hooks.alert.get, 'function')
  assert.equal(typeof injected.hooks.alert.getSnapshot, 'function')
  // 三个挂载点都要有可渲染的组件。
  for (const entry of registered) assert.equal(typeof entry.component, 'function')
  // 清理函数不得抛错（卸载路径）。
  for (const cleanup of effects) if (typeof cleanup === 'function') cleanup()
})

test('apply 在缺少账号能力时不抛错（惰性解析）', () => {
  const { exports } = loadBundle()
  const ctx = {
    effect: () => () => {},
    locale: { register: () => () => {}, getSnapshot: () => ({ active: 'en-US' }) },
    slots: { inject: (_name, register) => register(), register: () => {} },
    get: () => null
  }
  assert.doesNotThrow(() => exports.apply(ctx))
})

test('createAccountClient 把任何异常压成失败结果', async () => {
  const unavailable = createAccountClient({ get: () => null, locale: { getSnapshot: () => ({ active: 'zh-CN' }) } })
  assert.equal(unavailable.available(), false)
  const result = await unavailable.read()
  assert.equal(result.balance.ok, false)
  assert.equal(result.state.ok, false)

  const throwing = createAccountClient({
    get: (key) =>
      key === 'remote.account'
        ? {
            getBalance: () => {
              throw new Error('boom')
            },
            getState: () => ({ ok: true, value: { status: 'credential-stored' } })
          }
        : null,
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) }
  })
  assert.equal(throwing.available(), true)
  const mixed = await throwing.read()
  assert.equal(mixed.balance.ok, false)
  assert.equal(mixed.state.ok, true)

  const direct = createAccountClient({
    get: (key) => (key === 'remote.account' ? { getBalance: () => ({ ok: true, value: null }), getState: () => 'raw' } : null),
    locale: { getSnapshot: () => ({ active: 'zh-CN' }) }
  })
  const raw = await direct.read()
  assert.deepEqual(raw.state, { ok: true, value: 'raw' }, '非 Result 形状被包成成功结果')
})

test('产物里的存储键与挂载点标记齐全', () => {
  const { code } = loadBundle()
  for (const marker of [
    'conversation.composer.dock',
    'settings.general.item',
    'shell.overlay',
    'remote.account',
    'dsh-balance-pill:settings',
    'dsh-balance-pill:history',
    'dsh-balance-pill:sessions',
    'api-docs.deepseek.com/zh-cn/quick_start/pricing',
    'panel.tariff.',
    'data-balance-tariff',
    'alert.tariff.',
    'data-balance-alert-kind',
    'service.tariff',
    'getSnapshot',
    'showTariff',
    'nextTickDelay',
    'data-balance-runout',
    'data-balance-today-spend',
    'panel.todaySpend',
    // v1.5
    'data-balance-week-spend',
    'panel.weekSpend',
    'spendInWeek',
    'billingWeekOf',
    'alertedAtPeak',
    'alertedAtOffPeak',
    'panel.rateOffPeak',
    // v0.1.6
    'data-balance-recent-spend',
    'panel.recentSpend',
    'spendInWindow',
    'data-balance-version',
    'PLUGIN_VERSION',
    'configKey',
    'formatBillingMoment',
    'RATE_MAX_ELAPSED_MS',
    // v0.2.0
    'data-balance-last-topup',
    'lastTopUpFromSamples',
    'dailyAverage',
    'recordReading',
    'panel.runoutAt',
    'panel.lastTopUp',
    // v0.3.0
    'service.balanceAlertState',
    'data-balance-runway',
    'panel.runway',
    'runwayOf',
    'FUTURE_SKEW_MS',
    'pollChoiceList'
  ]) {
    assert.ok(code.includes(marker), `产物里缺少 ${marker}`)
  }
})

test('产物不残留 ESM 语句、也不 require 未授权的模块', () => {
  const { code } = loadBundle()
  assert.doesNotMatch(code, /^\s*(?:import|export)\s/m)
  const allowed = new Set(['react', 'react-dom', 'react/jsx-runtime', '@deepseek-ai/dsh-client-ui-primitives'])
  for (const match of code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    assert.ok(allowed.has(match[1]), `产物 require 了未授权的模块：${match[1]}`)
  }
})

test('构建脚本能跑通，且产物与源码同步', () => {
  // 源码改了却忘记构建是最容易漏的一步。
  const before = readFileSync(BUNDLE, 'utf8')
  const output = execFileSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs')], { encoding: 'utf8' })
  assert.match(output, /插件 id\s*:\s*dsh-balance-pill/)
  assert.equal(readFileSync(BUNDLE, 'utf8'), before, '产物与源码不同步 —— 源码改了但没重新构建')
})

test('package.json / CHANGELOG / 面板版本常量 / 宿主入口四处一致', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
  const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')
  const top = changelog.match(/^## (\d+\.\d+\.\d+)$/m)
  assert.ok(top !== null, 'CHANGELOG 里应有版本标题')
  assert.equal(top[1], pkg.version, 'CHANGELOG 的最新版本应与 package.json 一致')
  assert.equal(PLUGIN_VERSION, pkg.version, '面板显示的版本必须与 package.json 一致')
  // v0.3.0：宿主侧入口也导出 version（install.mjs --status 与宿主诊断用），
  // 构建脚本同样校验这条 —— 测试与构建互为第二道网。
  assert.equal(libEntry.version, pkg.version, 'lib/index.js 的 version 必须与 package.json 一致')
  assert.equal(libEntry.name, pkg.name)
})

// ============================================================ 看门狗（自愈）

test('createTariffWatcher 首次 tick 记录快照但不提醒', () => {
  const alerts = alertModule.createAlertStore()
  const watcher = tariffService.createTariffWatcher({ alerts, now: () => bj('2026-10-16 10:30') })
  const snap = watcher.tick({ settings: { alertOnTariff: true } })
  assert.equal(snap.period, 'peak')
  assert.equal(alerts.getSnapshot(), null, '首次观测不该弹卡')
  assert.equal(watcher.latest().period, 'peak')
  assert.ok(watcher.lastTickAt() > 0)
})

test('createTariffWatcher 在时段切换时写入共享仓库', () => {
  let now = bj('2026-10-16 11:59')
  const alerts = alertModule.createAlertStore()
  const watcher = tariffService.createTariffWatcher({ alerts, now: () => now })
  watcher.tick({ settings: { alertOnTariff: true } })
  now = bj('2026-10-16 12:01')
  watcher.tick({ settings: { alertOnTariff: true } })
  const card = alerts.getSnapshot()
  assert.ok(card !== null, '跨过 12:00 边界应产出卡片')
  assert.equal(card.kind, 'tariff')
  assert.equal(card.period, 'off-peak')
  assert.equal(card.model, 'deepseek-flash')
})

test('createTariffWatcher 的 drift 识别时钟跳变并在同一拍自愈', () => {
  let real = 1_000_000_000
  let logical = bj('2026-10-16 14:30')
  const alerts = alertModule.createAlertStore()
  // 真实时钟与业务时钟分开：跳变体现在真实时钟上。
  const watcher = tariffService.createTariffWatcher({ alerts, now: () => real })
  watcher.tick({ settings: { alertOnTariff: true }, now: logical })
  assert.equal(watcher.drift().jumped, false, '第一次 tick 不算跳变')

  // 从 14:30 一次性推到 19:00（跨过 18:00 边界），真实时钟也前进 3 小时。
  real += 3 * 3600 * 1000
  logical = bj('2026-10-16 19:00')
  const snap = watcher.tick({ settings: { alertOnTariff: true }, now: logical })
  assert.equal(snap.period, 'off-peak')
  const drift = watcher.drift()
  assert.equal(drift.jumped, true, `时钟跳变应被识别，gapMs=${drift.gapMs}`)
  assert.ok(drift.gapMs > tariffService.TARIFF_MAX_GAP_MS)
  // 自愈：跳变后的第一拍就产出正确的卡片。
  const card = alerts.getSnapshot()
  assert.ok(card !== null, '跳变后的第一拍必须补上卡片')
  assert.equal(card.period, 'off-peak')
})

test('createTariffWatcher 在 TARIFF_MAX_GAP_MS 内不判为跳变', () => {
  let real = 1_000_000_000
  const watcher = tariffService.createTariffWatcher({ alerts: alertModule.createAlertStore(), now: () => real })
  watcher.tick({ settings: {} })
  real += tariffService.TARIFF_TICK_MS
  watcher.tick({ settings: {} })
  assert.equal(watcher.drift().jumped, false)
})

test('nextTickDelay 对齐到下一个时段边界', () => {
  const watcher = tariffService.createTariffWatcher({ alerts: alertModule.createAlertStore() })
  // 距 12:00 还有 90 秒，但一拍最多 30 秒 → 返回 30 秒。
  assert.equal(watcher.nextTickDelay({ now: bj('2026-10-16 11:58:30') }), tariffService.TARIFF_TICK_MS)
  // 距边界 10 秒 → 对齐到 10 秒。
  assert.equal(watcher.nextTickDelay({ now: bj('2026-10-16 11:59:50') }), 10000)
  // 边界前一秒：精确对齐到那一拍。
  assert.equal(watcher.nextTickDelay({ now: bj('2026-10-16 11:59:59') }), 1000)
  // 刚跨过 12:00：下一个变化点是 14:00（两小时后），因此取一拍上限 30 秒，
  // 不会因为「刚过边界」就空转。
  assert.equal(watcher.nextTickDelay({ now: bj('2026-10-16 12:00:00') }), tariffService.TARIFF_TICK_MS)
})

test('nextTickDelay 的返回值恒落在 [0, TARIFF_TICK_MS]', () => {
  const watcher = tariffService.createTariffWatcher({ alerts: alertModule.createAlertStore() })
  for (let minute = 0; minute < 24 * 60; minute += 7) {
    const at = bj('2026-10-16 00:00') + minute * 60000
    const delay = watcher.nextTickDelay({ now: at })
    assert.ok(delay >= 0 && delay <= tariffService.TARIFF_TICK_MS, `${minute} 分钟的 delay=${delay}`)
  }
})

test('createTariffWatcher 在 alertOnTariff 关闭时推进状态但不弹卡', () => {
  let now = bj('2026-10-16 11:59')
  const alerts = alertModule.createAlertStore()
  const watcher = tariffService.createTariffWatcher({ alerts, now: () => now })
  watcher.tick({ settings: { alertOnTariff: false } })
  now = bj('2026-10-16 12:01')
  watcher.tick({ settings: { alertOnTariff: false } })
  assert.equal(alerts.getSnapshot(), null, '关掉开关不该弹卡')
  assert.equal(watcher.state().period, 'off-peak', '但状态必须跟上')
})

test('createTariffWatcher 的任何方法都不抛错（垃圾入参）', () => {
  const watcher = tariffService.createTariffWatcher()
  assert.doesNotThrow(() => watcher.tick())
  assert.doesNotThrow(() => watcher.tick({ settings: null, now: 'x' }))
  assert.doesNotThrow(() => watcher.snapshot())
  assert.doesNotThrow(() => watcher.nextTickDelay())
  assert.notEqual(watcher.latest(), undefined)
})

test('TARIFF_MAX_GAP_MS 是 2 倍 tick 间隔', () => {
  assert.equal(tariffService.TARIFF_MAX_GAP_MS, tariffService.TARIFF_TICK_MS * 2)
})

// ============================================================== 组件导出形状

test('pill.js 的两条 v0.1.6 接线还在（速度保留 / 配置键）', () => {
  const source = readFileSync(join(SRC, 'pill.js'), 'utf8')
  // 改设置的重算路径必须把已有速度显式传给 refreshedViewModel；否则同一份读数
  // 会让 elapsed=0，速度变 null，行消失。
  assert.match(source, /rate:\s*prev\.model\.rate/)
  // 速度基准必须经过 rateBaseline，不能退回「每次成功都覆盖」。
  assert.match(source, /rateBaseline\(previous\.current/)
  // 余额提醒必须带 configKey，否则切口径会弹假提醒。
  assert.match(source, /configKey:\s*`\$\{current\.format\}/)
})

test('pill.js 的 v0.2.0 接线还在（读数槽位 / 最近充值 / 日均 / 耗尽后缀）', () => {
  const source = readFileSync(join(SRC, 'pill.js'), 'utf8')
  // publish 成功读数必须写共享读数槽位：readings.js 的写入端在 v1.4 建好后
  // 从未被调用过，看门狗的峰谷预估因此全部静默为空 —— 这条锚住修复不回退。
  assert.match(source, /recordReading\(\{/)
  // 面板「最近充值」走 lastTopUpFromSamples；「近 7 天」行带 dailyAverage。
  assert.match(source, /lastTopUpFromSamples\(samples/)
  assert.match(source, /daily:\s*formatMoney\(recent\.dailyAverage/)
  // 速度行在 24 小时内耗尽时追加「约 {time} 耗尽」。
  assert.match(source, /panel\.runoutAt/)
})

test('readings 槽位：record / latest / reset，非法金额整体忽略（v0.2.0）', async () => {
  const readings = await import(pathToFileURL(join(SRC, 'readings.js')).href)
  readings.resetReading()
  assert.equal(readings.latestReading(), null)
  readings.recordReading({ amount: 12.5, currency: 'CNY', at: 123, perHour: 1.5 })
  assert.deepEqual(readings.latestReading(), { amount: 12.5, currency: 'CNY', at: 123, perHour: 1.5 })
  // 覆盖写；currency 缺省空串、perHour 非正归 null（与 balance.js 的口径一致）。
  readings.recordReading({ amount: 10, at: 456, perHour: 0 })
  assert.deepEqual(readings.latestReading(), { amount: 10, currency: '', at: 456, perHour: null })
  // 非法金额的写入被整体忽略（不能只更新部分字段）。
  readings.recordReading({ amount: Number.NaN, at: 789 })
  assert.equal(readings.latestReading().at, 456)
  readings.recordReading(null)
  assert.equal(readings.latestReading().at, 456)
  readings.resetReading()
  assert.equal(readings.latestReading(), null)
})

test('CLIENT_VERSION 跟随宿主 0.2.x 系列（v0.2.0 对齐 0.2.1）', () => {
  // v0.2.0 审计发现上报版本停留在 0.2.0-rc.2，而宿主已发布 0.2.1-rc.1；
  // 该版本只用于平台侧统计界面来源，不参与鉴权，但过期会让统计失真。
  assert.equal(balance.CLIENT_VERSION, '0.2.1')
})

test('候选边界缓存：同一天结果一致，自定义日历绕过缓存（v0.2.0）', () => {
  const friday = bj('2026-10-16 10:00')
  const first = pricing.pricingSnapshot({ now: friday })
  const second = pricing.pricingSnapshot({ now: friday + 12345 })
  // 缓存命中的那次调用，边界结论必须与首次完全一致。
  assert.equal(second.nextPeakAt, first.nextPeakAt)
  assert.equal(second.nextOffPeakAt, first.nextOffPeakAt)
  assert.deepEqual(second.offPeakWindow, first.offPeakWindow)
  assert.equal(second.reason, first.reason)

  // 自定义日历必须绕过缓存：同一时刻、两张不同的表，结论必须跟着表走 ——
  // 若把第一张表的结果喂给第二张，调休补班日会被静默判成空闲。
  const saturday = bj('2026-10-17 10:00')
  const empty = pricing.pricingSnapshot({ now: saturday, holidays: {} })
  const makeup = pricing.pricingSnapshot({ now: saturday, holidays: { '2026-10-17': 0 } })
  assert.equal(empty.period, 'off-peak')
  assert.equal(makeup.period, 'peak')
})

test('组件导出形状正确', () => {
  for (const component of [BalancePill, BalanceSettingsRow, TrendSparkline, BalanceAlert]) {
    assert.equal(typeof component, 'function')
  }
})

test('产物里带着价格表与节假日数据', () => {
  const { code } = loadBundle()
  // 价格表必须逐项出现在产物里。
  assert.ok(code.includes('13.5'), 'pro 的空闲输出单价应在产物里')
  assert.ok(code.includes('27'), 'pro 的高峰输出单价应在产物里')
  // 节假日数据在产物里（抽查 2026 国庆）。
  assert.ok(code.includes('2026-10-01'), '节假日日历应打进产物')
})

// ================================================================ v0.3.0

test('runwayOf 按日均估算可用天数，超出 30 天不展示（v0.3.0）', () => {
  // 用二进制精确的数字断言等式（19.1 / 1.91 会得到 10.000000000000002）。
  assert.equal(history.runwayOf(10, 2), 5)
  assert.equal(history.runwayOf(19.1, 1.91) > 9.99 && history.runwayOf(19.1, 1.91) < 10.01, true)
  // 带小数的天数原样返回，格式化交给展示层。
  assert.equal(history.runwayOf(5, 2), 2.5)
  // 余额 / 日均任一非正或非法都不给结论 —— 「不知道」不冒充一个数。
  assert.equal(history.runwayOf(0, 1.91), null)
  assert.equal(history.runwayOf(-5, 1.91), null)
  assert.equal(history.runwayOf(19.1, 0), null)
  assert.equal(history.runwayOf(null, 1.91), null)
  assert.equal(history.runwayOf(19.1, null), null)
  assert.equal(history.runwayOf('19.1', 1.91), null)
  // 超出展示窗口（RUNWAY_MAX_DAYS = 30）返回 null：天天挂一句
  // 「还能用 300 天」只是噪音，与耗尽预估只看 24 小时内是同一条纪律。
  assert.equal(history.runwayOf(100, 1), null)
  assert.equal(history.runwayOf(30, 1), 30, '恰好 30 天仍要展示（边界含在内）')
})

test('normalizeHistory 丢弃落在未来的样本（时钟回拨防护，v0.3.0）', () => {
  const now = 1_000_000_000
  const skew = now + history.FUTURE_SKEW_MS
  // 留 5 分钟余量是给写/读两端的时钟误差；超过它的只可能是坏数据。
  const ok = history.normalizeHistory([sample(now - 5000, 10), sample(skew - 1, 9)], now)
  assert.deepEqual(ok.map((s) => s.amount), [10, 9])
  const cleaned = history.normalizeHistory([sample(now - 5000, 10), sample(skew + 1, 99)], now)
  assert.deepEqual(cleaned.map((s) => s.amount), [10])
})

test('appendSample 拒绝未来时刻的新样本（v0.3.0）', () => {
  const now = 1_000_000_000
  const base = history.appendSample([], sample(now - 120000, 10), now)
  const next = history.appendSample(base, sample(now + history.FUTURE_SKEW_MS + 1, 8), now)
  assert.equal(next.length, 1)
  assert.equal(next[0].amount, 10, '未来样本不得进入历史，否则历史从此停止前进')
})

test('pollChoiceList 把非档位的当前值并进选项并保持升序（v0.3.0）', () => {
  // 档位内的值原样返回。
  assert.deepEqual(settingsModule.pollChoiceList(60000), [0, 30000, 60000, 300000])
  // 存储里存过 15000（归一化允许任意 ≥5000）时，受控下拉否则开天窗。
  assert.deepEqual(settingsModule.pollChoiceList(15000), [0, 15000, 30000, 60000, 300000])
  assert.deepEqual(settingsModule.pollChoiceList(5000), [0, 5000, 30000, 60000, 300000])
  // 非法输入退回纯档位列表。
  assert.deepEqual(settingsModule.pollChoiceList(Number.NaN), [0, 30000, 60000, 300000])
  assert.deepEqual(settingsModule.pollChoiceList('60000'), [0, 30000, 60000, 300000])
})

/** 组一份可直接渲染 BalancePanel 的最小视图模型。 */
function runwayModel(primary) {
  return {
    status: 'ready',
    signedIn: true,
    summary: {
      currency: 'CNY',
      recharge: primary,
      bonus: 0,
      total: primary,
      primary,
      wallets: [],
      bonusWallets: [],
      otherWallets: []
    },
    format: 'total',
    primary,
    level: 'ok',
    thresholds: { low: 3, warn: 10 },
    topUpUrl: null,
    at: Date.now(),
    ageMs: 0,
    stale: false,
    rate: null,
    effective: true
  }
}

test('面板「余额跑道」行：出现、缺席与跟随 showRate（v0.3.0）', () => {
  const settings = { ...settingsModule.DEFAULT_SETTINGS }
  const derived = (dailyAverage) => ({
    trend: null,
    spend: null,
    today: null,
    week: null,
    recent:
      dailyAverage === null
        ? null
        : { spent: dailyAverage * 7, dailyAverage, currency: 'CNY', firstAt: 1, lastAt: 2, samples: 10 },
    lastTopUp: null
  })
  const render = (model, derivedArg, overrides = {}) =>
    BalancePanel({
      model,
      settings: { ...settings, ...overrides },
      locale: 'zh-CN',
      t,
      busy: false,
      onRefresh: () => {},
      position: null,
      panelRef: { current: null },
      derived: derivedArg,
      pricing: null
    })
  const runwayOf = (tree) => findAll(tree, (node) => node.props?.['data-balance-runway'] === true)

  // 日均 ¥1.91、余额 ¥19.10 → 约 10 天 → 展示。
  const shown = runwayOf(render(runwayModel(19.1), derived(1.91)))
  assert.equal(shown.length, 1)
  assert.ok(String(shown[0].props.children).includes('1.91'), '跑道行要带日均金额')

  // 跑道超出 30 天 → 不渲染（runwayOf 的上限，面板不再判一次）。
  assert.equal(runwayOf(render(runwayModel(100), derived(1))).length, 0)

  // 没有「近 7 天」统计（样本不足）→ 不渲染。
  assert.equal(runwayOf(render(runwayModel(19.1), derived(null))).length, 0)

  // 关掉「显示消耗速度」→ 不渲染（与耗尽预估同一开关，不新增设置项）。
  assert.equal(runwayOf(render(runwayModel(19.1), derived(1.91), { showRate: false })).length, 0)
})

test('面板规则行与设置说明不再写死 ¥（v0.3.0）', () => {
  // 词条模板里不再有「¥{」：符号由组件按当前钱包币种给出。
  assert.ok(!zh['panel.rule'].includes('¥{'), 'panel.rule 不该写死 ¥')
  assert.ok(!zh['settings.thresholds.description'].includes('¥{'))
  assert.ok(!en['panel.rule'].includes('¥{'))
  assert.ok(!en['settings.thresholds.description'].includes('¥{'))

  // 渲染：人民币钱包 → 规则行带 ¥；无读数 → 只给数字。
  const settings = { ...settingsModule.DEFAULT_SETTINGS }
  const render = (model) =>
    BalancePanel({
      model,
      settings,
      locale: 'zh-CN',
      t,
      busy: false,
      onRefresh: () => {},
      position: null,
      panelRef: { current: null },
      derived: { trend: null, spend: null, today: null, week: null, recent: null, lastTopUp: null },
      pricing: null
    })
  const ruleText = (model) => {
    const nodes = findAll(render(model), (node) => node.props?.className === 'dbp_meta' && node.props?.key === 'rule-text')
    assert.equal(nodes.length, 1)
    return String(nodes[0].props.children)
  }
  assert.ok(ruleText(runwayModel(19.1)).includes('¥3'), '人民币钱包的规则行应带 ¥ 符号')
  assert.ok(!ruleText(null).includes('¥'), '没有读数时规则行不该冒充一个币种')
})

test('v0.3.0 接线：余额提醒状态机由 service 持有（跨会话存活）', () => {
  const pillSrc = readFileSync(join(SRC, 'pill.js'), 'utf8')
  // 写入端与回写端都要在：advanceAlert 是纯函数，漏掉回写等于没修。
  assert.ok(pillSrc.includes('service.balanceAlertState ?? (service.balanceAlertState = createAlertState())'))
  assert.ok(pillSrc.includes('service.balanceAlertState = outcome.state'))
  assert.ok(!pillSrc.includes('React.useRef(createAlertState())'), '状态机不得再住在组件 ref 里')
  const indexSrc = readFileSync(join(SRC, 'index.js'), 'utf8')
  assert.ok(indexSrc.includes('service.balanceAlertState = createAlertState()'), '入口应创建账号级状态机')
})

test('「余额跑道」等新词条键在中英两版里都有（v0.3.0）', () => {
  for (const key of ['panel.runway']) {
    assert.ok(typeof zh[key] === 'string', `zh 缺少 ${key}`)
    assert.ok(typeof en[key] === 'string', `en 缺少 ${key}`)
  }
  assert.ok(zh['panel.runway'].includes('{duration}'))
})

test('package.json 声明图标且文件真实存在（v0.3.0）', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.icon, './icon.svg')
  assert.ok(pkg.files.includes('icon.svg'), '发布文件清单应包含 icon.svg')
  assert.ok(existsSync(join(ROOT, 'icon.svg')), 'icon.svg 应真实存在')
})
