// List the third-party (non-@deepseek-ai) client plugin entries in the running GUI graph.
import { cookieFor } from './dsh-auth.mjs'

const base = process.argv[2] ?? 'http://127.0.0.1:19387/'
const { header } = cookieFor(base)
const html = await (await fetch(base, { headers: { cookie: header } })).text()
const marker = 'globalThis["__DSH_BOOT__"] = '
const at = html.indexOf(marker)
if (at === -1) throw new Error('no boot payload')
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
const rows = boot.entries.filter((entry) => !entry.id.startsWith('@deepseek-ai/'))
console.log(`boot rev=${boot.rev} entries=${boot.entries.length} third-party=${rows.length}`)
for (const row of rows) console.log(`  ${row.id}  rev=${row.rev}`)
