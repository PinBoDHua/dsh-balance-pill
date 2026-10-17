// Verify the installed client bundle is served and matches the built artifact (read-only).
// Usage: node verify-bundle.mjs [url]
import { readFileSync } from 'node:fs'
import { cookieFor } from './dsh-auth.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:19387/'
const { header } = cookieFor(base)

const index = await fetch(base, { headers: { cookie: header } })
const html = await index.text()
const at = html.indexOf('globalThis["__DSH_BOOT__"] = ')
const start = html.indexOf('{', at)
let depth = 0
let end = -1
for (let i = start; i < html.length; i += 1) {
  if (html[i] === '{') depth += 1
  else if (html[i] === '}') {
    depth -= 1
    if (depth === 0) { end = i + 1; break }
  }
}
const boot = JSON.parse(html.slice(start, end))
const entry = boot.entries.find((row) => row.id === 'dsh-balance-pill')
console.log(`boot rev=${boot.rev} entries=${boot.entries.length}`)
console.log(`entry: ${JSON.stringify(entry)}`)
if (entry === undefined) {
  console.error('鎻掍欢鏈嚭鐜板湪鍥鹃噷')
  process.exit(1)
}

const url = new URL(entry.url, base).href
const res = await fetch(url, { headers: { cookie: header } })
const body = await res.text()
const local = readFileSync(new URL('../../dsh-balance-pill/client/client.js', import.meta.url), 'utf8')
console.log(`GET ${url}\n  status=${res.status} bytes=${Buffer.byteLength(body)} type=${res.headers.get('content-type')}`)
console.log(`  鏈湴浜х墿 ${Buffer.byteLength(local)} 瀛楄妭锛涗竴鑷?${body.includes(local.slice(0, 2000)) && body.includes(local.slice(-2000))}`)
console.log(`  鍚?sourceMappingURL=${body.includes('sourceMappingURL')}`)
if (res.status !== 200) process.exit(1)
