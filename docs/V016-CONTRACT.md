# dsh-balance-pill 0.1.6 —— 「充值对账 + 近 7 天」契约

> 本文件是 **0.1.6** 的冻结契约。v1.3 / v1.4 / v1.5 的契约
> （`docs/V13-CONTRACT.md`、`docs/V14-CONTRACT.md`、`docs/V15-CONTRACT.md`）
> 继续有效，本文件只写**增量**与**被本次修订的部分**；冲突时以本文件为准。
> 契约里的名字（导出名、配置键、词条键、DOM 属性、CSS 类名）**不得改名**。

## 0. 版本号重置

版本号从 **1.5.0 重置为 0.1.6**，理由与迁移影响：

| 项 | 决定 |
| --- | --- |
| `package.json` 的 `version` | `0.1.6` |
| `CHANGELOG.md` 顶条目 | `## 0.1.6` |
| `src/client/version.js` 的 `PLUGIN_VERSION` | `0.1.6`，面板标题旁显示 `v0.1.6` |
| 设置键 / 存储键 / 挂载点 | **一个都不改**（仍是 `:settings` / `:history` / `:sessions` 与三个槽位） |
| 旧配置 | 无需迁移；1.5.0 及更早写入的配置、历史、会话基准继续可读 |

重置只影响版本号与文档，不影响任何存储格式。之后版本从 `0.1.7` 继续递增。

## 1. D1：消耗按「逐段下降」求和（本版主线）

### 1.1 现状（错的）

v1.5 及更早：

```
spent = 窗口最早样本金额 − 窗口最晚样本金额
if (spent < 0) spent = 0
```

当天充值过一次就会得到负数，然后被归零。例：

```
08:00 ¥20 → 09:00 ¥15（花 5）→ 10:00 ¥35（充 20）→ 11:00 ¥32（花 3）
旧：20 − 32 = −12 → 0
新：5 + 3 = 8
```

### 1.2 修法（名字冻结）

`src/client/history.js`：

| 导出 | 说明 |
| --- | --- |
| `spentFromSamples(samples)` | **新增**。按时间升序的一对相邻样本，只累加 `previous.amount - current.amount > 0` 的部分；上升（充值 / 赠金入账）跳过。返回非负数，绝不抛错。 |
| `RECENT_WINDOW_MS` | **新增**。`7 * 24 * 3600 * 1000`，供「近 7 天」窗口使用；与 `MAX_AGE_MS` 数值相同但语义独立。 |
| `spendInWindow(samples, at, options)` | **新增**。`options = {windowMs, tzOffsetMinutes, basis, currency}`；`windowMs` 缺省 `RECENT_WINDOW_MS`，非法/非正返回 `null`。窗口为 `[at - windowMs, at]`（两端闭）。 |
| `spendInDay` / `spendInWeek` | 语义修订：不再用「最早 − 最晚」，改用 `spentFromSamples`；其余过滤规则不变。 |

`spendInWindow` 与 `spendInDay` / `spendInWeek` 共用的规则：

1. 只取窗口内、`amount` 有限的样本；`at` 非法返回 `null`；
2. `basis` 非空时只取同口径；`currency` 非空时只取同币种；
3. 先按 `at` 升序排序，**同毫秒只保留最后一条**，再逐段求和；
4. 少于两个有效样本返回 `null`（一个点算不出消耗）；
5. 返回值形状 `{spent, currency, firstAt, lastAt, samples}`；`spent` 可以为 `0`，
   但调用方只在 `spent > 0` 时渲染消耗行；
6. 绝不抛错。

### 1.3 必须成立的行为（测试要锁）

- `20 → 15 → 35 → 32` 的日/周/窗口消耗都是 **8**；
- 纯充值（`5 → 20`）的消耗是 **0**，不是负数；
- 乱序样本 `10:00 ¥5, 08:00 ¥10, 09:00 ¥8` 按 `10→8→5` 算出 **5**；
- 同毫秒 `¥10, ¥8` 后接 `¥7`，只算 `8→7 = 1`；
- 8 天前的样本不进入 7 天窗口，正好落在 `at - windowMs` 的样本进入；
- 非法 `windowMs`（`0` / 负数 / `NaN` / `'x'` / `null`）返回 `null`。

## 2. D2：新增面板「近 7 天已用」

### 2.1 数据

