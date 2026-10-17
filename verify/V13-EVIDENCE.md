# dsh-balance-pill v1.3 —— 真实 GUI 实测证据（WP-D）

> 本文件只写**实测到的东西**。每一行都给出断言、结果与证据文件；
> 没在真实 GUI 里断言过的，写进第 5 节（仅单测覆盖）或第 6 节（已知偏差）。
> 采集时间：北京时间 2026-10-16 00:0x – 00:3x（周四深夜 → 周五凌晨，真实时段为空闲）。

## 0. 结论摘要

| 项 | 结果 |
| --- | --- |
| `node --test tests/runtime.test.mjs` | **166 / 166 通过，0 失败**（v1.2 基线 97 项 → 新增 **69** 项） |
| 真实 GUI 断言（`verify/out/v13-pill.json`） | **122 条，0 失败**（4 个变体：默认 / 时段+提醒 / 余额提醒 / 关闭 showTariff） |
| 控制台 `getSnapshot is not a function` / `slot entry crashed in 'shell.overlay'` | **0 次**（修复前每次启动都有，见第 4 节 ③） |
| 时段提醒卡（高峰方向 / 空闲方向 / 无宿主 Toast 的兜底卡片） | 三条都在真实 GUI 里拿到卡片与截图 |
| v1.2 余额跨档提醒（回归） | 卡片实测可见 —— **该通路在此前版本从未在真实 GUI 里渲染过** |
| 本轮抓出并修复的真缺陷 | 4 个（第 4 节，含 2 个由本验证台独立报出） |

## 1. 环境与复现命令

被测产物（Lead 同步，实测期间未再变更）：

- `client/client.js` = **217.9 KB**，SHA256 `B4549ABE…D043`（与本地产物一致）
- `node scripts/build.mjs` → exit 0，**20 个模块**、**15 条产物断言**（第 15 条即 `getSnapshot`）
- 运行中的 GUI：`http://127.0.0.1:19387`（宿主 Web GUI，插件已安装并热替换完成）

```powershell
# 1) 单测
cd D:\Questions\dsh-balance-pill
node --test tests/runtime.test.mjs

# 2) 真实 GUI 实测（离屏 Electron 验证台；必须先清掉 ELECTRON_RUN_AS_NODE）
cd D:\Questions\dsh-balance-pill\verify
$env:ELECTRON_RUN_AS_NODE = $null
& 'D:\Questions\.dsh-ui-plugin\research\c3\electron\electron.exe' shot-pill.mjs `
    --url=http://127.0.0.1:19387/ `
    --out=out/v13-pill.png `
    --json=out/v13-pill.json `
    --variants-file=variants-v13.json `
    --watchdog=1200000

# 3) 提醒卡定位探针（fiber 普查 + 定时器节奏 + MutationObserver，只读）
& 'D:\Questions\.dsh-ui-plugin\research\c3\electron\electron.exe' probe-tariff-alert.mjs `
    --url=http://127.0.0.1:19387/ --watchdog=300000
