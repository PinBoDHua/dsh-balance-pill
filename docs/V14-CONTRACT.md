# dsh-balance-pill v1.4 —— 「看门狗自愈 + 峰谷预估修正」接口契约

> 本文件是 v1.4 的**冻结契约**。v1.3 的契约（`docs/V13-CONTRACT.md`）继续有效，
> 本文件只写**增量**与**被本次修订的部分**；两者冲突时以本文件为准。
> 契约里的名字（导出名、配置键、词条键、DOM 属性、CSS 类名）**不得改名**。

## 0. 背景：v1.3 留下的三类问题

v1.3（时段判定）上线后，真实 GUI 验证台在 `v13-tariff` 变体上报出
「进入空闲」方向的提醒卡 **75 秒内一张都没有**（`RESULT ok=false
tariffAlertDirectionsOk=false`），而单测 166/166 全绿、构建通过。
逐层排查后确认了三个真缺陷与一个证伪的假设，全部记录在
[`docs/V14-DEFECTS.md`](V14-DEFECTS.md)。要点：

| 编号 | 结论 | 单测能抓到吗 |
| --- | --- | --- |
| D1 | 时段看门狗的 tick **只由 React effect 依赖变化驱动**，时钟前进本身不触发重算；休眠唤醒 / NTP 校时 / 后台节流后，跨时段边界会被静默漏掉 | ❌ 抓不到（纯函数入参永远是对的） |
| D2 | 提醒宿主的 effect 依赖数组是 `[settings, tariff]`（两个恒定引用），改设置**不能**立刻 tick，与 v1.3 契约里「也由它负责在设置变化时 tick」不符 | ❌ 抓不到（需要真实 React 运行时） |
| D3 | `pricingSnapshot().offPeakRemainingMs` 的数值与字段名 / 唯一使用点的语义**差 2 倍**（低报） | ⚠️ 能，但 v1.3 的测试只断言了「非 null」，没断言数值 |
| D4 | 「本段空闲」可能渲染出 `end <= start` 的 0 秒假区间 | — **已证伪**，不为它改代码 |

v1.4 的目标因此不是「再加一块功能」，而是**把 v1.3 那套时段机制在真实时序下修正确**，
并在同一层补上两个用户直接看得见的小增强（见第 4 节）。

## 1. D1 的修法：时间驱动的看门狗（核心）

### 1.1 现状（错的）

```
index.js  BalanceAlertHost
  useEffect(() => { run(); setInterval(run, 30000) }, [settings, tariff])
                                                        ^^^^^^^^^^^^^^^^ 恒定引用
run() → tariff.tick({settings, balance, ratePerHour})   ← 不传 now
tick() → snapshot() → pricingSnapshot({ now: readNow() })
```

`setInterval` 按**墙钟**触发，但 `snapshot()` 的 `now` 取 `Date.now()`；
真正的问题在于**跨边界的检测依赖「定时器恰好在时钟变化之后跑过一次」**，
而这个前提在休眠唤醒 / 时钟跳变 / 被节流时并不成立。探针实测：
注入 12:30 后 75 秒内 `tariff.latest().now` **冻在 10:30**，手动 tick 立刻出卡。

### 1.2 修法（新增，名字冻结）

`src/client/tariff-service.js` 增加：

| 导出 | 说明 |
| --- | --- |
| `TARIFF_TICK_MS` | 保持 `30000`（**已存在**，语义不变） |
| `TARIFF_MAX_GAP_MS` | 新增。允许的「真实时钟前进」上限，取 `2 * TARIFF_TICK_MS`。超过即判定发生过时钟跳变 / 休眠 |
| `nextTickDelay(input)` | 新增。返回下一次唤醒还应等多久（毫秒），取值落在 `[0, TARIFF_TICK_MS]`。依据是「距下一个时段边界的剩余时间」，边界由 `pricingSnapshot()` 的 `nextChangeAt` 给出；算不出来时退回 `TARIFF_TICK_MS` |
| `createTariffWatcher(options).tick(input)` | 语义修订：见下 |
| `createTariffWatcher(options).lastTickAt()` | 新增。最近一次 tick 的**真实时钟**读数（毫秒）；从未 tick 时为 0 |
| `createTariffWatcher(options).drift()` | 新增。`{gapMs, jumped}`：`gapMs` = 本次 tick 与上次 tick 的真实时钟差；`jumped` = `gapMs > TARIFF_MAX_GAP_MS`。诊断用，也是自愈的判据 |

`tick(input)` 的修订（**向后兼容**）：

1. `input.now` 若为**有限数**则优先使用；否则退回 `readNow()`（`Date.now`）。
   修掉 v1.3 里「调用方传 now、内部又各算一次」的两套口径。
