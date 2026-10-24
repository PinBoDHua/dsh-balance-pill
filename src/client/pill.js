/**
 * 余额徽章 —— 徽章与展开面板。
 *
 * 结构：徽章是一个按钮（图标 + 金额），挂在输入框下方状态行的最右侧；点击后在
 * `document.body` 上开一个气泡面板，展示充值/赠金拆分、读取时间与消耗速度。
 *
 * 为什么用 portal 而不是就地 absolute 定位：这一行位于输入框卡片下方，
 * 祖先里存在带 `overflow` 的布局容器，就地展开会被裁掉；宿主自己的两个统计
 * 气泡（TimePill / UsagePill）也是 portal 到 body 的，这里跟随同一约定。
 *
 * v1.1 的三处行为变化：
 *  1. 读取失败不再把余额抹成 `--`，而是继续显示上一次的读数并标成过期；
 *  2. 配置变化立刻重算（订阅式），轮询间隔由设置决定，支持「仅手动」；
 *  3. 面板给出「按当前速度还能用多久」，并在有其他币种时补一行提示。
 *
 * v1.3 增加计费时段（高峰 / 空闲）：徽章上挂一枚时段徽标，面板里补一组时段区块。
 * 时段判定全部来自 `pricing.js`（纯函数），这里只负责「什么时候重算」与「怎么显示」——
 * 面板打开时用秒级心跳重算倒计时，关着时按 30 秒分桶，别让徽章在后台白烧 CPU。
 *
 * v0.3.0：跨档提醒的状态机提升为账号级（`service.balanceAlertState`，跨会话存活）；
 * 面板新增「余额跑道」行（按近 7 天日均估算可用天数）；规则行的阈值带上当前
 * 钱包币种的符号（词条不再写死 ¥）。`BalancePanel` 显式导出供单测渲染。
 */

import { rateBaseline, refreshedViewModel, viewModel } from './balance.js'
import { CALENDAR_FIRST_YEAR, CALENDAR_LAST_YEAR, calendarCovers } from './calendars.js'
import { MIN_REFRESH_GAP_MS } from './settings.js'
// 只借 `priceOf` 读单价：时段快照一律走 `service.tariff.snapshot()`（见下方
// useTariffSnapshot），这里不自己拼装时段判定，免得出现两份口径。
import { priceOf } from './pricing.js'
import {
  RECENT_WINDOW_MS,
  appendSample,
  downsample,
  lastTopUpFromSamples,
  loadHistory,
  runwayOf,
  saveHistory,
  spendInDay,
  spendInWeek,
  spendInWindow,
  withinWindow
} from './history.js'
import { recordReading } from './readings.js'
import { loadBaselines, pruneBaselines, recordBaseline, saveBaselines, sessionSpend } from './session-spend.js'
import { advanceAlert, createAlertState } from './alert.js'
import {
  formatAge,
  formatAmount,
  formatBeijingDateTime,
  formatBeijingTime,
  formatBillingMoment,
  formatClock,
  formatCountdown,
  formatDuration,
  formatMoney,
  formatMoneyDelta,
  formatThreshold,
  currencySymbol
} from './format.js'
import { AlertIcon, WalletIcon } from './icons.js'
import { TrendSparkline } from './sparkline.js'
import { PLUGIN_VERSION } from './version.js'

/** 面板宽度，与宿主气泡面板一致。 */
const PANEL_WIDTH = 264

/** 面板与徽章之间的空隙。 */
const PANEL_GAP = 8

/**
 * 订阅一个小型 store 并跟随其变化重渲染。
 *
 * 不用 `useSyncExternalStore`：那是 React 18 才有的钩子，而这个组件在测试里
 * 由自带的微型 hook 运行时渲染（见 tests/runtime.test.mjs）。
 */
function useSettingValue(store) {
  const [value, setValue] = React.useState(() => store.get())
  React.useEffect(() => {
    setValue(store.get())
    return store.subscribe((next) => {
      setValue(next)
    })
  }, [store])
  return value
}

/**
 * 币种前缀；紧凑模式返回空串。
 *
 * v0.3.0 起直接复用 `format.js` 的 `currencySymbol`：两处此前各写了一份
 * 「CNY→¥ / USD→$ / 其他→代码」的映射，改币种展示要同步两处。
 */
function currencyPrefix(currency, settings) {
  return settings.compact === true ? '' : currencySymbol(currency)
}

/**
 * 秒级心跳：`enabled` 为真时每秒推一次重渲染。
 *
 * 用途只有一个 —— 面板展开时让时段倒计时走字。用 `setInterval` 而不是
 * `requestAnimationFrame`：后台标签页里 rAF 会被暂停，而倒计时是「什么时候
 * 变便宜」的时间信息，切回标签页时必须已经是最新值。`enabled` 为假时**不装**
 * 定时器，这也是契约里「未打开面板不浪费 CPU」的那条。
 *
 * 不用 `useSyncExternalStore`（React 18 专有，测试的微型运行时里没有）。
 *
 * @param enabled - 是否启用（面板展开）。
 * @returns 已走过的 tick 次数；把它放进依赖即可跟随心跳重算。
 */