```

**期望值不复用 `pricing.js`。** 验证台只 import `calendars.js` 的节假日**数据**，
日期/窗口/依据/边界全部独立重算（逐分钟扫描找边界），否则就是「拿实现验证实现」。
时间相关的用例一律用**可控时钟**：徽章自己读 `Date.now()`，而且面板一打开就有
1 秒心跳重算，所以固定时刻必须覆盖整段用例。

真实 GUI 实测覆盖的四个变体（`verify/variants-v13.json`）：

| 变体 | 设置 | 用途 |
| --- | --- | --- |
| `v13-default` | `showTariff=true, alertOnTariff=false` | 真实时间下的徽标与面板 |
| `v13-tariff` | `+alertOnTariff=true, tariffModel=flash` | 时间注入（高峰 / 午休 / 下午高峰）、倒计时走字、提醒卡、关闭-重开 `showTariff` |
| `v13-balance-alert` | `alertOnTariff=false` | v1.2 余额跨档提醒回归（走真实设置控件） |
| `v13-no-tariff` | `showTariff=false` | 关闭徽标后的对照 |

## 2. 断言表（真实 GUI 实测，逐条）

| # | 断言 | 实测值 | 结果 | 证据 |
| --- | --- | --- | --- | --- |
| 1 | `data-tariff` 与按北京时间独立算出的时段一致 | `off-peak`（周四 23:5x 空闲） | 通过 | `v13-pill.json` → `results[].tariff.assertions` |
| 2 | `data-tariff-reason` 与独立算出的依据一致 | `night` | 通过 | 同上 |
| 3 | 注入 2026-10-16 10:30（周五高峰）后时段随之变化 | `peak` / `peak-window` | 通过 | `TARIFF-INJECT[peak-2026-10-16-10:30]`（21 条全过） |
| 4 | 注入 12:30（午休）后时段与依据 | `off-peak` / `midday` | 通过 | `TARIFF-INJECT[offpeak-2026-10-16-12:30]`（24 条全过） |
| 5 | 注入 14:30（下午高峰）后时段与依据 | `peak` / `peak-window` | 通过 | `TARIFF-INJECT[peak-2026-10-16-14:30]`（21 条全过） |
| 6 | 徽标存在且 `data-balance-tariff` 与 `data-tariff` 一致；文案「空闲 / 高峰」 | `空闲`（真实时刻）/ `高峰`（注入后） | 通过 | 截图 `v13-pill-v13-tariff-panel.png`、`v13-pill-v13-tariff-peak.png` |
| 7 | 徽标的 `title` 与 `aria-label` 同源，且说明「贵/便宜」 | 空闲：「当前处于空闲时段，单价为高峰时段的一半」 | 通过 | `tariff.inspect.badge` |
| 8 | 徽标真的可见（字号 11px、有尺寸） | `fontSize=11px`，`rect.w>10` | 通过 | `tariff.inspect.badge.rect` |
| 9 | 面板时段区按契约顺序渲染（row→note→next→window→reason→price→save→lasts→calendar） | 顺序一致（只出现应出现的） | 通过 | `tariff.inspect.order` |
| 10 | `[data-balance-tariff-next]` 的 `{time}` = 独立算出的边界（跨天带日期） | `距下一个高峰 8 小时 44 分钟（09:00 起）`；跨天时 `（10-16 09:00 起）` | 通过 | `blocks.next`（同日/跨天两种形态都覆盖） |
| 11 | `{duration}` 与边界时刻自洽（±2 分钟） | 由独立逐分钟扫描的边界核对 | 通过 | `assertions[15..17]` |
| 12 | `[data-balance-tariff-window]` 的起点 = 独立算出的「高峰→空闲」变化点 | `本段空闲：18:00 – 10-16 09:00（共 15 小时）` | 通过 | `blocks.window` + 截图 `v13-pill-v13-tariff-panel.png` |
| 13 | `{duration}` = `end - start`（整段长度，不是距 now 的剩余） | 15 小时 = 18:00→次日 09:00；午休 2 小时 = 12:00→14:00 | 通过 | 同上 + `TARIFF-INJECT[offpeak…]` |
| 14 | 价格行：当前时段单价与高峰对照价自洽（空闲 = 高峰 ÷ 2） | 空闲 `¥4.00（高峰 ¥8.00）`；高峰 `¥8.00（高峰 ¥8.00）` | 通过 | `blocks.price` + 两张面板截图（曾疑为「印两遍」，复核后为误报：高峰用例两数相同是正确语义） |
| 15 | 高峰 `save` 行：`half = amount ÷ 2` | 注入高峰下渲染：`高峰跑 2 小时约 ¥0.02，留到空闲时段只花 ¥0.01` | 通过 | `TARIFF-INJECT[peak-2026-10-16-14:30]`（22 条全过） |
| 16 | 非人民币币种降级成 `saveGeneric`（金额与价格不混用） | 由单测锁死；GUI 场景余额为 CNY，未出现该分支 | 仅单测 | 见第 5 节 |
| 17 | 空闲 `lasts` 行只在有消耗速度时出现 | 真实场景两次读数之间余额未变 → 该行按契约不渲染；注入场景出现「按当前速度，余额够撑到下一个高峰」 | 通过（条件断言） | `blocks.lasts` |
| 18 | `[data-balance-tariff-calendar]` 与日历覆盖年份一致 | `节假日日历覆盖 2025–2026 年` | 通过 | `blocks.calendar` |
| 19 | 补班日说明：`makeup` 时渲染 `panel.tariff.makeup` | 由单测锁死（GUI 未注入补班日） | 仅单测 | 见第 5 节 |
| 20 | 倒计时在走字（真实时间，分钟粒度） | `8 小时 43 分钟` → `8 小时 41 分钟`（间隔 89.9 秒，中间去做其它断言） | 通过 | `evidence.countdownTick` |
| 21 | 关闭 `showTariff` 后 `.dbp_tariff` 消失、`data-tariff` 仍在 | `badge=null`，`period=off-peak` | 通过 | `evidence.showTariffOff` + 截图 `v13-pill-v13-tariff-no-tariff.png` |
| 22 | 重新打开后徽标恢复 | `badge="空闲"` | 通过 | `evidence.showTariffBackOn` |
| 23 | 控制台不再有浮层条目崩溃痕迹 | `slotErrors: []` | 通过 | `evidence.slotErrors` |
| 24 | 时段提醒卡（高峰方向） | `进入高峰时段：单价已翻倍（deepseek-flash 输出 ¥8.00/百万 tokens）。不急的活可以留到 12:00 之后。` | 通过 | 截图 `v13-pill-v13-tariff-alert.png` |
| 25 | 时段提醒卡（空闲方向） | `进入空闲时段：单价降为一半，同样的钱能用更久。` | 通过 | 截图 `v13-pill-v13-tariff-alert-offpeak.png` |
| 26 | 兜底卡片路径带 `[data-balance-alert-kind='tariff']`（临时摘掉宿主 Toast） | `ownKind="tariff"` | 通过 | 截图 `v13-pill-v13-tariff-alert-fallback.png` |
| 27 | v1.2 余额跨档提醒（走真实设置控件：口径切到赠金 ¥0.00） | 卡片 `余额不足：当前 ¥0.00，任务可能随时中断。`；档位 `warn → low`，还原后回 `warn` | 通过 | 截图 `v13-pill-v13-balance-alert-balance-alert.png` |
| 28 | 设置行在真实 GUI 里挂载（`[data-balance-settings]`） | `rowMounted=true` | 通过 | `evidence.balanceAlerts[0].rowMounted` |

断言总数与结论见 `verify/out/v13-pill.json` → `evidence`；每条断言都带
`{check, expected, actual, ok}`，失败项会列进 `tariffFailedChecks`。

## 3. 提醒卡实测（本轮修复后的关键证据）

时段提醒与余额提醒共用 `shell.overlay` 上的同一个条目与同一个共享仓库
（`alert.js` 的 `createAlertStore()`），因此下面的四张卡同时证明**两条通路**都活着：

| 卡片 | 触发方式 | 实测文案 | 截图 |
| --- | --- | --- | --- |
| 时段卡 · 高峰 | 时钟注入跨 09:00→10:30 | 进入高峰时段：单价已翻倍（deepseek-flash 输出 ¥8.00/百万 tokens）。不急的活可以留到 12:00 之后。 | `v13-pill-v13-tariff-alert.png` |
| 时段卡 · 空闲 | 时钟注入跨 12:00→12:30 | 进入空闲时段：单价降为一半，同样的钱能用更久。 | `v13-pill-v13-tariff-alert-offpeak.png` |
| 时段卡 · 兜底路径 | 摘掉宿主 Toast 后再跨一次边界 | 卡片带 `data-balance-alert-kind="tariff"`（契约第 3 节的数据形状） | `v13-pill-v13-tariff-alert-fallback.png` |
| 余额卡（v1.2，回归） | 真实设置控件把徽章口径切到赠金（¥0.00），再手动刷新 | 余额不足：当前 ¥0.00，任务可能随时中断。 | `v13-pill-v13-balance-alert-balance-alert.png` |

触发条件按实现：看门狗每 30 秒 tick 一次，只有「上一次观测」与「现在」分属两个
时段才提醒，且**每小时最多一张卡**（冷却；状态里只有一个 `alertedAt`，因此这是
全局而非「每个方向各一张」—— 词条与文档已统一为该口径）。验证台的等待窗口是 75 秒
（远大于 30 秒），且在每段等待前先点掉上一张卡，避免把旧卡误判成新卡。

## 4. 本轮实测抓出并修复的缺陷（按发现顺序）

| # | 缺陷 | 发现方式 | 影响 | 修复 |
| --- | --- | --- | --- | --- |
| ① | `boundaryCandidates` 前后搜索跨度都不够（`offset` 从 `-1` 到 `+2`） | 本验证台实测报出：`nextPeriodStart` 在**周五傍晚/整夜**与**假期中段**返回 `null` | 契约 §1 的 `nextPeakAt/msUntilPeak/lastsUntilNextPeak` 在那些时段为空；面板「距下一个高峰」整行消失；空闲区间被截到当天 24:00 | `DEFAULT_SEARCH_DAYS/BACK_DAYS = 30`（Lead），单测 4 条 + 不变量锁定 |
| ② | `currentOffPeakWindow` 起点被截到日界（回看只覆盖 1 天） | teammate-ui 报备 + 本验证台逐条复现 4 例（10-02 / 10-08 / 10-18 / 05-04） | 长假把「本段空闲」低报数天（国庆少算 6 小时起、春节更多） | 回扫改为「最后一个前一刻是高峰的边界点」并覆盖 30 天，单测补 4 条期望 + 跨 5 个探针的不变量循环 |
| ③ | `shell.overlay` 条目因 `createAlertStore()` 缺 `getSnapshot` 崩溃，被宿主 `abdicate` 永久摘除 | 本验证台定位：页面控制台 `TypeError: w.getSnapshot is not a function` + fiber 普查 `withTariff: 0` + 定时器节奏 8/8（排除节流） | **提醒卡整条通路不可达**（时段提醒与 v1.2 余额提醒都弹不出来）；v1.2 的 `behaviour.json` 里 `ownCardFound:false` 正是它的痕迹 | `alert.js` 提供 `getSnapshot`（宿主 `bindSnapshotSelector()` 只认这个 uSES 契约名）；构建新增第 15 条产物断言锁死。修复后四张卡片实测可见 |
| ④ | 「本段空闲」时长口径（区间起点语义） | teammate-ui 报备，本验证台用「时长 = end − start」与「起点 = 变化点」两条断言在真实 GUI 复验 | 面板时长与起止不自洽 | 与 ② 同一处修复；GUI 断言 12/13 两条锁死 |

另有一处**经复核判定为误报、不计入缺陷**：Lead 在联调时怀疑「空闲时段的价格行把高峰价
印了两遍」。逐条核对后不成立 —— 那一行 `输出 ¥8.00（高峰 ¥8.00）` 来自 **10:30 高峰**
用例（高峰时当前价本就等于高峰价），13:00 午休用例是 `输出 ¥4.00（高峰 ¥8.00）`，
符合契约（空闲价 = 高峰价 ÷ 2）。两侧因此都补了自检与断言锁死（见上表第 14 行），
但 README/CHANGELOG 的修复段**不含**这一条。

## 5. 仅单测覆盖（未在真实 GUI 断言）

以下都在 `tests/runtime.test.mjs`（166 项）里覆盖，但**不算**真实 GUI 实测：

- 时段提醒状态机六条规则（首次观测不提醒 / 未变不提醒 / 冷却内原样返回旧 state 且不推进 period / muted 仍推进但不产出 / `nextAt` 非法给 `null` / 冷却从上次真正提醒起算），以及 `createTariffWatcher` 的 tick 与静音行为。
- 非人民币币种时 `panel.tariff.save` 降级为 `saveGeneric`（真实 GUI 当前余额为 CNY，未走到该分支）。
- 补班日 `panel.tariff.makeup`（真实时刻不在补班日，未做时间注入到补班日）。
- 节假日/周末/midday 的 `reason` 文案映射（GUI 覆盖了 `midday`，节假日/周末/补班由单测覆盖）。
- `formatBeijingTime / formatBeijingDateTime / formatPeakWindow / formatCountdown / formatPrice` 的边界（含跨天「次日 / N 天后」形态）。
- 配置三个新键的默认值与归一化、词条键集与占位符一致性、样式选择器与根级变量、构建产物标记。
- `useSecondTick(enabled)` 的定时器装载/清理（单测用可控 `setInterval` 断言语义；GUI 用「倒计时走字」证明行为）。

## 6. 已知偏差与限制（不含糊带过）

1. **注入时钟的变体不校验面板「更新于 …」的相对时间。** 时间注入会把时钟推到未来，而余额读数时刻仍是真实时间，`formatAge` 于是把「未来读数」显示成很大的「N 小时前」（例如注入 10-16 10:30 时显示「更新于 23:53:30（10 小时前）」）。这是验证台的注入副作用，**不是插件缺陷**；真实时间变体该行正常（「刚刚」）。因此断言里刻意不含 `panel.updated` 的相对时间。
2. **`lasts` 行需要消耗速度。** `lastsUntilNextPeak` 只在「空闲 + 余额 + 速率」齐全时有值；真实 GUI 里两次读数之间余额常常没有变化（`computeRate` 要求余额确实下降），所以默认场景该行不渲染 —— 这是契约行为。验证台改成条件断言（有速度才要求该行），两个分支由单测覆盖。
3. **宿主 Toast 可用时卡片没有插件专属属性。** `[data-balance-alert-kind='tariff']` 是**自带兜底卡片**的标记；真实 GUI 里宿主 Toast 可用（`toastPrimitiveBound=true`），卡片是宿主 Toast（类名带哈希），因此断言用词条文案；兜底路径由「临时摘掉 `__DBP_TOAST__` 再跨一次边界」单独验证（结果是 `ownKind="tariff"`）。
4. **提醒有 30 秒 tick 延迟。** 看门狗每 30 秒推进一次，所以注入时钟后必须等 ≥30 秒才可能出卡（验证台等待上限 75 秒）。短超时会误判成「提醒没出」。
5. **变体切换用「写 localStorage + reload」。** 配置 store 在内存里、不订阅外部 `localStorage` 写入，所以验证台切换设置的方式是写入存储后重新加载页面（等价于用户改完设置后的下一次加载）；而 v1.2 余额提醒回归刻意走**真实设置控件**（`[data-balance-control=format]`），以证明组件确实收到变更。
6. **空闲/高峰的真实切换无法等待。** 真实时间的下一个边界在 09:00（数小时之后），因此高峰/午休/下午高峰三个场景都用**时间注入**（覆写 `Date.now`）驱动；注入期间验证台会备份并还原 `dsh-balance-pill:history|sessions`，不给用户的界面留下「未来」样本。
7. **`verify/out/` 的历史截图未改动**，本轮只新增 `v13-*` 文件。

## 7. 交付文件清单

| 文件 | 说明 |
| --- | --- |
| `tests/runtime.test.mjs` | 166 项（新增 69 项：v1.3 契约常量/边界/日历/快照/词条/格式/配置/提醒状态机/徽标/面板/样式/产物） |
| `verify/shot-pill.mjs` | 真实 GUI 验证台（v1.2 的断言未删，新增 v1.3 时段阶段、时段提醒阶段、余额提醒回归阶段） |
| `verify/variants-v13.json` | 本轮四个变体：`v13-default` / `v13-tariff` / `v13-balance-alert` / `v13-no-tariff` |
| `verify/probe-tariff-alert.mjs` | 提醒卡定位探针（fiber 普查 + 定时器节奏 + MutationObserver，只读，可复跑） |
| `verify/out/v13-pill.json` | 原始 DOM 快照 + 122 条断言结果 + 页面控制台消息（78.6 KB） |
| `verify/out/v13-pill-v13-default.png` / `-default-panel.png` | 默认变体：空闲徽标 + 面板（真实时间） |
| `verify/out/v13-pill-v13-tariff.png` / `-tariff-panel.png` | 时段变体：徽标 + 面板 |
| `verify/out/v13-pill-v13-tariff-peak.png` | 注入 2026-10-16 10:30 的高峰徽标 + 面板（`距下一个空闲时段 1 小时 30 分钟（12:00 起）`） |
| `verify/out/v13-pill-v13-tariff-alert.png` | 时段提醒卡（高峰方向，宿主 Toast） |
| `verify/out/v13-pill-v13-tariff-alert-offpeak.png` | 时段提醒卡（空闲方向，宿主 Toast） |
| `verify/out/v13-pill-v13-tariff-alert-fallback.png` | 兜底卡片路径（带 `data-balance-alert-kind="tariff"`） |
| `verify/out/v13-pill-v13-tariff-no-tariff.png` | 关闭 `showTariff` 的对照（徽标消失、`data-tariff` 仍在） |
| `verify/out/v13-pill-v13-balance-alert.png` / `-panel.png` / `-balance-alert-balance-alert.png` | 余额提醒变体：收起态 / 面板 / **v1.2 跨档提醒卡回归** |
| `verify/out/v13-pill-v13-no-tariff.png` / `-no-tariff-panel.png` | 关闭 `showTariff` 变体：收起态 / 面板 |
| `verify/V13-EVIDENCE.md` | 本文件 |
