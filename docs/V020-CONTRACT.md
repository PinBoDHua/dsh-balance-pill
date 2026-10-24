# dsh-balance-pill 0.2.0 —— 「审计修复 + 账本讲完整」契约

> 本文件是 **0.2.0** 的冻结契约。v1.3 / v1.4 / v1.5 / v0.1.6 的契约
> （`docs/V13-CONTRACT.md`、`docs/V14-CONTRACT.md`、`docs/V15-CONTRACT.md`、
> `docs/V016-CONTRACT.md`）继续有效，本文件只写**增量**与**被本次修订的部分**；
> 冲突时以本文件为准。契约里的名字（导出名、配置键、词条键、DOM 属性、
> CSS 类名）**不得改名**。

## 0. 版本号

| 项 | 决定 |
| --- | --- |
| `package.json` 的 `version` | `0.2.0` |
| `CHANGELOG.md` 顶条目 | `## 0.2.0` |
| `src/client/version.js` 的 `PLUGIN_VERSION` | `0.2.0`，面板标题旁显示 `v0.2.0` |
| `balance.js` 的 `CLIENT_VERSION` | `0.2.1`（上报平台侧的宿主版本，跟随 0.2.x 系列） |
| 设置键 / 存储键 / 挂载点 | **一个都不改**（仍是 `:settings` / `:history` / `:sessions` 与三个槽位） |
| 新增设置项 | **没有** —— 新增的三行都只读已有历史采样 |

## 1. D1：共享读数槽位接线（本版主线缺陷）

### 1.1 现状（错的，v1.4 起）

`readings.js` 提供了 `recordReading()` / `latestReading()` / `resetReading()`，
`shell.overlay` 的提醒宿主每拍 `latestReading()` 喂给 `tariff.tick()` —— 但
`recordReading()` **没有任何调用方**。后果：看门狗快照里 `balance` /
`ratePerHour` 恒为空，`remainingMs` / `lastsUntilNextPeak` / `offPeakRemainingMs`
全部静默为 null。徽章面板另算快照所以显示正常，「看起来正常」正是它隐匿
一个版本的原因。

### 1.2 修法（名字冻结）

`src/client/pill.js` 的 `publish()` 在**每次成功读数**后（历史采样之后、
会话基准之前）调用：

```js
recordReading({ at, amount, currency, perHour })
```

- `amount` = `model.primary`（当前口径的金额），`currency` = `model.summary.currency`，
  `at` = `reading.at`，`perHour` = `model.rate?.perHour ?? null`；
- `readings.js` 本身的形状**不变**：非法金额整体忽略、`perHour` 非正归 null；
- 产物断言锚 `recordReading`：这行被删时构建失败（而不是预估静默消失）。

### 1.3 必须成立的行为（测试要锁）

1. 覆盖写：后一次成功读数完整替换前一次；
2. 非法金额的写入被**整体**忽略（不能只更新部分字段）；
3. `resetReading()` 清空；生产代码不调用它。

## 2. D2：面板「最近充值」行

### 2.1 数据（名字冻结）

`src/client/history.js`：

| 导出 | 说明 |
| --- | --- |
| `lastTopUpFromSamples(samples, options)` | **新增**。`options = {basis, currency}`，语义与 `spendInDay` 一致（都可缺省 = 不过滤）。取**同口径、同币种**的相邻样本里最近一次 `current.amount - previous.amount > 0` 的跳变，返回 `{amount, at, currency}`（`amount` 恒为正，`at` 是跳变后那枚样本的时刻）；不足两个有效样本、或没有上升时返回 null。**绝不抛错。** |

与消耗统计同一条纪律：输入先按 `at` 排序、同毫秒去重（保留最后一条）再扫描。
它**不感知窗口**：入账可能发生在 7 天之前，那一跳仍在历史里（历史保留 7 天）。

### 2.2 词条

| 键 | zh | 占位符 |
| --- | --- | --- |
| `panel.lastTopUp` | `最近充值 {amount}（{time}）` | `amount`（带 `+` 号，走 `formatMoneyDelta`）、`time`（`formatBillingMoment`，跨天补日期） |

### 2.3 DOM

`<p class="dbp_topup" data-balance-last-topup>`，位置在「近 7 天已用」之后、
趋势图之前。`lastTopUp === null || amount <= 0` 时**不渲染**。样式与
`.dbp_recent` 同族（`margin: 2px 0 0`、三级标签色、表格数字）。

