// Dump the live index.html and print the __DSH_BOOT__ region (read-only).
import { writeFileSync } from 'node:fs'
import { cookieFor } from './dsh-auth.mjs'

const url = process.argv[2] ?? 'http://127.0.0.1:19387/'
const { header } = cookieFor(url)
const res = await fetch(url, { headers: { cookie: header } })
const text = await res.text()
writeFileSync(new URL('./index.html', import.meta.url), text)
console.log(`status=${res.status} bytes=${text.length}`)
for (const needle of ['__DSH_BOOT__', '__DSH_BOOT_READY__', 'plugins/??', 'client.js']) {
  const at = text.indexOf(needle)
  console.log(`\n--- ${needle} @${at}`)
  if (at !== -1) console.log(text.slice(Math.max(0, at - 300), at + 1200))
}
