# v1.4 缺陷清单（基线实测，2026-10-16）

> 采集方式：`node scripts/build.mjs` + `node --test tests/runtime.test.mjs`（166/166 全绿）
> 与真实 GUI 验证台 `verify/shot-pill.mjs`、只读探针 `verify/probe-tariff-alert.mjs`。
> 下列每一条都带**独立证据**，不是读代码猜的。
>
> **修复结果（收尾时补记）**：D1 / D2 / D3 已全部修掉，并在真实 GUI 里复验 ——
> 单测 185/185、真实 GUI 断言 170 条 / 0 失败，v1.3 唯一失败的验收项
> （进入空闲方向的提醒卡）本轮通过。逐条证据见
> [`verify/V14-EVIDENCE.md`](../verify/V14-EVIDENCE.md)。D4 已被证伪，不为它改代码。

## D1（真缺陷）时段看门狗只由 React 依赖变化驱动 —— 时钟跳变后的跨边界被静默漏掉

> 标题不写「第二次不行」：那不是「第一次行、第二次不行」，而是**依赖「定时器恰好
> 在时钟变化之后跑过一次」**这个前提。下面用实测数据说明。

**现象**：`shot-pill.mjs --variants-file=variants-v13.json` 的 `v13-tariff` 变体里，
「进入高峰」方向的卡片拿到了（截图 `v14-baseline-v13-tariff-alert.png`），
但「进入空闲」方向在 **75 秒**内一张卡都没出现：

```
TARIFF-ALERT[v13-tariff:offpeak] 超时：75000 ms 内没有看到目标方向的时段提醒卡；
最后快照 {"overlayPresent":true,"toastBound":true,"matches":[]}
```

**独立证据**（`verify/probe-tariff-alert.mjs`，只读探针，直接读组件的 fiber props）：

| 相位 | 注入时刻 | `tariff.latest().now` | 自动 tick 了吗 |
| --- | --- | --- | --- |
| peak | `2026-10-16T02:30:00Z`（北京 10:30 高峰） | `1792117800000` = 注入时刻 | ✅ 是 |
| offpeak | `2026-10-16T04:30:00Z`（北京 12:30 午休空闲） | `1792117800000` = **上一段的时刻** | ❌ 75 秒内 0 次 |

同一次探针里，**手动**调一次 `tariff.tick()` 立刻产出正确的卡片：

```
phase=offpeak manualTick={"ok":true,
  "before":{"period":"peak","alertedAt":1792117800000,"seq":1},
  "after": {"period":"off-peak","alertedAt":1792125000000,"seq":2},
  "snapshot":{"period":"off-peak","now":1792125000000}}
phase=offpeak afterManualTick card=[{"text":"进入空闲时段：单价降为一半，同样的钱能用更久。知道了"}]
```

**根因**：`tariff-service.js` 的 `tick()` 把 `now` 交给 `pricingSnapshot()` 之后，
**只在函数末尾**写 `last = current`。而 `index.js` 里驱动 `tick()` 的 effect 依赖数组是
`[settings, tariff]` —— 这两个引用在整个会话里**从不变化**，所以 effect 只跑一次、
`setInterval` 只装一次。定时器确实还在跳（同一探针的 `timerProbe` 报 `8/8`），
但 `snapshot()` 的 `now` 取值链是 `input?.now ?? readNow()`，而 `BalanceAlertHost`
的 `run()` 调 `tariff.tick({settings, balance, ratePerHour})` —— **不传 `now`**。

**为什么第一段（peak）成了、第二段（offpeak）没成**：这不是「第一次行、第二次不行」，
而是「注入发生的那一刻恰好有没有 tick 经过」。peak 段注入后 30 秒内正好有一次定时器
tick 落在注入之后，于是 `latest` 更新到注入时刻、状态机看到跨档、卡片弹出；
offpeak 段在 75 秒窗口里**没有任何一次 tick 的 `Date.now()` 落在注入之后**被观察到 ——
`latest.now` 冻在上一段就是这一点的直接读数。

换言之：**看门狗的证据链依赖「定时器恰好在注入之后跑一次」，而这个前提在注入式验证里
根本不成立**。纯逻辑状态机本身是对的（`verify/probe-v14-cooldown.mjs` 三个序列全部
证明 2 小时 > 1 小时冷却、空闲方向该提醒就提醒），错的是**宿主侧那层驱动的接线**。

**影响面（为什么这不是验证台的毛病，而是产品的毛病）**：
真实用户不会注入时钟，但会遇到同一类失效 —— 只要 tick 的**触发条件**只依赖
「effect 重跑」而不是「时间前进」：

1. **笔记本合盖 / 系统休眠**后唤醒：`setInterval` 在挂起期间被吞，醒来后第一次
   `Date.now()` 可能已经跨过 1–2 个时段边界，而 effect 不会因此重跑；
2. **系统时钟被校时**（NTP 校时、手工改表、跨时区旅行）：与验证台的注入是同一个
   形状 —— 时钟跳了，但没有任何 React 依赖变化去唤醒看门狗；
