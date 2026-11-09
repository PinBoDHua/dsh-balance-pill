/**
 * 余额徽章 —— 安全的安装 / 卸载 / 同步（多 profile）。
 *
 * ## 为什么不用一行 `dsh plugin add`
 * `desktop` 是 Electron 独占的保留 profile：内置 CLI 要求**完全退出桌面端**
 * （profile 有写锁），而用户往往正开着应用。于是需要一条「先看清要改什么、
 * 再决定动不动手」的路径。本脚本默认 **dry-run**：只打印计划，不写盘；
 * 加 `--apply` 才执行，且执行前先备份。
 *
 * ## v0.3.1：不再只认一个 profile（审计 P2-2）
 * 旧实现只解析**一个** profile（优先 `DSH_PROFILE_DIR`，否则 `desktop`）。
 * 本机同时有 `profiles/web` 与 `profiles/desktop`，两者都登记了本插件，但
 * `--apply` 只会更新其中一个 —— 另一份继续指向旧副本，而两边 `package.json`
 * 里的 `file:` 依赖看起来一模一样，没有任何地方能看出它们已经不同步。
 *
 * 现在默认遍历 `$DSH_HOME/profiles/*`：
 *  - 安装 / 卸载 / 同步：对所有**登记了本插件**的 profile 逐个计算并执行；
 *  - 首次安装（还没有 profile 登记）：对所有存在的 profile 执行，并打印提示；
 *  - `--status`：列出全部 profile 的「登记 / 版本 / 客户端产物」状态；
 *  - `--profile=<name>`：显式限定一个 profile（调试或只想改 Web 时用）；
 *  - 备份按 profile 分目录：`<DSH_HOME>/dsh-balance-pill-backup-<时间戳>/<profile>/`，
 *    每个目录里各有一份 `restore.ps1`，再加一个 `restore-all.ps1` 统一回滚。
 *
 * ## 用法
 *   node scripts/install.mjs                          # 预览安装（所有 profile）
 *   node scripts/install.mjs --apply                  # 安装到所有已登记 profile
 *   node scripts/install.mjs --status                 # 查看全部 profile 的状态
 *   node scripts/install.mjs --profile=web --apply    # 只处理 web
 *   node scripts/install.mjs --sync-client --apply    # 只同步客户端产物（热更新）
 *   node scripts/install.mjs --uninstall              # 预览卸载
 *   node scripts/install.mjs --apply --uninstall      # 卸载
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PLUGIN_NAME = 'dsh-balance-pill'

const argv = process.argv.slice(2)
const apply = argv.includes('--apply')
const uninstall = argv.includes('--uninstall')
const syncClientOnly = argv.includes('--sync-client')
const showStatus = argv.includes('--status')
const profileFilter = argumentValue('--profile')

/** 读取 `--name=value` 或 `--name value` 形式的参数。 */
function argumentValue(name) {
  const prefix = `${name}=`
  const inline = argv.find((value) => value.startsWith(prefix))
  if (inline !== undefined) return inline.slice(prefix.length)
  const index = argv.indexOf(name)
  if (index >= 0 && argv[index + 1] !== undefined && !argv[index + 1].startsWith('--')) return argv[index + 1]
  return null
}

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
const warn = (message) => console.warn(`警告：${message}`)
const fail = (message) => {
  console.error(`错误：${message}`)
  process.exit(2)
}

if ((argv.includes('--profile') || argv.some((value) => value.startsWith('--profile='))) && (profileFilter === null || profileFilter === '')) {
  fail('--profile 需要一个 profile 名称，例如 --profile=web')
}

// ------------------------------------------------------------- DSH 与 profile

/** 解析 DSH_HOME：环境变量优先，其次 DSH_PROFILE_DIR 的上级，最后 ~/.dsh。 */
function resolveHome() {
  if (process.env.DSH_HOME && existsSync(process.env.DSH_HOME)) return resolve(process.env.DSH_HOME)
  if (process.env.DSH_PROFILE_DIR && existsSync(process.env.DSH_PROFILE_DIR)) {
    return dirname(dirname(resolve(process.env.DSH_PROFILE_DIR)))
  }
  const fallback = join(homedir(), '.dsh')
  if (existsSync(fallback)) return fallback
  fail('找不到 DSH_HOME。请设置 DSH_HOME，或在 DSH 桌面端进程中运行本脚本。')
  return ''
}

