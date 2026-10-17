/** Read the pill's real amount + the seeded history, side by side. */
import { app, BrowserWindow, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { cookieFor } from './dsh-auth.mjs'

const HERE = import.meta.dirname
const URL_TO_LOAD = 'http://127.0.0.1:19387/'
const LOG = path.join(HERE, 'out', 'probe-amount.log')
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
    if ((await js(DISMISS)) === null) break
    await sleep(600)
  }
  await js(`(() => {
    const rows = [...document.querySelectorAll('[class*="sessionRow"]')].filter((el) => el.getBoundingClientRect().width > 150)
    const hit = rows.find((el) => (el.textContent || '').includes('DSH界面UI美化插件设计')) ?? rows[1] ?? rows[0]
    if (hit) hit.click()
    return true
  })()`)
  await sleep(3000)
  for (let i = 0; i < 3; i += 1) {
    if ((await js(DISMISS)) === null) break
    await sleep(600)
  }
  const probe = await js(`(() => {
    const text = document.querySelector('[data-balance-pill] .dbp_text')
    const raw = text === null ? null : text.textContent
    const stripped = raw === null ? null : raw.replace(/[^0-9.]/g, '')
    const history = (() => { try { return JSON.parse(localStorage.getItem('dsh-balance-pill:history') || 'null') } catch { return 'unparseable' } })()
    const baselines = (() => { try { return JSON.parse(localStorage.getItem('dsh-balance-pill:sessions') || 'null') } catch { return 'unparseable' } })()
    return {
      pillText: raw,
      stripped,
      parseInt: stripped === null ? null : Number(stripped),
      locale: navigator.language,
      historyCount: Array.isArray(history) ? history.length : history,
      historyLast: Array.isArray(history) ? history[history.length - 1] : null,
      historyFirst: Array.isArray(history) ? history[0] : null,
      baselineKeys: baselines === null ? null : Object.keys(baselines),
      baseline: baselines === null ? null : Object.values(baselines)[0]
    }
  })()`)
  say('AMOUNT PROBE ' + JSON.stringify(probe, null, 2))
  win.destroy()
  app.exit(0)
}).catch((error) => {
  say('ERROR ' + (error?.stack ?? String(error)))
  app.exit(1)
})
