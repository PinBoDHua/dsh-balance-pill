# dsh-balance-pill v1.4 —— 真实 GUI 实测证据

> 本文件只写**实测到的东西**。每一行都给出断言、结果与证据文件；
> 没在真实 GUI 里断言过的，写进第 5 节（仅单测覆盖）或第 6 节（已知偏差）。
> 采集时间：北京时间 2026-10-16 02:4x – 02:5x（周五凌晨，真实时段为空闲）。

## 0. 结论摘要

| 项 | 结果 |
| --- | --- |
| `node --test tests/runtime.test.mjs` | **185 / 185 通过，0 失败**（v1.3 基线 166 项 → 新增 **19** 项） |
| 真实 GUI 断言（`verify/out/v14-pill.json`） | **170 条，0 失败**（6 个变体） |
| 单独跑耗尽预估变体（`verify/out/v14-runout.json`） | **24 条，0 失败** |
| **v1.3 唯一失败的验收**：进入空闲方向的提醒卡 | 本轮**通过**（v1.3 为 75 秒超时、`tariffAlertDirectionsOk=false`） |
| 时钟跳变自愈（D1） | 从 14:30 一次性跳到 19:00（跨 18:00 边界）→ `drift().jumped=true` 且卡片出现 |
| 控制台 `getSnapshot is not a function` / `slot entry crashed` | **0 次** |
| 本轮抓出的真缺陷 | 3 个（D1 / D2 / D3）+ 1 个被**证伪**的假设（D4，不为它改代码） |

## 1. 环境与复现命令

被测产物（实测期间未再变更）：

- `client/client.js` = **236.0 KB**
- `node scripts/build.mjs` → exit 0，**20 个模块**、**19 条产物断言**
- 运行中的 GUI：`http://127.0.0.1:19387`（宿主 Web GUI，插件已安装并热替换完成）

```powershell
# 1) 单测
cd D:\Questions\dsh-balance-pill
node --test tests/runtime.test.mjs

# 2) 真实 GUI 实测（六条通路；必须清掉 ELECTRON_RUN_AS_NODE）
cd D:\Questions\dsh-balance-pill\verify
$env:ELECTRON_RUN_AS_NODE = $null
& 'D:\Questions\.dsh-ui-plugin\research\c3\electron\electron.exe' shot-pill.mjs `
    --url=http://127.0.0.1:19387/ `
    --out=out/v14-pill.png --json=out/v14-pill.json `
    --variants-file=variants-v14.json --watchdog=1800000

# 3) 只验「余额耗尽预估」（它需要等真实消耗，最多 3 分钟）
& 'D:\Questions\.dsh-ui-plugin\research\c3\electron\electron.exe' shot-pill.mjs `
    --url=http://127.0.0.1:19387/ `
    --out=out/v14-runout.png --json=out/v14-runout.json `
    --variants-file=variants-v14-runout.json --watchdog=900000

# 4) 三个只读诊断探针（复现 D1 / D3 / 证伪 D4，不写任何存储）
node verify\probe-v14-cooldown.mjs   # 状态机本身是对的（三个序列）
node verify\probe-v14-d3.mjs         # offPeakRemainingMs 差 2 倍
node verify\probe-v14-d4.mjs         # 「本段空闲」不存在 0 秒退化区间（证伪）
```

**期望值绝不复用 `pricing.js` 的判定。** 验证台只 import `calendars.js` 的节假日
**数据**，日期 / 窗口 / 依据 / 边界全部独立重算（逐分钟扫描找边界），否则就是
「拿实现验证实现」。时间相关的用例一律用**可控时钟**。

六个变体（`verify/variants-v14.json`）：

