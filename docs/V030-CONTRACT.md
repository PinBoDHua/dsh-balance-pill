# dsh-balance-pill 0.3.0 —— 「账号级做彻底 + 余额跑道」契约

> 本文件是 **0.3.0** 的冻结契约。v1.3 / v1.4 / v1.5 / v0.1.6 / 0.2.0 的契约
> （`docs/V13-CONTRACT.md`、`docs/V14-CONTRACT.md`、`docs/V15-CONTRACT.md`、
> `docs/V016-CONTRACT.md`、`docs/V020-CONTRACT.md`）继续有效，本文件只写
> **增量**与**被本次修订的部分**；冲突时以本文件为准。契约里的名字（导出名、
> 配置键、词条键、DOM 属性、CSS 类名）**不得改名**。

## 0. 版本号

| 项 | 决定 |
| --- | --- |
| `package.json` 的 `version` | `0.3.0` |
| `CHANGELOG.md` 顶条目 | `## 0.3.0` |
| `src/client/version.js` 的 `PLUGIN_VERSION` | `0.3.0`，面板标题旁显示 `v0.3.0` |
| `lib/index.js` 的 `version` 导出 | **新增** `0.3.0`（宿主侧诊断 / `--status` 用） |
| `balance.js` 的 `CLIENT_VERSION` | `0.2.1`（不变，跟随宿主 0.2.x 系列） |
| 设置键 / 存储键 / 挂载点 | **一个都不改** |
| 新增设置项 / 存储键 | **没有** —— 余额跑道只读已有历史统计 |
| `package.json` 的 `icon` | **新增** `"./icon.svg"`（插件管理器卡片用） |

**版本一致性自 0.3.0 起由构建期强制**：`scripts/build.mjs` 的
`assertVersionConsistency()` 核对 package.json / `version.js` / CHANGELOG 顶条目 /
`lib/index.js` 四处，漏改任意一处构建直接失败（单测仍保留，互为第二道网）。

## 1. D1：余额提醒状态机提升为账号级（本版主线）

### 1.1 现状（错的，v1.2 起）

`advanceAlert` 的状态（`createAlertState()`）住在 `useBalance` 的组件 ref 里。
徽章挂在 `conversation.composer.dock`（**会话作用域**），切换会话整体卸载重挂 ——
「已提醒过哪个档位」「冷却从何时起算」随组件一起销毁。后果：
README 承诺的「同一档位只提醒一次 + 全局 30 分钟冷却」只在单会话内成立，
余额在阈值附近时跨几次会话就可能补出几张重复的卡。提醒的**显示**早在 v1.2
就搬到 root 作用域的浮层（账号级事件），状态机的生命周期却没跟上。

### 1.2 修法（名字冻结）

- 状态机由入口持有：`src/client/index.js` 在构造 `service` 后执行
  `service.balanceAlertState = createAlertState()`；
- 徽章侧（`src/client/pill.js` 的 `publish()`）读写它：
  惰性初始化 `service.balanceAlertState ?? (service.balanceAlertState = createAlertState())`
  （测试替身可不预建该字段），`advanceAlert` 的返回值必须显式写回
  `service.balanceAlertState = outcome.state`（纯函数，不回写等于没推进）；
- 组件里**不得**再出现 `React.useRef(createAlertState())`；
- `alert.js` / `advanceAlert` 本身的形状**不变**（30 分钟冷却、`configKey`
  判定、序列号语义全部沿用）；
- 构建期断言锚 `service.balanceAlertState`。

### 1.3 必须成立的行为（测试要锁）

1. `pill.js` 源码含写入端与回写端两处接线；不含组件 ref 形态；
2. `index.js` 源码含入口创建语句；
3. 纯函数语义（冷却、configKey、首次观测）由既有测试继续锁定。

## 2. D2：面板「余额跑道」行

### 2.1 数据（名字冻结）

`src/client/history.js`：

| 导出 | 说明 |
| --- | --- |
| `runwayOf(balance, dailyAverage)` | **新增**。两者均为有限数且 > 0 时返回 `balance / dailyAverage`（天数，可能带小数）；超出 `RUNWAY_MAX_DAYS` 返回 null；任一输入非法 / 非正返回 null。**绝不抛错。** |
| `RUNWAY_MAX_DAYS` | **新增** 常量 `30`。展示窗口封顶：更远的跑道没有行动价值，与「约 … 耗尽」只看 24 小时内是同一条纪律。 |

### 2.2 展示（名字冻结）

- 位置：「近 7 天已用」之后、「最近充值」之前；
- 节点：`<p class="dbp_runway" data-balance-runway>`；
- 词条：`panel.runway`，参数 `{daily, duration}`（中英占位符一致）；
  `daily` = `formatMoney(recent.dailyAverage, recent.currency)`，
  `duration` = `formatDuration(runway * 86400000, t)`；
