// Report the live client-plugin graph from the running GUI's __DSH_BOOT__ (read-only).
// Usage: node probe-graph.mjs [url] [idFilterRegex]
import { cookieFor } from './dsh-auth.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:19387/'
const filter = process.argv[3] ? new RegExp(process.argv[3], 'i') : null
const { header } = cookieFor(url)
const res = await fetch(url, { headers: { cookie: header } })
const text = await res.text()
if (res.status !== 200) {
  console.error(`GET ${url} -> ${res.status}`)
  process.exit(1)
}

const at = text.indexOf('globalThis["__DSH_BOOT__"] = ')
if (at === -1) {
  console.error('no __DSH_BOOT__ literal')
  process.exit(1)
}
const start = text.indexOf('{', at)
let depth = 0
let end = -1
for (let i = start; i < text.length; i += 1) {
  const ch = text[i]
  if (ch === '{') depth += 1
  else if (ch === '}') {
    depth -= 1
    if (depth === 0) { end = i + 1; break }
  }
}
const boot = JSON.parse(text.slice(start, end))
console.log(`boot rev=${boot.rev} entries=${boot.entries.length}`)
const rows = boot.entries.filter((e) => (filter ? filter.test(e.id) : true))
for (const e of rows) {
  console.log(`${e.id}\n    url=${e.url}\n    inject=${(e.inject ?? []).join(', ')}`)
}
console.log(`\nmatched ${rows.length}/${boot.entries.length}`)
