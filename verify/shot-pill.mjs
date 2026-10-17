/**
 * 余额徽章 —— 真实 GUI 验证台。
 *
 * 用独立 Electron 打开正在运行的 DSH Web GUI（同源 cookie 由 .credentials.yaml 里的
 * 会话密钥现场签出），关掉首次运行弹窗，进入一个已有会话，然后按变体逐个验证：
 *   1. 断言 composer 状态行里出现了 [data-balance-pill]，读回档位、文案、计算色值，
 *      以及它与相邻元素（统计胶囊 / 上下文环）的先后顺序；
 *   2. 点击徽章，断言展开面板里的充值/赠金/合计行与充值入口；
 *   3. 离屏截图（收起态 + 展开态）与一份 JSON 证据。
 *
 * 变体用于在不动真实余额的前提下验证三档配色与深色主题：写 localStorage 里的
 * 阀值覆盖（插件文档公开的旋钮），刷新后重新读取。
 *
 * 之所以不用宿主自带的 shot.mjs：它只能截图，不能驱动界面，而徽章只在
 * 「已有会话 + 输入框下方状态行」里出现，必须先点开一个会话才看得到。
 *
 * 用法（注意先清掉 DSH 导出的 ELECTRON_RUN_AS_NODE，否则 electron.exe 会退化成 node）：
 *   $env:ELECTRON_RUN_AS_NODE = $null
 *   .\electron\electron.exe shot-pill.mjs --url=http://127.0.0.1:19387/ \
 *       --out=out/pill.png --session=某会话标题 \
 *       --variants=[{"name":"low"},{"name":"warn","thresholds":{"low":0.5,"warn":2}},{"name":"dark","dark":true}]
 */
import { app, BrowserWindow, session } from 'electron'
import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
// 只借节假日**数据**（事实表），判定逻辑在下面独立重写一遍 —— 见 expectTariff。
import { CHINA_HOLIDAYS } from '../src/client/calendars.js'

const HERE = import.meta.dirname
const USER_DATA = path.join(HERE, 'userdata')
const LOG_FILE = path.join(HERE, 'out', 'harness.log')

/**
 * 验证台是「用完即走」的脚本，绝不能把异常抛成 Electron 的默认主进程错误弹窗。
 *
 * 典型触发场景：调用方用 `| Select-Object -First N` 之类的方式提前关掉了管道，
 * 主进程下一次写 stdout 就拿到 EPIPE。Electron 对未捕获的主进程异常会弹一个
 * 模态对话框，进程会一直卡在那里等用户点「确定」——必须在这里兜住：
 *   1. stdout/stderr 挂 error 监听，吞掉 EPIPE；
 *   2. uncaughtException / unhandledRejection 写进日志后主动退出。
 */
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
let stdoutBroken = false
let logFileBroken = false

function appendLog (line) {
  if (logFileBroken) return
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch {
    logFileBroken = true
  }
}

/** 清空上一次运行留下的日志（验证台的日志按次读取，不追加）。 */
try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.writeFileSync(LOG_FILE, '')
} catch {
  logFileBroken = true
}

process.on('uncaughtException', (error) => {
  appendLog('UNCAUGHT ' + (error?.stack ?? String(error)))
  app.exit(9)
})
process.on('unhandledRejection', (error) => {
  appendLog('UNHANDLED ' + (error?.stack ?? String(error)))
})

// ---------------------------------------------------------------- arguments
function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const eq = a.indexOf('=')
    if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue }
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) out[key] = true
    else { out[key] = next; i++ }
  }
  return out
}

const args = parseArgs(process.argv.slice(2))
const URL_TO_LOAD = args.url ?? 'http://127.0.0.1:19387/'
const OUT_PNG = path.resolve(HERE, args.out ?? path.join('out', 'pill.png'))
const OUT_JSON = path.resolve(HERE, args.json ?? OUT_PNG.replace(/\.png$/i, '.json'))
const WIDTH = Number(args.width ?? 1600)
const HEIGHT = Number(args.height ?? 1000)
const SESSION_HINT = typeof args.session === 'string' ? args.session : null
const WATCHDOG_MS = Number(args.watchdog ?? 240000)
const VARIANTS = typeof args.variants === 'string'
  ? JSON.parse(args.variants)
  : typeof args['variants-file'] === 'string'
    ? JSON.parse(fs.readFileSync(path.resolve(HERE, args['variants-file']), 'utf8'))
    : null

const logLines = []
function log (...parts) {
  const line = parts.join(' ')
  logLines.push(line)
  if (!stdoutBroken) {
    try {
      console.log(line)
    } catch {
      stdoutBroken = true
    }
  }
  appendLog(line)
}

setTimeout(() => {
  log(`WATCHDOG: 超过 ${WATCHDOG_MS} ms，强制退出`)
  app.exit(4)
}, WATCHDOG_MS).unref?.()

// ------------------------------------------------------- cookie minting
const DSH_HOME = process.env.DSH_HOME ?? 'C:\\Users\\李\\.dsh'
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml')
const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function readSigningSecret (file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim() === 'client-connection/browser-session:')
  if (at === -1) throw new Error('credentials: 没有 client-connection/browser-session 记录')
  const indent = lines[at].length - lines[at].trimStart().length
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (lines[i].length - lines[i].trimStart().length <= indent) break
    const m = /^\s*secret:\s*(\S+)\s*$/.exec(lines[i])
    if (m) {
      const key = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      if (key.byteLength !== 32) throw new Error(`credentials: secret 为 ${key.byteLength} 字节，期望 32`)
      return key
    }
  }
  throw new Error('credentials: browser-session secret 缺失')
}

function mintCookieFor (base) {
  const url = new URL(base)
  const authority = url.host
  const key = readSigningSecret(CREDENTIALS_FILE)
  const issuedAt = Date.now()
  // 有效期以毫秒计（30 天）。写成 30*1440*60*60*1000 会得到 4.9 年，
  // 宿主按窗口校验会直接判 401 —— 这正是本文件曾踩过的坑。
  const expiresAt = issuedAt + 30 * 1440 * 60 * 1000
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'))
  const signature = b64url(createHmac('sha256', key).update(body).digest())
  const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
  return { authority, name, value: `v1.${body}.${signature}`, header: `${name}=v1.${body}.${signature}`, origin: url.origin }
}

// ---------------------------------------------------------------- DOM 脚本

const SNAPSHOT = `(() => {
  const pill = document.querySelector('[data-balance-pill]')
  return {
    elementCount: document.body ? document.body.querySelectorAll('*').length : -1,
    hasBoot: typeof globalThis.__DSH_BOOT__ !== 'undefined',
    hasStats: document.querySelector('[data-composer-stats]') !== null,
    hasPill: pill !== null,
    pillStatus: pill ? pill.getAttribute('data-status') : undefined,
    pillLevel: pill ? pill.getAttribute('data-level') : undefined,
    modalOpen: document.querySelector('[role="dialog"]') !== null
  }
})()`

const DISMISS_OVERLAY = `(() => {
  const wanted = ['继续', '知道了', '我知道了', '开始设置', '跳过', '关闭', '确定']
  const nodes = [...document.querySelectorAll('button, [role="button"]')]
  const hit = nodes.find((el) => wanted.includes((el.textContent || '').trim()))
  if (!hit) return null
  const rect = hit.getBoundingClientRect()
  const x = rect.left + rect.width / 2
  const y = rect.top + rect.height / 2
  const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 }
  hit.dispatchEvent(new PointerEvent('pointerdown', base))
  hit.dispatchEvent(new MouseEvent('mousedown', base))
  hit.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
  hit.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
  hit.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }))
  return (hit.textContent || '').trim()
})()`

const SESSION_CANDIDATES = `(() => {
  const nodes = [...document.querySelectorAll('button, [role="button"], [role="treeitem"], a[href]')]
  return nodes.map((el) => {
    const text = (el.textContent || '').replace(/\\s+/g, ' ').trim()
    const rect = el.getBoundingClientRect()
    return { tag: el.tagName.toLowerCase(), cls: el.className && typeof el.className === 'string' ? el.className : '', text: text.slice(0, 60), x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) }
  }).filter((row) => row.text.length > 1 && row.w > 60 && row.h > 12 && row.y > 0)
})()`

function clickScript (needle) {
  return `(() => {
  const nodes = [...document.querySelectorAll('button, [role="button"], [role="treeitem"], a[href]')]
  const hit = nodes.find((el) => (el.textContent || '').replace(/\\s+/g, ' ').includes(${JSON.stringify(needle)}))
  if (!hit) return null
  hit.scrollIntoView({ block: 'center' })
  const rect = hit.getBoundingClientRect()
  const x = rect.left + 24
  const y = rect.top + rect.height / 2
  const target = document.elementFromPoint(x, y) ?? hit
  const base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: 1 }
  target.dispatchEvent(new PointerEvent('pointerdown', base))
  target.dispatchEvent(new MouseEvent('mousedown', base))
  target.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('mouseup', { ...base, buttons: 0 }))
  target.dispatchEvent(new MouseEvent('click', { ...base, buttons: 0 }))
  return (hit.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80)
})()`
}

const INSPECT = `(() => {
  const pill = document.querySelector('[data-balance-pill]')
  const row = document.querySelector('[data-composer-stats]')
  const slotParent = row ? row.parentElement : null
  const dock = slotParent ? slotParent.parentElement : null
  const round = (n) => Math.round(n)
  const describe = (el) => {
    if (!el) return null
    const rect = el.getBoundingClientRect()
    const style = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      cls: el.className && typeof el.className === 'string' ? el.className : '',
      text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 80),
      display: style.display,
      order: style.order,
      color: style.color,
      background: style.backgroundColor,
      opacity: style.opacity,
      textDecoration: style.textDecorationLine,
      fontSize: style.fontSize,
      dark: document.body.hasAttribute('data-ds-dark-theme'),
      rect: { x: round(rect.x), y: round(rect.y), w: round(rect.width), h: round(rect.height) }
    }
  }
  const trigger = pill ? pill.querySelector('.dbp_trigger') : null
  const styleTag = document.querySelector('style[data-plugin-css="dsh-balance-pill/client.css"]')
  let stored = null
  try { stored = localStorage.getItem('dsh-balance-pill:settings') } catch { /* ignore */ }
  return {
    pillFound: pill !== null,
    pillAttrs: pill ? {
      level: pill.getAttribute('data-level'),
      status: pill.getAttribute('data-status'),
      stale: pill.getAttribute('data-stale'),
      compact: pill.getAttribute('data-compact'),
      session: pill.getAttribute('data-balance-session')
    } : null,
    pill: describe(pill),
    trigger: describe(trigger),
    triggerAria: trigger ? trigger.getAttribute('aria-label') : null,
    triggerExpanded: trigger ? trigger.getAttribute('aria-expanded') : null,
    iconPaths: trigger ? [...trigger.querySelectorAll('svg path')].length : 0,
    statsRow: describe(row),
    slotParent: describe(slotParent),
    dock: describe(dock),
    dockItems: dock === null ? null : [...dock.children].map((child) => ({
      ...describe(child),
      hasPill: child.matches('[data-balance-pill]') || child.querySelector('[data-balance-pill]') !== null
    })),
    styleTagInjected: styleTag !== null,
    stored,
    statsText: row ? (row.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120) : null
  }
})()`

