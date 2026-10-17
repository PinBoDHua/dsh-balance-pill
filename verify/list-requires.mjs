// What modules do installed third-party client bundles require from the platform?
import { readFileSync } from 'node:fs'

const files = process.argv.slice(2)
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  const ids = new Set()
  for (const match of text.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) ids.add(match[1])
  console.log(`== ${file}`)
  console.log('   ' + [...ids].sort().join('\n   '))
}