`pill.js` 的 `derived` 多一个 `recent`：`spendInWindow(samples, now, {windowMs: RECENT_WINDOW_MS, basis: model.format, currency: model.summary.currency})`。
与「今日」「本周」共用同一次 `Date.now()`，避免午夜跨日时三行口径不一致。

### 2.2 词条（中英键集必须一致）

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `panel.recentSpend` | `近 7 天已用 {amount}（自 {time} 起）` | `Used in the last 7 days {amount} (since {time})` |

### 2.3 DOM

`<p class="dbp_recent" data-balance-recent-spend>`，位置在「本周已用」之后、
趋势图（`data-balance-trend`）之前。`recent === null` 或 `recent.spent <= 0` 时
**不渲染该节点**（与今日/本周一致）。

`{time}` 用 `formatBillingMoment(recent.firstAt, Date.now())`。

## 3. D3：跨天窗口的「自某时刻起」必须带日期

### 3.1 现状（歧义）

「本周已用 ¥1.86（自 08:20 起）」在周五会被读成**今天**早上 8:20，但本周
从周一就开始了。v1.5 的契约只要求 `formatBeijingTime(firstAt)`，丢掉了日期。

### 3.2 修法（名字冻结）

`src/client/format.js` 新增：

| 导出 | 说明 |
| --- | --- |
| `formatBillingMoment(at, now?, tzOffsetMinutes?)` | 同一计费日返回 `HH:MM`；跨日返回 `MM-DD HH:MM`；非法 `at` 返回 `--`。缺省时区 `+480`，缺省 `now` 为 `Date.now()`。 |

使用点（三处，全部改用它）：

- `panel.sessionSpend` 的 `{time}`（会话可能跨天）；
- `panel.weekSpend` 的 `{time}`；
- `panel.recentSpend` 的 `{time}`。

「今日已用」仍在同一天内，继续用 `formatBeijingTime`（行为不变）。

## 4. D4：改配置不再弹假「余额不足」

### 4.1 现状（错的）

把「徽章数字」从 `total` 切到 `recharge`：

```
旧口径 ¥20（ok） → 新口径 ¥2（low），金额与档位同时变
advanceAlert 只看「金额有没有变」→ 判成一次真实掉档 → 弹「余额不足」
```

用户只是换了显示口径，余额一分没少。

### 4.2 修法（名字冻结）

`src/client/alert.js`：

| 字段 / 行为 | 说明 |
| --- | --- |
| `createAlertState().configKey` | **新增**，初值 `null` |
| `advanceAlert` 的 `reading.configKey` | **新增**，可选字符串；标识「口径 + 阈值 + 币种」 |
| 判定 | 旧状态与本次读数的 `configKey` 都非空且不同 → **静默跟随**：更新 `level` / `amount` / `configKey` / `at`，`alertedLevel = level`，不产出 `alert`；不占用冷却 |
| 旧行为 | `amountUnchanged` 分支保留，供没有传 `configKey` 的调用方 |
| 序列化 | `serializeAlertState` / `deserializeAlertState` 带上 `configKey`（缺省 `null`） |

`pill.js` 传入：

```
configKey = `${settings.format}|${settings.currency}|${settings.low}|${settings.warn}|${summary.currency}`
```

必须成立：配置稳定后，真实的 `ok → low` 仍然提醒；配置变化本身不提醒。

## 5. D5：速度基准跨过「金额没变」的轮询

### 5.1 现状（错的）

每次成功读数都把 `previous` 覆盖为当前读数。若下一次轮询余额没变，
`computeRate` 得到 `spent = 0` → 返回 `null`，面板「近期消耗」与徽章耗尽预估
凭空消失；余额按批结算时尤其常见。

### 5.2 修法（名字冻结）

`src/client/balance.js`：

| 导出 / 常量 | 说明 |
| --- | --- |
| `RATE_MAX_ELAPSED_MS` | **新增**，`6 * 3600 * 1000` |
| `rateBaseline(previous, summary, at)` | **新增**。`summary` 为空返回旧基准；币种变化或 `total` / `primary` 变化 → `{summary, at}`；否则原样返回 `previous`（保留旧 `at`）。 |
| `computeRate` | 语义修订：`elapsedMs > RATE_MAX_ELAPSED_MS` 时返回 `null`（半天的平均不是「近期速度」）；其余规则不变。 |

