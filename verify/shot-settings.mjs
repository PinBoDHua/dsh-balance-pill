/**
 * 余额徽章 —— 设置行（设置 → 常规）的真实验证台。
 *
 * 与 shot-pill.mjs 同一套路：独立 Electron 打开运行中的 GUI，注入会话 cookie，
 * 打开「设置 → 常规」，然后：
 *   1. 断言宿主的 General 页面里出现了 [data-balance-settings]，并读回每一行；
 *   2. 断言它落在宿主的行序列之中（用同一容器的兄弟节点验证 order 生效）；
 *   3. 真的操作控件（改口径 / 阈值 / 紧凑模式 / 恢复默认），断言配置写进了
 *      localStorage，并截图留证。
 *
 * 用法（先清掉 DSH 导出的 ELECTRON_RUN_AS_NODE）：
 *   $env:ELECTRON_RUN_AS_NODE = $null
 *   .\electron\electron.exe shot-settings.mjs --url=http://127.0.0.1:19387/ --out=out/settings.png
 */
import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { cookieFor } from './dsh-auth.mjs'

const HERE = import.meta.dirname
const LOG_FILE = path.join(HERE, 'out', 'settings.log')

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
const OUT_PNG = path.resolve(HERE, args.out ?? path.join('out', 'settings.png'))
const OUT_JSON = path.resolve(HERE, args.json ?? OUT_PNG.replace(/\.png$/i, '.json'))
const WIDTH = Number(args.width ?? 1600)
const HEIGHT = Number(args.height ?? 1000)
const WATCHDOG_MS = Number(args.watchdog ?? 180000)
/** `--alert-probe` 时额外验证跨档提醒（走真实设置控件）。 */
const ALERT_PROBE = args['alert-probe'] === true || args['alert-probe'] === 'true'

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const SNAPSHOT = `(() => ({
  elementCount: document.body ? document.body.querySelectorAll('*').length : -1,
  hasBoot: typeof globalThis.__DSH_BOOT__ !== 'undefined',
  hasSettingsRow: document.querySelector('[data-balance-settings]') !== null,
  modalOpen: document.querySelector('[role="dialog"]') !== null
}))()`

/** 打开设置面板：点侧边栏底部的「设置」或标题栏的齿轮。 */
const OPEN_SETTINGS = `(() => {
  const byText = [...document.querySelectorAll('button, [role="button"], [role="tab"]')]
    .find((el) => /^(设置|Settings)$/.test((el.textContent || '').trim()))
  if (byText) { byText.click(); return 'text:' + (byText.textContent || '').trim() }
  const gear = document.querySelector('[aria-label*="设置"], [aria-label*="Settings"], [data-settings-trigger]')
  if (gear) { gear.click(); return 'gear' }
  return null
})()`

/** 在设置面板里切到「通用设置」分区（宿主的中文标签是「通用设置」）。 */
const OPEN_GENERAL = `(() => {
  const nodes = [...document.querySelectorAll('button, [role="tab"], [role="button"], li, a')]
  const hit = nodes.find((el) => {
    const text = (el.textContent || '').trim()
    return /^(通用设置|常规|常规设置|General)$/.test(text)
  })
  if (!hit) return null
  hit.click()
  return (hit.textContent || '').trim()
})()`

/** 收集设置行的完整信息，含宿主邻居与所属容器。 */
const INSPECT = `(() => {
  const root = document.querySelector('[data-balance-settings]')
  const describe = (el) => ({
    tag: el.tagName.toLowerCase(),
    cls: el.className && typeof el.className === 'string' ? el.className : '',
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120),
    hasBalance: el.matches('[data-balance-settings]') || el.querySelector('[data-balance-settings]') !== null
  })
  const rows = root === null ? [] : [...root.querySelectorAll('[data-balance-setting]')].map((el) => ({
    id: el.getAttribute('data-balance-setting'),
    text: (el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 160)
  }))
  const controls = root === null ? [] : [...root.querySelectorAll('[data-balance-control]')].map((el) => ({
    id: el.getAttribute('data-balance-control'),
    tag: el.tagName.toLowerCase(),
    type: el.getAttribute('type'),
    value: el.value === undefined ? null : String(el.value),
    checked: el.checked === undefined ? null : el.checked
  }))
  // 宿主「常规」页面把条目渲染成一层 flex 列；用最近的、含多个子节点的祖先作为容器。
  let host = root
  let siblings = null
  while (host !== null && host.parentElement !== null) {
    const parent = host.parentElement
    if (parent.children.length > 1 && parent.querySelector('[data-balance-settings]') !== null) {
      siblings = [...parent.children].map(describe)
      break
    }
    host = parent
  }
  let stored = null
  try { stored = localStorage.getItem('dsh-balance-pill:settings') } catch { /* ignore */ }
  const styleTag = document.querySelector('style[data-plugin-css="dsh-balance-pill/client.css"]')
  const rect = root === null ? null : (() => { const r = root.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } })()
  return {
    found: root !== null,
    rect,
    rows,
    controls,
    siblings,
    stored,
    styleTagInjected: styleTag !== null,
    bodyText: (document.body.textContent || '').replace(/\\s+/g, ' ').slice(0, 400)
  }
})()`

