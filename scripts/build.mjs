/**
 * 余额徽章 —— 零依赖构建脚本。
 *
 * ## 产物形状
 * 宿主客户端的模块加载器不认识 ESM：每个客户端包都必须是一个经典脚本，调用
 * `window.__ModuleLoader__.load({ id, factory })` 登记自己，并在 factory 内部用
 * 注入的 `require` 取依赖。参见 profile 里 dsh-better-sidebar 的 lib/client.js。
 *
 * ## 为什么不用打包器
 * 本插件的客户端代码不依赖任何第三方包，模块图是线性的、没有循环、没有动态
 * import。一套「按依赖序拼接 + 去 import/export」的构建足以胜任，产物可以逐行
 * 审阅，构建也不引入 node_modules。作为交换，脚本做几项硬校验，挡住拼接式构建
 * 最典型的失效方式（重名覆盖、遗漏 export、残留 ESM、越权 require）。
 *
 * ## 用法
 *   node scripts/build.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'src', 'client')
const ENTRY = join(SRC, 'index.js')
const STYLE_FILE = join(SRC, 'styles.css')
const GENERATED = join(SRC, 'styles.generated.js')
const OUT = join(ROOT, 'client', 'client.js')

/** 插件 id 与 package.json 的 name 保持一致。 */
const PLUGIN_ID = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).name

/** factory 里允许出现的 require id；越界即构建失败。 */
const ALLOWED_REQUIRES = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  // 平台种子表里的 primitives 包：用于取宿主 `Toast`（拿不到会退回自带卡片）。
  '@deepseek-ai/dsh-client-ui-primitives'
])

/** 构建期由脚本注入的绑定，参与重名校验。 */
const PRELUDE_NAMES = new Set(['React', 'ReactDOM'])

const failures = []

/** 记录一条构建期错误。 */
function fail(message) {
  failures.push(message)
}

/** 相对仓库根的短路径，用于日志。 */
function rel(file) {
  return file.slice(ROOT.length + 1).replace(/\\/g, '/')
}

// ---------------------------------------------------------------- 样式表

/** CSS 花括号配平检查：拼接式构建不解析 CSS，这是最廉价的结构校验。 */
function assertBalancedBraces(name, css) {
  let depth = 0
  let inComment = false
  for (let i = 0; i < css.length; i += 1) {
    const two = css.slice(i, i + 2)
    if (!inComment && two === '/*') {
      inComment = true
      i += 1
      continue
    }
    if (inComment && two === '*/') {
      inComment = false
      i += 1
      continue
    }
    if (inComment) continue
    if (css[i] === '{') depth += 1
    if (css[i] === '}') depth -= 1
    if (depth < 0) {
      fail(`${name}: 第 ${i} 字节出现多余的 '}'`)
      return
    }
  }
  if (depth !== 0) fail(`${name}: 花括号未配平（剩余深度 ${depth}）`)
}

/** 把 styles.css 合成 `export const STYLES` 模块，供入口引用。 */
function generateStyles() {
  // 与 loadModule 同理统一成 LF：样式会被原样嵌进产物，不规范化的话
  // 同一份源码在 LF / CRLF 检出下会产出不同字节的 client.js。
  const css = readFileSync(STYLE_FILE, 'utf8').replace(/\r\n/g, '\n')
  assertBalancedBraces('styles.css', css)
  if (/<\/style/i.test(css)) fail('styles.css: 含 "</style" 片段，会提前闭合宿主文档里的样式标签')
  const body = `/**
 * 本文件由 scripts/build.mjs 生成，请勿手工编辑。
 * 修改样式请编辑 src/client/styles.css，然后运行 \`node scripts/build.mjs\`。
 */
export const STYLES = ${JSON.stringify(css)}
`
  writeFileSync(GENERATED, body)
  return css.length
}

// ---------------------------------------------------------------- 模块图

