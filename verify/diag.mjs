/** Minimal diagnostic: what does the harness actually receive when it loads the GUI? */
import { app, BrowserWindow, session } from 'electron'
import { createHash, createHmac } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

// 同 shot-pill.mjs：吞掉管道 EPIPE，别让主进程异常变成 Electron 的错误弹窗。
process.stdout.on('error', () => {})
process.stderr.on('error', () => {})
process.on('uncaughtException', (error) => {
  try { fs.appendFileSync(path.join(import.meta.dirname, 'out', 'diag.log'), `UNCAUGHT ${error?.stack ?? String(error)}\n`) } catch { /* ignore */ }
  app.exit(9)
})
let stdoutBroken = false
const say = (line) => {
  if (stdoutBroken) return
  try { console.log(line) } catch { stdoutBroken = true }
}

const HERE = import.meta.dirname
const URL_TO_LOAD = 'http://127.0.0.1:19387/'
const DSH_HOME = process.env.DSH_HOME ?? 'C:\\Users\\李\\.dsh'
const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function readSigningSecret (file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim() === 'client-connection/browser-session:')
  const indent = lines[at].length - lines[at].trimStart().length
  for (let i = at + 1; i < lines.length; i++) {
    if (lines[i].trim() === '') continue
    if (lines[i].length - lines[i].trimStart().length <= indent) break
    const m = /^\s*secret:\s*(\S+)\s*$/.exec(lines[i])
    if (m) return Buffer.from(m[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  }
  throw new Error('no secret')
}

const key = readSigningSecret(path.join(DSH_HOME, '.credentials.yaml'))
const authority = new URL(URL_TO_LOAD).host
const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt: Date.now(), expiresAt: Date.now() + 86400000 }), 'utf8'))
const header = `dsh-auth-${b64url(createHash('sha256').update(authority).digest())}=v1.${body}.${b64url(createHmac('sha256', key).update(body).digest())}`

app.setPath('userData', path.join(HERE, 'userdata-diag'))
app.setPath('sessionData', path.join(HERE, 'userdata-diag'))
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-renderer-backgrounding')

app.whenReady().then(async () => {
  const s = session.defaultSession
  await s.cookies.set({ url: new URL(URL_TO_LOAD).origin, name: header.split('=')[0], value: header.slice(header.indexOf('=') + 1), path: '/', httpOnly: true, sameSite: 'strict' })
  s.webRequest.onBeforeSendHeaders({ urls: [`${new URL(URL_TO_LOAD).origin}/*`] }, (details, callback) => {
    details.requestHeaders.Cookie = header
    callback({ requestHeaders: details.requestHeaders })
  })

  const win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { offscreen: true, contextIsolation: true, nodeIntegration: false } })
  win.webContents.on('did-navigate', (_e, url, statusCode, statusText) => console.log(`did-navigate ${statusCode} ${statusText} ${url}`))
  win.webContents.on('did-fail-load', (_e, code, desc, url) => console.log(`did-fail-load ${code} ${desc} ${url}`))
  win.webContents.on('render-process-gone', (_e, details) => console.log(`render-process-gone ${JSON.stringify(details)}`))
  win.webContents.on('console-message', (event) => console.log(`console: ${String(event?.message ?? '').slice(0, 200)}`))

  const response = await win.loadURL(URL_TO_LOAD)
  console.log(`loadURL resolved; response status=${response} `)
  await new Promise((resolve) => setTimeout(resolve, 4000))
  const info = await win.webContents.executeJavaScript(`({
    url: location.href,
    title: document.title,
    readyState: document.readyState,
    bodyChildren: document.body ? [...document.body.children].map((el) => el.tagName + '#' + el.id + '.' + (typeof el.className === 'string' ? el.className : '')) : null,
    htmlHead: document.documentElement.outerHTML.slice(0, 300),
    hasBoot: typeof globalThis.__DSH_BOOT__ !== 'undefined'
  })`, true)
  console.log('INFO ' + JSON.stringify(info, null, 2))
  win.destroy()
  app.exit(0)
}).catch((error) => {
  console.log('ERROR ' + (error?.stack ?? String(error)))
  app.exit(1)
})