/** 读取 JSON；失败返回 null（状态查询要把坏文件显示成「无法读取」而不是崩溃）。 */
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

/**
 * 列出 `$DSH_HOME/profiles/*` 下的 profile 及其登记情况。
 * @param home - DSH_HOME。
 * @returns `{name, dir, manifestPath, manifest, text, inDeps, inBundles, hasBundles}[]`。
 */
function listProfiles(home) {
  const profilesRoot = join(home, 'profiles')
  if (!existsSync(profilesRoot)) return []
  return readdirSync(profilesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = join(profilesRoot, entry.name)
      const manifestPath = join(dir, 'package.json')
      if (!existsSync(manifestPath)) return null
      let text = ''
      try {
        text = readFileSync(manifestPath, 'utf8')
      } catch {
        return null
      }
      const manifest = readJson(manifestPath)
      const bundles = manifest?.dsh?.profile?.bundles
      return {
        name: entry.name,
        dir,
        manifestPath,
        manifest,
        text,
        inDeps: manifest?.dependencies?.[PLUGIN_NAME] !== undefined,
        inBundles: Array.isArray(bundles) && bundles.includes(PLUGIN_NAME),
        hasBundles: Array.isArray(bundles)
      }
    })
    .filter((profile) => profile !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

const home = resolveHome()
const profiles = listProfiles(home)
if (profiles.length === 0) fail(`在 ${join(home, 'profiles')} 下没有找到任何 profile`)

if (profileFilter !== null) {
  const matched = profiles.filter((profile) => profile.name === profileFilter)
  if (matched.length === 0) {
    fail(`没有名为 ${profileFilter} 的 profile（可用：${profiles.map((profile) => profile.name).join(', ')}）`)
  }
} else if (showStatus !== true) {
  // 默认展示全部；下面的选择逻辑再按「是否登记」收敛。
}

/** 应用 `--profile` 过滤。 */
function selected() {
  return profileFilter === null ? profiles : profiles.filter((profile) => profile.name === profileFilter)
}

/** 是否登记了本插件（依赖或 bundles 任一出现即可）。 */
function registered(profile) {
  return profile.inDeps || profile.inBundles
}

/**
 * 解析要操作的 profile 列表。
 *
 * - 安装 / 卸载 / 同步：只处理已登记的 profile。一个都没有登记时，安装
 *   （不是卸载 / 同步）回落到全部 profile —— 这对应「第一次装」的场景。
 * - `--status`：列出全部 profile（未登记的也要能看见）。
 */
function targets() {
  const list = selected()
  if (showStatus) return list
  const marked = list.filter(registered)
  if (uninstall || syncClientOnly) {
    if (marked.length === 0) fail('没有任何 profile 登记了 dsh-balance-pill，无可操作对象')
    return marked
  }
  if (marked.length > 0) return marked
  if (profileFilter !== null) return list
  log('提示：没有 profile 登记 dsh-balance-pill，将安装到全部 profile：')
  log(`      ${list.map((profile) => profile.name).join(', ')}`)
  return list
}

const targetsList = targets()
const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
const backupRoot = join(home, `${PLUGIN_NAME}-backup-${stamp}`)

/** profile 里已安装副本的目录。 */
function targetDirOf(profile) {
  return join(profile.dir, 'node_modules', PLUGIN_NAME)
}

/** 读取已安装副本的版本；没有副本返回 null。 */
function installedVersion(profile) {
  const pkg = readJson(join(targetDirOf(profile), 'package.json'))
  return typeof pkg?.version === 'string' ? pkg.version : null
}

/** 两个文件是否逐字节相同；任一不存在返回 false。 */
function sameFile(left, right) {
  if (!existsSync(left) || !existsSync(right)) return false
  try {
    return readFileSync(left).equals(readFileSync(right))
  } catch {
    return false
  }
}

// ------------------------------------------------------------------ 状态查询

if (showStatus) {
  const localPkg = readJson(join(ROOT, 'package.json'))
  const localClient = join(ROOT, 'client', 'client.js')
  log(`本地         v${localPkg?.version ?? '?'}（${ROOT}）`)
  log(`DSH_HOME     ${home}`)
  log('')
  log('profile      登记        版本(I)     客户端产物')
  log('-----------  ----------  ----------  ------------------------------------------')
  for (const profile of targetsList) {
    const version = installedVersion(profile)
    const marked = registered(profile) ? '是' : '否（未登记）'
    let clientState = '无已装副本'
    if (version !== null) {
      if (!existsSync(localClient)) clientState = '本地缺少 client.js（先 build）'
      else if (!existsSync(join(targetDirOf(profile), 'client', 'client.js'))) clientState = '副本缺少 client.js'
      else clientState = sameFile(localClient, join(targetDirOf(profile), 'client', 'client.js'))
        ? '与本地一致'
        : '与本地不一致（运行 --apply 或 --sync-client --apply）'
    }
    log(`${profile.name.padEnd(12)}  ${marked.padEnd(10)}  ${String(version ?? '—').padEnd(10)}  ${clientState}`)
    if (profile.hasBundles !== true) warn(`${profile.name}: package.json 缺少 dsh.profile.bundles 数组`)
  }
  log('')
  const stale = targetsList.filter((profile) => installedVersion(profile) !== (localPkg?.version ?? null))
  if (stale.length > 0) {
    log(`需要同步：${stale.map((profile) => profile.name).join(', ')}（已装版本与本地不一致）`)
  } else {
    log('全部 profile 的已装版本与本地一致。')
  }
  process.exit(0)
}

// --------------------------------------------------------------- 同步客户端

if (syncClientOnly) {
  const source = join(ROOT, 'client', 'client.js')
  if (!existsSync(source)) fail(`缺少构建产物 ${source} —— 先运行 node scripts/build.mjs`)
  const bytes = readFileSync(source)
  log(`同步客户端产物到 ${targetsList.length} 个 profile（${apply ? '执行' : '预览，不写盘'}）`)
  log(`  源 ${source}（${(bytes.length / 1024).toFixed(1)} KB）`)
  let missing = 0
  for (const profile of targetsList) {
    const target = join(targetDirOf(profile), 'client', 'client.js')
    if (!existsSync(targetDirOf(profile))) {
      warn(`${profile.name}: 插件尚未安装（${targetDirOf(profile)} 不存在）—— 跳过；先运行 --apply`)
      missing += 1
      continue
    }
    change(`${profile.name}: -> ${target}`)
    if (apply) {
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, bytes)
    }
  }
  if (apply) log('已写入。dsh-client-hmr 每 500ms 轮询这些文件，约 1 秒后界面自动热替换。')
  else log('这是预览。确认无误后加 --apply 执行。')
  if (missing === targetsList.length) process.exit(2)
  process.exit(0)
}