const INSPECT_PANEL = `(() => {
  const panel = document.querySelector('[data-balance-panel]')
  if (!panel) return { panelFound: false }
  const rect = panel.getBoundingClientRect()
  const rows = [...panel.querySelectorAll('[data-balance-field]')].map((el) => ({ field: el.getAttribute('data-balance-field'), text: (el.textContent || '').trim() }))
  const hint = panel.querySelector('.dbp_hint')
  const link = panel.querySelector('.dbp_topUp')
  const style = getComputedStyle(panel)
  const stale = panel.querySelector('[data-balance-stale]')
  const spend = panel.querySelector('[data-balance-spend]')
  const trend = panel.querySelector('[data-balance-trend]')
  const spark = trend === null ? null : trend.querySelector('.dbp_sparkLine')
  return {
    panelFound: true,
    rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
    title: (panel.querySelector('.dbp_panelTitle')?.textContent ?? '').trim(),
    background: style.backgroundColor,
    rows,
    stale: stale === null ? null : stale.textContent.trim(),
    spend: spend === null ? null : spend.textContent.trim(),
    trend: trend === null
      ? null
      : {
          tone: trend.getAttribute('data-tone'),
          // 折线的实际包围盒：能拿到就说明真的画出来了，而不只是挂了个空 svg。
          lineBox: (() => { const r = spark.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) } })(),
          d: spark.getAttribute('d'),
          min: trend.querySelector('[data-balance-trend-min]')?.textContent ?? null,
          max: trend.querySelector('[data-balance-trend-max]')?.textContent ?? null
        },
    hint: hint ? { level: hint.getAttribute('data-level'), text: hint.textContent.trim() } : null,
    meta: [...panel.querySelectorAll('.dbp_meta')].map((el) => el.textContent.trim()),
    topUpHref: link ? link.getAttribute('href') : null,
    text: (panel.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 400)
  }
})()`

const INSPECT_ALERT = `(() => {
  // 提醒可能由宿主 Toast 渲染（portal 到 body、无插件专属属性），也可能由
  // 自带兜底卡片渲染（带 [data-balance-alert]）。两种都认，用文案兜住前者。
  const own = document.querySelector('[data-balance-alert]')
  const overlay = document.querySelector('[data-shell-overlay]')
  const overlayText = overlay === null ? '' : (overlay.textContent || '').replace(/\\s+/g, ' ').trim()
  // 宿主 Toast module CSS 类名带哈希，只能按「含提醒文案的浮层节点」定位。
  const candidates = [...document.querySelectorAll('body > div')]
    .filter((el) => /余额|balance/i.test(el.textContent || '') && /充值|中断|偏低|不足|empty|low/i.test(el.textContent || ''))
    .map((el) => {
      const rect = el.getBoundingClientRect()
      const style = getComputedStyle(el)
      return {
        text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        zIndex: style.zIndex,
        position: style.position
      }
    })
    .filter((row) => row.rect.w > 0 && row.rect.h > 0)
  return {
    ownCardFound: own !== null,
    ownCardLevel: own === null ? null : own.getAttribute('data-level'),
    ownCardText: own === null ? null : (own.textContent || '').replace(/\\s+/g, ' ').trim(),
    overlayText: overlayText.slice(0, 200),
    hostToastCandidates: candidates,
    toastPrimitiveBound: globalThis.__DBP_TOAST__ !== undefined && globalThis.__DBP_TOAST__ !== null
  }
})()`

const TARIFF_INSPECT = `(() => {
  const pill = document.querySelector('[data-balance-pill]')
  if (pill === null) return { pillFound: false }
  const flat = (el) => el === null || el === undefined ? null : (el.textContent || '').replace(/\\s+/g, ' ').trim()
  const badge = pill.querySelector('.dbp_tariff')
  const badgeStyle = badge === null ? null : getComputedStyle(badge)
  const badgeRect = badge === null ? null : badge.getBoundingClientRect()
  const panel = document.querySelector('[data-balance-panel]')
  const block = (name) => panel === null ? null : flat(panel.querySelector('[data-balance-tariff-' + name + ']'))
  const panelBadge = panel === null ? null : panel.querySelector('.dbp_tariffBadge')
  const order = []
  if (panel !== null) {
    for (const el of panel.querySelectorAll('[data-balance-tariff-row],[data-balance-tariff-note],[data-balance-tariff-next],[data-balance-tariff-window],[data-balance-tariff-reason],[data-balance-tariff-price],[data-balance-tariff-save],[data-balance-tariff-lasts],[data-balance-tariff-calendar]')) {
      for (const key of ['row', 'note', 'next', 'window', 'reason', 'price', 'save', 'lasts', 'calendar']) {
        if (el.hasAttribute('data-balance-tariff-' + key)) { order.push(key); break }
      }
    }
  }
  let stored = null
  try { stored = localStorage.getItem('dsh-balance-pill:settings') } catch { /* ignore */ }
  return {
    pillFound: true,
    period: pill.getAttribute('data-tariff'),
    reason: pill.getAttribute('data-tariff-reason'),
    session: pill.getAttribute('data-balance-session'),
    badge: badge === null ? null : {
      attr: badge.getAttribute('data-balance-tariff'),
      text: flat(badge),
      title: badge.getAttribute('title'),
      aria: badge.getAttribute('aria-label'),
      fontSize: badgeStyle.fontSize,
      color: badgeStyle.color,
      background: badgeStyle.backgroundColor,
      radius: badgeStyle.borderRadius,
      rect: { w: Math.round(badgeRect.width), h: Math.round(badgeRect.height) }
    },
    panelFound: panel !== null,
    hasRate: panel !== null && panel.querySelector('[data-balance-rate]') !== null,
    panelBadge: panelBadge === null ? null : { attr: panelBadge.getAttribute('data-tariff'), text: flat(panelBadge) },
    blocks: {
      row: block('row'), note: block('note'), next: block('next'), window: block('window'),
      reason: block('reason'), price: block('price'), save: block('save'), lasts: block('lasts'),
      calendar: block('calendar')
    },
    order,
    panelText: panel === null ? null : flat(panel).slice(0, 400),
    stored,
    // ---- v1.4 ----
    // 余额耗尽预估：只在「有读数 + 有速度 + 24 小时内」时存在。
    runout: pill.getAttribute('data-balance-runout'),
    runoutTitle: (() => {
      const trigger = pill.querySelector('.dbp_trigger')
      return trigger === null ? null : trigger.getAttribute('title')
    })(),
    // 「今日已用」：它由历史采样算出，与趋势图开关无关。
    // 注意属性名是 data-balance-today-spend（**没有** tariff 前缀），
    // 不能用上面那个 tariff 专用的 block() 去取。
    // （本行在模板字符串里，注释中不要出现反引号 —— 那会提前结束模板。）
    todaySpend: panel === null ? null : flat(panel.querySelector('[data-balance-today-spend]')),
    // v0.1.6：本周 / 近 7 天 / 版本号 / 面板限高滚动。
    weekSpend: panel === null ? null : flat(panel.querySelector('[data-balance-week-spend]')),
    recentSpend: panel === null ? null : flat(panel.querySelector('[data-balance-recent-spend]')),
    version: panel === null ? null : flat(panel.querySelector('[data-balance-version]')),
    panelScroll: panel === null
      ? null
      : {
          scrollHeight: panel.scrollHeight,
          clientHeight: panel.clientHeight,
          overflowY: getComputedStyle(panel).overflowY,
          top: Math.round(panel.getBoundingClientRect().top),
          bottom: Math.round(panel.getBoundingClientRect().bottom)
        },
    hasTrend: panel !== null && panel.querySelector('.dbp_trend') !== null,
    now: Date.now()
  }
})()`

/** 把页面里的 `Date.now` 固定到「真实时间 + offset」；只在验证台里用，随后必须还原。 */
const INJECT_CLOCK = (offset) => `(() => {
  if (window.__v13RealNow === undefined) window.__v13RealNow = Date.now
  const base = window.__v13RealNow()
  Date.now = () => base + ${offset}
  return { injectedNow: base + ${offset}, realNow: base }
})()`

const RESTORE_CLOCK = `(() => {
  if (window.__v13RealNow !== undefined) { Date.now = window.__v13RealNow; delete window.__v13RealNow }
  return true
})()`

const NEXT_TEXT = `(() => {
  const el = document.querySelector('[data-balance-tariff-next]')
  return el === null ? null : el.textContent.trim()
})()`

/**
 * 时段提醒卡的实测快照。
 *
 * 卡片有两条渲染路径：宿主 `Toast`（portal 到 body、类名带哈希、只有文本）与
 * 自带兜底卡片（带 `data-balance-alert`）。两条都要能认出来，因此除了专用属性，
 * 还按**文案**在页面里找最小的那个元素 —— 那就是卡片的正文节点。
 */
/**
 * 读时段看门狗自报的时钟漂移（v1.4 新增的诊断字段）。
 *
 * 看门狗由 `service.tariff` 暴露，而 service 是通过挂载点注入组件 props 的；
 * 页面里没有全局引用，因此从 DOM 节点的 React fiber 上溯到根、DFS 找那个
 * props 上带 `tariff` 的组件（与 probe-tariff-alert.mjs 用的是同一手法）。
 * 全程只读，不改任何状态。
 */
const TARIFF_DRIFT = `(() => {
  const keyOf = (node) => Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
  const anchor = document.querySelector('[data-balance-pill]') ?? document.body.firstElementChild
  if (anchor === null) return null
  const key = keyOf(anchor)
  if (key === undefined) return null
  let root = anchor[key]
  let guard = 0
  while (root.return !== null && root.return !== undefined && guard++ < 500) root = root.return
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited++ < 50000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined) continue
    const props = fiber.memoizedProps
    if (props !== null && props !== undefined) {
      const tariff = props.tariff
      if (tariff !== null && tariff !== undefined && typeof tariff.drift === 'function') {
        try {
          return { drift: tariff.drift(), lastTickAt: tariff.lastTickAt(), state: tariff.state(), found: true }
        } catch (error) {
          return { found: true, error: String(error && error.message ? error.message : error) }
        }
      }
    }
    if (fiber.child !== null && fiber.child !== undefined) stack.push(fiber.child)
    if (fiber.sibling !== null && fiber.sibling !== undefined) stack.push(fiber.sibling)
  }
  return null
})()`

const TARIFF_ALERT_INSPECT = `(() => {  const flat = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()
  const own = document.querySelector('[data-balance-alert]')
  const ownTariff = document.querySelector('[data-balance-alert-kind="tariff"]')
  const wanted = /进入高峰时段|进入空闲时段|Peak hours started|Off-peak hours started/
  const matches = [...document.querySelectorAll('body *')]
    .filter((el) => wanted.test(el.textContent || ''))
    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '', text: flat(el).slice(0, 200), kids: el.children.length }))
    .filter((row) => row.text.length > 0 && row.text.length < 160)
    .sort((a, b) => a.text.length - b.text.length || a.kids - b.kids)
    .slice(0, 3)
  const overlay = document.querySelector('[data-shell-overlay]')
  return {
    overlayPresent: overlay !== null,
    overlayText: overlay === null ? '' : flat(overlay).slice(0, 300),
    ownKind: ownTariff === null ? null : ownTariff.getAttribute('data-balance-alert-kind'),
    ownPeriod: ownTariff === null ? null : ownTariff.getAttribute('data-period'),
    ownText: own === null ? null : flat(own).slice(0, 200),
    overlayText: overlay === null ? '' : flat(overlay).slice(0, 300),
    toastPrimitiveBound: globalThis.__DBP_TOAST__ !== undefined && globalThis.__DBP_TOAST__ !== null,
    matches
  }
})()`

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// ---------------------------------------------------- 设置面板（改设置走真实控件）
//
// 配置 store 在内存里，只有经由 UI 改动才会同步到组件（直接写 localStorage 要等下次
// 页面加载才生效）。v1.2 余额提醒的回归必须走这条路。