2. 每次 tick 记录 `lastTickAt`；本次与上次的真实时钟差记进 `drift()`。
3. `jumped === true` 时**不得跳过**状态机推进：时钟跳变恰恰意味着「可能已经跨过了
   一个或多个时段边界」，必须照常喂给 `advanceTariffAlert`（它只比较
   `current.period` 与 `period`，跳变不会让它算错，只会让它看到一次真实的跨档）。
   这条是 D1 的**行为要求**：自愈 = 跳变后的第一拍就产出正确的卡片。
4. `options.now`（构造参数）与 `input.now`（调用参数）同时存在时，`input.now` 优先。

`nextTickDelay(input)` 的规则：

- 拿不到快照或 `nextChangeAt` 非法 → 返回 `TARIFF_TICK_MS`；
- 距边界 `d` 毫秒：
  - `d <= 0`（已经到/过了边界）→ 返回 `0`（**立刻**再 tick 一次，
    把「刚刚跨过的那次切换」当成一次正常切换处理）；
  - `0 < d <= TARIFF_TICK_MS` → 返回 `d`（**对齐到边界那一拍**，让提醒尽量准时）；
  - `d > TARIFF_TICK_MS` → 返回 `TARIFF_TICK_MS`（平时仍是 30 秒一拍）。

### 1.3 `index.js` 的驱动方式（自愈定时器）

`BalanceAlertHost` 里的效果改成「每次 tick 之后重新排下一次唤醒」的链式调度，
而**不是**固定间隔的 `setInterval`：

- 用 `setTimeout` + 在回调里重排：这样 `nextTickDelay()` 才有意义；
- effect 依赖数组加入**订阅到的 `alertOnTariff` 值**（修 D2），
  设置一变立刻 `run()` 一次；
- 额外监听 `visibilitychange`（变为 visible）与 `focus`：**立刻**补一次 tick。
  这两条覆盖「休眠唤醒」与「切回标签页」；
- 卸载时清掉定时器与两个监听器（不得泄漏）。

**契约要求的行为**：一次时钟跳变（`Date.now` 被推 > `TARIFF_MAX_GAP_MS`）之后，
**下一次 tick 必须**（a）推进状态机、（b）在方向确实变了时产出提醒卡、
（c）把 `drift().jumped` 记为 `true`。

## 2. D3 的修法：峰谷预估的数值

`pricing.js` 的字段语义**冻结为**：

| 字段 | 语义 | 公式 |
| --- | --- | --- |
| `remainingMs` | 按当前速度，余额还能用多久 | `balance / ratePerHour * 3600000`（不变） |
| `offPeakRemainingMs` | **同样的钱在空闲时段能用多久**（高峰才有） | `remainingMs / OFF_PEAK_MULTIPLIER` |
| `offPeakSavingMs` | **改用空闲时段能省下多少时间**（高峰才有，新增） | `offPeakRemainingMs - remainingMs` |

不变量（测试必须断言）：

- 高峰且 `remainingMs !== null` 时：`offPeakRemainingMs === remainingMs * 2`
  （因为 `OFF_PEAK_MULTIPLIER === 0.5`）；
- `offPeakSavingMs === offPeakRemainingMs - remainingMs`，且 `>= 0`；
- 非高峰或 `remainingMs === null` 时两个字段都为 `null`。

**UI 落点不变**：`panel.tariff.saveGeneric`（非人民币币种下的降级文案）继续用
`offPeakRemainingMs` —— 因为那句文案是「同样的钱在空闲时段能用约 {duration}」，
要的就是「能用多久」，现在数值终于对上了。

## 3. D2 的修法：设置变化立刻 tick

见 1.3 的第三条。`tariff-service.js` 的注释里那句「也由它负责在设置变化时 tick」
由此**才真正成立**。

## 4. 两个用户可见的小增强

### 4.1 面板新增「今日已用」一行

动机：现在面板能回答「本轮会话花了多少」，但答不了「今天一共花了多少」——
而日消耗是判断「这个月会不会超」的第一手数据。历史（`history.js`）已经存了 7 天
的采样点，按**计费日**（北京时间的自然日）切一刀就能算出来，不需要新增存储。

`src/client/history.js` 增加纯函数：

| 导出 | 说明 |
| --- | --- |
| `billingDayOf(at, tzOffsetMinutes?)` | 把 epoch 毫秒落到北京时间的日序号（整数）。默认偏移 `+480`，与 `pricing.js` 同口径 |
| `spendInDay(samples, at, options)` | → `{spent, currency, firstAt, lastAt, samples}` \| `null`。规则见下 |