// ------------------------------------------------------------ 计算目标状态

/**
 * 为一个 profile 计算安装 / 卸载后的 manifest。
 * @param profile - profile 记录。
 * @returns `{next, nextText, willWrite}`。
 */
function planManifest(profile) {
  if (profile.manifest === null) throw new Error(`${profile.manifestPath} 不是合法 JSON`)
  const next = JSON.parse(profile.text)
  if (uninstall) {
    if (next.dependencies !== undefined) delete next.dependencies[PLUGIN_NAME]
    if (next.dsh?.profile?.bundles !== undefined) {
      next.dsh.profile.bundles = next.dsh.profile.bundles.filter((name) => name !== PLUGIN_NAME)
    }
  } else {
    next.dependencies ??= {}
    const bundles = next.dsh?.profile?.bundles
    if (!Array.isArray(bundles)) {
      throw new Error(`${profile.manifestPath} 里没有 dsh.profile.bundles 数组 —— profile 结构不符合预期`)
    }
    next.dependencies[PLUGIN_NAME] = `file:${ROOT.replace(/\\/g, '/')}`
    if (!bundles.includes(PLUGIN_NAME)) next.dsh.profile.bundles = [...bundles, PLUGIN_NAME]
  }
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  return { next, nextText, willWrite: nextText !== profile.text }
}

