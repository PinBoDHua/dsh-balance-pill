/**
 * 铸造 DSH Web GUI 的浏览器会话 cookie（验证工具用）。
 *
 * 方案来自 @deepseek-ai/dsh-client-connection：
 *   authority  = new URL(base).host
 *   cookieName = "dsh-auth-" + base64url(sha256(authority))
 *   body       = base64url(JSON({version:1, authority, issuedAt, expiresAt}))
 *   value      = `v1.${body}.${base64url(HMAC-SHA256(secret, body))}`
 *   secret     = <DSH_HOME>/.credentials.yaml
 *                → records["client-connection/browser-session"].payload.secret
 *
 * 两个易错点，都在这里一次性解决：
 *  1. `issuedAt` / `expiresAt` 以**毫秒**计，且过期时间要落在宿主认可的窗口内
 *     （30 天足够）。写成 30*1440*60*60*1000 会得到 4.9 年，宿主直接判 401。
 *  2. secret 是 base64url 编码的 32 字节密钥，必须先解码再用作 HMAC key。
 */
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const DSH_HOME = process.env.DSH_HOME ?? 'C:\\Users\\李\\.dsh'
export const CREDENTIALS_FILE = join(DSH_HOME, '.credentials.yaml')

const b64url = (buf) => Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

/** 从凭证文件里取出 browser-session 的签名密钥。 */
export function readSigningSecret (file = CREDENTIALS_FILE) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  const at = lines.findIndex((line) => line.trim() === 'client-connection/browser-session:')
  if (at === -1) throw new Error(`credentials: ${file} 里没有 client-connection/browser-session 记录`)
  const indent = lines[at].length - lines[at].trimStart().length
  for (let i = at + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '') continue
    if (lines[i].length - lines[i].trimStart().length <= indent) break
    const matched = /^\s*secret:\s*(\S+)\s*$/.exec(lines[i])
    if (matched !== null) {
      const key = Buffer.from(matched[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
      if (key.byteLength !== 32) throw new Error(`credentials: secret 为 ${key.byteLength} 字节，期望 32`)
      return key
    }
  }
  throw new Error('credentials: browser-session secret 缺失')
}

/** 生成一次会话 cookie：`{authority, name, value, header, origin}`。 */
export function cookieFor (base, file = CREDENTIALS_FILE) {
  const url = new URL(base)
  const authority = url.host
  const key = readSigningSecret(file)
  const issuedAt = Date.now()
  const expiresAt = issuedAt + 30 * 1440 * 60 * 1000
  const body = b64url(Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt }), 'utf8'))
  const signature = b64url(createHmac('sha256', key).update(body).digest())
  const name = 'dsh-auth-' + b64url(createHash('sha256').update(authority).digest())
  const value = `v1.${body}.${signature}`
  return { authority, name, value, header: `${name}=${value}`, origin: url.origin }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2] ?? 'http://127.0.0.1:19387/'
  const cookie = cookieFor(base)
  console.log(`credentials : ${CREDENTIALS_FILE}`)
  console.log(`authority   : ${cookie.authority}`)
  console.log(`cookie name : ${cookie.name}`)
  const probe = await fetch(base, { headers: { cookie: cookie.header }, redirect: 'manual' })
  console.log(`probe       : ${probe.status}`)
}
