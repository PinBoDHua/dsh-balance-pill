/**
 * 余额徽章 —— 安全安装 / 卸载。
 *
 * ## 为什么不用一行 `dsh plugin add`
 * `desktop` 是 Electron 独占的保留 profile：内置 CLI 要求**完全退出桌面端**
 * （profile 有写锁），而用户往往正开着应用。于是需要一条「先看清要改什么、
 * 再决定动不动手」的路径。本脚本默认 **dry-run**：只打印计划，不写盘；
 * 加 `--apply` 才执行，且执行前先备份。
 *
 * 安装 = 复制插件目录 + 改 profile 的两处清单（依赖 + bundle 顺序），
 * 这也是当前 profile 里 dsh-ui-beautify 的实际形态。
 *
 * ## 用法
 *   node scripts/install.mjs                      # 预览安装
 *   node scripts/install.mjs --apply              # 安装
 *   node scripts/install.mjs --sync-client --apply  # 只同步客户端产物（改完前端热更新用）
 *   node scripts/install.mjs --uninstall          # 预览卸载
 *   node scripts/install.mjs --apply --uninstall  # 卸载
 *
 * 备份写到 <DSH_HOME>/dsh-balance-pill-backup-<时间戳>/，并留一份 restore.ps1。
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_NAME = 'dsh-balance-pill'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const uninstall = argv.includes('--uninstall')
const syncClientOnly = argv.includes('--sync-client')

/** 解析 profile 目录：优先环境变量，其次 DSH_HOME 下的 desktop profile。 */
function resolveProfileDir() {
  if (process.env.DSH_PROFILE_DIR && existsSync(process.env.DSH_PROFILE_DIR)) return process.env.DSH_PROFILE_DIR
  const home = process.env.DSH_HOME
  if (home && existsSync(join(home, 'profiles', 'desktop'))) return join(home, 'profiles', 'desktop')
  throw new Error('找不到 DSH profile 目录。请设置 DSH_PROFILE_DIR，或在 DSH 桌面端进程中运行本脚本。')
}

const profileDir = resolveProfileDir()
const manifestPath = join(profileDir, 'package.json')
const targetDir = join(profileDir, 'node_modules', PLUGIN_NAME)
const dshHome = process.env.DSH_HOME ?? dirname(dirname(profileDir))
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backupDir = join(dshHome, `${PLUGIN_NAME}-backup-${stamp}`)

/**
 * 不复制进 profile 的东西。
 *
 * 运行时真正需要的只有 lib/、client/、cordis.patch.yml 与 package.json；
 * src/ 与 scripts/ 保留是为了让 profile 里那份副本仍可读、可重新构建。
 * 测试与验证台（截图、探针、临时提取物）没有必要进入 profile。
 */
const COPY_EXCLUDE = new Set(['node_modules', '.git', '_probe', 'tests', 'verify'])

const log = (message) => console.log(message)
const change = (message) => console.log(`  · ${message}`)

// ---------------------------------------------------------------- 同步客户端

if (syncClientOnly) {
  const source = join(ROOT, 'client', 'client.js')
  if (!existsSync(source)) {
    console.error(`缺少构建产物 ${source} —— 先运行 node scripts/build.mjs`)
    process.exit(2)
  }
  const target = join(targetDir, 'client', 'client.js')
  const bytes = readFileSync(source)
  log(`同步客户端产物（${apply ? '执行' : '预览，不写盘'}）`)
  change(`${source} -> ${target}（${(bytes.length / 1024).toFixed(1)} KB）`)
  if (!existsSync(targetDir)) {
    console.error(`插件尚未安装到 ${targetDir} —— 先运行 node scripts/install.mjs --apply`)
    process.exit(2)
  }
  if (apply) {
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, bytes)
    log(`已写入。dsh-client-hmr 每 500ms 轮询该文件，约 1 秒后界面自动热替换。`)
  } else {
    log('这是预览。确认无误后加 --apply 执行。')
  }
  process.exit(0)
}

// ------------------------------------------------------------ 计算目标状态

const original = readFileSync(manifestPath, 'utf8')
const next = JSON.parse(original)
next.dependencies ??= {}
const bundles = next.dsh?.profile?.bundles
if (!Array.isArray(bundles)) {
  console.error(`${manifestPath} 里没有 dsh.profile.bundles 数组 —— profile 结构不符合预期，已中止。`)
  process.exit(2)
}