| 变体 | 设置 | 用途 |
| --- | --- | --- |
| `v14-default` | `showTariff/showTrend/showRate=true` | 真实时间下的徽标与面板 |
| `v14-today` | `showTrend=false` + 铺陡降历史 | 断言「今日已用」与趋势图**无关** |
| `v14-runout` | 轮询等真实消耗 | 断言 `data-balance-runout` 真的出现 |
| `v14-tariff` | `alertOnTariff=true, tariffModel=flash` | 两个方向的提醒卡 + 倒计时走字 + **一次性时钟跳变自愈** |
| `v14-balance-alert` | 走真实设置控件 | v1.2 余额跨档提醒回归 |
| `v14-no-tariff` | `showTariff=false` | 关掉徽标后的对照 |

## 2. 断言表（真实 GUI 实测，逐条）

| # | 断言 | 实测值 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | **进入空闲方向的时段提醒卡**（v1.3 唯一失败项） | 卡片文本「进入空闲时段：单价降为一半，同样的钱能用更久。」 | 通过 | `v14-pill.json` → `evidence.tariffAlerts[0].offPeak`；截图 `v14-pill-v14-tariff-alert-offpeak.png` |
| 2 | 进入高峰方向的时段提醒卡 | 「进入高峰时段：单价已翻倍（deepseek-flash 输出 ¥8.00/百万 tokens）。不急的活可以留到 12:00 之后。」 | 通过 | 同上 `.peak`；截图 `v14-pill-v14-tariff-alert.png` |
| 3 | 两个方向都拿到 → `tariffAlertDirectionsOk` | `true`（v1.3 为 `false`） | 通过 | `evidence.tariffAlertDirectionsOk` |
| 4 | **时钟跳变被识别**（D1） | `driftBefore={gapMs:7200000,jumped:true}`，`driftAfter={gapMs:16200000,jumped:true}` | 通过 | `evidence.clockJumps[0].jumpDetected=true` |
| 5 | **跳变后卡片被补上**（D1 的行为要求） | 跳出「进入空闲时段：单价降为一半…」 | 通过 | `evidence.clockJumps[0].recovered=true`；截图 `v14-pill-v14-tariff-alert-jump.png` |
| 6 | 跳变后状态机跟到新时段 | `state={period:'off-peak',seq:4}`（跳变前为 `peak,seq:3`） | 通过 | `v14-run.log` 的 `TARIFF-JUMP` 行 |
| 7 | **「今日已用」出现在面板** | `v14-default`：`今日已用 ¥0.32（自 01:50 起）`；`v14-today`：`今日已用 ¥0.24（自 01:53 起）` | 通过 | `evidence.todaySpends[]`；截图 `v14-pill-v14-today-panel.png` |
| 8 | **「今日已用」与趋势图开关无关** | `v14-today` 里 `hasTrend=false` 但 `text` 非空（六个变体**全部**有值） | 通过 | `evidence.todaySpends[1]` |
| 9 | **`data-balance-runout` 在满足条件时出现** | 两次独立观测：完整运行 `2026-10-15T19:30:53.170Z`（余额 ¥1.53）；单独跑 `2026-10-15T19:24:48.777Z`（余额 ¥1.22，第 **6** 轮轮询才攒够速度） | 通过 | `evidence.runoutChecks[0].afterRunout`（两个 JSON 各一条） |
| 10 | 耗尽预估的 `title` 与人话一致 | `账户余额 · ¥1.53 · 按当前速度约 10-16 03:30 耗尽`（`19:30:53Z` = 北京 03:30:53）；单独跑 `账户余额 · ¥1.22 · 按当前速度约 10-16 03:24 耗尽`（`19:24:48Z` = 03:24:48） | 通过 | 同上 `.afterTitle`；截图 `v14-pill-v14-runout-runout.png`、`v14-runout-v14-runout-runout.png` |
| 11 | 条件不满足时**不给**该属性 | 单独跑里第 **1–5** 轮全是 `runout=null` 且 `title` 只有两段（`账户余额 · ¥1.27`），第 6 轮才出现 | 通过 | `v14-runout-run.log` 的 `RUNOUT attempt=1..5` |
| 12 | v1.2 余额跨档提醒（回归） | 口径切到赠金 →「余额不足」卡片可见 | 通过 | `evidence.balanceAlerts[0].card` |
| 13 | 时段看门狗接线未破 | `service.tariff` 存在、`tick`/`drift`/`nextTickDelay` 可读 | 通过 | `TARIFF-JUMP` 行里的 `found:true` |
| 14 | 浮层条目未崩溃 | `slotErrors=[]` | 通过 | `evidence.slotErrorsAbsent=true` |
| 15 | 关掉 `showTariff` 后徽标消失、`data-tariff` 仍在 | `badge=null`、`period=off-peak` | 通过 | `evidence.showTariffOff[0]` |
| 16 | 倒计时在走字 | `6 小时 4 分钟` → `6 小时 2 分钟`（间隔 121.1 秒） | 通过 | `evidence.countdownTick[0].changed=true` |
| 17 | 时段判定与独立重算一致（时段区块全量断言） | 170 条断言 | 通过 | `evidence.tariffFailed=0` |

