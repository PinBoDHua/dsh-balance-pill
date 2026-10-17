# dsh-balance-pill v1.3 —— 「高峰 / 空闲时段」接口契约

> 本文件是 v1.3 的**冻结契约**：并行开发的三个工作包都按它对齐。
> 契约里的名字（导出名、配置键、词条键、DOM 属性、CSS 类名）**不得改名** ——
> 改名会让并行写出来的模块对不上，而拼接式构建要到运行时才炸。

## 0. 背景：为什么这一版的核心是「时段」

DeepSeek 的价格**不是常量**：空闲时段单价是高峰时段的一半。
官方口径（`https://api-docs.deepseek.com/zh-cn/quick_start/pricing`，2026-10 抓取）：

> 北京时间**周一至周五（不含中国法定节假日）** 9:00–12:00、14:00–18:00 为**高峰时段**；
> 其余时段，**包括周末及中国法定节假日全天**均为**空闲时段**。

等价的 UTC 说法：MON–FRI 01:00–04:00 与 06:00–10:00 UTC。

价格（元 / 百万 tokens）：

| 模型 | 输入(命中) 空闲/高峰 | 输入(未命中) 空闲/高峰 | 输出 空闲/高峰 |
| --- | --- | --- | --- |
| `deepseek-flash` | 0.02 / 0.04 | 1 / 2 | 4 / 8 |
| `deepseek-v4-pro` | 0.15 / 0.30 | 4.5 / 9.0 | 13.5 / 27.0 |

两个容易算错的地方，测试必须覆盖：

1. **午休 12:00–14:00 是空闲时段**，不是「白天都贵」；
2. **调休补班的周六是工作日**（有高峰时段），而**法定节假日里的工作日全天空闲**。

## 1. 已实现的模块（Lead 负责，勿改）

`src/client/calendars.js` —— 内置节假日日历（2025/2026，来源写在文件头），导出
`CHINA_HOLIDAYS`（`'YYYY-MM-DD' → 0 上班调休 / 1 放假`）、`CALENDAR_YEARS`、
`CALENDAR_LAST_YEAR`、`calendarCovers(year)`。

`src/client/pricing.js` —— 纯逻辑引擎，全部函数「输入 → 输出」，可 Node 直测：

| 导出 | 说明 |
| --- | --- |
| `BILLING_TZ_OFFSET_MINUTES` | `480`（北京时间 UTC+8），**固定值**，与机器时区无关 |
| `PEAK_WINDOWS` | `[{startMinute:540,endMinute:720},{startMinute:840,endMinute:1080}]` |
| `PERIODS` | `['peak','off-peak']` |
| `OFF_PEAK_MULTIPLIER` | `0.5` |
| `MODELS` | 两个模型的价格表（见上表），每项 `{key,label,note,source,peak,offPeak}` |
| `DEFAULT_MODEL_KEY` | `'flash'` |
| `DEFAULT_USAGE_MIX` | `{cacheHitShare:0.5, outputShare:0.1}` |
| `periodAt(at, options)` | → `{period,reason,workday,holiday,weekend,makeup,window}` |
| `peakWindowsForDay(at, options)` | → `[{start,end,minuteStart,minuteEnd,makeup}]`，休息日 `[]` |
| `nextTransition(at, options)` | → `{at,period,reason,windows}`：下一次**边界**（含 00:00 日界） |
| `nextPeriodStart(at, period, options)` | → epoch 毫秒：下一次**进入** `peak`/`off-peak` |
| `currentOffPeakWindow(at, options)` | → `{start,end}`；高峰时 `null` |
| `priceOf(model, period, field)` | 取单价；`field` ∈ `cacheHit`/`cacheMiss`/`output` |
| `tokensPerYuan(options, model, period)` | 金额 → 等效 token |
| `pricingSnapshot(options)` | **主入口**，见下 |
| `isPeakAt(at, options)` | 布尔 |
| `selectModel(options)` | `{modelKey,models}` → 价格表 |