export function useSecondTick(enabled) {
  const [tick, setTick] = React.useState(0)
  React.useEffect(() => {
    if (enabled !== true) return undefined
    const timer = setInterval(() => {
      setTick((value) => value + 1)
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [enabled])
  return tick
}

/**
 * 计费时段快照。
 *
 * 快照本身来自 `service.tariff.snapshot()`（tariff-service.js）：时段判定与
 * 提醒状态机共用同一份计算，组件层不重复实现，也不自己算「现在是不是高峰」。
 *
 * 重算时机：面板展开时跟着秒级心跳走；关着时按 30 秒分桶 —— 时段边界都是整点，
 * 30 秒内不可能跨过两次，而每次渲染都重算只是一遍遍得到同一个答案。
 *
 * @param service - 插件 service（缺 `tariff` 时返回 null，界面按「无时段数据」降级）。
 * @param settings - 当前配置（只用到 `tariffModel`）。
 * @param model - 余额视图模型（提供余额与消耗速度，用于峰谷预估）。
 * @param tick - `useSecondTick` 的计数值。
 * @param open - 面板是否展开。
 * @returns 时段快照，或 null（拿不到时段服务时）。
 */
function useTariffSnapshot(service, settings, model, tick, open) {
  const scale = open === true ? tick : Math.floor(Date.now() / 30000)
  const balance = model === null || model === undefined ? null : model.primary
  const ratePerHour = model?.rate?.perHour ?? null
  return React.useMemo(() => {
    const tariff = service.tariff
    if (tariff === undefined || tariff === null || typeof tariff.snapshot !== 'function') return null
    return tariff.snapshot({
      settings: { tariffModel: settings.tariffModel },
      balance,
      ratePerHour,
      now: Date.now()
    })
  }, [service, settings.tariffModel, balance, ratePerHour, scale])
}

/**
 * 余额读取与轮询，外加 v1.3 的四条派生线：历史采样、会话消耗、跨档提醒、计费时段。
 *
 * @param service - `{account, settings, storage, tariff}`，由插件入口构造一次。
 * @param sessionId - 当前会话 id（来自宿主会话标准 props）；为空表示不在会话里。
 * @param open - 面板是否展开（决定时段快照是按秒还是按 30 秒重算）。
 * @returns `{model, phase, busy, refresh(force?), derived}`；
 *   `derived` = `{trend, spend, pricing}`。
 */
function useBalance(service, sessionId, open) {
  const settings = useSettingValue(service.settings)
  // 时段心跳：只在面板展开时启用。它必须是根链上的无条件调用 —— 测试里的微型
  // hook 运行时只有一根游标，条件调用会把后面的钩子全部错位。
  const tariffTick = useSecondTick(open)
  const [snap, setSnap] = React.useState(() => ({
    phase: service.account.available() ? 'loading' : 'unsupported',
    model: null,
    busy: false
  }))
  const alive = React.useRef(true)
  const lastAt = React.useRef(0)
  const inflight = React.useRef(null)
  /** 上一次**成功**读数；失败时用它继续显示，而不是把数字抹掉。 */
  const previous = React.useRef(null)
  /** 余额历史（升序样本）。跨会话共享：它描述的是账号，不是某个对话。 */
  const history = React.useRef(null)
  /** 每个会话的基准余额，用于算「本轮花了多少」。 */
  const baselines = React.useRef(null)
  /** 面板打开时才画趋势图，避免无人观看时也做降采样与重渲染。 */
  const [derived, setDerived] = React.useState({ trend: null, spend: null, today: null, week: null, recent: null, lastTopUp: null })

  if (history.current === null) history.current = loadHistory(service.storage)
  if (baselines.current === null) baselines.current = loadBaselines(service.storage)

  const build = React.useCallback((balance, accountState, current) => {
    const now = Date.now()
    const model = viewModel({
      balance,
      state: accountState,
      previous: previous.current,
      thresholds: { low: current.low, warn: current.warn },
      format: current.format,
      currency: current.currency,
      at: now,
      now
    })
    // 只有拿到新读数时才推进 previous：stale 的 model 不能反过来污染基准，
    // 否则速度计算会把同一份旧数据算两次。
    //
    // v0.1.6 起不再「每次成功都覆盖」：金额没变时保留旧基准，否则下一次轮询
    // 会因为 `spent = 0` 判定不出速度，面板的「近期消耗」与徽章的耗尽预估
    // 会在一两次轮询后凭空空掉。`rateBaseline()` 负责这条规则（含 6 小时上限）。
    if (model.status === 'ready' && model.summary !== null) {
      previous.current = rateBaseline(previous.current, model.summary, model.at ?? now)
    }
    return model
  }, [])

  const publish = React.useCallback(
    (balance, accountState, current) => {
      if (!alive.current) return
      const model = build(balance, accountState, current)
      setSnap({ phase: 'done', model, busy: false })
      if (model.status !== 'ready' || model.summary === null || model.primary === null) return

      const reading = {
        at: model.at ?? Date.now(),
        amount: model.primary,
        currency: model.summary.currency ?? '',
        // 记录这条样本是按哪个口径取的（合计 / 仅充值 / 仅赠金）。口径一改，
        // 旧样本与新样本就不是同一个量，画进同一条折线会连出假的暴跌。
        basis: model.format
      }

      // 1) 历史采样：只有真正拿到新读数才写，且写入失败不影响主流程。
      history.current = appendSample(history.current ?? [], reading)
      saveHistory(history.current, service.storage)

      // 1b) 共享读数槽位（v0.2.0 接线）：`readings.js` 的写入端在 v1.4 建好后
      //     一直没接上 —— `latestReading()` 恒为 null，`shell.overlay` 上的时段
      //     看门狗拿到的快照里余额与速度永远是空的，峰谷预估全部静默为 null。
      //     徽章每次成功读数都把「金额 + 币种 + 时刻 + 速度」写进去，看门狗
      //     tick 时即可读到与徽章同一口径的最近读数（见 index.js 的 run）。
      recordReading({
        at: reading.at,
        amount: reading.amount,
        currency: reading.currency,
        perHour: model.rate?.perHour ?? null
      })

      // 2) 会话基准：本会话第一次看到余额时记下，之后用「当前 - 基准」算本轮消耗。
      baselines.current = recordBaseline(baselines.current ?? {}, sessionId, reading)
      baselines.current = pruneBaselines(baselines.current)
      saveBaselines(baselines.current, service.storage)

      // 3) 跨档提醒：状态机只在档位变差且未提醒过时给出 alert。
      //    提醒写进共享 store（不是组件 state）—— 徽章是会话作用域的，
      //    切换会话会卸载重挂，放在组件里的提醒会被顺手清掉。
      //
      //    v0.3.0 起状态机本身也提升为**账号级**（`service.balanceAlertState`，
      //    由入口构造一次）：它此前是组件 ref，切换会话会把「已提醒 / 冷却中」
      //    一起丢掉 —— 冷却窗口被重置后，30 分钟内跨几次会话就可能补出几张
      //    重复的卡，与文档承诺的「全局一个 30 分钟窗口」不符。提醒显示在
      //    root 作用域的浮层上（账号级事件），状态机也该有同样的生命周期。
      //
      //    这三步都在 `.then()` 里执行，任何一处抛出都会被下面的 `.catch()`
      //    当成「读取失败」，把一次成功的读数显示成失败。因此这里逐项做了
      //    存在性检查：附属能力缺失不该污染主读数。惰性初始化让测试替身
      //    （没有预建该字段的服务对象）也能照常工作。
      if (service.alerts !== undefined && service.alerts !== null) {
        const alertState = service.balanceAlertState ?? (service.balanceAlertState = createAlertState())
        const outcome = advanceAlert(
          alertState,
          {
            level: model.level,
            amount: model.primary,
            currency: reading.currency,
            at: reading.at,
            // 口径 / 阈值 / 币种任一变化都会让「金额 + 档位」同时跳，必须与
            // 真实的余额下降区分开；v0.1.6 用它挡掉切换口径时的假「余额不足」。
            configKey: `${current.format}|${current.currency}|${current.low}|${current.warn}|${reading.currency}`
          },
          { muted: current.alertOnCross !== true }
        )
        // `advanceAlert` 是纯函数：新状态必须显式写回，状态机才会记住
        // 「已提醒过哪个档位 / 冷却从何时起算」。
        service.balanceAlertState = outcome.state
        if (outcome.alert !== null) service.alerts.set(outcome.alert)
      }
    },
    [build, service, sessionId]
  )

  const refresh = React.useCallback(
    (force) => {
      if (!service.account.available()) {
        if (alive.current) setSnap({ phase: 'unsupported', model: null, busy: false })
        return Promise.resolve()
      }
      if (inflight.current !== null) return inflight.current
      const now = Date.now()
      // 防抖：焦点事件与可见性事件可能在几毫秒内连续到达。
      if (force !== true && now - lastAt.current < MIN_REFRESH_GAP_MS) return Promise.resolve()
      if (alive.current) setSnap((prev) => ({ ...prev, busy: true }))
      const current = service.settings.get()
      const run = service.account
        .read()
        .then(({ balance, state }) => {
          lastAt.current = Date.now()
          publish(balance, state, current)
        })
        .catch(() => {
          lastAt.current = Date.now()
          publish({ ok: false }, undefined, current)
        })
        .then(() => {
          inflight.current = null
        })
      inflight.current = run
      return run
    },
    [publish, service]
  )

  // 配置变化（阀值 / 口径 / 币种）时立刻用现有读数重算，不必等下一次轮询。
  //
  // 走 `refreshedViewModel` 而不是 `viewModel({balance: {ok: true, value: null}})`：
  // 后者会被当成「这次读取返回了空」，面板随即冒出「本次刷新失败」——
  // 而用户只是改了个阈值，根本没有刷新失败这回事。
  const settingsKey = `${settings.low}|${settings.warn}|${settings.format}|${settings.currency}`
  const recomputeKey = React.useRef(settingsKey)
  React.useEffect(() => {
    if (recomputeKey.current === settingsKey) return
    recomputeKey.current = settingsKey
    if (!alive.current || previous.current === null) return
    setSnap((prev) => {
      if (prev.model === null) return prev
      const rebuilt = refreshedViewModel({
        summary: previous.current.summary,
        at: previous.current.at,
        format: settings.format,
        thresholds: { low: settings.low, warn: settings.warn },
        topUpUrl: prev.model.topUpUrl,
        signedIn: prev.model.signedIn,
        // v0.1.6：直接沿用上一条视图模型算出的速度。旧实现只传 `previous`，
        // 而 `previous` 与 `summary` 是同一份读数（elapsed = 0），`computeRate`
        // 必然返回 null —— 改一次阈值，「近期消耗」那一行就消失到下一次轮询。
        rate: prev.model.rate,
        previous: previous.current,
        now: Date.now()
      })
      if (rebuilt === null) return prev
      return { ...prev, model: rebuilt }
    })
  }, [settingsKey, settings.low, settings.warn, settings.format, settings.currency])

  const pollMs = settings.pollMs

  React.useEffect(() => {
    alive.current = true
    refresh(true)
    const onFocus = () => {
      refresh(false)
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh(false)
    }
    // 手动模式（pollMs <= 0）不装定时器，只保留焦点/可见性触发。
    const timer = pollMs > 0
      ? setInterval(() => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
          refresh(false)
        }, pollMs)
      : undefined
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive.current = false
      if (timer !== undefined) clearInterval(timer)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, pollMs])

  /**
   * 计费时段快照：面板展开时跟着秒级心跳重算（倒计时走字），关着时按 30 秒分桶。
   * 它只依赖时钟与余额读数、不依赖历史，因此用 useMemo 而不是塞进 `derived` state。
   */
  const pricing = useTariffSnapshot(service, settings, snap.model, tariffTick, open)

  /**
   * 派生趋势与会话消耗。
   *
   * 放在 effect 里而不是渲染期算：`history` 是 ref（采样在 publish 里发生），
   * 渲染期读 ref 不会触发重渲染，趋势图会停在旧数据上。
   * 窗口取「最近 24 小时」，与设置里的说明一致；并只取**同口径**样本 ——
   * 口径从「可用合计」改成「仅充值」之后，同一张图上前后两截不是同一个量。
   */
  React.useEffect(() => {
    const samples = history.current ?? []
    const model = snap.model
    // 一次取时，三条消耗统计共用同一个「现在」：分别调用 Date.now() 在午夜
    // 那一拍可能落到两个计费日，让「今日」与「本周」自相矛盾。
    const now = Date.now()
    const windowed = withinWindow(samples, 24 * 3600 * 1000, now, model?.format)
    const reading = model !== null && model.summary !== null && model.primary !== null
      ? { amount: model.primary, currency: model.summary.currency ?? '', at: model.at ?? now }
      : null
    setDerived({
      // 两个点才构成一条线；一个点画出来只是一个点，没有信息量。
      trend: normalizedTrend(windowed),
      spend: sessionSpend(baselines.current ?? {}, sessionId, reading),
      // 「今日已用」按**整份**历史算，而不是上面那个 24 小时窗口：计费日可能与
      // 「最近 24 小时」错开（凌晨时尤其明显），用窗口算会把昨天的样本算进今天。
      // 口径（basis）与币种都跟随当前视图模型，跨口径相减会得出假的日消耗。
      today: spendInDay(samples, now, {
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      }),
      // 「本周已用」：与「今日已用」同口径，只是按 ISO 周（北京时间周一为起点）切分。
      // 周一早上它只含周一当天 —— 这正是它存在的意义：周一对账不需要看上周。
      week: spendInWeek(samples, now, {
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      }),
      // 「近 7 天已用」：与「本周」互补 —— 周一只含一天时，这一行给出跨周的
      // 完整 7 天窗口；窗口按当前口径与币种过滤，不会把充值算成消耗。
      // v0.2.0 起结果带 `dailyAverage`（覆盖天数的日均），词条里一起给出。
      recent: spendInWindow(samples, now, {
        windowMs: RECENT_WINDOW_MS,
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      }),
      // 「最近充值」（v0.2.0）：历史里最近一次**上升**就是入账；与消耗统计同一条
      // 纪律 —— 同口径、同币种。没有可识别的入账时为 null，该行不渲染。
      lastTopUp: lastTopUpFromSamples(samples, {
        basis: model?.format,
        currency: model?.summary?.currency ?? undefined
      })
    })
  }, [snap.model, sessionId, snap.model?.format])

  return {
    model: snap.model,
    phase: snap.phase,
    busy: snap.busy,
    refresh,
    // 时段快照跟 `derived` 一起交给面板：趋势/消耗是 state（异步派生），
    // 时段是每渲染可算的纯值，合成一个对象让面板只有一个数据入口。
    derived: { ...derived, pricing }
  }
}

/**
 * 趋势图数据点门槛。
 *
 * 少于两个样本时返回 null：一个点画不出趋势，硬画只会让人误以为「一直这么平」。
 * 同时做一次降采样，把几百个样本压到面板能表达的分辨率。
 */
function normalizedTrend(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null
  return downsample(samples, 60)
}

/**
 * 计算气泡面板的固定定位。
 *
 * 面板贴在徽章正上方、右边缘对齐，并夹在视口内；只算 `left / bottom`，
 * 因为高度由内容决定，而 `bottom` 定位不需要预先知道高度。
 */
function usePanelPosition(rootRef, open) {
  const [style, setStyle] = React.useState(null)

  const measure = React.useCallback(() => {
    const node = rootRef.current
    if (node === null || typeof window === 'undefined') return
    const rect = node.getBoundingClientRect()
    const width = Math.min(PANEL_WIDTH, window.innerWidth - PANEL_GAP * 2)
    const maxLeft = Math.max(PANEL_GAP, window.innerWidth - width - PANEL_GAP)
    const left = Math.min(Math.max(PANEL_GAP, rect.right - width), maxLeft)
    // 面板向上展开，可用高度就是徽章上方的空间。v0.1.6 起把上限写成内联值：
    // 窗口只有 600px 高、或设置页把界面字号调大时，面板内容会超过视口顶部，
    // 顶部标题与「刷新」按钮被裁掉（在 body 上又滚不动）。超过上限时面板
    // 自己滚动（CSS `overflow-y: auto`）。
    const maxHeight = Math.max(
      96,
      Math.round(Math.min(window.innerHeight - PANEL_GAP * 2, rect.top - PANEL_GAP * 2))
    )
    setStyle({
      left: `${Math.round(left)}px`,
      bottom: `${Math.round(window.innerHeight - rect.top + PANEL_GAP)}px`,
      width: `${Math.round(width)}px`,
      maxHeight: `${maxHeight}px`
    })
  }, [rootRef])

  React.useEffect(() => {
    if (open !== true) {
      setStyle(null)
      return undefined
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure, open])

  return style
}

/** 数字格式化的公共参数。 */
function numberOptions(locale) {
  return { locale, digits: 2 }
}

/**
 * 阈值的展示文本：币种符号 + 阈值数字（整数不带小数）。
 *
 * v0.3.0 修：面板底部的规则行此前把「¥」写死在词条模板里，账号是美元钱包时
 * 会显示「低于 ¥3 显示红色」—— 而阈值比较的是**当前展示币种**的金额，
 * 美元余额对 ¥3 判红是错的。符号现在跟随当前钱包的币种；没有 summary
 * （尚未读到任何数据）时不带符号，只给数字。
 */
function thresholdText(value, currency, locale) {
  return `${currencySymbol(currency)}${formatThreshold(value, numberOptions(locale))}`
}

/** 徽章上的金额文本。 */
function pillText(model, settings, locale, t) {
  if (model === null) return t('pill.loading')
  if (model.summary !== null) {
    const amount = formatAmount(model.primary, numberOptions(locale))
    return `${currencyPrefix(model.summary.currency, settings)}${amount}`
  }
  if (model.status === 'signed-out') return t('pill.signedOut')
  return t('pill.loading')
}

/** 徽章与面板共用的无障碍描述。 */
function ariaText(model, settings, locale, t) {
  if (model !== null && model.summary !== null) {
    const amount = `${currencyPrefix(model.summary.currency, settings)}${formatAmount(model.primary, numberOptions(locale))}`
    return model.stale
      ? t('pill.ariaStale', { amount, age: formatAge(model.at, t) })
      : t('pill.ariaReady', { amount })
  }
  if (model !== null && model.status === 'signed-out') return t('pill.ariaSignedOut')
  return t('pill.ariaPlain')
}

/**
 * 徽章上的「余额预估耗尽时刻」。
 *
 * 面板里早就有「按此速度约可用 {remaining}」这句话，但那要展开面板才看得到 ——
 * 而「今天就会用完」这种事最好在**不点开**的时候就能被察觉。这里不往徽章上加文字
 * （那会破坏 `data-balance-pill` 的既有断言与紧凑模式），只给一个属性与
 * `title` 的一句补充，展开面板后仍是原来的数字。
 *
 * 触发条件三选三，缺一不可：
 *  1. 有成功读数（`model.status === 'ready'`）；
 *  2. 有正的消耗速度（`model.rate.perHour > 0`）—— 没有速度就没有预估；
 *  3. 预估耗尽时刻落在**24 小时内**。
 * 任一不满足时返回 null，属性**不存在**（沿用 v1.3 对 `data-tariff` 的口径：
 * 「不知道」就不要冒充一个值）。
 *
 * 跟随 `showRate`：用户关掉「显示消耗速度」就是不想看这类预测，
 * 不该从徽章上绕回来（因此不新增设置项）。
 *
 * @param model - 余额视图模型。
 * @param settings - 当前配置（只用到 `showRate`）。
 * @returns `{at}` 或 null。
 */
function runoutOf(model, settings) {
  if (settings.showRate !== true) return null
  if (model === null || model.status !== 'ready') return null
  const perHour = model.rate?.perHour
  if (typeof perHour !== 'number' || !Number.isFinite(perHour) || perHour <= 0) return null
  const balance = model.primary
  if (typeof balance !== 'number' || !Number.isFinite(balance)) return null
  const hours = balance / perHour
  const at = Date.now() + hours * 3600000
  // 只提示「24 小时内会耗尽」：更远的时间没有行动价值，天天挂着一句
  // 「约 3 天后耗尽」只是噪音，也会让 title 变长。
  if (hours * 3600000 > 24 * 3600000) return null
  return { at }
}

/** 面板在无数据时的说明文案。 */
function messageFor(model, t) {
  if (model === null) return t('age.never')
  if (model.status === 'signed-out') return t('error.signedOut')
  if (model.status === 'unsupported') return t('error.unsupported')
  return t('error.failed')
}

/** 面板里的一行「键 → 值」。 */
function row(key, label, value, classes) {
  return [
    React.createElement('dt', { key: `${key}-k`, className: classes?.key }, label),
    React.createElement('dd', { key: `${key}-v`, className: classes?.value, 'data-balance-field': key }, value)
  ]
}

// ---------------------------------------------------------------- 计费时段

/**
 * `reason` → 补充说明词条（契约第 3 节第 4 条）。
 *
 * `peak-window` 与 `night` 刻意不在表里：它们没有额外的话要说 ——
 * 「现在是高峰 / 现在是半夜」已经由上面那行徽标说清楚了，再说一遍只是噪音。
 */
const TARIFF_REASON_KEYS = {
  holiday: 'panel.tariff.holiday',
  weekend: 'panel.tariff.weekend',
  'makeup-workday': 'panel.tariff.makeup',
  midday: 'panel.tariff.midday'
}

/** 面板徽标上的字。 */
function tariffPeriodText(pricing, t) {
  return t(pricing.isPeak ? 'tariff.peak' : 'tariff.offPeak')
}

/** 状态行徽章上那枚徽标的字：比面板更短，塞得进状态行。 */
function tariffPillText(pricing, t) {
  return t(pricing.isPeak ? 'tariff.pill.peak' : 'tariff.pill.offPeak')
}

/** 徽标的无障碍描述：说清「现在贵还是便宜」，而不只是「高峰」两个字。 */
function tariffPillAria(pricing, t) {
  return t(pricing.isPeak ? 'tariff.pill.aria' : 'tariff.pill.ariaOff')
}

/** 面板里的一句话结论。 */
function tariffNoteText(pricing, t) {
  return t(pricing.isPeak ? 'panel.tariff.peak' : 'panel.tariff.offPeak')
}

/** 补充说明的词条键；没有可说的返回 null（此时不渲染该节点）。 */
function tariffReasonKey(pricing) {
  // 补班日的高峰时段 reason 是 `peak-window`（见 pricing.js 的 periodAt），
  // 而「周六怎么在收费」恰恰是那时候最需要解释的一句，因此 makeup 单独判一次。
  if (pricing.makeup === true) return TARIFF_REASON_KEYS['makeup-workday']
  return TARIFF_REASON_KEYS[pricing.reason] ?? null
}

/** 某个时刻在计费时区里的「日序号」，用来判断两个时刻是否同一天。 */
function billingDay(at, tzOffsetMinutes) {
  return Math.floor((at + tzOffsetMinutes * 60000) / 86400000)
}

/** 某个时刻在计费时区里的年份（日历覆盖提示用）。 */
function billingYear(at, tzOffsetMinutes) {
  return new Date(at + tzOffsetMinutes * 60000).getUTCFullYear()
}

/**
 * 面板里的时段区块（契约第 3 节的 1–8 项）。
 *
 * 做成「返回元素数组的纯函数」而不是组件：测试里的微型 hook 运行时会把函数组件
 * 就地展开、共用同一根钩子游标，带钩子的子组件会把它搅乱（见 createHarness 的注释）。
 * 这里一个钩子都没有，两条渲染路径下行为一致。
 *
 * 金额一律往词条里传**纯数字**：`panel.tariff.price` / `panel.tariff.save` 的模板
 * 自己带着 `¥`（价格表是人民币口径），再套一层 `formatMoney` 会打印成 `¥¥16.00`。
 * 币种不是人民币时走的 `panel.tariff.saveGeneric` 不含金额，这正是契约要的降级。
 *
 * @param props - `{pricing, summary, locale, t}`。
 * @returns 元素数组，顺序即契约表格的顺序。
 */
function tariffBlocks(props) {
  const { pricing, summary, locale, t } = props
  if (pricing === null || pricing === undefined) return []
  const options = numberOptions(locale)
  const tz = pricing.tzOffsetMinutes
  const blocks = []

  // 1. 徽标 + 一句话结论。
  blocks.push(
    React.createElement(
      'p',
      { className: 'dbp_tariffRow', key: 'tariff-row', 'data-balance-tariff-row': true },
      React.createElement(
        'span',
        { className: 'dbp_tariffBadge', 'data-tariff': pricing.period },
        tariffPeriodText(pricing, t)
      ),
      React.createElement('span', { className: 'dbp_tariffNote', 'data-balance-tariff-note': true }, tariffNoteText(pricing, t))
    )
  )

  // 2. 距下一个高峰 / 下一个空闲时段的倒计时。
  //    倒计时是**确定**的时刻差，用 formatCountdown（远期能给「2 天」这种粒度）；
  //    由速度推算的预测量才用 formatDuration —— 两者语义不同，别混。
  //    目标不在今天时把日期一并给出：只写「09:00 起」在跨天时会读成已经过去的那个 9 点。
  const nextAt = pricing.isPeak ? pricing.nextOffPeakAt : pricing.nextPeakAt
  const msUntil = pricing.isPeak ? pricing.msUntilOffPeak : pricing.msUntilPeak
  if (Number.isFinite(nextAt)) {
    const sameDay = billingDay(nextAt, tz) === billingDay(pricing.now, tz)
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-next', 'data-balance-tariff-next': true },
        t(pricing.isPeak ? 'panel.tariff.untilOffPeak' : 'panel.tariff.untilPeak', {
          duration: formatCountdown(msUntil, t),
          time: sameDay ? formatBeijingTime(nextAt, tz) : formatBeijingDateTime(nextAt, tz)
        })
      )
    )
  }

  // 3. 本段空闲区间（高峰时不渲染）。跨天的结束时刻带上日期：
  //    「18:00 – 09:00」会被读成倒序，而它其实是一整段 15 小时的空闲。
  const offPeakWindow = pricing.offPeakWindow
  if (pricing.isOffPeak && offPeakWindow !== null && offPeakWindow !== undefined) {
    const sameDay = billingDay(offPeakWindow.start, tz) === billingDay(offPeakWindow.end, tz)
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-window', 'data-balance-tariff-window': true },
        t('panel.tariff.window', {
          from: formatBeijingTime(offPeakWindow.start, tz),
          to: sameDay
            ? formatBeijingTime(offPeakWindow.end, tz)
            : formatBeijingDateTime(offPeakWindow.end, tz),
          duration: formatDuration(offPeakWindow.end - offPeakWindow.start, t)
        })
      )
    )
  }

  // 4. 依 reason 补一句解释（节假日 / 周末 / 补班 / 午休）。
  const reasonKey = tariffReasonKey(pricing)
  if (reasonKey !== null) {
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-reason', 'data-balance-tariff-reason': true },
        t(reasonKey)
      )
    )
  }

  // 5. 当前时段的输出单价，并把高峰价放在旁边作对照 ——
  //    用户真正想确认的是「现在这个价是不是贵的那个」。
  const output = priceOf(pricing.model, pricing.period, 'output')
  const peakOutput = priceOf(pricing.model, 'peak', 'output')
  if (output !== null && peakOutput !== null) {
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-price', 'data-balance-tariff-price': true },
        t('panel.tariff.price', {
          model: pricing.model?.label ?? '',
          output: formatAmount(output, options),
          peakOutput: formatAmount(peakOutput, options)
        })
      )
    )
  }

  // 6. 高峰时算一笔「这两小时的账」：按当前速度跑 2 小时要花多少，留到空闲只花一半。
  //    余额是别的币种时这笔账不成立（价格表是人民币），降级成「同样的钱能多用多久」。
  if (pricing.isPeak && pricing.remainingMs !== null && pricing.ratePerHour !== null) {
    const currency = summary?.currency ?? ''
    const amount = pricing.ratePerHour * 2
    const text = currency === 'CNY'
      ? t('panel.tariff.save', {
          amount: formatAmount(amount, options),
          half: formatAmount(amount / 2, options)
        })
      : t('panel.tariff.saveGeneric', { duration: formatDuration(pricing.offPeakRemainingMs, t) })
    blocks.push(
      React.createElement('p', { className: 'dbp_tariffMeta', key: 'tariff-save', 'data-balance-tariff-save': true }, text)
    )
  }

  // 7. 空闲时回答真正要决策的那个问题：这点钱撑得到下一个高峰吗。
  if (pricing.isOffPeak && pricing.lastsUntilNextPeak !== null) {
    const shortfall = pricing.msUntilPeak === null ? null : pricing.msUntilPeak - pricing.remainingMs
    blocks.push(
      React.createElement(
        'p',
        { className: 'dbp_tariffMeta', key: 'tariff-lasts', 'data-balance-tariff-lasts': true },
        pricing.lastsUntilNextPeak === true
          ? t('panel.tariff.lasts')
          : t('panel.tariff.short', { duration: formatDuration(shortfall, t) })
      )
    )
  }

  // 8. 日历覆盖提示：日历过期意味着「节假日全天空闲」这条会静默失效。
  const year = billingYear(pricing.now, tz)
  blocks.push(
    React.createElement(
      'p',
      { className: 'dbp_tariffMeta', key: 'tariff-calendar', 'data-balance-tariff-calendar': true },
      calendarCovers(year)
        ? t('panel.tariff.calendar', { years: `${CALENDAR_FIRST_YEAR}–${CALENDAR_LAST_YEAR}` })
        : t('panel.tariff.calendarStale', { year })
    )
  )

  return blocks
}