`pill.js` 的 `build()` 用 `rateBaseline()` 更新 `previous.current`，不再无条件覆盖。
`refreshedViewModel()` 在重算设置时显式接收 `rate`，改阈值/口径后速度行不消失。

## 6. D6：`null` 不是 `0`（第三批）

### 6.1 `pricingSnapshot`

`src/client/pricing.js` 的输入归一改为只接受数字或非空数字字符串：

| 输入 | 旧结果 | 新结果 |
| --- | --- | --- |
| `balance: null` | `0` → 推出「撑不到下一高峰」 | `null` → `remainingMs = null` |
| `tzOffsetMinutes: null` | `0` → 按 UTC 判定 | `+480` → 按北京时间 |
| `now: null` | `0` → 1970 年 | `Date.now()` |
| `balance: 0` | `0` | `0`（合法，保持） |
| `tzOffsetMinutes: 0` | `0` | `0`（合法，保持） |

### 6.2 `normalizePoll`

`settings.js` 的 `pollMs` 归一：

| 输入 | 旧结果 | 新结果 |
| --- | --- | --- |
| `''` / `'  '` / `false` / `{}` / `[]` | `0`（仅手动） | 默认 60000 |
| `0` / `'0'` | `0` | `0`（明确「仅手动」） |
| 数字 / 非空数字字符串 | 按值 | 按值（小于 5000 抬到 5000） |

## 7. UI：面板限高与版本号

### 7.1 面板限高

`usePanelPosition()` 计算 `maxHeight`：取「徽章上方空间」与「视口高度减边距」
的较小值，最低 96px，作为内联 `max-height`；`styles.css` 的 `.dbp_panel` 同时有
`max-height: calc(100vh - 24px)` 与 `overflow-y: auto; overscroll-behavior: contain`。
面板内容超高时在面板内滚动，标题与「刷新」不会被裁掉。

### 7.2 版本号

面板标题旁渲染 `<span class="dbp_panelVersion" data-balance-version>v0.1.6</span>`。
`PLUGIN_VERSION` 在 `src/client/version.js`，测试锁定它等于 `package.json` 的
`version`，且 `CHANGELOG.md` 顶条目一致。

### 7.3 跨天倒计时

`formatCountdown` 在 `days >= 1` 时不再只返回整数天，而是：

| 剩余 | 文本 |
| --- | --- |
| 1 天整 | `1 天` |
| 1 天 2 小时整 | `1 天 2 小时` |
| 1 天 2 小时 13 分 | `1 天 2 小时 13 分钟` |
| 1 天 0 小时 30 分 | `1 天 30 分钟` |

这样面板里的「距下一个高峰 / 空闲」至少每分钟走一次字；`days >= 1` 的旧断言
（只给 `1 天`）被本契约修订。

## 8. 构建与验证的硬要求

- `scripts/build.mjs` 的产物断言从 **26 项增至 34 项**，新增：
  `data-balance-recent-spend`、`panel.recentSpend`、`spendInWindow`、
  `data-balance-version`、`PLUGIN_VERSION`、`configKey`、
  `formatBillingMoment`、`RATE_MAX_ELAPSED_MS`；保留 v1.5 的全部 26 项。
- `node --test tests/runtime.test.mjs` 全绿（本版为 **136** 项）。
- `package.json` / `CHANGELOG.md` / `PLUGIN_VERSION` 三处版本一致（有测试锁）。
- README / CHANGELOG 按 0.1.6 结构更新（新增一节，不改写历史版本）。
- 真实 GUI 验证：至少覆盖「近 7 天已用」出现、面板限高滚动、版本号、原有
  三档配色/时段/提醒不回归。

## 9. 不允许的改动

- 不引入任何第三方依赖；不新增挂载点（仍是三个）；不改 `cordis.patch.yml`；
- **不改存储键**（仍是 `dsh-balance-pill:settings` / `:history` / `:sessions`）；
- **不新增设置项**（「近 7 天已用」跟随已有历史采样，版本号是常量）；
- 不改 `pricing.js` / `calendars.js` 的导出名与语义（`pricingSnapshot` 的
  `null` 归一属于本契约第 6 节的修订，不是导出改名）；
- 不删除 `alertedAt` / `amountUnchanged` 等旧字段与旧分支（向后兼容）。
