/**
 * 时段提醒卡的定位探针（一次性诊断用，可复跑）。
 *
 * 目的：判断「注入时钟跨过时段边界后浮层没有出现 tariff 卡」到底是
 *   (a) 宿主浮层里的看门狗没在 tick，还是
 *   (b) tick 了但状态机没产出提醒，还是
 *   (c) 产出了但卡片渲染/查找方式不对。
 *
 * 做法：同一个页面里同时测三件事 ——
 *   1. 定时器节奏：装一个 1 秒 interval，8 秒后数它跳了几次（排除离屏窗口节流）；
 *   2. MutationObserver：记录浮层与 body 的每一次插入/文本变化（哪怕是闪现 1 帧的卡）；
 *   3. 时间注入：把时钟推到「高峰」与「空闲」两侧各等 75 秒，轮询卡片与 overlay 文本。
 *
 * 用法（先清 ELECTRON_RUN_AS_NODE）：
 *   .\electron\electron.exe probe-tariff-alert.mjs --url=http://127.0.0.1:19387/
 */
import { app, BrowserWindow, session } from 'electron'
import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const HERE = import.meta.dirname
const USER_DATA = path.join(HERE, 'userdata')
const LOG_FILE = path.join(HERE, 'out', 'probe-tariff-alert.log')

process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
const log = (line) => {
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
    fs.appendFileSync(LOG_FILE, line + '\n')
  } catch { /* ignore */ }
  try {
    console.log(line)
  } catch { /* ignore */ }
}

try {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true })
  fs.writeFileSync(LOG_FILE, '')
} catch { /* ignore */ }

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
const WATCHDOG_MS = Number(args.watchdog ?? 300000)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

setTimeout(() => {
  log(`WATCHDOG: 超过 ${WATCHDOG_MS} ms，强制退出`)
  app.exit(4)
}, WATCHDOG_MS).unref?.()

const DSH_HOME = process.env.DSH_HOME ?? 'C:\\Users\\李\\.dsh'
const CREDENTIALS_FILE = path.join(DSH_HOME, '.credentials.yaml')
const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function mintCookieFor (base) {
  const url = new URL(base)
  const authority = url.host
  const lines = fs.readFileSync(CREDENTIALS_FILE, 'utf8').split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim() === 'client-connection/browser-session:')
  if (at === -1) throw new Error('credentials: 没有 browser-session 记录')
  const indent = lines[at].length - lines[at].trimStart().length
  let secret = null
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (lines[i].length - lines[i].trimStart().length <= indent) break
    const m = /^\s*secret:\s*(\S+)\s*$/.exec(lines[i])
    if (m) { secret = Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64'); break }
  }
  if (secret === null || secret.byteLength !== 32) throw new Error('credentials: secret 缺失或长度不对')
  const issuedAt = Date.now()
  const expiresAt = issuedAt + 30 * 1440 * 60 * 1000
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'))
  const signature = b64url(createHmac('sha256', secret).update(body).digest())
  const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
  return { authority, name, value: `v1.${body}.${signature}`, header: `${name}=v1.${body}.${signature}`, origin: url.origin }
}

const CARD_INSPECT = `(() => {
  const flat = (el) => (el.textContent || '').replace(/\\s+/g, ' ').trim()
  const own = document.querySelector('[data-balance-alert]')
  const overlay = document.querySelector('[data-shell-overlay]')
  const wanted = /进入高峰时段|进入空闲时段|Peak hours started|Off-peak hours started/
  const matches = [...document.querySelectorAll('body *')]
    .filter((el) => wanted.test(el.textContent || ''))
    .map((el) => ({ tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '', text: flat(el).slice(0, 120) }))
    .filter((row) => row.text.length < 160)
    .slice(0, 3)
  return {
    ownKind: own === null ? null : own.getAttribute('data-balance-alert-kind'),
    ownText: own === null ? null : flat(own).slice(0, 160),
    overlayText: overlay === null ? '' : flat(overlay).slice(0, 200),
    overlayChildElements: overlay === null ? -1 : overlay.querySelectorAll('*').length,
    matches,
    mutations: (window.__v13Mutations ?? []).slice(-12),
    mutationCount: (window.__v13Mutations ?? []).length
  }
})()`

const INSTALL_OBSERVER = `(() => {
  window.__v13Mutations = []
  const push = (kind, node) => {
    if (window.__v13Mutations.length > 300) return
    const text = (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 100)
    window.__v13Mutations.push({ kind, text, at: Date.now() })
  }
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'characterData' || record.type === 'attributes') { push(record.type, record.target); continue }
      for (const node of record.addedNodes) push('added', node)
    }
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  window.__v13Observer = observer
  return true
})()`

const TIMER_PROBE = `(async () => {
  let count = 1
  const started = Date.now()
  const timer = setInterval(() => count++, 1000)
  await new Promise((resolve) => setTimeout(resolve, 8000))
  clearInterval(timer)
  return { expected: 8, actual: count - 1, elapsedMs: Date.now() - started }
})()`