/**
 * 展开面板。
 *
 * 纯展示组件：内部一个 hook 都不用 —— 它会被测试里的微型运行时就地展开，
 * 带钩子就会搅乱根组件的钩子游标。v0.3.0 起显式导出：单测直接渲染它，
 * 断言「余额跑道」等条件行的出现与缺席。
 *
 * @param props - `{model, settings, locale, t, busy, onRefresh, position, panelRef, derived, pricing}`。
 */
export function BalancePanel(props) {
  const { model, settings, locale, t, busy, onRefresh, position, panelRef, derived, pricing } = props
  const options = numberOptions(locale)
  const summary = model?.summary ?? null
  const spend = derived?.spend ?? null
  const today = derived?.today ?? null
  const week = derived?.week ?? null
  const recent = derived?.recent ?? null
  const lastTopUp = derived?.lastTopUp ?? null
  const trend = derived?.trend ?? null
  const children = [
    React.createElement(
      'div',
      { className: 'dbp_panelHead', key: 'head' },
      React.createElement('span', { className: 'dbp_panelTitle' }, t('panel.title')),
      // 版本号放在标题旁边而不是设置页：用户报问题时第一眼就能看到跑的是哪一版。
      React.createElement(
        'span',
        { className: 'dbp_panelVersion', 'data-balance-version': true, title: `dsh-balance-pill v${PLUGIN_VERSION}` },
        `v${PLUGIN_VERSION}`
      ),
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbp_refresh',
          onClick: () => {
            onRefresh(true)
          },
          disabled: busy
        },
        busy ? t('panel.refreshing') : t('panel.refresh')
      )
    )
  ]

  if (model !== null && model.stale) {
    children.push(
      React.createElement(
        'p',
        { className: 'dbp_stale', key: 'stale', role: 'status', 'data-balance-stale': true },
        t('panel.stale', { age: formatAge(model.at, t) })
      )
    )
  }

  children.push(React.createElement('div', { className: 'dbp_rule', key: 'rule-1' }))

  if (summary !== null) {
    children.push(
      React.createElement(
        'dl',
        { className: 'dbp_rows', key: 'rows' },
        row('recharge', t('panel.recharge'), formatMoney(summary.recharge, summary.currency, options))
          .concat(row('bonus', t('panel.bonus'), formatMoney(summary.bonus, summary.currency, options)))
          .concat(
            row('shown', t(`panel.shown.${model.format}`), formatMoney(model.primary, summary.currency, options), {
              key: 'dbp_totalKey',
              value: 'dbp_totalValue'
            })
          )
      )
    )

    // 计费时段：插在金额明细之后、档位提示之前（契约第 3 节第 1 条给的锚点）。
    // 先说明「现在这个价是贵还是便宜」，再由档位提示回答「钱还够不够」。
    children.push(...tariffBlocks({ pricing, summary, locale, t }))

    children.push(
      React.createElement('p', { className: 'dbp_hint', key: 'hint', 'data-level': model.level }, t(`hint.${model.level}`))
    )

    // 本轮会话消耗：余额是账号级的，用户更关心「这次对话花了多少」。
    // v1.5 起把「3 分钟前」改成「自 HH:MM 起」——「多久以前」每秒都在贬值，
    // 而「从几点开始」是稳定的；与下面「今日已用」的写法一致。
    if (settings.showSessionSpend && spend !== null && spend.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_spend', key: 'spend', 'data-balance-spend': true },
          t('panel.sessionSpend', {
            amount: formatMoney(spend.spent, spend.currency, options),
            // 会话可能跨天；只写「自 08:20 起」会让跨天的起点读成今天。
            time: formatBillingMoment(spend.since, Date.now())
          })
        )
      )
    }

    // 今日已用：本轮消耗回答「这次对话」，这一行回答「今天一共」。
    // 它**不**受 `showTrend` 控制 —— 只依赖历史采样，与折线图是两件事。
    // 当天样本不足两个时 `spendInDay` 返回 null，这一行不渲染（而不是显示 ¥0）。
    if (today !== null && today.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_today', key: 'today', 'data-balance-today-spend': true },
          t('panel.todaySpend', {
            amount: formatMoney(today.spent, today.currency, options),
            // 起点用**北京时间**而不是 formatClock：这一行是按北京时间的自然日
            // 切出来的（spendInDay 的口径），用本地时区显示时刻会在非 +08:00
            // 的机器上给出一个与「今天」对不上的钟点。
            time: formatBeijingTime(today.firstAt)
          })
        )
      )
    }

    // 本周已用（v1.5）：与「今日已用」同口径，按北京时间 ISO 周（周一为起点）。
    // 样本不足两个时不渲染 —— 周一早上通常就是这种情况。
    if (week !== null && week.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_week', key: 'week', 'data-balance-week-spend': true },
          t('panel.weekSpend', {
            amount: formatMoney(week.spent, week.currency, options),
            // 本周可能从周一就开始了；只写时刻会把它读成今天早上。
            time: formatBillingMoment(week.firstAt, Date.now())
          })
        )
      )
    }

    // 近 7 天已用（v0.1.6）：与「本周」互补。周一只含一天时，这一行仍然给出
    // 跨周的完整 7 天窗口；样本不足两个时不渲染。
    // v0.2.0 起附带**日均**：分母是覆盖天数（不足一天算一天），刚装插件的那两小时
    // 不会被摊薄成「几乎没花」。
    if (recent !== null && recent.spent > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_recent', key: 'recent', 'data-balance-recent-spend': true },
          t('panel.recentSpend', {
            amount: formatMoney(recent.spent, recent.currency, options),
            daily: formatMoney(recent.dailyAverage, recent.currency, options),
            time: formatBillingMoment(recent.firstAt, Date.now())
          })
        )
      )
    }

    // 余额跑道（v0.3.0）：瞬时速度回答「现在烧钱能撑多久」，这一行回答
    // 「不跑任务的话这点钱能撑几天」—— 用近 7 天日均除当前余额。跟随
    // `showRate`（用户关掉「显示消耗速度」就是不想看这类预测）；超出
    // `RUNWAY_MAX_DAYS` 天的跑道没有行动价值，不渲染（与「约 … 耗尽」
    // 只看 24 小时内是同一条纪律）。
    if (settings.showRate === true && recent !== null && model !== null) {
      const runway = runwayOf(model.primary, recent.dailyAverage)
      if (runway !== null) {
        children.push(
          React.createElement(
            'p',
            { className: 'dbp_runway', key: 'runway', 'data-balance-runway': true },
            t('panel.runway', {
              daily: formatMoney(recent.dailyAverage, recent.currency, options),
              duration: formatDuration(runway * 86400000, t)
            })
          )
        )
      }
    }

    // 最近充值（v0.2.0）：历史里最近一次入账。「充的钱到账没有」是充值后第一个
    // 想确认的问题，此前要展开网页端才能看；这一行只读历史采样，不新增存储。
    // 没有可识别的入账（新装、或窗口内只跌不涨）时不渲染。
    if (lastTopUp !== null && lastTopUp.amount > 0) {
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_topup', key: 'topup', 'data-balance-last-topup': true },
          t('panel.lastTopUp', {
            amount: formatMoneyDelta(lastTopUp.amount, lastTopUp.currency, options),
            time: formatBillingMoment(lastTopUp.at, Date.now())
          })
        )
      )
    }

    if (settings.showTrend && trend !== null) {
      children.push(
        React.createElement(TrendSparkline, {
          key: 'trend',
          points: trend,
          currency: currencyPrefix(summary.currency, { compact: false }),
          t
        })
      )
    }

    if (settings.showRate && model.rate !== null) {
      const hours = model.rate.perHour > 0 ? (model.primary / model.rate.perHour) * 3600000 : 0
      // v1.5：标注这是按**当前**时段单价折算的速度。
      // 跨峰/谷切换时这个数会跳，不标注会让用户以为是余额算错了。
      const rateKey = pricing !== null && pricing.isPeak === false ? 'panel.rateOffPeak' : 'panel.rate'
      // v0.2.0：预计耗尽时刻（24 小时内）直接写进面板。徽章 title 里早有这句话，
      // 但「今天就会用完」这种事不该要求用户去悬停徽章才能看到。
      // runoutOf 与徽章 title 用的是同一个函数，两处说法永远一致。
      const runout = runoutOf(model, settings)
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_meta', key: 'rate', 'data-balance-rate': true },
          t(rateKey, {
            amount: formatMoneyDelta(-model.rate.spent, summary.currency, options),
            remaining: formatDuration(hours, t)
          }),
          runout === null
            ? null
            : React.createElement(
                'span',
                { className: 'dbp_runout', 'data-balance-rate-runout': true },
                t('panel.runoutAt', { time: formatBeijingDateTime(runout.at) })
              )
        )
      )
    }

    if (summary.otherWallets.length > 0) {
      const others = []
      const seen = []
      for (const wallet of summary.otherWallets) {
        if (seen.includes(wallet.currency)) continue
        seen.push(wallet.currency)
        others.push(`${wallet.currency} ${formatAmount(wallet.amount, options)}`)
      }
      children.push(
        React.createElement(
          'p',
          { className: 'dbp_meta', key: 'others', 'data-balance-others': true },
          t('panel.others', { list: others.join(' · ') })
        )
      )
    }
  } else {
    children.push(React.createElement('p', { className: 'dbp_message', key: 'message' }, messageFor(model, t)))
  }

  children.push(
    React.createElement('div', { className: 'dbp_rule', key: 'rule-2' }),
    React.createElement(
      'p',
      { className: 'dbp_meta', key: 'updated', 'data-balance-updated': true },
      model === null || model.at === null
        ? t('age.never')
        : t('panel.updated', { time: formatClock(model.at), age: formatAge(model.at, t) })
    ),
    React.createElement(
      'p',
      { className: 'dbp_meta', key: 'auto' },
      settings.pollMs <= 0 ? t('panel.manual') : t('panel.auto', { seconds: Math.round(settings.pollMs / 1000) })
    ),
    React.createElement(
      'p',
      { className: 'dbp_meta', key: 'rule-text' },
      // v0.3.0 起阈值行带上**当前钱包币种**的符号（词条不再写死 ¥）：
      // 阈值比较的是展示币种的金额，美元账号此前会看到「低于 ¥3 显示红色」。
      t('panel.rule', {
        low: thresholdText(settings.low, summary?.currency ?? '', locale),
        warn: thresholdText(settings.warn, summary?.currency ?? '', locale)
      })
    ),
    React.createElement('p', { className: 'dbp_meta', key: 'settings-hint' }, t('panel.settingsHint'))
  )

  if (model !== null && model.topUpUrl !== null) {
    children.push(
      React.createElement(
        'a',
        { className: 'dbp_topUp', key: 'topup', href: model.topUpUrl, target: '_blank', rel: 'noreferrer noopener' },
        t('panel.topUp')
      )
    )
  }

  return React.createElement(
    'div',
    {
      className: 'dbp_panel',
      role: 'dialog',
      'aria-label': t('panel.title'),
      'data-balance-panel': true,
      ref: panelRef,
      style: position ?? {
        visibility: 'hidden',
        left: '0px',
        bottom: '0px',
        width: `${PANEL_WIDTH}px`,
        maxHeight: 'calc(100vh - 24px)'
      }
    },
    children
  )
}