if (uninstall) {
  delete next.dependencies[PLUGIN_NAME]
  next.dsh.profile.bundles = bundles.filter((name) => name !== PLUGIN_NAME)
} else {
  next.dependencies[PLUGIN_NAME] = `file:${ROOT.replace(/\\/g, '/')}`
  if (!bundles.includes(PLUGIN_NAME)) next.dsh.profile.bundles = [...bundles, PLUGIN_NAME]
}

const nextText = `${JSON.stringify(next, null, 2)}\n`
const willWriteManifest = nextText !== original
const willCopy = !uninstall

// ---------------------------------------------------------------- 展示计划

log(`${uninstall ? '卸载' : '安装'}计划（${apply ? '执行' : '预览，不写盘'}）`)
log(`  profile    ${profileDir}`)
log(`  插件源     ${ROOT}`)
log('')

if (willCopy) change(`复制插件目录 -> ${targetDir}（复制前先移除旧副本）`)
change(willWriteManifest ? `改写 ${manifestPath}` : 'package.json 无需改动（已是目标状态）')
change(`备份 -> ${backupDir}`)
log('')

if (!apply) {
  log('这是预览。确认无误后加 --apply 执行：')
  log(`  node scripts/install.mjs --apply${uninstall ? ' --uninstall' : ''}`)
  log('')
  log('提示：桌面端正在运行时，profile 清单的改动会被 dsh-hmr 重新组合层栈；')
  log('      客户端 bundle 由 dsh-client-hmr 每 500ms 轮询，改完源码不需要刷新页面。')
  process.exit(0)
}

// ------------------------------------------------------------------ 执行

mkdirSync(backupDir, { recursive: true })

/** 备份一个文件（若存在）。 */
function backup(relative) {
  const from = join(profileDir, relative)
  if (!existsSync(from)) return false
  cpSync(from, join(backupDir, relative.replace(/[\\/]/g, '__')))
  return true
}

const backedUp = ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'].filter(backup)

writeFileSync(
  join(backupDir, 'restore.ps1'),
  `# 余额徽章 —— 一键回滚到安装前的 profile 状态。
# 用法：先在 DeepSeek Harness 里完全退出，然后：
#   pwsh -File "${join(backupDir, 'restore.ps1')}"
$ErrorActionPreference = 'Stop'
$profile = '${profileDir.replace(/'/g, "''")}'
foreach ($pair in @(
${backedUp.map((f) => `  @('${f}', '${f.replace(/[\\/]/g, '__')}')`).join(',\n')}
)) {
  $src = Join-Path '${backupDir.replace(/'/g, "''")}' $pair[1]
  if (Test-Path $src) { Copy-Item $src (Join-Path $profile $pair[0]) -Force; Write-Host "restored $($pair[0])" }
}
$plugin = Join-Path $profile 'node_modules\\${PLUGIN_NAME}'
if (Test-Path $plugin) { Remove-Item $plugin -Recurse -Force; Write-Host 'removed plugin copy' }
Write-Host '回滚完成。请重新打开 DeepSeek Harness。'
`
)

if (uninstall) {
  if (existsSync(targetDir)) {
    rmSync(targetDir, { recursive: true, force: true })
    log(`已删除 ${targetDir}`)
  }
} else {
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(ROOT, targetDir, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(source.split(/[\\/]/).pop())
  })
  log(`已复制插件 -> ${targetDir}`)
}

if (willWriteManifest) {
  writeFileSync(manifestPath, nextText)
  log(`已改写 ${manifestPath}`)
}

// 复制后做一次最小可用性检查。
log('')
log('安装结果：')
for (const [path, label] of [
  [join(targetDir, 'lib', 'index.js'), '宿主侧入口'],
  [join(targetDir, 'client', 'client.js'), '客户端 bundle'],
  [join(targetDir, 'cordis.patch.yml'), 'bundle patch'],
  [join(targetDir, 'package.json'), '包清单']
]) {
  log(`  ${existsSync(path) ? '✓' : '✗'} ${label}  ${path.replace(profileDir, '<profile>')}`)
}
log(`  插件目录条目数：${existsSync(targetDir) ? readdirSync(targetDir).length : 0}`)
log('')
log(`备份：${backupDir}`)
log(`回滚：pwsh -File "${join(backupDir, 'restore.ps1')}"`)
log('')
log('下一步：')
log('  1. 无需重启：dsh-hmr 会重新组合层栈，dsh-client-hmr 每 500ms 轮询客户端产物；')
log('     若界面里没有出现余额徽章，先刷新一次页面，再考虑完全退出后重开。')
log('  2. 改完前端源码：node scripts/build.mjs && node scripts/install.mjs --sync-client --apply')
log(`  3. 卸载：node scripts/install.mjs --apply --uninstall`)