const PILL_STATE = `(() => {
  const pill = document.querySelector('[data-balance-pill]')
  return {
    period: pill === null ? null : pill.getAttribute('data-tariff'),
    reason: pill === null ? null : pill.getAttribute('data-tariff-reason'),
    badge: pill === null ? null : (pill.querySelector('.dbp_tariff')?.textContent ?? null),
    now: Date.now()
  }
})()`

/**
 * 在页面里装一个「从 fiber 根往下找提醒宿主」的查找器。
 *
 * 提醒宿主在没有任何卡片时渲染 `null`，所以它的 fiber 没有对应 DOM 节点，不能从
 * 浮层 DOM 往上找；只能从任意 DOM 节点的 fiber 上溯到根，再 DFS 找 props 里带
 * `tariff` 的那个组件。纯只读。
 */
const INSTALL_FINDER = `(() => {
  const rootOf = (node) => {
    if (node === null || node === undefined) return null
    const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    if (key === undefined) return null
    let root = node[key]
    let guard = 0
    while (root.return !== null && root.return !== undefined && guard++ < 200) root = root.return
    return root
  }
  window.__v13Root = () => rootOf(document.querySelector('[data-balance-pill]') ?? document.body.firstElementChild)
  window.__v13FindHost = () => {
    const root = window.__v13Root()
    if (root === null) return null
    const stack = [root]
    let visited = 0
    while (stack.length > 0 && visited++ < 50000) {
      const fiber = stack.pop()
      if (fiber === null || fiber === undefined) continue
      const props = fiber.memoizedProps
      if (props !== null && props !== undefined && props.tariff !== undefined) return fiber
      if (fiber.child !== null && fiber.child !== undefined) stack.push(fiber.child)
      if (fiber.sibling !== null && fiber.sibling !== undefined) stack.push(fiber.sibling)
    }
    return null
  }
  /** fiber 普查：函数组件名 → props 键，用来确认遍历有效、以及提醒宿主在不在树里。 */
  window.__v13Census = () => {
    const root = window.__v13Root()
    if (root === null) return { error: 'no root' }
    const rows = []
    let total = 0
    let withService = 0
    let withTariff = 0
    const stack = [root]
    while (stack.length > 0 && total < 50000) {
      const fiber = stack.pop()
      if (fiber === null || fiber === undefined) continue
      total += 1
      const type = fiber.type
      if (typeof type === 'function') {
        const props = fiber.memoizedProps ?? {}
        const keys = Object.keys(props)
        if (keys.includes('service')) withService += 1
        if (keys.includes('tariff')) withTariff += 1
        const name = type.name || 'anonymous'
        if (/Balance|Alert|Toast|Pill/i.test(name) || keys.includes('tariff') || keys.includes('service')) {
          rows.push({ name, keys: keys.slice(0, 12), hasTariff: keys.includes('tariff'), hasService: keys.includes('service') })
        }
      }
      if (fiber.child !== null && fiber.child !== undefined) stack.push(fiber.child)
      if (fiber.sibling !== null && fiber.sibling !== undefined) stack.push(fiber.sibling)
    }
    return { total, withService, withTariff, rows: rows.slice(0, 25) }
  }
  window.__v13OverlayDump = () => {
    const overlay = document.querySelector('[data-shell-overlay]')
    if (overlay === null) return null
    return [...overlay.childNodes].map((node) => ({
      type: node.nodeType,
      name: node.nodeName,
      text: (node.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      kids: node.childNodes === undefined ? 0 : node.childNodes.length
    }))
  }
  return true
})()`

/**
 * 只读地看一眼宿主浮层里那个提醒宿主组件：props 是否拿全了、
 * 看门狗的 `state()`（状态机）与 `latest()`（最近一次 tick 的快照）。
 * 这是唯一能把「effect 没跑 / tick 没跑 / 状态机没产出」区分开的观测点。
 */
const FIBER_PROBE = `(() => {
  const fiber = typeof window.__v13FindHost === 'function' ? window.__v13FindHost() : null
  if (fiber === null) return { found: false }
  const props = fiber.memoizedProps
  const type = fiber.type
  const tariff = props.tariff
  let state = null
  let latest = null
  try { state = typeof tariff.state === 'function' ? tariff.state() : null } catch (error) { state = String(error) }
  try {
    const snap = typeof tariff.latest === 'function' ? tariff.latest() : null
    latest = snap === null ? null : { period: snap.period, now: snap.now, msUntilPeak: snap.msUntilPeak, msUntilOffPeak: snap.msUntilOffPeak }
  } catch (error) { latest = String(error) }
  return {
    found: true,
    component: typeof type === 'function' ? (type.name || 'anonymous') : String(type),
    hasSettings: props.settings !== undefined && props.settings !== null,
    hasUseAlert: props.useAlert !== undefined,
    settingsAlertOnTariff: props.settings !== undefined && props.settings !== null ? props.settings.get().alertOnTariff : null,
    state,
    latest,
    now: Date.now()
  }
})()`