`options` 统一为 `{now, tzOffsetMinutes, holidays, useCalendar, modelKey, models,
ratePerHour, balance, usageMix}`，全部可缺省；**任何非法输入都不抛错**。

`pricingSnapshot()` 返回（字段名冻结）：

```
now, tzOffsetMinutes,
period: 'peak'|'off-peak', reason, isPeak, isOffPeak,
workday, holiday, weekend, makeup,
window: {start,end}|null,                    // 当前高峰区间
nextChangeAt, nextPeriod, nextReason, msUntilChange,
nextPeakAt, msUntilPeak,                     // 下一个高峰开始（空闲时=还能半价用多久）
nextOffPeakAt, msUntilOffPeak,               // 下一个空闲开始（高峰时=最该看的数）
offPeakWindow: {start,end}|null,
offPeakMultiplier: 0.5,
model, tokensPerYuan: {input,output,total}|null,
balance, ratePerHour,
remainingMs,                                 // 余额按当前速度能用多久
lastsUntilNextPeak: boolean|null,            // 空闲时段：这点钱撑得到下一个高峰吗
offPeakRemainingMs,                          // 高峰时段：同样的钱在空闲能多撑多久
priceSource
```

`reason` 取值：`peak-window` / `night` / `midday` / `weekend` / `holiday` /
`makeup-workday`。语义边界：`makeup-workday` 只在补班日的**空闲**时段出现；
补班日的高峰时段 reason 是 `peak-window` 且 `makeup === true`。

**v1.3 修订（实测后收紧，以这里为准）**：

1. `boundaryCandidates` 的跨度**两个方向**都从 2 天扩到 **30 天**
   （`DEFAULT_SEARCH_DAYS` / `DEFAULT_BACK_DAYS`；`options.days` / `options.backDays`
   可覆盖）。向前不够会让「周五 17:00 的下一个高峰」返回 null（面板整行消失）；
   向后不够会让长假里的空闲区间起点退回当日日界（低报好几天的免费时长）。
   中国法定节假日最长 9 天（春节），30 天余量充足。
2. `nextTransition(at)` 收紧为「下一次**真正改变时段**的时刻」：跳过时段没变的
   边界（23:30 的下一个边界是 00:00，但前后都是空闲，不算切换）。
   要问「下一个高峰/空闲何时开始」，用 `nextPeriodStart`。
3. `currentOffPeakWindow` 的 `end` 走同一长跨度：周五 18:00 → **周一 09:00**
   （63 小时），不再被截到当天 24:00。
4. `currentOffPeakWindow` 的 `start` 取「**最后一个前一刻还是高峰的边界点**」，
   而不是「最后一个 <= now 的边界点」：长假里连续的整天空闲会让中间的 00:00
   成为「最后一个候选点」，于是区间被截成「从今天 0 点开始」。国庆那种长度下
   这会低报好几天。不变式（测试要断言）：`periodAt(start - 1).period === 'peak'`
   且 `periodAt(end).period === 'peak'`。
5. **UI 落点裁决**（WP-B 提出，Lead 确认）：
   - `{time}`：目标与 `now` 同日用 `formatBeijingTime`，跨天用
     `formatBeijingDateTime`（否则「09:00 起」会被读成已经过去的那个 9 点）；
   - `{duration}`：`panel.tariff.next` 用 `formatCountdown`（确定的时刻差、会走字），
     `panel.tariff.short` 的差额用 `formatDuration`（由速度推算的预测，只给数量级）；
   - `{amount}` / `{half}` / `{output}` / `{peakOutput}` 一律传 `formatAmount` 的
     **纯数字**：词条模板自带 `¥`，再套 `formatMoney/formatPrice` 会打出 `¥¥`；
     币种不是 CNY 时不走金额口径（`saveGeneric`），因此「金额必须带币种」仍成立；
   - `formatPeakWindow` 因此**没有 UI 落点**（面板的 `{from}`/`{to}` 是分开的占位符），
     它保留为纯逻辑工具（供测试与诊断脚本断言区间文本）。