## 3. D3：`spendInWindow` 的 `dailyAverage`

返回形状在 `{spent, currency, firstAt, lastAt, samples}` 上**追加**
`dailyAverage`（不改动既有字段；`spendInDay` / `spendInWeek` 不加）：

```
coveredDays = max(1, ceil((lastAt - firstAt) / 86400000))
dailyAverage = spent / coveredDays
```

- 分母是**覆盖天数**而不是固定 7：两小时样本的日均不能被摊薄；
- `spent === 0` 时 `dailyAverage === 0`（行不渲染，但形状必须自洽）；
- 词条 `panel.recentSpend` 的占位符从 `{amount, time}` 变为
  `{amount, daily, time}`：zh `近 7 天已用 {amount}（日均 {daily}，自 {time} 起）`。

## 4. D4：速度行的「预计耗尽时刻」

- 条件与徽章 `title` / `data-balance-runout` **完全一致**（同一个
  `runoutOf(model, settings)`）：`showRate` 开、`status === 'ready'`、
  `perHour > 0`、预计耗尽落在 24 小时内；
- 满足时在速度行 `<p class="dbp_meta" data-balance-rate>` 内追加
  `<span class="dbp_runout" data-balance-rate-runout>`，文案走新词条
  `panel.runoutAt`（zh `，约 {time} 耗尽`，`time` 用 `formatBeijingDateTime`）；
- 不满足时该 span **不存在**（不是空串）。

## 5. D5：`formatCountdown` 的 0 语义

- `ms === 0` → `t('duration.seconds', {count: 1})`（边界那一拍不再闪
  「暂时无法估算」；`msUntil*` 都是 `Math.max(0, …)`，0 是真实会出现的值）；
- `ms < 0` 或非有限 → `t('duration.unknown')`（负数是调用方传错，仍不可估算）；
- 其余分档不变（v0.1.6 的「天 + 小时 + 分钟」规则保留）。

## 6. D6：候选边界的单槽缓存（性能）

`pricing.js` 的 `boundaryCandidates()` 增加模块级单槽缓存，**纯函数语义不变**
（同样的输入仍得到同样的值）：

- 缓存键：`基准日序号 | tzOffsetMinutes | days | backDays | useCalendar`；
- **自定义日历（`options.holidays` 非 null/undefined）一律绕过缓存**：
  两张不同的自定义表在键里区分不开，宁可慢也不能错；
- 返回数组是**只读共享**的，任何调用方不得修改；
- 必须成立（测试要锁）：同一计费日内两次 `pricingSnapshot` 的边界结论一致；
  同一时刻、两张不同的自定义日历必须给出不同结论（缓存不得串表）。

## 7. 其余修订

| 项 | 决定 |
| --- | --- |
| `CLIENT_VERSION` | `0.2.1`（测试锁死；只用于平台侧统计界面来源，不参与鉴权） |
| `settings.alertOnTariff.description` | 文案对齐 v1.5 的分方向冷却：zh「……每个方向每小时最多一张。」/ en「…per hour per direction.」 |
| `useBalance` 的 `dismissAlert` | **删除**（死代码：提醒关闭走 `shell.overlay` 注入的 `dismiss`，不走组件内部） |
| 样式 | 新增 `.dbp_topup`；`.dbp_runout` 不加专属样式（继承 `.dbp_meta`） |

## 8. 构建与验证的硬要求

- 构建期产物断言从 34 项增至 **40 项**：新增 `data-balance-last-topup`、
  `lastTopUpFromSamples`、`dailyAverage`、`recordReading`、`panel.runoutAt`、
  `panel.lastTopUp`；测试侧的标记清单同步为 40 项；
- `tests/runtime.test.mjs` 从 136 项扩到 **142 项**；
- `package.json` / `CHANGELOG.md` / `PLUGIN_VERSION` 三处一致（既有测试继续锁）。

## 9. 不允许的改动

- 不得删除或改名 `recordReading` / `latestReading` / `resetReading`；
- 不得给 `spendInDay` / `spendInWeek` 加 `dailyAverage`（分母语义只对
  「跨多天窗口」成立）；
- 不得让「最近充值」行绕过 `basis` / `currency` 过滤（口径切换的跳变不是充值）；
- 不得把 D4 的耗尽条件写第二份判断（必须复用 `runoutOf`，两处说法才永远一致）；
- 不得缓存自定义日历的候选边界。
