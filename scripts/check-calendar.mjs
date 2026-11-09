/**
 * 余额徽章 —— 节假日日历体检（审计 P2-5）。
 *
 * ## 为什么需要一条可执行流程
 * 时段判定依赖内置的法定节假日 / 调休补班表。这张表每年 11 月国务院办公厅
 * 发布下一年安排后需要人工补；此前没有任何检查，2027 年起「法定节假日全天空闲」
 * 会静默失效，而界面看起来一切正常。项目里的注释早就写了「每年更新一次」，
 * 但「每年」不是一条能被执行、能失败的流程。
 *
 * 这个脚本把维护动作变成三件事：
 *  1. **数据体检**：日期格式、取值、年份声明是否自洽（手抄错会立刻报出来）；
 *  2. **覆盖门禁**：当前年份与下一年必须有数据，否则退出码 1；
 *  3. **可执行的下一步**：打印还缺哪一年、该改哪个文件的哪些地方。
 *
 * 用法：
 *   node scripts/check-calendar.mjs            # 发版前的门禁（缺下一年即失败）
 *   node scripts/check-calendar.mjs --allow-stale  # 只体检、不因缺数据失败
 *   node scripts/check-calendar.mjs --json     # 供 CI / 监控读取
 *
 * 注意：本脚本**不联网**。国务院公告页的抓取与 diff 涉及 HTML 结构与网络可用性，
 * 放进发版门禁会让「网断了就发不了版」；保持离线、只校验内置表，把联网核对留给
 * 人工在补表时完成（来源 URL 写在 `src/client/calendars.js` 顶部）。
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const allowStale = argv.includes('--allow-stale')
const asJson = argv.includes('--json')

const calendars = await import(pathToFileURL(join(ROOT, 'src', 'client', 'calendars.js')).href)
const { CALENDAR_YEARS, CHINA_HOLIDAYS, CALENDAR_DATA_VERSION, CALENDAR_LAST_ENTRY, calendarStatus } = calendars

const problems = []
const warnings = []

// ---------------------------------------------------------------- 数据体检

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const entries = Object.entries(CHINA_HOLIDAYS)
for (const [date, flag] of entries) {
  const match = date.match(DATE_RE)
  if (match === null) {
    problems.push(`${date}: 不是 YYYY-MM-DD 日期`)
    continue
  }
  const [, y, m, d] = match
  const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)))
  if (
    parsed.getUTCFullYear() !== Number(y) ||
    parsed.getUTCMonth() !== Number(m) - 1 ||
    parsed.getUTCDate() !== Number(d)
  ) {
    problems.push(`${date}: 不是真实存在的日期`)
  }
  if (flag !== 0 && flag !== 1) problems.push(`${date}: 取值必须是 0（上班）或 1（放假），实际 ${flag}`)
  if (!CALENDAR_YEARS.includes(Number(y))) problems.push(`${date}: 不在 CALENDAR_YEARS 声明 ${JSON.stringify(CALENDAR_YEARS)} 里`)
}

const sorted = [...entries].sort((a, b) => (a[0] < b[0] ? -1 : 1))
if (entries.some((entry, index) => entry[0] !== sorted[index][0])) {
  problems.push('数据表不是按日期升序书写（便于人工核对，也便于 diff；请排序）')
}

for (const year of CALENDAR_YEARS) {
  if (!entries.some(([date]) => date.startsWith(`${year}-`))) {
    warnings.push(`${year} 年在 CALENDAR_YEARS 里声明了，但表里没有任何该年条目`)
  }
}

if (CALENDAR_LAST_ENTRY !== sorted[sorted.length - 1]?.[0]) {
  problems.push(`CALENDAR_LAST_ENTRY 与实际最后一条不一致：${CALENDAR_LAST_ENTRY} vs ${sorted[sorted.length - 1]?.[0]}`)
}

// ---------------------------------------------------------------- 覆盖门禁

const status = calendarStatus()
if (!status.covered) {
  problems.push(
    `当前年份 ${status.year} 没有日历数据（覆盖 ${status.firstYear}–${status.lastYear}）：` +
      '法定节假日会被当作工作日，峰谷、单价、倒计时与节省预估都会算错'
  )
} else if (status.needsUpdate) {
  const message =
    `还没有 ${status.year + 1} 年的安排（当前覆盖到 ${status.lastYear}）。` +
    `国务院办公厅通常在 11 月发布，请补 ${join('src', 'client', 'calendars.js')} 的 CHINA_HOLIDAYS/CALENDAR_YEARS，` +
    '并同步更新 CALENDAR_DATA_VERSION；否则跨年当天起时段判定会静默失效'
  if (allowStale) warnings.push(message)
  else problems.push(message)
}

// -------------------------------------------------------------------- 输出

const summary = {
  ok: problems.length === 0,
  dataVersion: CALENDAR_DATA_VERSION,
  years: CALENDAR_YEARS,
  firstYear: status.firstYear,
  lastYear: status.lastYear,
  lastEntry: CALENDAR_LAST_ENTRY,
  entryCount: entries.length,
  today: status.year,
  needsUpdate: status.needsUpdate,
  problems,
  warnings
}

if (asJson) {
  console.log(JSON.stringify(summary, null, 2))
} else {
  console.log(`节假日日历 ${CALENDAR_YEARS[0]}–${CALENDAR_YEARS.at(-1)} · ${entries.length} 条 · 数据版本 ${CALENDAR_DATA_VERSION}`)
  console.log(`当前北京时间年份 ${status.year} · 覆盖 ${status.covered ? '是' : '否'} · 下一年 ${status.needsUpdate ? '缺数据' : '已覆盖'}`)
  console.log(`最后一条记录 ${CALENDAR_LAST_ENTRY} · 文件 ${join(ROOT, 'src', 'client', 'calendars.js')}`)
  for (const warning of warnings) console.warn(`警告：${warning}`)
  for (const problem of problems) console.error(`错误：${problem}`)
  if (problems.length === 0) console.log('检查通过。')
}

process.exit(problems.length === 0 ? 0 : 1)
