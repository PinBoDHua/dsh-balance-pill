# dsh-balance-pill v1.5 —— 「周消耗 + 分方向冷却」接口契约

> 本文件是 v1.5 的**冻结契约**。v1.3 / v1.4 的契约（`docs/V13-CONTRACT.md`、
> `docs/V14-CONTRACT.md`）继续有效，本文件只写**增量**与**被本次修订的部分**；
> 冲突时以本文件为准。契约里的名字（导出名、配置键、词条键、DOM 属性、CSS 类名）
> **不得改名**。

## 0. 背景：v1.4 留下的两类问题

| 编号 | 结论 | 单测能抓到吗 |
| --- | --- | --- |
| D1 | `advanceTariffAlert` 的冷却只有单一 `alertedAt`，**反方向**的切换会被挡掉：11:30 的「进入高峰」使 12:00 的「进入空闲」进不了冷却窗口而静默丢弃 —— 而「现在便宜了」恰恰是最该提醒的一次 | ✅ 能（纯函数），v1.4 的测试只断言了同方向 |
| D2 | `settings.normalizeSettings()` 的 `numberOr()` 直接 `Number(value)`；`Number(null)` / `Number('')` / `Number(false)` 都是 `0`，会被当成合法阈值 → **任何余额都判红** | ✅ 能，v1.4 没有覆盖 `null` / `''` / `false` 三种输入 |

v1.5 的目标因此是**修掉这两个静默缺陷**，并补一行用户直接看得见的「本周已用」。

## 1. D1 的修法：冷却按方向分账（核心）

### 1.1 现状（错的）

```
advanceTariffAlert(state, input, options)
  lastAlertedAt = state.alertedAt          ← 单一时间戳，所有方向共用
  if (at - lastAlertedAt < cooldownMs) return { state, alert: null }
```

`11:30 进入高峰` → `alertedAt = 11:30`；`12:00 进入空闲` → `30 分钟 < 1 小时` → 被挡。

### 1.2 修法（名字冻结）

`src/client/tariff-alert.js`：

| 字段 / 行为 | 说明 |
| --- | --- |
| `createTariffAlertState()` | 返回 `{period: null, alertedAt: 0, alertedAtPeak: 0, alertedAtOffPeak: 0, seq: 0}` |
| `alertedAtPeak` | 新增。最近一次**进入高峰**方向真正提醒的时刻（毫秒）；从未提醒为 0 |
| `alertedAtOffPeak` | 新增。最近一次**进入空闲**方向真正提醒的时刻；从未提醒为 0 |
| `alertedAt` | **保留**。继续写回「最近一次任何方向的提醒」，供旧代码读取；**不再参与判定** |

判定规则：

```
lastAlertedAt = period === 'peak' ? alertedAtPeak : alertedAtOffPeak
if (lastAlertedAt !== 0 && at - lastAlertedAt < cooldownMs) return { state, alert: null }
```

提醒产出时只推进**本方向**的时间戳：

```
nextAlerted = period === 'peak' ? { alertedAtPeak: at } : { alertedAtOffPeak: at }
state = { ...current, ...nextAlerted, period, alertedAt: at, seq }
```

其余规则**一个字都不改**（v1.3 / v1.4 的契约继续有效）：

1. 首次观测只记录不提醒；
2. 时段没变不提醒，且**返回同一个 state 引用**（让下游跳过重渲染）；
3. 静音（`muted`）推进 `period` 但不产出卡片、不占用冷却；
4. 冷却期内**原样返回旧 state，绝不推进 `period`** —— 冷却一过就补上；
5. 边界 / 单价算不出来时给 `null`（不是 `0`）。

### 1.3 必须成立的行为（测试要锁）

- `11:30 进入高峰`（提醒）→ `12:00 进入空闲` **必须**提醒；
- 反过来的时序同样成立（`12:00 进入空闲` 不挡 `14:00 进入高峰`）；
- 同方向连续两次切换，第二次仍受 1 小时冷却保护；
- 冷却期内 `period` 不推进 → 冷却一过，那次切换仍然补得上。

## 2. D2 的修法：阈值解析不接受隐式的 0

`src/client/settings.js` 的 `numberOr(value, fallback)` 改为：

| 输入 | 结果 |
| --- | --- |
| `typeof value === 'number'` 且有限、`>= 0` | 采用该数值 |
| 非空数字字符串（`'5'`、`' 5 '`） | 采用 `Number(value)` |
| `null` / `undefined` / `''` / `'  '` / `false` / `{}` / 负数 / `NaN` / `Infinity` | **回落 `fallback`** |