6. `panel.tariff.window` 的 `{duration}` 是**整段**长度（`end - start`），不是
   「距 now 还剩多久」；配合修订 4 之后，长假里它会正确显示「共 9 天」。

### 新增的两个共享模块（Lead 负责，UI 只读）

`src/client/tariff-service.js` —— 时段看门狗。**`service.tariff`** 由 `index.js`
构造并注入：

| 方法 | 说明 |
| --- | --- |
| `snapshot({settings, balance, ratePerHour, now})` | 取时段快照（不推进状态机），供 UI 渲染 |
| `tick({settings, balance, ratePerHour, now})` | 算快照 + 推进时段提醒 + 写共享卡片仓库；由浮层每 30 秒调用 |
| `latest()` | 最近一次 tick 的快照 |
| `state()` | 提醒状态机的只读快照（诊断/测试） |

`src/client/readings.js` —— 「最近一次成功读数」的共享槽位
（`recordReading` / `latestReading` / `resetReading`）：徽章写入，看门狗读取，
避免同一个 Remote 被两处独立轮询。

`src/client/balance.js` 的 `viewModel()` 返回值新增 **`effective: true`**；
`refreshedViewModel()` 返回 `effective: false`。含义是**数据来源**（本次真的读到了
vs 沿用旧读数重算），与 `stale`（数据**新鲜度**）分开 —— v1.2 把两者混成一个字段，
于是「改阈值」被显示成了「读取失败」。

## 2. WP-A（Lead 负责）：配置 + 词条 + 格式化

`src/client/settings.js` 新增字段（默认值即下表）：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `showTariff` | `true` | 状态行徽章上显示时段徽标 |
| `tariffModel` | `'flash'` | 价格口径：`flash` / `pro` |
| `alertOnTariff` | `false` | 高峰开始/空闲开始时是否提醒（默认关：只在用户要求时打扰） |
`src/client/locales.js` 新增词条（中英键集必须一致，占位符必须同名）：