/**
 * 状态行里的余额徽章。
 *
 * @param props - 渲染器注入的 props：`t`（本插件词条）、`service`
 *   （`{account, settings, activeLocale, storage, tariff}`）与宿主会话标准 props
 *   （`sessionId` 用于「本轮会话消耗」）。
 */
export function BalancePill(props) {
  const { t, service, sessionId } = props
  const [open, setOpen] = React.useState(false)
  const rootRef = React.useRef(null)
  const panelRef = React.useRef(null)
  const settings = useSettingValue(service.settings)
  const locale = React.useMemo(() => {
    try {
      return String(service.activeLocale?.() ?? 'zh-CN')
    } catch {
      return 'zh-CN'
    }
  }, [service])
  const { model, phase, busy, refresh, derived } = useBalance(service, sessionId, open)
  const position = usePanelPosition(rootRef, open)
  /** 时段快照；拿不到时段服务（旧测试替身）时为 null，界面按「无时段数据」降级。 */
  const pricing = derived?.pricing ?? null

  React.useEffect(() => {
    if (open !== true) return undefined
    const onKey = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    const onDown = (event) => {
      const target = event.target
      if (rootRef.current !== null && rootRef.current.contains(target)) return
      if (panelRef.current !== null && panelRef.current.contains(target)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown, true)
    }
  }, [open])

  // 没有账号能力时不留噪音：整枚徽章不出现（诊断走 console）。
  if (phase === 'unsupported') {
    if (globalThis.__DBP_WARNED__ !== true) {
      globalThis.__DBP_WARNED__ = true
      console.warn('[dsh-balance-pill] remote.account 未挂载，余额徽章已停用')
    }
    return null
  }

  const level = model?.level ?? 'ok'
  const status = model?.status ?? 'loading'
  const text = pillText(model, settings, locale, t)
  const label = ariaText(model, settings, locale, t)
  const lowish = level === 'low' || (model !== null && model.summary === null && status === 'failed')
  const Icon = lowish ? AlertIcon : WalletIcon
  /** 余额预估耗尽（24 小时内才有）；拿不到时为 null。 */
  const runout = runoutOf(model, settings)

  /** 时段徽标的无障碍描述：给读屏用户一句「现在贵还是便宜」。 */
  const badgeLabel = pricing === null ? '' : tariffPillAria(pricing, t)
  // `settings.showTariff` 关掉时这个元素**必须不存在**（契约第 3 节的硬要求，
  // 也是 GUI 验证里「关掉后徽标消失」那条断言的依据）。
  const tariffBadge =
    settings.showTariff === true && pricing !== null
      ? React.createElement(
          'span',
          {
            className: 'dbp_tariff',
            'data-balance-tariff': pricing.period,
            title: badgeLabel,
            'aria-label': badgeLabel
          },
          tariffPillText(pricing, t)
        )
      : null

  const trigger = React.createElement(
    'button',
    {
      type: 'button',
      className: 'dbp_trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      'aria-label': label,
      // 耗尽预估作为一个**补充**追加在标题末尾，而不是替换原有内容：
      // title 原本是「账户余额 · ¥3.02」，两件事各说各的。
      title:
        runout === null
          ? `${t('pill.title')} · ${text}`
          : `${t('pill.title')} · ${text} · ${t('pill.runout', { time: formatBeijingDateTime(runout.at) })}`,
      onClick: () => {
        setOpen((prev) => !prev)
      }
    },
    React.createElement(Icon, null),
    React.createElement('span', { className: 'dbp_text' }, text),
    tariffBadge
  )

  const panel = open
    ? ReactDOM.createPortal(
        React.createElement(BalancePanel, {
          model,
          settings,
          locale,
          t,
          busy,
          onRefresh: refresh,
          position,
          panelRef,
          derived,
          pricing
        }),
        document.body
      )
    : null

  // 跨档提醒不在这里渲染：它是账号级事件，但徽章是会话作用域的（切会话会卸载
  // 重挂），因此提醒由 `shell.overlay` 上的独立条目渲染。见 index.js 的注册。

  return React.createElement(
    'span',
    {
      className: 'dbp_root',
      'data-balance-pill': true,
      'data-level': level,
      'data-status': status,
      // 当前计费时段：**始终输出**（哪怕徽标被设置关掉），样式与验证都靠它定位。
      // 拿不到时段服务时为 undefined，元素上就不出现这个属性 —— 那是「不知道」，
      // 不是「空闲」，不该冒充一个档位。
      'data-tariff': pricing?.period,
      'data-tariff-reason': pricing?.reason,
      // 余额预估耗尽时刻（ISO 字符串）。只在「有读数 + 有正的消耗速度 +
      // 24 小时内」三个条件都满足时才输出；否则**属性不存在**（不是空串）——
      // 与 data-tariff 同一口径：「不知道」不该冒充一个值。
      'data-balance-runout': runout === null ? undefined : new Date(runout.at).toISOString(),
      'data-stale': model?.stale === true ? 'true' : undefined,
      'data-compact': settings.compact === true ? 'true' : undefined,
      // 当前会话 id：宿主自己也在 DOM 上暴露了同一个值
      // （`data-conversation-session`），这里跟随该约定。
      // 它让「本轮消耗为什么没显示」这类问题可以被直接看出来，而不必猜。
      'data-balance-session': typeof sessionId === 'string' && sessionId !== '' ? sessionId : undefined,
      ref: rootRef
    },
    trigger,
    panel
  )
}
