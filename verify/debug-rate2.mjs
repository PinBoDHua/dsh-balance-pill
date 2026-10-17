/** Re-run the exact scenario from the failing test with tracing. */
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

const settingsModule = await import(pathToFileURL(join(SRC, 'settings.js')).href)
globalThis.ReactDOM = { createPortal: (n) => n }
const { BalancePill } = await import(pathToFileURL(join(SRC, 'pill.js')).href)

const zh = (await import(pathToFileURL(join(SRC, 'locales.js')).href)).zh
const t = (key, params) => {
  const template = zh[key] ?? key
  if (params === undefined) return template
  return template.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`))
}

function findAll(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const c of node) findAll(c, predicate, out)
    return out
  }
  if (predicate(node)) out.push(node)
  findAll(node.props?.children ?? null, predicate, out)
  return out
}

function createHarness(Component, props) {
  const slots = []
  const effectDeps = new Map()
  const cleanups = new Map()
  let pendingEffects = []
  let cursor = 0
  let tree = null
  let queue = Promise.resolve()
  const sameDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const api = {
    Fragment: Symbol('Fragment'),
    createElement(type, attributes, ...children) {
      const p = { ...(attributes ?? {}), children: children.length <= 1 ? (children[0] ?? null) : children }
      if (typeof type === 'function') return type(p)
      return { type, props: p }
    },
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], (next) => {
        const value = typeof next === 'function' ? next(slots[index]) : next
        if (Object.is(value, slots[index])) return
        slots[index] = value
        queue = queue.then(() => render())
      }]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn, deps) {
      const index = cursor++
      const prev = slots[index]
      if (prev === undefined || !sameDeps(prev.deps, deps)) slots[index] = { deps, fn }
      return slots[index].fn
    },
    useMemo(fn, deps) {
      const index = cursor++
      const prev = slots[index]
      if (prev === undefined || !sameDeps(prev.deps, deps)) slots[index] = { deps, value: fn() }
      return slots[index].value
    },
    useEffect(fn, deps) {
      const index = cursor++
      if (!sameDeps(effectDeps.get(index), deps)) pendingEffects.push({ index, fn })
      effectDeps.set(index, deps)
    }
  }
  const flush = () => {
    const batch = pendingEffects
    pendingEffects = []
    for (const { index, fn } of batch) {
      const prev = cleanups.get(index)
      if (typeof prev === 'function') prev()
      cleanups.set(index, undefined)
      const result = fn()
      if (typeof result === 'function') cleanups.set(index, result)
    }
  }
  const render = () => {
    cursor = 0
    pendingEffects = []
    const prev = globalThis.React
    globalThis.React = api
    try {
      tree = Component(props)
    } finally {
      globalThis.React = prev
    }
    if (tree !== null && tree !== undefined) flush()
    return tree
  }
  return {
    render,
    tree: () => tree,
    async settle() {
      for (let i = 0; i < 10; i += 1) {
        await Promise.resolve()
        await queue
      }
      return tree
    },
    unmount() {
      for (const c of cleanups.values()) if (typeof c === 'function') c()
      cleanups.clear()
    }
  }
}

const detail = (amount) => ({
  balance: { ok: true, value: { status: 'ready', value: [{ currency: 'CNY', balance: amount }], bonusWallets: [] } },
  state: { ok: true, value: { status: 'credential-stored' } }
})

let call = 0
const service = {
  account: {
    available: () => true,
    activeLocale: () => 'zh-CN',
    read: async () => {
      call += 1
      return call === 1 ? detail('10.00') : detail('8.00')
    }
  },
  settings: settingsModule.createSettingsStore(undefined, { getItem: () => null, setItem: () => {} }),
  storage: { getItem: () => null, setItem: () => {} },
  alerts: { get: () => null, set: () => {}, subscribe: () => () => {} }
}

const harness = createHarness(BalancePill, { t, service, sessionId: 'session-debug' })
harness.render()
await harness.settle()
console.log('after first read:', harness.tree().props['data-status'], findAll(harness.tree(), (n) => n.props?.className === 'dbp_text')[0].props.children)

findAll(harness.tree(), (n) => n.props?.className === 'dbp_trigger')[0].props.onClick()
await harness.settle()
console.log('panel open:', findAll(harness.tree(), (n) => n.props?.['data-balance-panel'] === true).length)

const real = Date.now
Date.now = () => real() + 2 * 3600 * 1000
findAll(harness.tree(), (n) => n.props?.className === 'dbp_refresh')[0].props.onClick()
await harness.settle()
Date.now = real

console.log('after second read:', harness.tree().props['data-status'], findAll(harness.tree(), (n) => n.props?.className === 'dbp_text')[0].props.children)
const rate = findAll(harness.tree(), (n) => n.props?.['data-balance-rate'] === true)[0]
console.log('rate row:', rate ? JSON.stringify(rate.props.children) : 'MISSING')
console.log('meta rows:', JSON.stringify(findAll(harness.tree(), (n) => n.props?.className === 'dbp_meta').map((n) => n.props.children)))
console.log('read calls:', call)
harness.unmount()