/** 打开设置面板：点侧边栏底部的「设置」或标题栏的齿轮。 */
const OPEN_SETTINGS = `(() => {
  const byText = [...document.querySelectorAll('button, [role="button"], [role="tab"]')]
    .find((el) => /^(设置|Settings)$/.test((el.textContent || '').trim()))
  if (byText) { byText.click(); return 'text:' + (byText.textContent || '').trim() }
  const gear = document.querySelector('[aria-label*="设置"], [aria-label*="Settings"], [data-settings-trigger]')
  if (gear) { gear.click(); return 'gear' }
  return null
})()`

/** 切到「通用设置」分区。 */
const OPEN_GENERAL = `(() => {
  const nodes = [...document.querySelectorAll('button, [role="tab"], [role="button"], li, a')]
  const hit = nodes.find((el) => /^(通用设置|常规|常规设置|General)$/.test((el.textContent || '').trim()))
  if (!hit) return null
  hit.click()
  return (hit.textContent || '').trim()
})()`

/** 改一个设置控件的值并派发 React 认得的原生事件。 */
function changeScript (controlId, value) {
  return `(() => {
  const el = document.querySelector('[data-balance-control=${JSON.stringify(controlId)}]')
  if (el === null) return null
  if (el.type === 'checkbox') {
    const want = ${value === true || value === 'true'}
    if (el.checked !== want) el.click()
    else el.dispatchEvent(new Event('change', { bubbles: true }))
    return el.checked
  }
  const descriptor = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value')
  if (descriptor && descriptor.set) descriptor.set.call(el, ${JSON.stringify(String(value))})
  else el.value = ${JSON.stringify(String(value))}
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return true
})()`
}

/**
 * 直接调用插件 service 的配置 store 改一项设置（v0.1.6）。
 *
 * 为什么绕过设置面板：设置面板的入口在宿主升级后可能换选择器，而这里要验证的
 * 是**配置变化本身**——切口径不该弹假提醒。从徽章的 React fiber 上找到
 * `props.service`（与 TARIFF_DRIFT 同一手法），调用与设置行完全相同的
 * `settings.update()`，不碰存储、也不重新加载页面。
 */
const SERVICE_UPDATE = (patch) => `(() => {
  const keyOf = (node) => Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
  const anchor = document.querySelector('[data-balance-pill]')
  if (anchor === null) return { ok: false, reason: 'no pill' }
  const key = keyOf(anchor)
  if (key === undefined) return { ok: false, reason: 'no fiber' }
  let root = anchor[key]
  let guard = 0
  while (root.return !== null && root.return !== undefined && guard++ < 500) root = root.return
  const stack = [root]
  let visited = 0
  while (stack.length > 0 && visited++ < 50000) {
    const fiber = stack.pop()
    if (fiber === null || fiber === undefined) continue
    const service = fiber.memoizedProps && fiber.memoizedProps.service
    if (service !== null && service !== undefined && service.settings && typeof service.settings.update === 'function') {
      service.settings.update(${JSON.stringify(patch)})
      return { ok: true, settings: service.settings.get() }
    }
    if (fiber.child !== null && fiber.child !== undefined) stack.push(fiber.child)
    if (fiber.sibling !== null && fiber.sibling !== undefined) stack.push(fiber.sibling)
  }
  return { ok: false, reason: 'service not found' }
})()`

/** 余额提醒卡（走宿主 Toast 或自带兜底卡片）的实测快照。 */
const BALANCE_ALERT_INSPECT = `(() => {
  const flat = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()
  const own = document.querySelector('[data-balance-alert]')
  // 只认真正的提醒文案（带「当前金额」的那种），且排除面板与徽章本身：
  // 面板里也有「余额偏低，建议尽快充值」与「去充值」，旧选择器会把面板提示
  // 误当成提醒卡。v0.1.6 的「切换口径不该弹卡」断言依赖这个区分。
  const wanted = /余额不足：当前|余额偏低：当前|Balance is nearly empty:|Balance is running low:/i
  const matches = [...document.querySelectorAll('body *')]
    .filter((el) => wanted.test(el.textContent || ''))
    .filter((el) => el.closest('[data-balance-panel], [data-balance-pill]') === null)
    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '', text: flat(el).slice(0, 160) }))
    .filter((row) => row.text.length < 200)
    .sort((a, b) => a.text.length - b.text.length)
    .slice(0, 3)
  return {
    ownLevel: own === null ? null : own.getAttribute('data-level'),
    ownText: own === null ? null : flat(own).slice(0, 200),
    matches,
    pillLevel: (() => { const pill = document.querySelector('[data-balance-pill]'); return pill === null ? null : pill.getAttribute('data-level') })(),
    pillText: (() => { const el = document.querySelector('[data-balance-pill] .dbp_text'); return el === null ? null : flat(el) })()
  }
})()`


// ------------------------------------------------- v1.3 计费时段（独立核对）
//
// 验证台要回答的问题是「界面上的时段徽标是不是**按北京时间算对了**」。
// 如果期望值也来自 pricing.js，那就成了拿实现验证实现（同一个 bug 两边都错，
// 断言照样绿）。因此这里只用节假日**数据**，把日期/窗口/依据的判定独立重写一遍。

const TZ_MS = 8 * 3600 * 1000
const PEAK_MINUTES = [[540, 720], [840, 1080]]

/** 独立实现：某个 epoch 毫秒在计费上属于哪个时段与依据。 */
function expectTariff (nowMs) {
  const local = new Date(nowMs + TZ_MS)
  const weekday = local.getUTCDay()
  const key = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${String(local.getUTCDate()).padStart(2, '0')}`
  const flag = CHINA_HOLIDAYS[key]
  const weekend = weekday === 0 || weekday === 6
  const workday = flag === 0 ? true : flag === 1 ? false : !weekend
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes()
  const inWindow = workday && PEAK_MINUTES.some(([start, end]) => minutes >= start && minutes < end)
  let reason
  if (inWindow) reason = 'peak-window'
  else if (flag === 1) reason = 'holiday'
  else if (flag === 0) reason = 'makeup-workday'
  else if (weekend) reason = 'weekend'
  else if (minutes >= 720 && minutes < 840) reason = 'midday'
  else reason = 'night'
  return {
    period: inWindow ? 'peak' : 'off-peak',
    reason,
    workday,
    weekend,
    holiday: flag === 1,
    makeup: flag === 0,
    date: key,
    minutes
  }
}

/** 独立实现：从 nowMs 起的下一次**时段变化**落在哪一分钟（逐分钟扫，最多 40 天）。 */
function expectNextBoundary (nowMs) {
  const target = expectTariff(nowMs).period === 'peak' ? 'off-peak' : 'peak'
  const start = Math.floor(nowMs / 60000) * 60000 + 60000
  for (let at = start; at <= nowMs + 40 * 86400000; at += 60000) {
    if (expectTariff(at).period === target) return { target, at }
  }
  return null
}

/**
 * 独立实现：当前这段空闲的整段区间（起点 = 最近一次「高峰 → 空闲」的变化点）。
 *
 * 逐分钟向前回扫「上一个还是高峰的分钟」，因此**结构上**保证
 * `expectTariff(start - 1).period === 'peak'` —— 这正是「起点是变化点、不是日界」
 * 那条契约；面板上的 `{duration}` 必须等于 `end - start`（整段长度）。
 */
function expectOffPeakWindow (nowMs) {
  if (expectTariff(nowMs).period !== 'off-peak') return null
  const minute = Math.floor(nowMs / 60000) * 60000
  let start = minute
  for (let at = minute - 60000; at >= nowMs - 40 * 86400000; at -= 60000) {
    if (expectTariff(at).period === 'peak') {
      start = at + 60000
      break
    }
    start = at
  }
  const boundary = expectNextBoundary(nowMs)
  return { start, end: boundary === null ? null : boundary.at }
}

/** epoch 毫秒 → 北京时间 `MM-DD HH:MM`（面板在边界跨天时用这个形态）。 */
function bjDateTime (at) {
  const local = new Date(at + TZ_MS)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())} ${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`
}

/** 面板倒计时里的 `{time}`：同一天给 `HH:MM`，跨天给 `MM-DD HH:MM`（pill.js 的刻意分支）。 */
function expectBoundaryText (nowMs, at) {
  return Math.floor((nowMs + TZ_MS) / 86400000) === Math.floor((at + TZ_MS) / 86400000) ? bjTime(at) : bjDateTime(at)
}

/** epoch 毫秒 → 北京时间 `HH:MM`（独立实现，用于比对面板上的 `{time}`）。 */
function bjTime (at) {
  const local = new Date(at + TZ_MS)
  return `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`
}

/** `formatCountdown` / `formatDuration` 文案 → 毫秒（只能拿到近似值，因此比较时给容差）。 */
function countdownToMs (text) {
  if (typeof text !== 'string') return null
  // v0.1.6：跨天倒计时会同时出现「天 + 小时 + 分钟」，不能只匹配整天的文本。
  const days = /(\d+) 天/.exec(text)
  const hours = /(\d+) 小时/.exec(text)
  const minutes = /(\d+) 分钟/.exec(text)
  const seconds = /^(\d+) 秒$/.exec(text)
  if (seconds !== null) return Number(seconds[1]) * 1000
  if (days === null && hours === null && minutes === null) return null
  return (days === null ? 0 : Number(days[1]) * 86400000) +
    (hours === null ? 0 : Number(hours[1]) * 3600000) +
    (minutes === null ? 0 : Number(minutes[1]) * 60000)
}

/**
 * 一段**展示文本**的量化粒度（毫秒）。
 *
 * 为什么需要它：`formatCountdown` / `formatDuration` 在「天」这一档只给整数天 ——
 * 剩余「1 天 21 小时」渲染成「1 天」，跨度「3 天 15 小时」渲染成「4 天」。
 * 拿 ±2 分钟 / ±90 分钟的容差去比一天的量化误差，是**验证台的假设错了**，
 * 不是插件算错了。容差必须与文本自身的粒度同量级。
 *
 * @param text - 面板上的展示文本（如 `1 天`、`2 小时 13 分钟`、`13 分钟`）。
 * @returns 毫秒；文本无法识别时返回 null。
 */
function displayGranularityMs (text) {
  if (typeof text !== 'string') return null
  // v0.1.6：跨天文案是「天 + 小时 + 分钟」的组合，粒度取**最小**出现的单位。
  if (/\d+ 分钟/.test(text)) return 60000
  if (/\d+ 秒/.test(text)) return 1000
  if (/\d+ 小时/.test(text)) return 3600000
  if (/\d+ 天/.test(text)) return 86400000
  return null
}