const plans = targetsList.map((profile) => {
  try {
    return { profile, ...planManifest(profile) }
  } catch (error) {
    fail(error.message)
    return null
  }
})

// ---------------------------------------------------------------- 展示计划

log(`${uninstall ? '卸载' : '安装'}计划（${apply ? '执行' : '预览，不写盘'}）`)
log(`  DSH_HOME   ${home}`)
log(`  插件源     ${ROOT}`)
log(`  目标       ${targetsList.map((profile) => profile.name).join(', ')}`)
log('')

for (const plan of plans) {
  const { profile } = plan
  log(`[${profile.name}]`)
  log(`  profile    ${profile.dir}`)
  log(`  登记       dependencies=${profile.inDeps ? '是' : '否'} · bundles=${profile.inBundles ? '是' : '否'}`)
  if (uninstall) {
    change(`删除插件目录 -> ${targetDirOf(profile)}`)
  } else {
    change(`复制插件目录 -> ${targetDirOf(profile)}（复制前先移除旧副本）`)
  }
  if (existsSync(targetDirOf(profile))) {
    change(`已装副本先备份 -> ${join(backupRoot, profile.name, 'plugin')}`)
  }
  change(plan.willWrite ? `改写 ${profile.manifestPath}` : 'package.json 无需改动（已是目标状态）')
  change(`备份 -> ${join(backupRoot, profile.name)}`)
  log('')
}

if (!apply) {
  log('这是预览。确认无误后加 --apply 执行：')
  log(`  node scripts/install.mjs --apply${uninstall ? ' --uninstall' : ''}${profileFilter === null ? '' : ` --profile=${profileFilter}`}`)
  log('')
  log('提示：桌面端正在运行时，profile 清单的改动会被 dsh-hmr 重新组合层栈；')
  log('      客户端 bundle 由 dsh-client-hmr 每 500ms 轮询，改完源码不需要刷新页面。')
  process.exit(0)
}

// ------------------------------------------------------------------ 执行

