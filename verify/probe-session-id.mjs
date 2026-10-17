// Probe the live GUI for how the current session id is discoverable from the DOM.
import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { cookieFor } from './dsh-auth.mjs'

const HERE = import.meta.dirname
const URL_TO_LOAD = process.argv[2] ?? 'http://127.0.0.1:19387/'
const LOG = path.join(HERE, 'out', 'probe-session-id.log')

process.stdout.on('error', () => {})
process.on('uncaughtException', (error) => {
  try {
    fs.appendFileSync(LOG, `UNCAUGHT ${error?.stack ?? String(error)}\n`)
  } catch { /* ignore */ }
  app.exit(9)
})
try {
  fs.mkdirSync(path.dirname(LOG), { recursive: true })
  fs.writeFileSync(LOG, '')
} catch { /* ignore */ }
const say = (line) => {
  try {
    console.log(line)
  } catch { /* ignore */ }
  try {
    fs.appendFileSync(LOG, line + '\n')
  } catch { /* ignore */ }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const DISMISS = `(() => {
  const dialog = document.querySelector('[role="dialog"]')
  if (dialog === null) return null
  const buttons = [...dialog.querySelectorAll('button')].filter((el) => !el.disabled && el.getBoundingClientRect().width > 0)
  if (buttons.length === 0) return null
  const hit = buttons.find((el) => /继续|确定|知道了|开始|完成|关闭|好|OK|Continue|Got it|Close|Done|Start/i.test((el.textContent || '').trim())) ?? buttons[buttons.length - 1]
  hit.click()
  return (hit.textContent || '').trim().slice(0, 30)
})()`

app.setPath('userData', path.join(HERE, 'userdata'))
app.setPath('sessionData', path.join(HERE, 'userdata'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-renderer-backgrounding')

app.whenReady().then(async () => {
  const cookie = cookieFor(URL_TO_LOAD)
  const s = session.defaultSession
  await s.cookies.set({ url: cookie.origin, name: cookie.name, value: cookie.value, path: '/', httpOnly: true, sameSite: 'strict' })
  s.webRequest.onBeforeSendHeaders({ urls: [`${cookie.origin}/*`] }, (details, callback) => {
    details.requestHeaders.Cookie = cookie.header
    callback({ requestHeaders: details.requestHeaders })
  })

  const win = new BrowserWindow({ width: 1600, height: 1000, show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
  const js = (script) => win.webContents.executeJavaScript(script, true)
  await win.loadURL(URL_TO_LOAD)
  await sleep(3000)
  for (let i = 0; i < 5; i += 1) {
    const dismissed = await js(DISMISS)
    if (dismissed === null) break
    say(`dismissed: ${dismissed}`)
    await sleep(600)
  }
  // 打开一个会话。
  await js(`(() => {
    const rows = [...document.querySelectorAll('[class*="sessionRow"]')].filter((el) => el.getBoundingClientRect().width > 150)
    const hit = rows.find((el) => (el.textContent || '').includes('DSH界面UI美化插件设计')) ?? rows[1] ?? rows[0]
    if (!hit) return null
    hit.click()
    return (hit.textContent || '').trim().slice(0, 30)
  })()`)
  await sleep(2500)
  for (let i = 0; i < 3; i += 1) {
    const dismissed = await js(DISMISS)
    if (dismissed === null) break
    await sleep(600)
  }

  const found = await js(`(() => {
    const hits = {}
    // 任何属性里带 session 且值形如 uuid/session-xxx 的都记下来。
    for (const el of document.querySelectorAll('*')) {
      for (const attr of el.attributes ?? []) {
        if (!/session/i.test(attr.name)) continue
        if (attr.value.length < 8 || attr.value.length > 80) continue
        hits[attr.name] = hits[attr.name] ?? new Set()
        if (hits[attr.name].size < 3) hits[attr.name].add(attr.value)
      }
      if (Object.keys(hits).length > 6) break
    }
    const out = {}
    for (const [key, set] of Object.entries(hits)) out[key] = [...set]
    // localStorage 里形如 session 的键也看一眼。
    const storageKeys = []
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i)
        if (/session/i.test(key)) storageKeys.push(key)
      }
    } catch { /* ignore */ }
    return { attributes: out, storageKeys, title: document.title }
  })()`)
  say('SESSION-ID PROBE ' + JSON.stringify(found, null, 2))
  win.destroy()
  app.exit(0)
}).catch((error) => {
  say('ERROR ' + (error?.stack ?? String(error)))
  app.exit(1)
})