3. **长时间后台标签页**：`setInterval` 被节流到 ≥1 分钟，跨边界的检测延迟随之放大。

**修法（v1.4）**：把「看门狗是否该重算」从**依赖变化的被动触发**改成**显式的
时间驱动 + 自愈**：

- `tariff-service.tick()` 接受并**优先使用显式 `now`**，且在 `snapshot()` 内部把
  `now` 归一到一个「安全时钟」，杜绝 `input.now` 与 `Date.now()` 两套口径打架；
- `index.js` 的驱动 effect 增加一条**独立的对齐定时器**：每次 tick 后按「距下一个
  时段边界的真实剩余时间」重新计算下一次唤醒（而不是固定 30 秒傻等），
  并在 `visibilitychange` / `focus` 时立刻补一次 tick —— 覆盖休眠唤醒与时钟跳变；
- tick 里记录 `lastTickAt`，若发现「真实时钟前进了远超定时间隔」（> 2× 间隔），
  视为一次时钟跳变，立即补 tick 并把这次跳变记进诊断字段。

**验收**：`v13-tariff` 变体里「进入高峰」与「进入空闲」两个方向都必须拿到卡片；
新增一条**时钟跳变**用例（把 `Date.now` 一次性推 3 小时）断言看门狗在下一拍就自愈。

---

## D2（真缺陷）`BalanceAlertHost` 的 effect 依赖数组漏了 `alertOnTariff`，改设置不能立刻生效

`index.js` 里：

```js
React.useEffect(() => { ... const timer = setInterval(run, TARIFF_TICK_MS) ... }, [settings, tariff])
```

依赖里只有 store 对象本身（引用恒定），**没有订阅它的值**。契约（`V13-CONTRACT.md`
第 3 节末）明确要求「也由它负责在设置变化时 tick」：用户打开「时段切换提醒」后，
看门狗里的 `alertState` 仍在按 `muted: true` 推进（这是对的），但 `latest()` 与
提醒的**立即重算**要等到下一个 30 秒拍子。这与 v1.3 自己写的规则「改设置时立刻重算」
不一致。

**修法**：让宿主订阅配置值（`useSettingValue` 等价物），把 `alertOnTariff` 纳入依赖，
设置一变立刻 tick 一次。

---

## D3（真缺陷）`pricing.js` 的 `offPeakRemainingMs` 语义与面板文案不符

`pricingSnapshot()` 里：

```js
offPeakRemainingMs: state.period === 'peak' && remainingMs !== null
  ? remainingMs * (1 / OFF_PEAK_MULTIPLIER - 1)   // = remainingMs * 1
  : null
```

`1 / 0.5 - 1 = 1`，所以这个字段等于 `remainingMs` **本身**，而不是注释里写的
「省下的时间」。面板在非人民币币种下把它当「同样的钱在空闲能用多久」渲染
（`panel.tariff.saveGeneric`，`pill.js` 第 633 行），于是**低报一半**：
真正的时长应该是 `remainingMs / OFF_PEAK_MULTIPLIER`（= `remainingMs * 2`）。

注释自己写的是「省下的时间 = 高峰剩余时长 × (1/0.5 - 1)」—— 那算的是**省下的量**，
但字段名 `offPeakRemainingMs` 与唯一的使用点（`saveGeneric` 的 `{duration}`）要的都是
**能用多久**（总量）。名字、注释、用法三者不一致，用法是对的语义、实现是错的数值。

**修法**：让字段返回 `remainingMs / OFF_PEAK_MULTIPLIER`（空闲时段能用多久），
并把「省下多少」单独留成一个语义明确的字段（`offPeakSavingMs`）供高峰那条文案用。
两条都要有测试锁住数值关系。

---

## D4（**已排除**，记录一次证伪）面板「本段空闲」不存在 `end <= start` 的退化区间

初查时怀疑：`currentOffPeakWindow()` 的 `end` 没做「`end > start`」守卫，边界上可能
渲染出「本段空闲：09:00 – 09:00（共 0 秒）」。

**证伪证据**（`verify/probe-v14-d4.mjs`，两个维度独立扫描）：

- 2026-10-16（周五）全天**逐分钟**扫描 1440 个时刻 → 退化区间 **0** 个；
- 四个高峰窗口边界（09:00 / 12:00 / 14:00 / 18:00）各 **±5 秒逐秒**扫描 → 退化区间 **0** 个。

结论：`Math.min(start, at)` 与「`end` 取下一个进入高峰的边界」这两条一起已经保证了
`end > start`。**v1.4 不为这一条改代码**，只把它作为一条已证伪的假设留在文档里 ——
比在更新日志里写一条「修复」然后让用户找不到差异要诚实。

---

## 结论

- 单测 166/166 与构建**都是绿的**，D1–D3 **没有一条**被现有测试覆盖 —— 这本身就是
  v1.4 最该补的东西：**用真实 GUI 的时序，而不是纯函数的入参**。
- D1 是唯一「用户会真的遇到、但单测永远抓不到」的接线缺陷，优先级最高。
- D4 已被证伪，不产生代码改动。