/** 备份单个 profile；失败抛错（此时还没有做任何不可逆改动）。 */
function backupProfile(profile) {
  const dir = join(backupRoot, profile.name)
  mkdirSync(dir, { recursive: true })
  const backedUp = []
  for (const relative of ['package.json', 'cordis.patch.yml', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) {
    const from = join(profile.dir, relative)
    if (!existsSync(from)) continue
    cpSync(from, join(dir, relative.replace(/[\\/]/g, '__')))
    backedUp.push(relative)
  }
  const pluginDir = targetDirOf(profile)
  const hasPlugin = existsSync(pluginDir)
  if (hasPlugin) cpSync(pluginDir, join(dir, 'plugin'), { recursive: true })
  writeFileSync(join(dir, 'restore.ps1'), restoreScript(profile, dir, backedUp, hasPlugin))
  return { dir, backedUp, hasPlugin }
}

/** 生成单 profile 的 restore.ps1。 */
function restoreScript(profile, backupDir, backedUp, hasPlugin) {
  const q = (value) => value.replace(/'/g, "''")
  return `# 余额徽章 —— 把 ${profile.name} 回滚到本次安装前的状态。
# 用法：先在 DeepSeek Harness 里完全退出，然后：
#   pwsh -File "${join(backupDir, 'restore.ps1')}"
$ErrorActionPreference = 'Stop'
$profile = '${q(profile.dir)}'
foreach ($pair in @(
${backedUp.map((file) => `  @('${file}', '${file.replace(/[\\/]/g, '__')}')`).join(',\n')}
)) {
  $src = Join-Path '${q(backupDir)}' $pair[1]
  if (Test-Path $src) { Copy-Item $src (Join-Path $profile $pair[0]) -Force; Write-Host "restored $($pair[0])" }
}
$plugin = Join-Path $profile 'node_modules\\${PLUGIN_NAME}'
$pluginBackup = Join-Path '${q(backupDir)}' 'plugin'
if (Test-Path $pluginBackup) {
  if (Test-Path $plugin) { Remove-Item $plugin -Recurse -Force }
  Copy-Item $pluginBackup $plugin -Recurse -Force
  Write-Host 'restored plugin copy from backup'
} elseif (Test-Path $plugin) {
  Remove-Item $plugin -Recurse -Force; Write-Host 'removed plugin copy'
}
Write-Host '回滚完成。请重新打开 DeepSeek Harness。'
`
}

/** 把一个 profile 的插件目录替换成当前源码。 */
function installCopy(profile) {
  const targetDir = targetDirOf(profile)
  if (existsSync(targetDir)) rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(dirname(targetDir), { recursive: true })
  cpSync(ROOT, targetDir, {
    recursive: true,
    filter: (source) => !COPY_EXCLUDE.has(source.split(/[\\/]/).pop())
  })
}

/** 安装 / 卸载后的最小可用性检查。 */
function verify(profile) {
  const targetDir = targetDirOf(profile)
  if (uninstall) {
    log(`  ${existsSync(targetDir) ? '✗' : '✓'} ${profile.name}: 插件目录已移除`)
    return
  }
  for (const [path, label] of [
    [join(targetDir, 'lib', 'index.js'), '宿主侧入口'],
    [join(targetDir, 'client', 'client.js'), '客户端 bundle'],
    [join(targetDir, 'cordis.patch.yml'), 'bundle patch'],
    [join(targetDir, 'package.json'), '包清单']
  ]) {
    log(`  ${existsSync(path) ? '✓' : '✗'} ${profile.name}: ${label}`)
  }
}

const restores = []
for (const plan of plans) {
  const { profile } = plan
  try {
    const backup = backupProfile(profile)
    restores.push(join(backup.dir, 'restore.ps1'))
    log(`[${profile.name}] 已备份 -> ${backup.dir}`)
    if (uninstall) {
      const targetDir = targetDirOf(profile)
      if (existsSync(targetDir)) {
        rmSync(targetDir, { recursive: true, force: true })
        log(`[${profile.name}] 已删除 ${targetDir}`)
      }
    } else {
      installCopy(profile)
      log(`[${profile.name}] 已复制插件 -> ${targetDirOf(profile)}`)
    }
    if (plan.willWrite) {
      writeFileSync(profile.manifestPath, plan.nextText)
      log(`[${profile.name}] 已改写 ${profile.manifestPath}`)
    }
  } catch (error) {
    console.error(`[${profile.name}] 失败：${error.message}`)
    console.error(`  已备份的内容在 ${join(backupRoot, profile.name)}；必要时手动运行其中的 restore.ps1。`)
    process.exitCode = 2
  }
}

if (restores.length > 1) {
  writeFileSync(
    join(backupRoot, 'restore-all.ps1'),
    `# 余额徽章 —— 依次回滚本次改动的全部 profile。
# 用法：先在 DeepSeek Harness 里完全退出，然后：
#   pwsh -File "${join(backupRoot, 'restore-all.ps1')}"
$ErrorActionPreference = 'Stop'
${restores.map((file) => `& '${file.replace(/'/g, "''")}'`).join('\n')}
`
  )
}

log('')
log('安装结果：')
for (const plan of plans) verify(plan.profile)
log('')
log(`备份：${backupRoot}`)
if (restores.length === 1) log(`回滚：pwsh -File "${restores[0]}"`)
else if (restores.length > 1) log(`回滚：pwsh -File "${join(backupRoot, 'restore-all.ps1')}"`)
log('')
log('下一步：')
log('  1. 无需重启：dsh-hmr 会重新组合层栈，dsh-client-hmr 每 500ms 轮询客户端产物；')
log('     若界面里没有出现余额徽章，先刷新一次页面，再考虑完全退出后重开。')
log('  2. 改完前端源码：node scripts/build.mjs && node scripts/install.mjs --sync-client --apply')
log('  3. 卸载：node scripts/install.mjs --apply --uninstall')
process.exit(process.exitCode ?? 0)
