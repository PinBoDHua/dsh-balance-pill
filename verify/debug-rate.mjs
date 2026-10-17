/** Focused debug for the v1.2 rate regression. */
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client')

const listeners = { window: new Set(), document: new Set() }
globalThis.window = {
  addEventListener: (t, h) => listeners.window.add(`${t}:${String(h)}`),
  removeEventListener: (t, h) => listeners.window.delete(`${t}:${String(h)}`),
  innerWidth: 1280,
  innerHeight: 800
}
globalThis.document = {
  visibilityState: 'visible',
  body: {},
  addEventListener: (t, h) => listeners.document.add(`${t}:${String(h)}`),
  removeEventListener: (t, h) => listeners.document.delete(`${t}:${String(h)}`)
}

const balance = await import(pathToFileURL(join(SRC, 'balance.js')).href)
const settingsModule = await import(pathToFileURL(join(SRC, 'settings.js')).href)

// Two readings 2h apart: 10 -> 8 should yield rate.
const previous = { summary: { currency: 'CNY', primary: 10, total: 10, recharge: 10, bonus: 0 }, at: 0 }
const fresh = { status: 'ready', value: [{ currency: 'CNY', balance: '8.00' }], bonusWallets: [] }
const model = balance.viewModel({
  balance: { ok: true, value: fresh },
  previous,
  thresholds: { low: 3, warn: 10 },
  format: 'total',
  currency: 'auto',
  at: 2 * 3600 * 1000,
  now: 2 * 3600 * 1000
})
console.log('rate:', JSON.stringify(model.rate))
console.log('status:', model.status, 'primary:', model.primary)

const store = settingsModule.createSettingsStore(undefined, { getItem: () => null, setItem: () => {} })
console.log('showRate default:', store.get().showRate)
console.log('showTrend default:', store.get().showTrend)
console.log('showSessionSpend default:', store.get().showSessionSpend)
console.log('alertOnCross default:', store.get().alertOnCross)