/** 直接用看门狗 tick 一次，对比状态机前后（只读 + 一次显式 tick，不改实现）。 */
const MANUAL_TICK = `(() => {
  const fiber = typeof window.__v13FindHost === 'function' ? window.__v13FindHost() : null
  if (fiber === null) return { ok: false, reason: 'host not found' }
  const props = fiber.memoizedProps
  try {
    const before = props.tariff.state()
    const snap = props.tariff.tick({ settings: props.settings.get() })
    const after = props.tariff.state()
    return { ok: true, before, after, snapshot: { period: snap.period, now: snap.now } }
  } catch (error) {
    return { ok: false, reason: String(error && error.stack ? error.stack : error) }
  }
})()`

async function main () {
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

  let lastFrame = null
  const win = new BrowserWindow({
    width: 1600,
    height: 1000,
    show: false,
    skipTaskbar: true,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.on('paint', (_event, _dirty, image) => { lastFrame = image })
  const js = (script) => win.webContents.executeJavaScript(script, true)

  await win.loadURL(URL_TO_LOAD)
  await sleep(4000)
  for (let i = 0; i < 4; i++) {
    const dismissed = await js(`(() => {
      const wanted = ['继续', '知道了', '我知道了', '开始设置', '跳过', '关闭', '确定']
      const hit = [...document.querySelectorAll('button, [role="button"]')].find((el) => wanted.includes((el.textContent || '').trim()))
      if (!hit) return null
      hit.click()
      return (hit.textContent || '').trim()
    })()`)
    if (dismissed === null) break
    await sleep(600)
  }

  // 让 alertOnTariff 生效：写存储 + 重载（设置 store 不认识外部 localStorage 写入）。
  await js(`(() => {
    const key = 'dsh-balance-pill:settings'
    const raw = localStorage.getItem(key)
    const parsed = raw === null ? {} : JSON.parse(raw)
    localStorage.setItem(key, JSON.stringify({ ...parsed, showTariff: true, alertOnTariff: true, tariffModel: 'flash' }))
    return true
  })()`)
  await js('location.reload(); true')
  await sleep(4000)
  log('stored: ' + JSON.stringify(await js("localStorage.getItem('dsh-balance-pill:settings')")))
  log('pill: ' + JSON.stringify(await js(PILL_STATE)))

  log('timerProbe: ' + JSON.stringify(await js(TIMER_PROBE)))
  await js(INSTALL_OBSERVER)
  log('observer installed')
  log('finder installed: ' + JSON.stringify(await js(INSTALL_FINDER)))
  log('overlayDump: ' + JSON.stringify(await js('window.__v13OverlayDump()')))
  log('census: ' + JSON.stringify(await js('window.__v13Census()')))
  log('fiberInitial: ' + JSON.stringify(await js(FIBER_PROBE)))

  const phases = [
    ['peak', Date.parse('2026-10-16T10:30:00+08:00')],
    ['offpeak', Date.parse('2026-10-16T12:30:00+08:00')]
  ]
  for (const [label, target] of phases) {
    log(`phase=${label} fiberBefore=` + JSON.stringify(await js(FIBER_PROBE)))
    await js(`(() => {
      if (window.__v13RealNow === undefined) window.__v13RealNow = Date.now
      Date.now = () => ${target}
      return true
    })()`)
    const pills = []
    let card = null
    const deadline = Date.now() + 75000
    while (Date.now() < deadline && card === null) {
      await sleep(1500)
      const snapshot = await js(CARD_INSPECT)
      pills.push(snapshot.overlayChildElements)
      if (snapshot.ownKind === 'tariff' || snapshot.matches.length > 0) card = snapshot
    }
    const state = await js(PILL_STATE)
    log(`phase=${label} injected=${new Date(target).toISOString()} pill=${JSON.stringify(state)} card=${JSON.stringify(card)}`)
    log(`phase=${label} fiberAfter=` + JSON.stringify(await js(FIBER_PROBE)))
    log(`phase=${label} manualTick=` + JSON.stringify(await js(MANUAL_TICK)))
    const afterTick = await js(CARD_INSPECT)
    log(`phase=${label} afterManualTick card=${JSON.stringify(afterTick.ownKind ?? afterTick.matches)}`)
    log(`phase=${label} overlayChildSamples=${JSON.stringify(pills.slice(0, 6))}… tail=${JSON.stringify(pills.slice(-3))}`)
    const final = await js(CARD_INSPECT)
    log(`phase=${label} mutations=${final.mutationCount} last=${JSON.stringify(final.mutations)}`)
  }

  await js(`(() => { if (window.__v13RealNow !== undefined) { Date.now = window.__v13RealNow; delete window.__v13RealNow } return true })()`)
  log('restored clock')
  await js("localStorage.removeItem('dsh-balance-pill:settings'); true").catch(() => {})
  win.destroy()
  return 0
}

app.setPath('userData', USER_DATA)
app.setPath('sessionData', USER_DATA)
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.disableHardwareAcceleration()

app.whenReady()
  .then(main)
  .then((code) => app.exit(code))
  .catch((error) => {
    log('ERROR ' + (error && error.stack ? error.stack : String(error)))
    app.exit(1)
  })