`spendInDay` 的规则（每条都要有测试）：

1. 只取与 `at` **同一个计费日**的样本；跨天的样本一律不参与；
2. 只取**同一口径**（`basis`）的样本 —— 复用 `withinWindow` 已有的 `basis` 过滤，
   否则「合计」与「仅充值」混在一起会算出一个假的日消耗；
3. 币种必须一致（`currency` 相同）；不一致时返回 `null`；
4. 消耗 = 当天**最早**样本的金额 − 当天**最晚**样本的金额；
   - 为负数（当天充值过）时**归零**，与 `sessionSpend` 同口径（宁可说 0 也不说负数）；
5. 当天样本少于 2 个时返回 `null`（一个点算不出消耗，与趋势图「两点才成线」同理）；
6. `at` 非法或 `samples` 不是数组时返回 `null`，绝不抛错。

**词条**（中英键集必须一致）：

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `panel.todaySpend` | `今日已用 {amount}（自 {time} 起）` | `Used today {amount} (since {time})` |

**DOM**：`<p class="dbp_today" data-balance-today-spend>`，位置在
**「本轮会话已用」之后、趋势图之前**；关掉 `showTrend` 时**仍然显示**
（它不依赖趋势图，只依赖历史采样）。历史不足 2 个当天样本时不渲染该节点。

### 4.2 徽章上的「余额预估耗尽时刻」

动机：面板里有「按此速度约可用 {remaining}」这句话，但那要展开面板才看得到。
徽章上一枚极短的**提示**（不是数字）就能把「快没了」提前传达到位，而不增加噪音。

**做法**：不改徽章文字（那会破坏 `data-balance-pill` 的既有断言与紧凑模式），
只增加一个属性 + 一个 `title` 片段：

- 徽章元素新增 `data-balance-runout="<ISO 日期时间>"`，**仅当**同时满足
  「有成功读数」+「有正消耗速度」+「预估耗尽时刻在 24 小时内」时输出；
  否则该属性**不存在**（不是空串）—— 沿用 v1.3 对 `data-tariff` 的「不知道就不要
  冒充一个值」的口径。
- 同一条件下，徽章 `title` 追加一句 `pill.runout`（见下），已有的标题内容保留。

**词条**：

| 键 | 中文 | 英文 |
| --- | --- | --- |
| `pill.runout` | `按当前速度约 {time} 耗尽` | `Runs out around {time} at this pace` |

`{time}` 用 `formatBeijingDateTime`（跨天也要能读），因此 24 小时内可能跨天。

**设置项**：不新增。它跟随已有的「显示消耗速度」(`showRate`) —— 用户关掉速度估算
就是不想看这类预测，再塞一个开关只会让设置页更长。

## 5. 构建与验证的硬要求

- `scripts/build.mjs` 的产物断言从 **15 项增至 18 项**，新增：
  `data-balance-runout`（徽章耗尽属性）、`data-balance-today-spend`（今日已用行）、
  `panel.todaySpend`（词条键）；并保留 v1.3 的全部 15 项。
- 顶层声明不得重名（拼接式构建的经典坑）。
- `node --test tests/runtime.test.mjs` 全绿，**新增用例不少于 24 条**。
- 真实 GUI 验证（`verify/shot-pill.mjs`）必须断言：
  1. `v13-tariff` 变体的**两个方向**（进入高峰 / 进入空闲）都能拿到提醒卡 ——
     这是 D1 的验收，也是 v1.3 唯一没通过的那条；
  2. 时钟跳变后看门狗自愈（`drift().jumped` 为真，且下一拍产出卡片）；
  3. 面板「今日已用」行在真实数据下出现且数值与独立重算一致；
  4. `data-balance-runout` 在余额/速度满足条件时出现、不满足时不存在。
- README / CHANGELOG 按 v1.4 结构更新（新增一节，不改写 v1.3 的历史）。

## 6. 不允许的改动

- 不引入任何第三方依赖（构建脚本只允许 `react` / `react-dom` / `react/jsx-runtime` /
  `@deepseek-ai/dsh-client-ui-primitives`）；
- 不新增挂载点（仍是三个）；不改 `cordis.patch.yml`；
- **不改存储键**（仍是 `dsh-balance-pill:settings` / `:history` / `:sessions`）；
  旧配置缺省时各字段回落默认值，无需手工迁移；
- 不改 `pricing.js` / `calendars.js` 的**导出名**；`offPeakRemainingMs` 的**语义**
  按第 2 节修正（这是本次唯一一处语义修订，已在上面写清）；
- 不动 `verify/out/` 里的历史截图（除非是新增）。