### 2.1 D1 的证据链（为什么这不是「碰巧过了」）

`v14-tariff` 变体里的时钟跳变是**一次性大步跳**，而不是像其它注入那样停在目标时刻
等一拍 —— 这正是 v1.3 会漏掉的形状。两条判据缺一不可：

- `jumpDetected: true` —— 看门狗**识别**出了这次漂移（`gapMs=16200000` = 4.5 小时，
  远超 `TARIFF_MAX_GAP_MS=60000`）；
- `recovered: true` —— 识别之后**补上了**卡片。

只断言后者会让「恰好有一拍落在跳变之后」蒙混过关；只断言前者则无法证明用户真的
看到了卡片。**v1.3 在同一套探针下的读数是 `latest.now` 冻在上一段、75 秒零卡片。**

补充：修复前用只读探针（`probe-tariff-alert.mjs`，直接读组件的 fiber props）拿到了
根因证据 —— 注入 12:30 后 75 秒内 `tariff.latest().now` 停在 10:30，而**手动**调一次
`tick()` 立刻产出正确卡片（`seq` 从 1 到 2）。这说明状态机是对的、错的是驱动层，
也是选「自愈调度」而不是「改状态机」的依据。

## 3. 缺陷（本轮修掉的）

| 编号 | 缺陷 | 证据 | 修法 |
| --- | --- | --- | --- |
| D1 | 看门狗只由 React 依赖变化驱动，时钟前进不触发重算；休眠唤醒 / 校时 / 节流后跨边界被静默漏掉 | `probe-tariff-alert.mjs` + 本轮断言 4/5/6 | 链式 `setTimeout` + `nextTickDelay()` 对齐边界 + `visibilitychange`/`focus` 补拍 + `drift()` 判跳变 |
| D2 | 提醒宿主的 effect 依赖是 `[settings, tariff]`（恒定引用），改设置不能立刻 tick | `index.js` 源码 + 本轮断言（构建产物含 `useAlertOnTariff`） | 订阅**值**，设置一变立刻重排 |
| D3 | `offPeakRemainingMs` 数值差 2 倍（`remainingMs * (1/0.5-1)` 恒等于 `remainingMs`） | `probe-v14-d3.mjs`：余额 $9、速度 $2/h → 实现给 6h…实为 4.5h，正确 9h | 语义统一为「能用多久」（`/0.5`），「省下多少」另立 `offPeakSavingMs` |
| D4 | 假设：「本段空闲」可能渲染 `end <= start` 的 0 秒假区间 | **证伪**：全天逐分钟 1440 点 + 四个边界各 ±5 秒，退化区间 **0** 个 | **不改代码**，只记录 |

## 4. 本轮新增的测试（19 项）