| 键 | 中文示例 | 英文示例 |
| --- | --- | --- |
| `tariff.peak` | `高峰` | `Peak` |
| `tariff.offPeak` | `空闲` | `Off-peak` |
| `tariff.pill.peak` | `高峰` | `Peak` |
| `tariff.pill.offPeak` | `空闲` | `Off-peak` |
| `tariff.pill.aria` | `当前处于高峰时段，单价为空闲时段的两倍` | `Currently in peak hours; rates are double off-peak` |
| `tariff.pill.ariaOff` | `当前处于空闲时段，单价为高峰时段的一半` | `Currently off-peak; rates are half of peak` |
| `panel.tariff.peak` | `高峰时段 · 单价为空闲的 2 倍` | `Peak hours · rates are 2× off-peak` |
| `panel.tariff.offPeak` | `空闲时段 · 单价为高峰的一半（5 折）` | `Off-peak · rates are half of peak (50% off)` |
| `panel.tariff.untilPeak` | `距下一个高峰 {duration}（{time} 起）` | `Next peak in {duration} (from {time})` |
| `panel.tariff.untilOffPeak` | `距下一个空闲时段 {duration}（{time} 起）` | `Next off-peak in {duration} (from {time})` |
| `panel.tariff.window` | `本段空闲：{from} – {to}（共 {duration}）` | `Off-peak window: {from} – {to} ({duration})` |
| `panel.tariff.holiday` | `今天是法定节假日，全天空闲时段` | `Public holiday today — off-peak all day` |
| `panel.tariff.weekend` | `周末全天空闲时段` | `Weekend — off-peak all day` |
| `panel.tariff.makeup` | `今天调休补班，按工作日计费` | `Make-up workday — weekday rates apply` |
| `panel.tariff.midday` | `午休 12:00–14:00 也是空闲时段` | `Midday 12:00–14:00 is off-peak too` |
| `panel.tariff.price` | `{model}：输出 ¥{output} / 百万 tokens（高峰 ¥{peakOutput}）` | `{model}: output ¥{output}/M tokens (peak ¥{peakOutput})` |
| `panel.tariff.save` | `高峰跑 2 小时约 ¥{amount}，留到空闲时段只花 ¥{half}` | `2h at peak ≈ ¥{amount}; off-peak it costs ¥{half}` |
| `panel.tariff.saveGeneric` | `同样的钱在空闲时段能用约 {duration}` | `The same money lasts about {duration} off-peak` |
| `panel.tariff.lasts` | `按当前速度，余额够撑到下一个高峰` | `At this pace the balance lasts until the next peak` |
| `panel.tariff.short` | `按当前速度，余额撑不到下一个高峰（还差 {duration}）` | `At this pace it falls short of the next peak by {duration}` |
| `panel.tariff.calendar` | `节假日日历覆盖 {years} 年` | `Holiday calendar covers {years}` |
| `panel.tariff.calendarStale` | `节假日日历未覆盖 {year} 年，按常规周末规则判定` | `Holiday calendar has no {year} data; weekday/weekend rules apply` |
| `settings.tariff.title` | `计费时段` | `Billing window` |
| `settings.tariff.description` | `高峰时段（北京时间周一至周五 9:00–12:00、14:00–18:00，节假日除外）单价为空闲时段的两倍。` | `Peak hours (Mon–Fri 09:00–12:00 and 14:00–18:00 Beijing time, excluding public holidays) cost double the off-peak rate.` |
| `settings.showTariff.title` | `显示计费时段` | `Show billing window` |
| `settings.showTariff.description` | `在徽章上标出当前是高峰还是空闲时段。` | `Marks whether the pill currently sits in peak or off-peak hours.` |
| `settings.tariffModel.title` | `价格口径` | `Rate table` |
| `settings.tariffModel.description` | `面板里的价格与预估按哪个模型计算。` | `Which model the panel prices and estimates use.` |
| `settings.alertOnTariff.title` | `时段切换提醒` | `Billing-window alerts` |
| `settings.alertOnTariff.description` | `高峰开始与空闲时段开始时浮出一张提示卡，每小时最多一张。` | `Raises a card when peak starts and when off-peak starts, at most one card per hour.` || `alert.tariff.peak.title` | `进入高峰时段` | `Peak hours started` |
| `alert.tariff.peak.body` | `单价已翻倍（{model} 输出 ¥{output}/百万 tokens）。不急的活可以留到 {time} 之后。` | `Rates doubled ({model} output ¥{output}/M tokens). Non-urgent work can wait until {time}.` |
| `alert.tariff.offPeak.title` | `进入空闲时段` | `Off-peak hours started` |
| `alert.tariff.offPeak.body` | `单价降为一半，同样的钱能用更久。` | `Rates halved — the same balance lasts longer.` |

`src/client/format.js` 新增纯函数（locale 显式传入，测试不得依赖机器时区）：

| 函数 | 说明 |
| --- | --- |
| `formatBeijingTime(at, tzOffsetMinutes?)` | `'HH:MM'`，默认 +480；跨天不重要（面板另给日期） |
| `formatBeijingDateTime(at, tzOffsetMinutes?)` | `'MM-DD HH:MM'` |
| `formatCountdown(ms, t)` | 倒计时：`{h} 小时 {m} 分钟` / `{m} 分钟` / `{s} 秒`，用 `duration.*` 词条 |
| `formatPeakWindow(window, tzOffsetMinutes?)` | `{start,end}` → `'09:00–12:00'`（同日）或 `'18:00–次日 09:00'`（跨日） |

## 3. WP-B（UI，`src/client/pill.js` / `styles.css`）：验收接口

**徽章**（`data-balance-pill` 元素）新增属性与子元素：

- `data-tariff="peak" | "off-peak"` —— 始终输出（便于样式与验证）；
- `data-tariff-reason="<reason>"`；
- 当 `settings.showTariff === true` 时，徽章内渲染一个徽标
  `<span class="dbp_tariff" data-balance-tariff="peak|off-peak">{t('tariff.pill.*')}</span>`；
  关闭时该元素**必须不存在**；