理由与 `history.billingDayOf`（v1.4）、`tariff-alert.tariffEpochOf`（v1.3）是同一条：
**`null` 不是 `0`**。区别在于这两个函数的后果是「显示 1970 年」，而这里的结果是
「任何余额都判红」—— 用户会以为账号真的没钱了。

不变量（测试必须断言）：

- `normalizeSettings({low: null, warn: ''})` 的两个阈值都等于 `DEFAULT_SETTINGS`；
- `normalizeSettings({low: 0, warn: 10})` 的 `low` **就是** `0`（数值 0 是合法输入）；
- `normalizeSettings({low: '3', warn: '10'})` 正常采用。

## 3. 新增：面板「本周已用」

### 3.1 纯函数（名字冻结）

`src/client/history.js` 增加：

| 导出 | 说明 |
| --- | --- |
| `billingWeekOf(at, tzOffsetMinutes?)` | 把 epoch 毫秒落到北京时间的 **ISO 周序号**（周一为起点）。默认偏移 `+480`，与 `billingDayOf` / `pricing.js` 同口径 |
| `spendInWeek(samples, at, options)` | → `{spent, currency, firstAt, lastAt, samples}` \| `null`。规则见下 |

`spendInWeek` 的规则（与 `spendInDay` 逐条对齐，每条都要有测试）：

1. 只取与 `at` **同一个计费周**的样本；
2. 只取**同一口径**（`basis`）的样本；`basis` 缺省或空串时**不过滤**（v1.5 起的统一语义，
   与 `spendInDay` 一致）；
3. 币种必须一致；`options.currency` 缺省或空串时**不过滤**；
4. 消耗 = 本周**最早**样本金额 − **最晚**样本金额；为负（本周充值过）时**归零**；
5. 本周样本少于 2 个时返回 `null`（一个点算不出消耗）；
6. `at` 非法或 `samples` 不是数组时返回 `null`，绝不抛错。

### 3.2 词条（中英键集必须一致）

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `panel.weekSpend` | `本周已用 {amount}（自 {time} 起）` | `Used this week {amount} (since {time})` |

### 3.3 DOM

`<p class="dbp_week" data-balance-week-spend>`，位置在**「今日已用」之后、趋势图之前**。
`{time}` 用 `formatBeijingTime(firstAt)`（北京时间，与「今日已用」一致 —— 这一行按
北京时间切周，用本地时区显示会给出与「本周」对不上的钟点）。

**不新增设置项**：跟随已有的历史采样。`week.spent <= 0` 或 `week === null` 时不渲染该节点。

## 4. 两个附带修订

### 4.1 「近期消耗」标注时段口径

`pill.js` 的「近期消耗」行在**空闲时段**改用新词条，说明这个速度是按空闲单价折算的
（跨峰谷切换时它会跳变，不标注会被误读成余额算错）：

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `panel.rateOffPeak` | `近期消耗 {amount}（空闲价），按此速度约可用 {remaining}` | 见 `locales.js` |

高峰时段继续用 `panel.rate`（原文案不变）。

### 4.2 「本轮会话已用」的时刻写法

`panel.sessionSpend` 的 `{time}` 参数从 `formatAge(...)`（「3 分钟前」）改为
`formatBeijingTime(spend.since)`（「15:42」），与「今日已用」「本周已用」统一 ——
相对写法每秒都在贬值，而「从几点开始」是稳定的。

## 5. 构建与验证的硬要求

- `scripts/build.mjs` 的产物断言从 **19 项增至 26 项**，新增：
  `data-balance-week-spend`、`panel.weekSpend`、`spendInWeek`、`billingWeekOf`、
  `alertedAtPeak`、`alertedAtOffPeak`、`panel.rateOffPeak`；保留 v1.4 的全部 19 项。
- `node --test tests/runtime.test.mjs` 全绿。
- `package.json` 的 `version` 与 `CHANGELOG.md` 顶条目一致（有测试锁）。
- README / CHANGELOG 按 v1.5 结构更新（新增一节，不改写 v1.4 的历史）。

## 6. 不允许的改动

- 不引入任何第三方依赖；不新增挂载点（仍是三个）；不改 `cordis.patch.yml`；
- **不改存储键**（仍是 `dsh-balance-pill:settings` / `:history` / `:sessions`）；
- **不新增设置项**（「本周已用」跟随历史采样，分方向冷却是内部实现）；
- 不改 `pricing.js` / `calendars.js` 的导出名与语义；
- 不删除 `alertedAt` 字段（旧代码仍在读），只是不再用它判定冷却。