| 主题 | 条数 | 覆盖 |
| --- | --- | --- |
| `nextTickDelay` 边界与对齐 | 2 | 常规拍子 / 对齐到边界 / 边界前 1 毫秒 / 非法输入 |
| 时钟漂移与跳变判据 | 2 | 正常拍子不判跳变、3 小时间隔判跳变；`TARIFF_MAX_GAP_MS` 关系 |
| 跳变自愈 | 2 | 跳变跨边界后下一拍出卡；跨过整个高峰窗口只补「当前一档」 |
| 显式 `now` 优先 | 1 | `snapshot`/`tick` 认显式值，非法值退回 `readNow` |
| D2 接线 | 1 | 产物含订阅值 / 对齐调度 / 可见性监听；反向断言旧写法消失 |
| `billingDayOf` | 1 | 跨零点不串天、时区可换、非法输入给 null |
| `spendInDay` | 2 | 同日 / 同口径 / 同币种 / 不为负；样本不足与垃圾输入 |
| 「今日已用」渲染 | 2 | 位置、与 `showTrend` 无关；当天不足两个样本时不渲染 |
| `data-balance-runout` | 2 | 24 小时内给、跟随 `showRate`；无速度 / 无读数时不给 |
| 词条与样式契约 | 3 | 中英键集与占位符一致；`.dbp_today` 不引用 `.dbp_root` 变量；产物含 v1.4 标记 |

## 5. 仅单测覆盖、未在真实 GUI 里断言的

- `spendInDay` 的**跨币种**与**当天充值（差额为负）**分支：真实账号当前只有 CNY
  钱包、且本轮没有充值，无法在不篡改读数的前提下制造。单测覆盖。
- 「今日已用」在**当天样本不足两个**时不渲染：本轮真实账号一直有两个以上当天样本，
  真实 GUI 里没走到这条分支。单测覆盖。
- `data-balance-runout` 的**跨天**形态（`title` 里的日期不是今天）：本轮实测的耗尽
  时刻落在次日凌晨，`title` 显示 `10-16 04:32`，**这一条实际走到了**；
  但「余额在 24 小时内但坐标跨到后天」的极端形态未构造。
- 时段看门狗的**休眠唤醒**路径（`visibilitychange`）本身：验证台用「一次性时钟跳变」
  复现了同样的时序形状，但**没有**真的让机器休眠。这是等价的时序证据，不是关机证据。

## 6. 已知偏差与说明

- `verify/out/v14-pill.json` 里 `evidence.runouts`（来自变体启动时的 `TARIFF_INSPECT`）
  全部是 `null` —— 那是**取值时机**问题：该快照在轮询攒够消耗速度之前就取了。
  真正的实测值在 `evidence.runoutChecks`（见断言 9/10/11），以及单独跑的
  `verify/out/v14-runout.json`。**注意**：这两处都是「同一件事的两次独立观测」，
  不是两种实现 —— 单独跑那个变体只是为了在轮询超时时有更长的预算。
- 验证台修正了一处**自身**的精度假设缺陷：「省一半」的断言直接比较 `¥0.02` 与
  `¥<0.01` 的数值，而金额小于一分钱时两位小数表达不出来 —— 余额很小时它会报假失败。
  现在按面板的显示精度比较并显式识别下溢写法。这是**验证台**的修正，不是插件行为变化。
- 变体按顺序执行，最后一个（`v14-no-tariff`）会把界面停在「关掉时段徽标」的状态。
  验证台只在单次运行内还原存储，跨次收尾需要再跑一次 `variants-restore.json`。
- 「余额耗尽预估」的出现**取决于账号当时是否在消耗**：三次观测分别在第 2、第 2、第 6
  轮轮询拿到。它**不是**保证复现的 —— 账号空闲时该属性按设计就该缺席（无速度＝无预估）。
  因此这一条的证据价值是「它确实能出现、数值自洽、且不满足时确实不出现」，
  而不是「每次跑都有」。第 11 条那 5 次 `null` 与第 9 条那次出现，是同一件事的两面。