- 徽标的 `title` 与 `aria-label` 用 `tariff.pill.aria*`。

**面板**新增内容（顺序即下表；都用 `data-balance-*` 便于断言）：

1. 余额明细之后、`hint` 之前：`<p class="dbp_tariffRow" data-balance-tariff-row>`
   内含
   - `<span class="dbp_tariffBadge" data-tariff="peak|off-peak">{t('tariff.peak'|'tariff.offPeak')}</span>`
   - `<span data-balance-tariff-note>` = `panel.tariff.peak` / `panel.tariff.offPeak`
2. `<p data-balance-tariff-next>` —— 高峰时 `panel.tariff.untilOffPeak`，
   空闲时 `panel.tariff.untilPeak`（占位符 `{duration}` 用 `formatDuration(ms,t)`、`{time}` 用 `formatBeijingTime`）
3. `<p data-balance-tariff-window>` —— 空闲时的本段区间（`panel.tariff.window`）；
   高峰时为 `null`（不渲染）
4. `<p data-balance-tariff-reason>` —— 依 `reason` 取一条补充说明：
   `holiday`→`panel.tariff.holiday`、`weekend`→`panel.tariff.weekend`、
   `makeup-workday`→`panel.tariff.makeup`、`midday`→`panel.tariff.midday`；
   其余（`night`/`weekday`/`peak-window`）**不渲染这个节点**。
   注意 `reason='makeup-workday'` 出现在补班日的**空闲**时段（高峰时 reason 是
   `peak-window`，此时靠 `makeup===true` 判断是否渲染补班说明）。
5. `<p data-balance-tariff-price>` —— `panel.tariff.price`（当前时段输出单价 + 高峰对照价）
6. 高峰且 `remainingMs !== null`：`<p data-balance-tariff-save>` ——
   `panel.tariff.save`，其中 `amount` = 按当前速度跑 **2 小时**的花费，
   `half` = 其一半（都用 `formatMoney(amount, summary.currency, options)`）。
   注意余额币种可能是 USD：价格表是人民币口径，因此币种不是 CNY 时改用
   `panel.tariff.saveGeneric`（金额与价格不可混用），这是刻意的降级。
7. 空闲且 `lastsUntilNextPeak === true|false`：`<p data-balance-tariff-lasts>` ——
   `panel.tariff.lasts` / `panel.tariff.short`（`{duration}` = 差额）
8. `<p data-balance-tariff-calendar>` —— 日历覆盖提示：覆盖当前年份用
   `panel.tariff.calendar`（`{years}` = `'2025–2026'`），否则 `panel.tariff.calendarStale`。

**触发器**：时段的计时器精度是 1 秒 —— `pill.js` 里新增一个
`useSecondTick(enabled)` 钩子（`setInterval` 1000ms，`enabled` 为 false 时不起定时器），
面板打开时启用（倒计时会走字），未打开时不启用（不浪费 CPU）。
时段快照本身每 30 秒或每次 `snap.model` 变化时重算即可（时段边界不会在 30 秒内跳过两次）。

**设置行**（`src/client/settings-row.js`，WP-B 一并负责）在 `showTrend` 之后插入三行：
`showTariff`（勾选框）、`tariffModel`（下拉：flash/pro）、`alertOnTariff`（勾选框），
沿用现有 `Row`/`Checkbox`/`Select`，`testId` 分别为
`showTariff`/`tariffModel`/`alertOnTariff`。

**样式**（`styles.css`）：新增 `.dbp_tariff`（徽标，11px、圆角、峰值用暖色底、
空闲用绿色底，颜色必须走主题令牌或 `:root` 变量 —— 面板 portal 到 `body`，
变量定义在 `.dbp_root` 上的老坑不要再犯）、`.dbp_tariffRow`、`.dbp_tariffBadge`、
`.dbp_tariffMeta`，并给 `[data-tariff='peak']`/`[data-tariff='off-peak']` 各一套配色。