- **显示条件（全部满足才渲染）**：`settings.showRate === true`、`recent !== null`
  （即近 7 天窗口有两个以上同口径样本）、`runwayOf(model.primary,
  recent.dailyAverage) !== null`。任一不满足时**该行不存在**（不是空串），
  沿用「不知道就不冒充」的口径；
- 跟随 `showRate` 而不是新增开关：跑道与耗尽预估同属「预测」，用户关掉
  「显示消耗速度」就是不想看这类内容。

## 3. D3：未来样本防护

### 3.1 名字冻结

| 导出 | 说明 |
| --- | --- |
| `FUTURE_SKEW_MS` | **新增** 常量 `5 * 60000`。样本时刻最多允许落在「现在」之后 5 分钟。 |
| `normalizeHistory` | **修订**：丢弃 `at > now + FUTURE_SKEW_MS` 的样本。 |
| `appendSample` | **修订**：拒绝 `parsed.at > now + FUTURE_SKEW_MS` 的新样本（`normalizeHistory` 只清已有历史，写入端必须自守）。 |

### 3.2 必须成立的行为（测试要锁）

1. 落在 `now + FUTURE_SKEW_MS` 之内（含边界前一毫秒）的样本保留；
2. 超过的样本在加载与写入两端都被拒绝；
3. 其余裁剪 / 排序 / 去重行为不变（既有测试锁定）。

## 4. D4：阈值行去「¥」硬编码

| 项 | 决定 |
| --- | --- |
| `panel.rule` 词条 | **修订**：模板不再含 `¥`（`低于 {low} 显示红色 · 低于 {warn} 显示橙色`）；`{low}` / `{warn}` 由组件传 `thresholdText(value, currency, locale)` —— 币种跟随**当前钱包**，无读数时不带符号 |
| `settings.thresholds.description` 词条 | **修订**：币种中性（`当前：红色阈值 {low}，橙色阈值 {warn}。填入金额后立即生效。`）—— 设置行拿不到账号币种，不猜 |
| `thresholdText` | `pill.js` 内部助手（不导出）：`currencySymbol(currency) + formatThreshold(value)` |
| 中英占位符 | 两版模板的 `{low}` / `{warn}` 必须一致（既有 parity 测试锁定） |

## 5. D5：轮询选项并集

| 导出 | 说明 |
| --- | --- |
| `pollChoiceList(currentMs)` | **新增**（`settings.js`）。返回毫秒数组（升序）：`POLL_CHOICES` 并上「不在档位里的当前值」。非数字 / NaN 退回纯档位列表。 |

设置行的「刷新间隔」下拉改用它：存储里的 `pollMs` 允许任意 ≥5000（归一化不对齐
档位），受控 `<select>` 的 value 匹配不到 option 时会渲染成空白 —— 修复
「刷新间隔开天窗」。

## 6. 清理与工具链

| 项 | 决定 |
| --- | --- |
| `pill.js` 的 `currencyPrefix` | **修订**：复用 `format.js` 的 `currencySymbol`（此前两份相同映射），行为逐字节不变 |
| `BalancePanel` | **改为导出**（原模块私有）：单测直接渲染面板断言条件行 |
| `lib/index.js` | **新增** `export const version`（与 package.json 一致，构建期核对） |
| `scripts/build.mjs` | **新增** 版本一致性校验与 5 条产物断言（40 → 45 项，见第 7 节） |
| `scripts/install.mjs` | **新增** `--status`（只读）；**新增** 已装副本备份（`<备份目录>/plugin`）与 `restore.ps1` 回滚插件体；备份失败中止安装 |
| `icon.svg` | **新增**，`package.json.icon` 指向它，`files` 含它 |

## 7. 构建期断言（40 → 46 项）

新增 6 条，全部锚「源码里原样出现的字面量」：

| 标记 | 锚的东西 |
| --- | --- |
| `service.balanceAlertState` | 余额提醒状态机的账号级持有（D1 主线；退回组件 ref 时纯函数测试照常全绿，只有跨会话时序露馅） |
| `data-balance-runway` | 面板「余额跑道」行 |
| `panel.runway` | 「余额跑道」词条键 |
| `runwayOf` | 跑道纯函数 |
| `FUTURE_SKEW_MS` | 未来样本防护 |
| `pollChoiceList` | 轮询选项并集 |

## 8. 不变式（回归红线）

以下各条由既有测试与断言继续锁定，本次**全部不变**：

- 三个挂载点（`conversation.composer.dock` / `settings.general.item` /
  `shell.overlay`）与三个存储键（`:settings` / `:history` / `:sessions`）；
- `advanceAlert` / `advanceTariffAlert` 的状态机语义（冷却、分方向、configKey、
  首次观测）；
- `readings.js` 的写入端接线（v0.2.0 主线，`recordReading` 断言仍在）；
- 逐段下降的消耗账本（`spentFromSamples` / `spendInDay` / `spendInWeek` /
  `spendInWindow`）与 `lastTopUpFromSamples`；
- 「属性不存在，不是空串」的未知值口径（`data-tariff` / `data-balance-runout` /
  `data-balance-runway` 同一条纪律）。