/** 改一个控件的值并派发 React 认得的原生事件。 */
function changeScript (controlId, value) {
  return `(() => {
  const el = document.querySelector('[data-balance-control=${JSON.stringify(controlId)}]')
  if (el === null) return null
  if (el.type === 'checkbox') {
    // 复选框只派发 click：原生 click 自己会翻转 checked 并补一个 change。
    // 先手动赋值再 click 会翻两次，等于没改（这是本验证台踩过的坑）。
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

async function main () {
  const started = Date.now()
  log(`# shot-settings.mjs url=${URL_TO_LOAD}`)

  const cookie = cookieFor(URL_TO_LOAD)
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

  const shoot = async (target) => {
    fs.mkdirSync(path.dirname(target), { recursive: true })
    lastFrame = null
    win.webContents.invalidate()
    const deadline = Date.now() + 8000
    while (lastFrame === null && Date.now() < deadline) await sleep(60)
    if (lastFrame === null) throw new Error('离屏渲染 8 秒内没有收到帧')
    fs.writeFileSync(target, lastFrame.toPNG())
    log(`wrote ${target}`)
  }

  await win.loadURL(URL_TO_LOAD)
  log('did-finish-load')

  const deadline = Date.now() + 30000
  let snap = null
  while (Date.now() < deadline) {
    await sleep(400)
    snap = await js(SNAPSHOT)
    if (snap.elementCount > 200 && snap.hasBoot) break
  }
  log(`boot: ${JSON.stringify(snap)}`)

  // 首次运行弹窗会挡住设置。
  for (let i = 0; i < 4; i += 1) {
    const dismissed = await js(`(() => {
      const wanted = ['继续', '知道了', '我知道了', '开始设置', '跳过']
      const hit = [...document.querySelectorAll('button, [role="button"]')]
        .find((el) => wanted.includes((el.textContent || '').trim()))
      if (!hit) return null
      hit.click()
      return (hit.textContent || '').trim()
    })()`)
    if (dismissed === null) break
    log(`dismissed overlay: ${dismissed}`)
    await sleep(600)
  }

  const opened = await js(OPEN_SETTINGS)
  log(`open settings: ${String(opened)}`)
  await sleep(1200)

  const general = await js(OPEN_GENERAL)
  log(`open general: ${String(general)}`)
  await sleep(1500)

  let inspect = await js(INSPECT)
  if (!inspect.found) {
    // 「常规」可能是默认分区，或分区名不同：把可见的分区标签列出来辅助定位。
    const tabs = await js(`(() => [...document.querySelectorAll('button, [role="tab"], li')]
      .map((el) => (el.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter((text) => text.length > 0 && text.length < 20)
      .slice(0, 40))()`)
    log(`settings tabs: ${JSON.stringify(tabs)}`)
    await sleep(800)
    inspect = await js(INSPECT)
  }
  log('INSPECT ' + JSON.stringify(inspect))

  const interactions = []
  /** 改一个设置控件的值，并等到存储真的变化（React 是异步渲染的）。 */
  const setControl = async (id, value) => {
    const ok = await js(changeScript(id, value))
    await sleep(400)
    return ok === true
  }
  if (inspect.found) {
    await shoot(OUT_PNG)

    /**
     * 跨档提醒的真实验证。
     *
     * 走**设置控件**（而不是直接写 localStorage）：配置 store 在内存里，
     * 只有经由 UI 改动才会同步到组件；直接写存储要等下次页面加载才生效。
     *
     * 步骤：先把两个阈值压到 0（档位必然 ok）→ 再把红色阈值抬到余额之上。
     * 余额一分钱没动、档位却变差 —— 这正是「阈值改动」的场景，用来确认
     * v1.2 的守卫生效：**不**该弹提醒（用户自己刚把线画在那里）。
     */
    if (ALERT_PROBE) {
      const amount = await js(`(() => {
        const el = document.querySelector('[data-balance-pill] .dbp_text')
        const value = el === null ? null : Number((el.textContent || '').replace(/[^0-9.]/g, ''))
        return Number.isFinite(value) && value > 0 ? value : null
      })()`)
      log(`alert probe: current balance=${String(amount)}`)
      if (amount !== null) {
        await setControl('low', '0')
        await setControl('warn', '0')
        const levelAfterZero = await js(`(() => { const el = document.querySelector('[data-balance-pill]'); return el === null ? null : el.getAttribute('data-level') })()`)
        log(`alert probe: level after thresholds=0 -> ${String(levelAfterZero)}`)

        const raised = String(Math.ceil(amount * 10) + 100)
        await setControl('low', raised)
        const after = await js(`(() => {
          const pill = document.querySelector('[data-balance-pill]')
          const own = document.querySelector('[data-balance-alert]')
          return {
            level: pill === null ? null : pill.getAttribute('data-level'),
            ownCard: own === null ? null : (own.textContent || '').replace(/\\s+/g, ' ').trim(),
            overlayText: (() => {
              const overlay = document.querySelector('[data-shell-overlay]')
              return overlay === null ? '' : (overlay.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 120)
            })()
          }
        })()`)
        log(`alert probe: after raise=${JSON.stringify(after)}`)
        interactions.push({ id: 'alert-probe', amount, raised, levelAfterZero, after })
        await shoot(OUT_PNG.replace(/\.png$/i, '-alert.png'))
        // 恢复阈值，免得影响后面的「恢复默认」断言。
        await js(`(() => { const el = document.querySelector('[data-balance-control="reset"]'); if (el) el.click(); return true })()`)
        await sleep(500)
      }
    }

    // 交互序列：口径 → 阈值 → 紧凑模式 → 恢复默认。
    for (const [id, value, label] of [
      ['format', 'bonus', '切换徽章口径为「仅赠金」'],
      ['low', '42', '红色阈值改为 42'],
      ['compact', true, '打开紧凑模式']
    ]) {
      const ok = await setControl(id, value)
      const stored = await js("(() => { try { return localStorage.getItem('dsh-balance-pill:settings') } catch { return null } })()")
      interactions.push({ id, value, dispatched: ok, stored })
      log(`change ${label} -> ${String(stored)}`)
    }
    const beforeReset = await js("(() => { try { return localStorage.getItem('dsh-balance-pill:settings') } catch { return null } })()")
    await js(`(() => { const el = document.querySelector('[data-balance-control="reset"]'); if (!el) return false; el.click(); return true })()`)
    await sleep(600)
    const afterReset = await js("(() => { try { return localStorage.getItem('dsh-balance-pill:settings') } catch { return null } })()")
    interactions.push({ id: 'reset', beforeReset, afterReset })
    log(`reset -> ${String(afterReset)}`)

    inspect = await js(INSPECT)
    await shoot(OUT_PNG.replace(/\.png$/i, '-after.png'))
  }

  fs.writeFileSync(
    OUT_JSON,
    JSON.stringify(
      {
        url: URL_TO_LOAD,
        elapsedMs: Date.now() - started,
        openedSettings: opened,
        openedGeneral: general,
        inspect,
        interactions,
        consoleMessages: consoleMessages.slice(0, 30),
        screenshot: OUT_PNG
      },
      null,
      2
    )
  )
  log(`wrote ${OUT_JSON}`)

  // 收尾：把配置恢复成默认，避免验证台改动留在浏览器存储里。
  if (inspect.found) {
    await js(
      `(() => { try { localStorage.removeItem('dsh-balance-pill:settings'); localStorage.removeItem('dsh-balance-pill:thresholds') } catch {} return true })()`
    ).catch(() => {})
  }

  win.destroy()
  return inspect.found ? 0 : 3
}

app.setPath('userData', path.join(HERE, 'userdata'))
app.setPath('sessionData', path.join(HERE, 'userdata'))
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