**时段提醒**（WP-C，见下）挂在**已有的** `shell.overlay` 条目上：
`service.alerts` 已经是共享仓库，提醒卡片复用 `alert-toast.js`，
只是数据形状多一个 `kind: 'tariff'`。

### 提醒的数据形状（冻结）

`alert-toast.js` 的 `BalanceAlert` 现在接收
`alert = {level, from, amount, currency, at, seq}`。v1.3 增加一种：

```js
{ kind: 'tariff', period: 'peak'|'off-peak', model: 'deepseek-flash',
  outputPrice: 8, nextAt: <epoch>, at: <epoch>, seq: <number> }
```

`kind` 缺省视为 `'balance'`（向后兼容，v1.2 的形状不变）。

## 4. WP-C（`src/client/tariff-alert.js`，新文件）：提醒状态机

导出（名字冻结）：

| 导出 | 说明 |
| --- | --- |
| `createTariffAlertState()` | `{period: null, alertedAt: 0, seq: 0}` |
| `advanceTariffAlert(state, input, options)` | → `{state, alert}` |
| `DEFAULT_TARIFF_COOLDOWN_MS` | `3600000`（每小时最多一张卡；状态里只有一个 `alertedAt`，故为全局而非分方向） |

`input` = `{period, at, model, outputPrice, nextAt}`；`options` = `{muted, cooldownMs}`。

规则（每条都要有测试）：

1. **首次观测只记录不提醒**（页面打开时已经是高峰 → 不弹）；
2. 时段**没变**不提醒；
3. 时段变了但**距上次提醒不足冷却** → **原样返回旧 state**（不推进 period），
   冷却一过补上 —— 与 v1.2 余额提醒同一语义（那次的教训：推进了状态就把这次切换永久吞掉）；
4. `muted` 为真时仍推进状态但不产出 alert；
5. `nextAt` 非法时 `alert.nextAt` 为 `null`，UI 不得因此崩；
6. 冷却从**上次真正提醒**起算，且**不分方向**：`advanceTariffAlert` 的状态里只有
   一个 `alertedAt`，所以「每小时最多一张卡」是全局的，不是「每个方向各一张」。
   真实的高峰↔空闲切换间隔最短也有 2 小时（12:00 与 14:00 之间是午休），因此行为上
   与「每方向一张」无差别；但文档、词条与实现必须用同一个口径 —— v1.3 统一为
   「每小时最多一张」。
7. `formatPeakWindow(window, tzOffsetMinutes, t)` —— 比契约早期版本多一个 `t`：
   跨天文案（`tariff.windowNextDay` / `tariff.windowDays`）需要本地化函数。
   `t` 缺省时退化成 `HH:MM–HH:MM+N` 这种纯数字形式（仅供诊断）。

## 5. 构建与验证的硬要求

- `scripts/build.mjs` 的产物断言增加：`'计费时段'`（或 `tariff` 相关标记）、
  新存储键不需要新增（配置仍在 `dsh-balance-pill:settings`），新增
  `data-balance-tariff` 与 `tariff-alert` 相关标记各一条；
- 顶层声明不得重名（拼接式构建的经典坑）；
- `node --test tests/runtime.test.mjs` 全绿，新增用例不少于 30 条；
- 真实 GUI 验证（`verify/shot-pill.mjs`）必须断言：
  `data-tariff` 存在且与当前北京时间算出来的时段一致、倒计时在走字、
  关闭 `showTariff` 后徽标消失；
- README / CHANGELOG 按 v1.3 结构重写（WP-D）。

## 6. 不允许的改动

- 不改 `pricing.js` / `calendars.js` 的导出名与语义（要改先与 Lead 对齐）；
- 不引入任何第三方依赖（构建脚本只允许 `react` / `react-dom` / `react/jsx-runtime` /
  `@deepseek-ai/dsh-client-ui-primitives`）；
- 不新增挂载点（仍是三个）；不改 `cordis.patch.yml`；
- 不动 `verify/out/` 里的历史截图（除非是新增）。