const num = (text) => {
  const parsed = Number(String(text).replace(/[,，]/g, ''))
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 用独立算出的期望核对一次实测快照。
 *
 * @returns `{check, expected, actual, ok}[]`（全部列进 JSON 证据）。
 */
function checkTariff (inspect, nowMs, settings, expectPanel = true) {
  const out = []
  const add = (check, expected, actual) => {
    out.push({ check, expected, actual, ok: JSON.stringify(expected) === JSON.stringify(actual) })
  }
  const showTariff = !(settings !== null && settings !== undefined && settings.showTariff === false)
  const want = expectTariff(nowMs)

  add('data-tariff 存在', true, inspect.period !== null && inspect.period !== undefined)
  add('data-tariff = 独立算出的时段', want.period, inspect.period)
  add('data-tariff-reason = 独立算出的依据', want.reason, inspect.reason)
  add('showTariff 决定徽标是否存在', showTariff, inspect.badge !== null)
  if (expectPanel) {
    add('断言时面板处于打开状态', true, inspect.panelFound === true)
  }

  if (inspect.badge !== null) {
    add('.dbp_tariff 的 data-balance-tariff 与 data-tariff 一致', inspect.period, inspect.badge.attr)
    add('徽标文案与时段一致', true, inspect.badge.text === (want.period === 'peak' ? '高峰' : '空闲'))
    add('徽标 aria 说明当前是贵还是便宜', true,
      want.period === 'peak'
        ? /两倍/.test(String(inspect.badge.aria)) && /两倍/.test(String(inspect.badge.title))
        : /一半/.test(String(inspect.badge.aria)) && /一半/.test(String(inspect.badge.title)))
    add('aria-label 与 title 同源', inspect.badge.title, inspect.badge.aria)
    add('徽标真的可见（有字号与尺寸）', true, Number.parseFloat(inspect.badge.fontSize) > 0 && inspect.badge.rect.w > 10)
  }

  if (inspect.panelFound && showTariff) {
    add('面板时段区存在（data-balance-tariff-row）', true, inspect.blocks.row !== null)
    add('面板徽标 data-tariff 与时段一致', want.period, inspect.panelBadge === null ? null : inspect.panelBadge.attr)

    // 价格行：当前时段单价必须与高峰对照价自洽（空闲 = 高峰 ÷ 2）。
    const price = /：输出 ¥([\d.,]+) \/ 百万 tokens（高峰 ¥([\d.,]+)）$/.exec(String(inspect.blocks.price ?? ''))
    if (price === null) {
      add('价格行可解析', true, false)
    } else {
      const current = num(price[1])
      const peak = num(price[2])
      add('价格行：高峰对照价 = 当前时段高峰价', true, peak !== null && peak > 0)
      add('价格行：当前价 = 高峰价 ÷ 2（空闲）/ 相等（高峰）',
        want.period === 'peak' ? peak : peak / 2,
        current)
    }

    // 倒计时行：`{time}` 必须等于独立算出的边界（跨天时带日期），`{duration}` 与它自洽。
    const nextRe = /^(距下一个高峰|距下一个空闲时段) (.+?)（((?:\d{2}-\d{2} )?\d{2}:\d{2}) 起）$/.exec(String(inspect.blocks.next ?? ''))
    const boundary = expectNextBoundary(nowMs)
    if (nextRe === null) {
      add('倒计时行可解析', true, false)
    } else {
      add('倒计时行指向对侧时段', boundary === null ? null : (boundary.target === 'peak' ? '距下一个高峰' : '距下一个空闲时段'), nextRe[1])
      add('倒计时行的 {time} = 独立算出的边界时刻（跨天带日期）',
        boundary === null ? null : expectBoundaryText(nowMs, boundary.at),
        nextRe[3])
      const parsed = countdownToMs(nextRe[2])
      const actualMs = boundary === null ? null : boundary.at - nowMs
      // 容差与展示粒度同量级：`1 天` 这一档本身就有一天的量化误差。
      const grain = displayGranularityMs(nextRe[2])
      add('倒计时行的 {duration} 与边界自洽（容差 = 展示粒度）', true,
        parsed !== null && actualMs !== null && grain !== null && Math.abs(parsed - actualMs) <= grain)
    }

    // 空闲区间行：只在空闲时出现；起止与独立算出的整段区间一致，时长 = end - start。
    const windowRe = /^本段空闲：(\d{2}:\d{2}) – (?:(\d{2})-(\d{2}) )?(\d{2}:\d{2})（共 (.+?)）$/.exec(String(inspect.blocks.window ?? ''))
    const wantWindow = expectOffPeakWindow(nowMs)
    if (want.period === 'peak') {
      add('高峰时不渲染本段空闲区间', null, inspect.blocks.window)
    } else if (windowRe === null) {
      add('空闲区间行可解析', true, false)
    } else {
      add('空闲区间起点 = 独立算出的变化点', wantWindow === null ? null : bjTime(wantWindow.start), windowRe[1])
      // 面板对终点用哪种形态，取决于**区间起止是否同一天**（不是与 now 是否同天）。
      add('空闲区间终点 = 独立算出的下一个高峰',
        wantWindow === null || wantWindow.end === null ? null : expectBoundaryText(wantWindow.start, wantWindow.end),
        `${windowRe[2] === undefined ? '' : `${windowRe[2]}-${windowRe[3]} `}${windowRe[4]}`)
      const parsed = countdownToMs(windowRe[5])
      const span = wantWindow === null || wantWindow.end === null ? null : wantWindow.end - wantWindow.start
      // 同上：`共 3 天` 是 `formatDuration` 的整数天档，容差按展示粒度给。
      const grain = displayGranularityMs(windowRe[5])
      add('空闲区间：时长 = end - start（容差 = 展示粒度）', true,
        parsed !== null && span !== null && grain !== null && Math.abs(parsed - span) <= grain)
    }

    // 「省一半」只在高峰出现，且金额严格一半（人民币口径）。
    //
    // 注意 `<0.01`：余额很小时（实测 ¥0.015 的一半）面板会渲染成 `¥<0.01`，
    // `num()` 对它是 null，直接比会得到一个假失败。这是**格式化精度**的限制，
    // 不是插件的错：金额小于一分钱时两位小数表达不出来。因此这里做两件事 ——
    // ① 两个数都能解析时按「显示精度」比较（四舍五入到 2 位）；
    // ② 出现 `<0.01` 这种下溢写法时，只要求另一半也下溢（同一量级）。
    const saveRe = /^高峰跑 2 小时约 ¥([\d.,]+|<[\d.]+)，留到空闲时段只花 ¥([\d.,]+|<[\d.]+)$/.exec(String(inspect.blocks.save ?? ''))
    if (want.period === 'peak' && saveRe !== null) {
      const amount = num(saveRe[1])
      const half = num(saveRe[2])
      if (amount === null || half === null) {
        // 至少一边下溢（写成 `<0.01`）：要求两边都下溢，否则是真错。
        const bothUnderflow = /^</.test(saveRe[1]) && /^</.test(saveRe[2])
        add('省一半：金额过小、两侧都以 <0.01 表达（精度下溢，不做数值比较）', true, bothUnderflow)
      } else {
        // 两个数都按面板的两位小数精度比较：0.0075 会显示成 0.01，
        // 而 amount 显示成 0.02，此时 floor 到分之后 0.02/2 === 0.01。
        const round2 = (value) => Math.round(value * 100) / 100
        add('省一半：half = amount ÷ 2（按面板两位小数精度）', round2(amount) / 2, round2(half))
      }
    } else if (want.period === 'off-peak') {
      add('空闲时不渲染高峰 2 小时的账', null, inspect.blocks.save)
    }

    // 「撑不撑得到下一个高峰」只在空闲 + 有消耗速度时出现（没有速度就没有可比的时长）。
    if (want.period === 'peak') {
      add('高峰时不渲染 lasts 行', null, inspect.blocks.lasts)
    } else if (inspect.hasRate) {
      add('空闲且已知消耗速度时必须有 lasts 行', true, inspect.blocks.lasts !== null)
    } else {
      out.push({ check: '空闲时 lasts 行（本场景无消耗速度，按契约不渲染）', expected: 'skipped', actual: 'skipped', ok: true })
    }

    // 日历提示：覆盖 2025–2026 就是「覆盖」，否则必须是过期提示。
    const year = Number(String(want.date).slice(0, 4))
    const covered = year >= 2025 && year <= 2026
    add('日历提示与覆盖年份一致', true,
      covered ? /覆盖 2025–2026/.test(String(inspect.blocks.calendar)) : /未覆盖/.test(String(inspect.blocks.calendar)))

    // 区块顺序即契约顺序（只要求出现的那几个保序）。
    const canonical = ['row', 'note', 'next', 'window', 'reason', 'price', 'save', 'lasts', 'calendar']
    const indices = (inspect.order ?? []).map((name) => canonical.indexOf(name)).filter((index) => index >= 0)
    add('面板区块顺序符合契约', true, indices.every((value, index) => index === 0 || value > indices[index - 1]))
  }
  return out
}

// -------------------------------------------------------------------- main

async function main () {
  const started = Date.now()
  log(`# shot-pill.mjs url=${URL_TO_LOAD} out=${OUT_PNG}`)
  log(`# electron=${process.versions.electron} chrome=${process.versions.chrome} variants=${VARIANTS === null ? '(single)' : VARIANTS.length}`)

  const cookie = mintCookieFor(URL_TO_LOAD)
  const s = session.defaultSession
  await s.cookies.set({
    url: cookie.origin,
    name: cookie.name,
    value: cookie.value,
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    expirationDate: Math.floor(Date.now() / 1000) + 30 * 24 * 3600
  })
  s.webRequest.onBeforeSendHeaders({ urls: [`${cookie.origin}/*`] }, (details, callback) => {
    details.requestHeaders.Cookie = cookie.header
    callback({ requestHeaders: details.requestHeaders })
  })
  s.webRequest.onBeforeRequest({ urls: [`${cookie.origin}/*`] }, (details, callback) => {
    if (blockAccount && /account/i.test(details.url)) {
      blockedUrls.push(details.url)
      callback({ cancel: true })
      return
    }
    callback({})
  })
  log(`auth: 已注入会话 cookie ${cookie.name}（长度 ${cookie.value.length}）`)
  try {
    const probe = await fetch(URL_TO_LOAD, { headers: { cookie: cookie.header }, redirect: 'manual' })
    log(`auth: node 侧探测 ${probe.status}`)
  } catch (error) {
    log(`auth: node 侧探测失败 ${String(error?.message ?? error)}`)
  }

  let lastFrame = null
  /**
   * `blockAccount` 为真时取消账号接口请求，用来在真实 GUI 里复现「平台读取失败」。
   * 取消（而不是重定向到 data:）是因为它产生的是网络层失败，与平台不可达同类。
   */
  let blockAccount = false
  const blockedUrls = []
  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    skipTaskbar: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.setFrameRate(30)
  win.webContents.on('paint', (_event, _dirty, image) => { lastFrame = image })

  const consoleMessages = []
  win.webContents.on('console-message', (event) => {
    const text = typeof event?.message === 'string' ? event.message : String(event ?? '')
    if (text.length > 0) consoleMessages.push(text.slice(0, 300))
  })

  const js = (script) => win.webContents.executeJavaScript(script, true)

  /** 等到断言成立；返回最后一次快照。 */
  const waitFor = async (script, predicate, timeoutMs, label) => {
    const deadline = Date.now() + timeoutMs
    let snapshot = null
    while (Date.now() < deadline) {
      await sleep(350)
      snapshot = await js(script)
      if (predicate(snapshot)) return snapshot
    }
    const body = await js('document.body ? document.body.textContent.slice(0, 200) : "(no body)"').catch(() => '(unreadable)')
    log(`waitFor(${label}) 超时，最后快照 ${JSON.stringify(snapshot)}，正文 ${JSON.stringify(body)}`)
    return snapshot
  }

  const shoot = async (target) => {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    lastFrame = null
    win.webContents.invalidate()
    const paintDeadline = Date.now() + 8000
    while (lastFrame === null && Date.now() < paintDeadline) await sleep(60)
    if (lastFrame === null) throw new Error('离屏渲染 8 秒内没有收到帧')
    fs.writeFileSync(target, lastFrame.toPNG())
    log(`wrote ${target} (${lastFrame.getSize().width}x${lastFrame.getSize().height})`)
  }

  const boot = async (label) => {
    await waitFor(SNAPSHOT, (snap) => snap !== null && snap.elementCount > 200 && snap.hasBoot, 30000, `${label}:boot`)
    for (let i = 0; i < 4; i += 1) {
      const dismissed = await js(DISMISS_OVERLAY)
      if (dismissed === null) break
      log(`dismissed overlay: ${dismissed}`)
      await sleep(700)
    }
  }

  await win.loadURL(URL_TO_LOAD)
  log('did-finish-load')
  await boot('initial')

  // 打开一个会话：优先按标题匹配，否则挑侧边栏里最靠上的会话行。
  const candidates = await js(SESSION_CANDIDATES)
  const hintCandidates = SESSION_HINT === null ? [] : candidates.filter((row) => row.text.includes(SESSION_HINT))
  const sessionRows = candidates.filter((row) => row.x < 40 && row.w > 200 && row.h >= 28 && !/新会话|插件|自动化任务|设置/.test(row.text))
  const alreadyOpen = (await js(SNAPSHOT)).hasStats
  let picked = null
  if (!alreadyOpen) {
    picked = hintCandidates[0] ?? sessionRows[0] ?? candidates[0]
    log(`session candidates=${candidates.length} rows=${sessionRows.length} picked=${JSON.stringify(picked ?? null)}`)
    if (picked !== undefined && picked !== null) log(`clicked=${JSON.stringify(await js(clickScript(picked.text.slice(0, 20))))}`)
  } else {
    log('session: 已有一个会话打开（userdata 保持），跳过点击')
  }

  const ready = await waitFor(
    SNAPSHOT,
    (snap) => snap !== null && snap.hasPill && snap.pillStatus !== 'loading',
    30000,
    'pill'
  )
  log(`pill ready: ${JSON.stringify(ready)} (${Date.now() - started} ms)`)

  const variants = VARIANTS ?? [{ name: 'default' }]
  const results = []
  for (const variant of variants) {
    const name = variant.name ?? 'variant'
    if (variant.thresholds === undefined || variant.thresholds === null) {
      if (variant.settings === undefined || variant.settings === null) {
        await js("localStorage.removeItem('dsh-balance-pill:settings'); localStorage.removeItem('dsh-balance-pill:thresholds'); true")
      }
    }
    if (variant.settings !== undefined && variant.settings !== null) {
      // 写 v1.1 的设置键（也要清掉 v1.0 的旧键，否则它会作为兜底继续生效）。
      await js(
        `localStorage.removeItem('dsh-balance-pill:thresholds'); localStorage.setItem('dsh-balance-pill:settings', ${JSON.stringify(JSON.stringify(variant.settings))}); true`
      )
    }
    // 预置历史与会话基准：趋势图需要 ≥2 个采样点、会话消耗需要基准余额才会出现，
    // 而真实环境里这两样要等上一段时间。`variant.seedHistory` 让验证台立刻能看到
    // v1.2 的两条新信息，而不必真的等几分钟。
    //
    // 两个细节决定了这份数据是否「诚实」：
    //  1. 会话 id 从宿主自己的属性上取（`data-conversation-session`）——
    //     基准必须挂在**当前**会话下，随便编一个 id 是看不到「本轮消耗」的；
    //  2. 采样点以**当前真实余额**为锚往下铺（模拟一段消耗），而不是硬编码一串
    //     与真实余额无关的数字 —— 否则图上会出现一条真实数据造成的竖直尖峰，
    //     看起来像插件算错了。
    if (variant.seedHistory === true) {
      const anchor = await js(`(() => {
        const el = document.querySelector('[data-balance-pill] .dbp_text')
        if (el === null) return null
        const text = (el.textContent || '').replace(/[^0-9.]/g, '')
        const value = Number(text)
        return Number.isFinite(value) && value > 0 ? value : null
      })()`)
      const now = Date.now()
      const samples = []
      if (anchor !== null) {
        // 从约 1.5 倍余额一路消耗到当前值，每 5 分钟一个点。
        // `variant.steepHistory` 把斜率放大到 ≈¥0.02/分钟：余额不高时这足以让
        // 「今日已用」是个有意义的正数，也能让徽章的耗尽预估落进 24 小时窗口。
        const step = variant.steepHistory === true ? 0.02 : anchor * 0.04
        for (let index = 12; index >= 0; index -= 1) {
          samples.push({
            at: now - index * 300000,
            amount: Number((anchor + index * step).toFixed(2)),
            currency: 'CNY'
          })
        }

        // v0.1.6：可选的跨天历史（`seedDays`），用来验证「本周 / 近 7 天」。
        // 每 2 小时一个点，中间插一次充值（金额向上跳），尾点仍然等于
        // 当前真实余额 —— 否则图上会出现一条真实读数造成的竖直尖峰。
        const seedDays = Number(variant.seedDays ?? 0)
        if (Number.isFinite(seedDays) && seedDays > 1) {
          samples.length = 0
          const total = Math.round(seedDays * 12)
          const dailyStep = Math.max(0.01, (anchor * 0.05) / total)
          const topUp = Math.min(2, Math.max(0.2, anchor * 0.2))
          const topUpAt = Math.floor(total / 2)
          for (let index = 0; index < total; index += 1) {
            const ageSlots = total - 1 - index
            const amount = index < topUpAt
              ? anchor + (total - index) * dailyStep - topUp
              : anchor + ageSlots * dailyStep
            samples.push({
              at: now - ageSlots * 2 * 3600000,
              amount: Number(Math.max(0.01, amount).toFixed(2)),
              currency: 'CNY'
            })
          }
        }
      }
      const sessionId = await js(
        "(() => { const el = document.querySelector('[data-conversation-session]'); return el === null ? null : el.getAttribute('data-conversation-session') })()"
      )
      log(`seed: anchor=${String(anchor)} sessionId=${String(sessionId)} samples=${samples.length}`)
      // 基准取 1.6 倍余额 ⇒ 「本轮已用」约 0.6 倍余额，稳定为正数。
      const baselines = anchor === null || sessionId === null || sessionId === ''
        ? {}
        : { [sessionId]: { amount: Number((anchor * 1.6).toFixed(2)), at: now - 3900000, currency: 'CNY' } }
      await js(
        `localStorage.setItem('dsh-balance-pill:history', ${JSON.stringify(JSON.stringify(samples))}); ` +
          `localStorage.setItem('dsh-balance-pill:sessions', ${JSON.stringify(JSON.stringify(baselines))}); true`
      )
      const stored = await js(`(() => {
        const raw = localStorage.getItem('dsh-balance-pill:history')
        if (raw === null) return null
        const parsed = JSON.parse(raw)
        return { count: parsed.length, first: parsed[0], last: parsed[parsed.length - 1] }
      })()`)
      log(`seed stored: ${JSON.stringify(stored)}`)
    }
    if (VARIANTS !== null) {
      await js('location.reload(); true')
      await sleep(1200)
      await boot(`variant:${name}`)
    }
    // 主题属性必须在重新加载之后设置：应用会用自身偏好重写它。
    if (variant.dark === true) {
      await js("document.body.setAttribute('data-ds-dark-theme',''); document.documentElement.style.colorScheme='dark'; true")
      await sleep(600)
    } else {
      await js("document.body.removeAttribute('data-ds-dark-theme'); document.documentElement.style.colorScheme='light'; true")
    }
    await waitFor(SNAPSHOT, (snap) => snap !== null && snap.hasPill && snap.pillStatus !== 'loading', 30000, `variant:${name}:ready`)

    const inspect = await js(INSPECT)
    log(`INSPECT[${name}] ` + JSON.stringify(inspect))
    const storedAfter = await js(`(() => {
      const raw = localStorage.getItem('dsh-balance-pill:history')
      if (raw === null) return null
      const parsed = JSON.parse(raw)
      return { count: parsed.length, min: Math.min(...parsed.map((s) => s.amount)), max: Math.max(...parsed.map((s) => s.amount)) }
    })()`)
    log(`history after boot [${name}]: ${JSON.stringify(storedAfter)}`)
    const target = OUT_PNG.replace(/\.png$/i, `-${name}.png`)
    await shoot(target)

    const opened = await js("(() => { const el = document.querySelector('.dbp_trigger'); if (!el) return false; el.click(); return true })()")
    await sleep(900)
    const panel = await js(INSPECT_PANEL)
    log(`PANEL[${name}] ` + JSON.stringify(panel))
    if (panel.panelFound) await shoot(target.replace(/\.png$/i, '-panel.png'))
    results.push({ variant: variant, inspect, panel, screenshot: target, opened })

    // ---------------------------------------------------------- v1.3 时段断言
    {
      const nowMs = Date.now()
      const storedSettings = await js(`(() => { try { const raw = localStorage.getItem('dsh-balance-pill:settings'); return raw === null ? null : JSON.parse(raw) } catch { return null } })()`)
      const tariff = await js(TARIFF_INSPECT)
      const tariffAssertions = checkTariff(tariff, nowMs, storedSettings)
      const tariffFailed = tariffAssertions.filter((row) => row.ok === false)
      log(`TARIFF[${name}] period=${String(tariff.period)} reason=${String(tariff.reason)} badge=${JSON.stringify(tariff.badge === null ? null : tariff.badge.text)} panel=${tariff.panelFound} assertions=${tariffAssertions.length} failed=${tariffFailed.length}`)
      for (const row of tariffFailed) log(`  FAIL ${row.check}: expected=${JSON.stringify(row.expected)} actual=${JSON.stringify(row.actual)}`)
      log(`TARIFF[${name}] blocks=` + JSON.stringify(tariff.blocks))
      results[results.length - 1].tariff = { inspect: tariff, assertions: tariffAssertions, checkedAt: nowMs }
    }

    if (variant.tariffCheck === true) {
      // 面板此刻是打开的（上面刚点过）。先把「真实时间」下的倒计时文本记下来，
      // 等做完时间注入的几组断言再回来取第二次 —— 分钟粒度的跳变最多要等 60 秒，
      // 干等就把这段时间浪费了（在等待窗口里做别的断言）。
      const nextBefore = await js(NEXT_TEXT)
      const tickWatchStartedAt = Date.now()
      const record = results[results.length - 1]

      // 时间注入前把历史/会话基准备份下来：注入的时钟会把「未来」的读数写进
      // 本地历史，收尾必须还原，不能污染用户正在用的界面数据。
      const backup = await js(`(() => ({
        history: localStorage.getItem('dsh-balance-pill:history'),
        sessions: localStorage.getItem('dsh-balance-pill:sessions')
      }))()`)

      /** 面板应当处于打开状态：注入与倒计时断言都依赖「1 秒心跳在重算」。 */
      const ensurePanelOpen = async () => {
        const has = await js("document.querySelector('[data-balance-panel]') !== null")
        if (has) return true
        await js("(() => { const el = document.querySelector('.dbp_trigger'); if (el !== null) el.click(); return true })()")
        await sleep(900)
        const opened = await js("document.querySelector('[data-balance-panel]') !== null")
        log(`panel reopened: ${String(opened)}`)
        return opened
      }

      /** 把页面时钟推到某个绝对时刻，等到界面确实按它重算（或超时）。 */
      const jumpTo = async (targetMs, expectPeriod, label) => {
        await ensurePanelOpen()
        const info = await js(`(() => {
          if (window.__v13RealNow === undefined) window.__v13RealNow = Date.now
          const base = window.__v13RealNow()
          Date.now = () => ${targetMs}
          return { realNow: base, injectedNow: ${targetMs} }
        })()`)
        const deadline = Date.now() + 20000
        let snapshot = await js(TARIFF_INSPECT)
        while (Date.now() < deadline && snapshot.period !== expectPeriod) {
          await sleep(1000)
          snapshot = await js(TARIFF_INSPECT)
        }
        const want = expectTariff(info.injectedNow)
        const assertions = checkTariff(snapshot, info.injectedNow, { showTariff: true })
        const failed = assertions.filter((row) => row.ok === false)
        log(`TARIFF-INJECT[${name}:${label}] now=${new Date(info.injectedNow).toISOString()} period=${String(snapshot.period)} reason=${String(snapshot.reason)} assertions=${assertions.length} failed=${failed.length}`)
        for (const row of failed) log(`  FAIL(inject) ${row.check}: expected=${JSON.stringify(row.expected)} actual=${JSON.stringify(row.actual)}`)
        log(`TARIFF-INJECT[${name}:${label}] blocks=` + JSON.stringify(snapshot.blocks))
        return { info, snapshot, want, assertions }
      }

      /** 点掉当前卡片（宿主 Toast 的「知道了」），让下一段等待不会被上一段的卡片误判。 */
      const dismissCards = async () => {
        await js(`(() => {
          const hit = [...document.querySelectorAll('button, [role="button"], span')]
            .find((el) => /^(知道了|Got it)$/.test((el.textContent || '').trim()))
          if (hit === undefined) return false
          hit.click()
          return true
        })()`)
        await sleep(900)
      }

      /**
       * 等一张时段提醒卡出现（看门狗每 30 秒 tick 一次，所以至少留 30 秒余量）。
       *
       * `wanted` 限定**方向**（「进入高峰」与「进入空闲」两张卡的文案不同）：
       * 上一段遗留的卡片会一直留在浮层里，不限定方向就会把旧卡当成新卡。
       * `requireOwn` 用于兜底卡片路径：那条路径必须出现插件专属属性
       * `[data-balance-alert-kind='tariff']`，不能靠文案糊过去。
       */
      const waitForTariffAlert = async (label, timeoutMs, options = {}) => {
        const wanted = options.wanted ?? null
        const requireOwn = options.requireOwn === true
        const deadline = Date.now() + timeoutMs
        let last = null
        let lastDiag = 0
        while (Date.now() < deadline) {
          await sleep(1500)
          last = await js(TARIFF_ALERT_INSPECT)
          const ownHit = last.ownKind === 'tariff'
          const textHit = wanted !== null && last.matches.some((row) => wanted.test(String(row.text)))
          if (requireOwn ? ownHit : (ownHit || textHit)) {
            log(`TARIFF-ALERT[${name}:${label}] ` + JSON.stringify(last))
            return last
          }
          if (Date.now() - lastDiag > 10000) {
            lastDiag = Date.now()
            log(`TARIFF-ALERT[${name}:${label}] 等待中 overlayPresent=${String(last.overlayPresent)} toastBound=${String(last.toastPrimitiveBound)} matches=${JSON.stringify((last.matches ?? []).map((row) => row.text.slice(0, 40)))}`)
          }
        }
        log(`TARIFF-ALERT[${name}:${label}] 超时：${timeoutMs} ms 内没有看到目标方向的时段提醒卡；最后快照 ` + JSON.stringify(last))
        return null
      }
      const PEAK_COPY = /进入高峰时段|Peak hours started/
      const OFFPEAK_COPY = /进入空闲时段|Off-peak hours started/

      // 注入 1：周五 2026-10-16 10:30（北京时间高峰窗口内）。停在这里久一点，
      // 让看门狗至少 tick 一次 —— 提醒需要「上一次观测」与「现在」分属两个时段。
      await dismissCards()
      const peakState = await jumpTo(Date.parse('2026-10-16T10:30:00+08:00'), 'peak', 'peak-2026-10-16-10:30')
      const peakShot = target.replace(/\.png$/i, '-peak.png')
      await shoot(peakShot)
      const peakAlert = await waitForTariffAlert('peak', 75000, { wanted: PEAK_COPY })
      if (peakAlert !== null) await shoot(target.replace(/\.png$/i, '-alert.png'))

      // 注入 2：同一天 12:30（午休，空闲）—— 跨过 12:00 的边界。
      await dismissCards()
      const middayState = await jumpTo(Date.parse('2026-10-16T12:30:00+08:00'), 'off-peak', 'offpeak-2026-10-16-12:30')
      const middayAlert = await waitForTariffAlert('offpeak', 75000, { wanted: OFFPEAK_COPY })
      if (middayAlert !== null) await shoot(target.replace(/\.png$/i, '-alert-offpeak.png'))

      // 兜底卡片路径：宿主 `Toast` 可用时走的是宿主 Toast（没有插件专属属性），
      // 契约里的 `[data-balance-alert-kind='tariff']` 是**自带兜底卡片**的标记。
      // 把 Toast 暂时摘掉再跨一次边界，就能在真实 GUI 里验证兜底路径。
      await dismissCards()
      await js("(() => { window.__v13Toast = globalThis.__DBP_TOAST__; delete globalThis.__DBP_TOAST__; return true })()")
      const fallbackState = await jumpTo(Date.parse('2026-10-16T14:30:00+08:00'), 'peak', 'peak-2026-10-16-14:30')
      const fallbackAlert = await waitForTariffAlert('fallback-card', 40000, { requireOwn: true })
      if (fallbackAlert !== null) await shoot(target.replace(/\.png$/i, '-alert-fallback.png'))
      await js("(() => { if (window.__v13Toast !== undefined) { globalThis.__DBP_TOAST__ = window.__v13Toast; delete window.__v13Toast } return true })()")

      // ---- v1.4：时钟跳变自愈（D1 的直接验收）----
      //
      // v1.3 的看门狗只在 React 依赖变化时重算，于是「时钟被一次性推过边界」
      // （休眠唤醒 / NTP 校时 / 后台节流）会**静默漏掉**这次切换。这里刻意用
      // **一次性大步跳**（而不是像上面那样停在注入时刻等一拍）复现那个形状：
      // 从 14:30（高峰）一步跳到 19:00（空闲），中间跨过 18:00 边界。
      //
      // 判据有两条，缺一不可：
      //  ① 看门狗自报 drift().jumped 为真（证明它**识别**出了这次跳变）；
      //  ② 卡片真的出现（证明识别之后**补上了**这次切换）。
      // 只断言 ② 会让「恰好有一拍落在跳变后」蒙混过关。
      await dismissCards()
      const driftBefore = await js(TARIFF_DRIFT)
      const jumpState = await jumpTo(Date.parse('2026-10-16T14:30:00+08:00'), 'peak', 'peak-before-jump')
      // 一次性跳到 19:00：真实时钟直接前进 4.5 小时。
      const jumpInfo = await js(`(() => {
        const base = window.__v13RealNow === undefined ? Date.now : window.__v13RealNow
        Date.now = () => ${Date.parse('2026-10-16T19:00:00+08:00')}
        return { target: ${Date.parse('2026-10-16T19:00:00+08:00')} }
      })()`)
      const jumpAlert = await waitForTariffAlert('clock-jump', 75000, { wanted: OFFPEAK_COPY })
      if (jumpAlert !== null) await shoot(target.replace(/\.png$/i, '-alert-jump.png'))
      const driftAfter = await js(TARIFF_DRIFT)
      log(`TARIFF-JUMP[${name}] before=${JSON.stringify(driftBefore)} after=${JSON.stringify(driftAfter)} alert=${jumpAlert === null ? 'null' : 'got'}`)
      record.clockJump = {
        target: jumpInfo.target,
        driftBefore,
        driftAfter,
        alert: jumpAlert === null ? null : (jumpAlert.ownText ?? jumpAlert.matches[0]?.text ?? null),
        screenshot: jumpAlert === null ? null : target.replace(/\.png$/i, '-alert-jump.png'),
        // `TARIFF_DRIFT` 返回的是 `{drift: {gapMs, jumped}, lastTickAt, state}`，
        // 因此 jumped 在 `driftAfter.drift.jumped` 上，不是 `driftAfter.jumped`。
        jumped: driftAfter !== null && driftAfter.drift !== undefined && driftAfter.drift.jumped === true,
        // 识别之后必须补上卡片。
        recovered: jumpAlert !== null,
        inspect: jumpState.snapshot.blocks
      }

      // 还原时钟与本地数据。
      await js(RESTORE_CLOCK)
      await js(`(() => {
        const back = ${JSON.stringify(backup)}
        if (back.history === null) localStorage.removeItem('dsh-balance-pill:history')
        else localStorage.setItem('dsh-balance-pill:history', back.history)
        if (back.sessions === null) localStorage.removeItem('dsh-balance-pill:sessions')
        else localStorage.setItem('dsh-balance-pill:sessions', back.sessions)
        return true
      })()`)
      await sleep(2500)
      const restored = await js(TARIFF_INSPECT)
      log(`TARIFF-RESTORE[${name}] period=${String(restored.period)} reason=${String(restored.reason)}`)
      record.injected = [peakState, middayState].map((row) => ({
        injectedNow: row.info.injectedNow,
        expected: { period: row.want.period, reason: row.want.reason },
        actual: { period: row.snapshot.period, reason: row.snapshot.reason, blocks: row.snapshot.blocks },
        assertions: row.assertions
      }))
      record.tariffAlert = {
        peak: peakAlert,
        offPeak: middayAlert,
        fallback: fallbackAlert,
        peakScreenshot: peakAlert === null ? null : target.replace(/\.png$/i, '-alert.png'),
        offPeakScreenshot: middayAlert === null ? null : target.replace(/\.png$/i, '-alert-offpeak.png'),
        fallbackScreenshot: fallbackAlert === null ? null : target.replace(/\.png$/i, '-alert-fallback.png'),
        peakShot
      }
      record.restored = { period: restored.period, reason: restored.reason }

      // 回到真实时间后取第二次倒计时文本，断言「走字」。
      // 分钟粒度的文案最多 60 秒必然跳一次；给它到 95 秒的上限。
      await ensurePanelOpen()
      let nextAfter = await js(NEXT_TEXT)
      const tickDeadline = tickWatchStartedAt + 95000
      while (nextAfter === nextBefore && Date.now() < tickDeadline) {
        await sleep(3000)
        nextAfter = await js(NEXT_TEXT)
      }
      record.tick = {
        before: nextBefore,
        after: nextAfter,
        elapsedMs: Date.now() - tickWatchStartedAt,
        changed: nextBefore !== null && nextAfter !== null && nextBefore !== nextAfter
      }
      log(`TARIFF-TICK[${name}] before=${JSON.stringify(nextBefore)} after=${JSON.stringify(nextAfter)} elapsedMs=${record.tick.elapsedMs} changed=${String(record.tick.changed)}`)

      // 关闭 showTariff：徽标消失、data-tariff 仍在；再打开要恢复。
      const writeSettings = async (patch) => {
        await js(`(() => {
          const key = 'dsh-balance-pill:settings'
          const raw = localStorage.getItem(key)
          const parsed = raw === null ? {} : JSON.parse(raw)
          localStorage.setItem(key, JSON.stringify(Object.assign({}, parsed, ${JSON.stringify(patch)})))
          return true
        })()`)
        await js('location.reload(); true')
        await sleep(1500)
        await boot(`settings:${name}`)
        await waitFor(SNAPSHOT, (snap) => snap !== null && snap.hasPill && snap.pillStatus !== 'loading', 30000, `settings:${name}`)
        return await js(TARIFF_INSPECT)
      }

      const offInspect = await writeSettings({ showTariff: false, alertOnTariff: true })
      const offShot = target.replace(/\.png$/i, '-no-tariff.png')
      await shoot(offShot)
      log(`TARIFF-OFF[${name}] period=${String(offInspect.period)} badge=${JSON.stringify(offInspect.badge)}`)
      record.tariffOff = { inspect: offInspect, screenshot: offShot }

      const onInspect = await writeSettings({ showTariff: true, alertOnTariff: true })
      log(`TARIFF-ON[${name}] period=${String(onInspect.period)} badge=${JSON.stringify(onInspect.badge === null ? null : onInspect.badge.text)}`)
      record.tariffBackOn = { inspect: onInspect }
    }

    if (variant.configSwitchCheck === true) {
      // v0.1.6 主线之一：把「徽章数字」从可用合计切到赠金（¥0.00）会让金额与
      // 档位同时跳，旧实现把它当成真实掉档并弹「余额不足」；现在必须静默。
      // 这里直接调用配置 store（同一个 update 路径），不依赖设置面板的选择器。
      const record = results[results.length - 1]
      const before = await js(BALANCE_ALERT_INSPECT)
      const switched = await js(SERVICE_UPDATE({ format: 'bonus' }))
      await sleep(600)
      const panelOpen = await js("document.querySelector('[data-balance-panel]') !== null")
      if (!panelOpen) {
        await js("(() => { const el = document.querySelector('.dbp_trigger'); if (el !== null) el.click(); return true })()")
        await sleep(800)
      }
      await js("(() => { const el = document.querySelector('.dbp_refresh'); if (el === null) return false; el.click(); return true })()")
      await sleep(2500)
      const after = await js(BALANCE_ALERT_INSPECT)
      const afterPill = await js(INSPECT)
      const shot = target.replace(/\.png$/i, '-config-switch.png')
      await shoot(shot)
      log(`CONFIG-SWITCH[${name}] switched=${JSON.stringify(switched)} beforeLevel=${String(before.pillLevel)} afterLevel=${String(after.pillLevel)} matches=${after.matches.length} ownLevel=${String(after.ownLevel)}`)
      record.configSwitch = {
        switched,
        before: { pillLevel: before.pillLevel, pillText: before.pillText, matches: before.matches.length },
        after: { pillLevel: after.pillLevel, pillText: after.pillText, matches: after.matches, ownLevel: after.ownLevel },
        afterPillAttrs: afterPill.pillAttrs,
        screenshot: shot
      }
      // 还原口径，避免影响后续变体。
      await js(SERVICE_UPDATE({ format: 'total' }))
      await sleep(600)
      await js("(() => { const el = document.querySelector('.dbp_refresh'); if (el === null) return false; el.click(); return true })()")
      await sleep(1200)
      record.configSwitchAfter = await js(BALANCE_ALERT_INSPECT)
    }

    if (variant.balanceAlertCheck === true) {
      // v1.2 余额跨档提醒的回归：它此前**从未在真实 GUI 里渲染过** —— 浮层条目因
      // `getSnapshot` 缺失崩溃后被宿主摘掉，提醒通路整条不可达。这里用真实设置控件
      // 制造一次「金额变化 + 档位变差」（把徽章口径切到赠金 ¥0.00），断言卡片可见。
      const record = results[results.length - 1]
      const openedSettings = await js(OPEN_SETTINGS)
      await sleep(1200)
      const general = await js(OPEN_GENERAL)
      await sleep(1200)
      const rowMounted = await js("document.querySelector('[data-balance-settings]') !== null")
      const before = await js(BALANCE_ALERT_INSPECT)
      log(`BALANCE-ALERT[${name}] openSettings=${String(openedSettings)} general=${String(general)} rowMounted=${String(rowMounted)} before=${JSON.stringify(before)}`)

      await js(changeScript('format', 'bonus'))
      await sleep(900)
      // 口径改完要让组件真的重新读数：手动刷新（force=true 不受 10 秒防抖影响）。
      const panelOpen = await js("document.querySelector('[data-balance-panel]') !== null")
      if (!panelOpen) {
        await js("(() => { const el = document.querySelector('.dbp_trigger'); if (el !== null) el.click(); return true })()")
        await sleep(900)
      }
      await js("(() => { const el = document.querySelector('.dbp_refresh'); if (el === null) return false; el.click(); return true })()")

      let card = null
      const deadline = Date.now() + 30000
      while (Date.now() < deadline) {
        await sleep(1200)
        const snapshot = await js(BALANCE_ALERT_INSPECT)
        if (snapshot.ownLevel !== null || snapshot.matches.length > 0) {
          card = snapshot
          break
        }
      }
      const shot = target.replace(/\.png$/i, '-balance-alert.png')
      if (card !== null) await shoot(shot)
      log(`BALANCE-ALERT[${name}] card=${JSON.stringify(card)}`)
      record.balanceAlert = { before, card, rowMounted, screenshot: card === null ? null : shot }

      // 还原口径（不改其它设置）并收起设置面板。
      await js(changeScript('format', 'total'))
      await sleep(900)
      await js("(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true })()")
      await sleep(600)
      record.balanceAlertAfter = await js(BALANCE_ALERT_INSPECT)
      log(`BALANCE-ALERT[${name}] restored=` + JSON.stringify(record.balanceAlertAfter))
    }

    // `variant.runoutCheck`：验证徽章的 `data-balance-runout`（v1.4）。
    //
    // 这个属性要求「有读数 + 有正的消耗速度 + 24 小时内耗尽」，三者同时成立。
    // 速度由 `computeRate` 从**两次真实读数**算出：要求相隔 ≥30 秒、且余额至少
    // 掉 0.01（平台给的是两位小数字符串）。账号在空闲时消耗很慢，因此这里**轮询
    // 等待真实的消耗**，而不是缩短等待时间或伪造读数 —— 走的是与用户完全相同的
    // 路径（面板上的「刷新」按钮 = 用户能做的同一件事）。
    //
    // 轮询上限约 3 分钟：按本机实测的消耗速度（≈¥1.4/小时），攒够 0.01 大约 26 秒，
    // 几轮之内必然成立；如果账号确实没在消耗，那就**应当**看不到这个属性
    // （无速度 = 无预估），此时记录 null 并如实报告，不做假。
    if (variant.runoutCheck === true) {
      const record = results[results.length - 1]
      const open = await js("(() => { const el = document.querySelector('.dbp_trigger'); if (el === null) return false; el.click(); return true })()")
      await sleep(1000)
      const before = await js(TARIFF_INSPECT)
      const deadline = Date.now() + 180000
      let after = before
      let attempts = 0
      while (Date.now() < deadline && after.runout === null) {
        attempts += 1
        // 等过 MIN_REFRESH_GAP_MS（10 秒）并给余额攒够一次可见的下降。
        await sleep(32000)
        await js("(() => { const el = document.querySelector('.dbp_refresh'); if (el === null) return false; el.click(); return true })()")
        await sleep(2500)
        after = await js(TARIFF_INSPECT)
        log(`RUNOUT[${name}] attempt=${attempts} runout=${JSON.stringify(after.runout)} title=${JSON.stringify(after.runoutTitle)}`)
      }
      const shot = target.replace(/\.png$/i, '-runout.png')
      await shoot(shot)
      log(`RUNOUT[${name}] opened=${String(open)} attempts=${attempts} before=${JSON.stringify({ runout: before.runout, today: before.todaySpend })} after=${JSON.stringify({ runout: after.runout, title: after.runoutTitle, today: after.todaySpend })}`)
      record.runout = {
        opened: open,
        attempts,
        before: { runout: before.runout, todaySpend: before.todaySpend },
        after: { runout: after.runout, title: after.runoutTitle, todaySpend: after.todaySpend },
        screenshot: shot
      }
    }

    // `variant.blockAccount` 用请求取消模拟「平台读取失败」，验证 stale 路径：
    // 数字必须保留、状态转 stale、面板给出过期提示。
    if (variant.blockAccount === true && panel.panelFound) {
      blockAccount = true
      await js(`(() => { const el = document.querySelector('.dbp_refresh'); if (!el) return false; el.click(); return true })()`)
      await sleep(1500)
      const staleInspect = await js(INSPECT)
      const stalePanel = await js(INSPECT_PANEL)
      log(`STALE[${name}] ` + JSON.stringify(staleInspect.pillAttrs) + ' ' + JSON.stringify(stalePanel.stale))
      await shoot(target.replace(/\.png$/i, '-stale.png'))
      blockAccount = false
      await js(`(() => { const el = document.querySelector('.dbp_refresh'); if (!el) return false; el.click(); return true })()`)
      await sleep(1500)
      const recovered = await js(INSPECT)
      log(`RECOVERED[${name}] ` + JSON.stringify(recovered.pillAttrs))
      results[results.length - 1].stale = { inspect: staleInspect, panel: stalePanel, recovered }
    }

    // `variant.crossLevel` 用「把红色阈值临时抬到当前余额之上」制造一次真实掉档
    // （ok → low），验证 v1.2 的跨档提醒是否真的浮出来。
    //
    // 为什么用设置而不是伪造余额：提醒的触发点就是「档位变差」，而档位由
    // 余额与阈值共同决定 —— 抬阈值是唯一能在不篡改读数、不真花钱的前提下
    // 触发它的路径，且走的是与用户完全相同的代码路径。
    if (variant.crossLevel === true) {
      const current = await js(INSPECT)
      const amount = Number(String(current.trigger.text).replace(/[^0-9.]/g, ''))
      log(`cross: current=${current.trigger.text} -> raising thresholds above ${amount}`)
      // 先把档位推回 ok（阈值设 0），让下一次写阈值成为一次真实的「变差」。
      await js(`(() => {
        const key = 'dsh-balance-pill:settings'
        const raw = localStorage.getItem(key)
        const parsed = raw === null ? {} : JSON.parse(raw)
        localStorage.setItem(key, JSON.stringify({ ...parsed, low: 0, warn: 0 }))
        return true
      })()`)
      await js(`(() => { const el = document.querySelector('.dbp_refresh'); if (!el) return false; el.click(); return true })()`)
      await sleep(1800)
      const reset = await js(INSPECT)
      log(`cross: after reset=${JSON.stringify(reset.pillAttrs)}`)

      // 现在把两个阈值都抬到余额之上：下一次读取会把它判成 low，且是从 ok 掉下来的。
      await js(`(() => {
        const key = 'dsh-balance-pill:settings'
        const raw = localStorage.getItem(key)
        const parsed = raw === null ? {} : JSON.parse(raw)
        localStorage.setItem(key, JSON.stringify({ ...parsed, low: 99999, warn: 99999 }))
        return true
      })()`)
      await js(`(() => { const el = document.querySelector('.dbp_refresh'); if (!el) return false; el.click(); return true })()`)
      await sleep(2500)
      const alert = await js(INSPECT_ALERT)
      const after = await js(INSPECT)
      log(`ALERT[${name}] ` + JSON.stringify(alert))
      log(`cross: after raise=${JSON.stringify(after.pillAttrs)}`)
      const alertShot = target.replace(/\.png$/i, '-alert.png')
      await shoot(alertShot)
      results[results.length - 1].crossing = { amount, reset: reset.pillAttrs, after: after.pillAttrs, alert, screenshot: alertShot }
    }
  }

  const summary = {
    url: URL_TO_LOAD,
    elapsedMs: Date.now() - started,
    alreadyOpen,
    picked,
    candidates: candidates.slice(0, 40),
    blockedUrls: blockedUrls.slice(0, 10),
    results,
    consoleMessages: consoleMessages.slice(0, 40)
  }
  // 汇总判定：v1.2 的「徽章与面板都在」+ v1.3 的三条硬要求
  // （时段断言全过、倒计时走字、关掉 showTariff 后徽标消失）。
  const allTariff = results.flatMap((row) => [
    ...(row.tariff?.assertions ?? []),
    ...(row.injected ?? []).flatMap((item) => item.assertions ?? [])
  ])
  const tariffFailed = allTariff.filter((row) => row.ok === false)
  const tickRows = results.map((row) => row.tick).filter(Boolean)
  const offRows = results.map((row) => row.tariffOff).filter(Boolean)
  const alertRows = results.map((row) => row.tariffAlert).filter(Boolean)
  // 宿主浮层条目的崩溃痕迹：`getSnapshot` 缺失会让条目被宿主永久摘掉，
  // 提醒卡从此不再出现 —— 这条必须在证据里显式核对（本轮修的就是它）。
  const slotErrors = (summary.consoleMessages ?? []).filter((line) =>
    /getSnapshot is not a function|slot entry crashed in 'shell\.overlay'/.test(String(line))
  )
  const evidence = {
    slotErrors,
    slotErrorsAbsent: slotErrors.length === 0,
    pillAndPanelOk: results.every((row) => row.inspect.pillFound && row.panel.panelFound),
    tariffAssertions: allTariff.length,
    tariffFailed: tariffFailed.length,
    tariffFailedChecks: tariffFailed.map((row) => `${row.check}: 期望 ${JSON.stringify(row.expected)} / 实际 ${JSON.stringify(row.actual)}`),
    countdownTick: tickRows.map((row) => ({ before: row.before, after: row.after, elapsedMs: row.elapsedMs, changed: row.changed })),
    showTariffOff: offRows.map((row) => ({ period: row.inspect.period, badge: row.inspect.badge === null ? null : row.inspect.badge.text })),
    showTariffBackOn: results.map((row) => row.tariffBackOn?.inspect?.badge?.text ?? null),
    tariffAlerts: alertRows.map((row) => ({
      peak: row.peak === null ? null : (row.peak.ownText ?? row.peak.matches[0]?.text ?? null),
      offPeak: row.offPeak === null ? null : (row.offPeak.ownText ?? row.offPeak.matches[0]?.text ?? null),
      fallbackCardKind: row.fallback === null ? null : row.fallback.ownKind,
      fallbackCardText: row.fallback === null ? null : row.fallback.ownText,
      ownKind: row.peak?.ownKind ?? row.offPeak?.ownKind ?? null
    })),
    balanceAlerts: results.filter((row) => row.balanceAlert !== undefined).map((row) => ({
      rowMounted: row.balanceAlert.rowMounted,
      beforePill: row.balanceAlert.before?.pillText ?? null,
      card: row.balanceAlert.card === null ? null : (row.balanceAlert.card.ownText ?? row.balanceAlert.card.matches[0]?.text ?? null),
      screenshot: row.balanceAlert.screenshot
    })),
    // v0.1.6：切换徽章口径（金额/档位同时跳）不允许弹余额提醒。
    configSwitches: results.filter((row) => row.configSwitch !== undefined).map((row) => ({
      variant: row.variant.name,
      switched: row.configSwitch.switched,
      beforeLevel: row.configSwitch.before.pillLevel,
      afterLevel: row.configSwitch.after.pillLevel,
      afterMatches: row.configSwitch.after.matches.length,
      afterOwnLevel: row.configSwitch.after.ownLevel,
      screenshot: row.configSwitch.screenshot
    })),
    // ---- v1.4 ----
    // 时钟跳变自愈（D1 的验收）：jumped 必须为真、卡片必须补上。
    clockJumps: results.filter((row) => row.clockJump !== undefined).map((row) => ({
      target: row.clockJump.target,
      jumpDetected: row.clockJump.jumped,
      recovered: row.clockJump.recovered,
      driftBefore: row.clockJump.driftBefore?.drift ?? null,
      driftAfter: row.clockJump.driftAfter?.drift ?? null,
      alert: row.clockJump.alert,
      screenshot: row.clockJump.screenshot
    })),    // 余额耗尽预估：记录每个变体下它是否存在，便于核对「条件不满足就不存在」。
    runouts: results.map((row) => ({
      variant: row.variant.name,
      runout: row.inspect.runout ?? null,
      title: row.inspect.runoutTitle ?? null
    })),
    // v1.4：专门跑过刷新、让消耗速度成立的那个变体的实测值。
    runoutChecks: results.filter((row) => row.runout !== undefined).map((row) => ({
      variant: row.variant.name,
      beforeRunout: row.runout.before.runout,
      afterRunout: row.runout.after.runout,
      afterTitle: row.runout.after.title,
      todaySpend: row.runout.after.todaySpend,
      screenshot: row.runout.screenshot
    })),
    // 「今日已用」：值与趋势图开关无关。
    todaySpends: results.map((row) => ({
      variant: row.variant.name,
      text: row.tariff?.inspect?.todaySpend ?? null,
      hasTrend: row.tariff?.inspect?.hasTrend ?? null
    })),
    // ---- v0.1.6 ----
    // 「近 7 天已用」：跨天变体必须真的渲染出这一行；值应包含「近 7 天已用」。
    recentSpends: results.map((row) => ({
      variant: row.variant.name,
      text: row.tariff?.inspect?.recentSpend ?? null,
      expected: row.variant.expectRecentSpend === true,
      week: row.tariff?.inspect?.weekSpend ?? null
    })),
    // 每个面板都应该带版本号，且是当前构建的 0.1.6。
    panelVersions: results.map((row) => ({
      variant: row.variant.name,
      text: row.tariff?.inspect?.version ?? null
    })),
    // 面板限高：默认窗口下必须落在视口内；小窗口下允许 scrollHeight > clientHeight，
    // 但不允许 rect.top < 0（标题被裁掉）。
    panelScroll: results.map((row) => ({
      variant: row.variant.name,
      ...(row.tariff?.inspect?.panelScroll ?? {})
    }))
  }
  summary.evidence = evidence
  const alertRowsOk = alertRows.length === 0 || alertRows.every((row) => row.peak !== null && row.offPeak !== null && row.fallback !== null)
  const balanceRowsOk = evidence.balanceAlerts.length === 0 || evidence.balanceAlerts.every((row) => row.card !== null)
  // v1.4：每个做了时钟跳变的变体都必须「识别出跳变」且「补上了卡片」。
  const jumpRowsOk = evidence.clockJumps.length === 0 ||
    evidence.clockJumps.every((row) => row.jumpDetected === true && row.recovered === true)
  // v0.1.6：跨天变体必须真的渲染「近 7 天已用」；版本号必须出现且是 0.1.6。
  const recentRowsOk = evidence.recentSpends
    .filter((row) => row.expected === true)
    .every((row) => typeof row.text === 'string' && row.text.includes('近 7 天已用'))
  const versionRowsOk = evidence.panelVersions.every((row) => row.text === 'v0.1.6')
  // 配置变化必须真的改变了档位（证明切换生效），同时**不能**出现提醒卡。
  const configSwitchRows = results.filter((row) => row.configSwitch !== undefined)
  const configSwitchOk = configSwitchRows.every((row) =>
    row.configSwitch.switched?.ok === true &&
    row.configSwitch.before.pillLevel !== row.configSwitch.after.pillLevel &&
    row.configSwitch.after.matches.length === 0 &&
    row.configSwitch.after.ownLevel === null
  )
  // 面板必须落在视口内；小窗口下允许内部滚动，但标题不能被裁到视口外。
  const panelScrollOk = evidence.panelScroll.every((row) =>
    row.top === undefined || (row.top >= 0 && row.bottom <= HEIGHT + 1)
  )
  evidence.tariffAlertDirectionsOk = alertRowsOk
  evidence.balanceAlertOk = balanceRowsOk
  evidence.clockJumpOk = jumpRowsOk
  evidence.recentSpendOk = recentRowsOk
  evidence.versionOk = versionRowsOk
  evidence.panelScrollOk = panelScrollOk
  evidence.configSwitchOk = configSwitchOk
  const ok =
    evidence.pillAndPanelOk &&
    evidence.slotErrorsAbsent &&
    evidence.tariffFailed === 0 &&
    allTariff.length > 0 &&
    tickRows.every((row) => row.changed === true) &&
    offRows.every((row) => row.inspect.badge === null && row.inspect.period !== null) &&
    alertRowsOk &&
    balanceRowsOk &&
    jumpRowsOk &&
    recentRowsOk &&
    versionRowsOk &&
    panelScrollOk &&
    configSwitchOk
  fs.writeFileSync(OUT_JSON, JSON.stringify(summary, null, 2))
  log(`wrote ${OUT_JSON}`)
  log('EVIDENCE ' + JSON.stringify(evidence))
  log(`RESULT ok=${String(ok)} tariffAssertions=${evidence.tariffAssertions} failed=${evidence.tariffFailed}`)

  // 收尾：清掉验证台写进去的配置，别把它留在浏览器存储里。
  await js("localStorage.removeItem('dsh-balance-pill:settings'); localStorage.removeItem('dsh-balance-pill:thresholds'); true").catch(() => {})

  win.destroy()
  return ok ? 0 : 3
}

app.setPath('userData', USER_DATA)
app.setPath('sessionData', USER_DATA)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('force-color-profile', 'srgb')
app.disableHardwareAcceleration()

app.whenReady()
  .then(main)
  .then((code) => app.exit(code))
  .catch((error) => {
    log('ERROR ' + (error && error.stack ? error.stack : String(error)))
    app.exit(1)
  })