const IMPORT_RE = /^[ \t]*import\s+(?:([\w$]+)\s*,\s*)?(?:\{([^}]*)\}\s*)?from\s*['"]([^'"]+)['"];?[ \t]*$/gm
const DECL_RE = /^(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm

/** 读取一个模块，拆出依赖与去掉 import/export 后的函数体。 */
function loadModule(file) {
  const text = readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const deps = []
  for (const match of text.matchAll(IMPORT_RE)) {
    const specifier = match[3]
    if (!specifier.startsWith('.')) {
      fail(`${rel(file)}: 只允许相对导入，发现 '${specifier}'`)
      continue
    }
    deps.push(resolve(dirname(file), specifier))
  }
  const body = text.replace(IMPORT_RE, '')
  const stripped = body.replace(/^(export\s+)/gm, '')
  if (/^[ \t]*export\s/m.test(stripped)) {
    const leftover = stripped.match(/^[ \t]*export\s.*$/m)?.[0]?.trim()
    fail(`${rel(file)}: 存在脚本无法处理的 export 形式：${leftover}`)
  }
  return { file, deps, body: stripped }
}

/** 后序 DFS：被依赖者先入列，保证拼接后 const 的求值顺序正确。 */
function orderModules(entry) {
  const ordered = []
  const state = new Map()
  const visit = (file, stack) => {
    const mark = state.get(file)
    if (mark === 'done') return
    if (mark === 'visiting') {
      fail(`模块图存在循环依赖：${[...stack, file].map(rel).join(' -> ')}`)
      return
    }
    state.set(file, 'visiting')
    const mod = loadModule(file)
    for (const dep of mod.deps) visit(dep, [...stack, file])
    state.set(file, 'done')
    ordered.push(mod)
  }
  visit(entry, [])
  return ordered
}

/** 校验顶层声明不重名 —— 拼接式构建最典型的静默失效方式。 */
function collectDeclarations(modules) {
  const seen = new Map()
  for (const name of PRELUDE_NAMES) seen.set(name, '<prelude>')
  for (const mod of modules) {
    for (const match of mod.body.matchAll(DECL_RE)) {
      const name = match[1]
      const owner = seen.get(name)
      if (owner !== undefined) {
        fail(`顶层名冲突：'${name}' 同时定义于 ${owner} 与 ${rel(mod.file)}（拼接后后者会覆盖前者）`)
        continue
      }
      seen.set(name, rel(mod.file))
    }
  }
  return seen
}

/** 组装最终的经典脚本。 */
function assemble(modules) {
  const chunks = modules.map(
    (mod) => `\n// ---- ${rel(mod.file)} ${'-'.repeat(Math.max(0, 56 - rel(mod.file).length))}\n${mod.body.trim()}\n`
  )
  const body = `\t\tconst React = require("react")
\t\tconst ReactDOM = require("react-dom")
${chunks.join('')}
\t\texports.apply = apply
\t\texports.inject = inject
\t\texports.name = name
\t\treturn module.exports`

  return `window.__ModuleLoader__.load({
\tid: ${JSON.stringify(PLUGIN_ID)},
\tfactory: (require) => {
\t\tvar module = { exports: {} }
\t\tvar exports = module.exports
\t\tObject.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
${body}
\t}
})
`
}

// ---------------------------------------------------------------- 构建期校验

/** 产物必须能作为经典脚本解析，且只 require 允许的 id。 */
function verify(code) {
  try {
    new vm.Script(code, { filename: 'client.js' })
  } catch (error) {
    fail(`产物无法解析为经典脚本：${error.message}`)
    return
  }
  for (const match of code.matchAll(/require\(\s*["']([^"']+)["']\s*\)/g)) {
    if (!ALLOWED_REQUIRES.has(match[1])) fail(`产物 require 了未授权的模块 id：'${match[1]}'`)
  }
  for (const key of ['name', 'inject', 'apply']) {
    if (!code.includes(`exports.${key} = ${key}`)) fail(`产物缺少 exports.${key} —— 加载器会认为它不是合法插件`)
  }
  if (/^\s*(?:import|export)\s/m.test(code)) fail('产物中残留 ESM 语句 —— 经典脚本会直接语法报错')
  // 断言说明：这些字符串都必须出现在**产物**里，也就是说「代码真的被拼进去了」。
  // 刻意只取那些在源码里就会原样出现的字面量（挂载点名、存储键、DOM 属性、
  // 词条键前缀、URL），不取函数名 —— 拼接后可以合法改名，函数名断言会误报。
  for (const [marker, label] of [
    ['conversation.composer.dock', 'composer.dock 挂载点'],
    ['settings.general.item', 'settings.general.item 挂载点'],
    ['shell.overlay', 'shell.overlay 挂载点'],
    ['remote.account', '账号桥'],
    ['dsh-balance-pill:settings', '配置存储键'],
    ['dsh-balance-pill:history', '历史存储键'],
    ['dsh-balance-pill:sessions', '会话基准存储键'],
    // v1.3：时段引擎与它的价格来源。价格表是「事实数据」，把它锚在产物里，
    // 引擎被误删/被换掉时构建就会失败，而不是等到用户看见错的单价。
    ['api-docs.deepseek.com/zh-cn/quick_start/pricing', 'DeepSeek 价格来源'],
    ['panel.tariff.', '计费时段词条键前缀'],
    ['data-balance-tariff', '徽章时段属性'],
    ['alert.tariff.', '时段提醒词条键前缀'],
    ['data-balance-alert-kind', '时段提醒卡片的 kind 标记'],
    // v1.3：时段看门狗必须与提醒卡片同处 root 作用域，缺了它提醒就退回
    // 「切会话重置」的旧行为 —— 那正是这一版要修掉的东西。
    // 用 `service.tariff` 而不是 `tariff: service.tariff`：后者会把断言绑死在
    // 某一行的写法上（缩进、换行、是否用简写属性都能让它误报）。
    ['service.tariff', '时段看门狗接线'],
    // v1.3：提醒卡必须能真的挂上宿主浮层。宿主 `bindSnapshotSelector()` 只认
    // `getSnapshot`（useSyncExternalStore 的契约名），缺了它条目会在首次渲染时
    // 抛错并被宿主永久摘掉 —— 提醒卡再也不出现，而控制台只有一行不显眼的错误。
    // 这条断言把「提醒链路仍然可挂载」变成构建期就能发现的契约漂移。
    ['getSnapshot', '提醒仓库的 useSyncExternalStore 契约（宿主浮层要求）'],
    ['showTariff', '时段显示开关'],
    // v1.4：看门狗的自愈调度与两个新 UI 落点。断言的都是「源码里就会原样出现的
    // 字面量」——DOM 属性与词条键，不取函数名（拼接后可以合法改名）。
    ['nextTickDelay', '看门狗的对齐调度（自愈）'],
    ['data-balance-runout', '徽章余额耗尽预估属性'],
    ['data-balance-today-spend', '面板「今日已用」行'],
    ['panel.todaySpend', '「今日已用」词条键'],
    // v1.5：周消耗、分方向冷却与「按空闲价折算」的速度文案。
    // 冷却分账尤其值得锚住：退回单一 `alertedAt` 时功能看起来完全正常，
    // 只有「11:30 的高峰卡堵掉 12:00 的空闲卡」这一种时序才会露馅。
    ['data-balance-week-spend', '面板「本周已用」行'],
    ['panel.weekSpend', '「本周已用」词条键'],
    ['spendInWeek', '周消耗纯函数'],
    ['billingWeekOf', '计费周切分'],
    ['alertedAtPeak', '时段提醒按方向分账的冷却（高峰）'],
    ['alertedAtOffPeak', '时段提醒按方向分账的冷却（空闲）'],
    ['panel.rateOffPeak', '空闲价折算的消耗速度文案'],
    // v0.1.6：近 7 天统计、版本号、配置变化识别、跨天时刻与速度基准。
    // `configKey` 尤其值得锚住：切换口径时如果不把「配置变化」与「余额掉档」
    // 分开，插件会立刻弹一张假的「余额不足」，而正常使用时完全看不出来。
    ['data-balance-recent-spend', '面板「近 7 天已用」行'],
    ['panel.recentSpend', '「近 7 天已用」词条键'],
    ['spendInWindow', '近 N 天消耗纯函数'],
    ['data-balance-version', '面板版本号'],
    ['PLUGIN_VERSION', '插件版本常量'],
    ['configKey', '提醒区分配置变化与真实掉档'],
    ['formatBillingMoment', '跨天起点补日期'],
    ['RATE_MAX_ELAPSED_MS', '速度基准的 6 小时上限']
  ]) {
    if (!code.includes(marker)) fail(`产物里没有找到 ${label}（${marker}）—— 入口可能没被打进去`)
  }
}

// -------------------------------------------------------------------- 主流程

const cssLength = generateStyles()
const modules = orderModules(ENTRY)
collectDeclarations(modules)
const code = assemble(modules)
verify(code)

if (failures.length > 0) {
  console.error(`构建失败，共 ${failures.length} 项：`)
  for (const message of failures) console.error(`  - ${message}`)
  process.exit(1)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, code)

console.log(`插件 id : ${PLUGIN_ID}`)
console.log(`样式    : ${(cssLength / 1024).toFixed(1)} KB（src/client/styles.css）`)
console.log(`模块    : ${modules.length} 个`)
// 按 UTF-8 字节数报告：产物里中文注释占比不低，字符数会明显小于磁盘占用。
console.log(`产物    : ${rel(OUT)} (${(Buffer.byteLength(code, 'utf8') / 1024).toFixed(1)} KB)`)
