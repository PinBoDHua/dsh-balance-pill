/**
 * 余额徽章 —— 客户端插件入口。
 *
 * 这个文件是 bundle 的入口：`scripts/build.mjs` 会把它与同目录的模块拼成一个
 * `window.__ModuleLoader__.load({ id, factory })` 经典脚本。宿主模块加载器只保证
 * `react`、`react/jsx-runtime`、`react-dom` 与少数 `@deepseek-ai/*` 可 require，
 * 本插件的代码不依赖任何第三方包，因此一套零依赖的拼接式构建就够，
 * 产物也能逐行审阅。
 *
 * v1.1 起本插件提供两个挂载点：
 *  1. `conversation.composer.dock` —— 状态行末尾的余额徽章；
 *  2. `settings.general.item`       —— 「设置 → 通用设置」里的配置行，
 *     与宿主自己的「外观 / 字号大小 / 显示代码工作视图」并排。
 * 三者共用同一个配置 store，改完立刻生效。
 *
 * v1.2 增加第三个：`shell.overlay` 上的跨档提醒。它必须独立于徽章 ——
 * 徽章是会话作用域的（切会话会卸载重挂），而提醒是账号级事件。
 *
 * v1.3 让浮层同时承载**时段提醒**（进入高峰 / 进入空闲）：宿主浮层里只放一张卡，
 * 因此余额提醒与时段提醒共用 `service.alerts` 这一个「当前卡片」仓库 ——
 * 两张卡同时挂在浮层上会互相压住，看谁先渲染毫无道理。
 */

import { createAccountClient } from './account.js'
import { NS, createSettingsStore, loadSettings, resolveStorage } from './settings.js'
import { createAlertStore } from './alert.js'
import { BalanceAlert } from './alert-toast.js'
import { en, zh } from './locales.js'
import { BalancePill } from './pill.js'
import { BalanceSettingsRow } from './settings-row.js'
import { STYLES } from './styles.generated.js'
import { TARIFF_TICK_MS, createTariffWatcher } from './tariff-service.js'
import { latestReading } from './readings.js'

/** 插件 id，必须与 package.json 的 name 一致 —— 加载器用它做模块登记。 */
export const name = NS

/**
 * 依赖的客户端服务。
 *
 * 只声明 `slots`（挂载点）与 `locale`（文案），**不**声明 `remote.account`：
 * 账号命名空间在某些部署里可能不存在，硬注入会让整个插件卡在等待依赖上，
 * 而徽章更合适的降级是「自己进入不可用状态」。账号客户端在 account.js 里惰性解析。
 */
export const inject = ['slots', 'locale']

/** 样式标签的归属标记：HMR 与卸载按它清点并回收。 */
const STYLE_TAG_ID = `${NS}/client.css`

/**
 * 幂等注入样式表。
 *
 * 与其他客户端包一致：用一个 `<style data-plugin data-plugin-css>` 承载 CSS，
 * 重复调用不会产生第二个标签。返回本次是否由自己创建，便于卸载时精确回收。
 */
function mountStyles() {
  if (typeof document === 'undefined') return false
  const existing = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`)
  if (existing !== null) return false
  const tag = document.createElement('style')
  tag.dataset.plugin = NS
  tag.dataset.pluginCss = STYLE_TAG_ID
  tag.textContent = STYLES
  document.head.appendChild(tag)
  return true
}

/**
 * 取宿主 primitives 的 `Toast` 组件。
 *
 * 用 try 包住：模块解析失败在任何部署里都不该让整个插件加载失败。
 * 返回 null 时 `alert-toast.js` 会退回自带卡片。
 */
function resolveToastPrimitive() {
  try {
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives')
    const Toast = primitives?.Toast
    return typeof Toast === 'function' ? Toast : null
  } catch {
    return null
  }
}

/**
 * 客户端插件体。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx) {
  // 样式层：注入一次，卸载时把自己创建的那个标签摘掉。
  ctx.effect(() => {
    const created = mountStyles()
    return () => {
      if (!created) return
      const tag = document.querySelector(`style[data-plugin-css=${JSON.stringify(STYLE_TAG_ID)}]`)
      if (tag !== null) tag.remove()
    }
  }, `${NS}: 样式表`)

  // 词典：两套语言键集一致。
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), `${NS}: 词典`)

  /**
   * 宿主 `Toast` primitive。
   *
   * 它在平台种子表里（`@deepseek-ai/dsh-client-ui-primitives` 是九个可 require 的
   * 平台模块之一），已装的第三方插件也直接 require 它。这里仍然做成「拿不到就
   * 退回自带卡片」：提示的内容是「余额快没了」，宁可样式朴素一点也不能整条消失。
   * 通过 `globalThis` 传到渲染组件，避免让组件直接依赖模块解析。
   */
  globalThis.__DBP_TOAST__ = resolveToastPrimitive()

  const account = createAccountClient(ctx)
  /**
   * 持久化目标。
   *
   * 只在这里解析一次 `localStorage`：设置、历史、会话基准共用同一个 store，
   * 也让测试可以注入内存替身（浏览器隐私模式下 `localStorage` 访问本身会抛错，
   * 因此必须包一层而不是直接用 `globalThis.localStorage`）。
   */
  const storage = resolveStorage()
  // 账号客户端、配置与语言读取器只构造一次：它们跨轮询保持不变，
  // 避免每次渲染都造新对象（也会让 React 的依赖比较失效）。
  const service = {
    account,
    storage,
    settings: createSettingsStore(loadSettings(storage), storage),
    /**
     * 宿主浮层上**当前显示的那张卡**（与组件生命周期无关，见 alert.js）。
     *
     * v1.3 起它承载两种卡片：余额跨档（`kind: 'balance'`，v1.2 形状不变）与
     * 时段切换（`kind: 'tariff'`，见 tariff-alert.js）。共用一个槽位是因为
     * 宿主浮层只该出现一张卡。
     *
     * 它必须提供 `getSnapshot`（而不只是 `get`）：宿主的挂载点渲染器用
     * `useSyncExternalStoreWithSelector(subscribe, () => store.getSnapshot(), …)`
     * 订阅快照，只给 `get` 会让条目首次渲染就抛错并被宿主永久摘掉 ——
     * 表现是「提醒永远不出现」，而不是一条明显的报错。详见 alert.js 的注释。
     */
    alerts: createAlertStore(),
    activeLocale: () => {
      try {
        return account.activeLocale()
      } catch {
        return 'zh-CN'
      }
    }
  }

  // 时段看门狗：算快照、推进时段提醒、把卡片写进上面的共享仓库。
  // 它**必须**在这里构造（而不是在组件里）：提醒状态机要跨会话存活，
  // 而徽章所在的槽位是会话作用域的。
  service.tariff = createTariffWatcher({ alerts: service.alerts })

  // 挂到输入框下方的状态行末尾（宿主自己的统计胶囊是 order 0，上下文环也是 0，
  // 本条目 order 50 先排在它们之后，再由样式表里的 flex `order:1` 落到最右侧）。
  //
  // 不显式注入 `sessionId`：它是该槽位（scope: "session"）的宿主标准 props，
  // 渲染器会直接传给组件（session.client.js 的 BUILTIN_SOURCE）。
  ctx.slots.inject('conversation.composer.dock', () =>
    ctx.slots.register(
      {
        name: 'conversation.composer.dock',
        id: NS,
        order: 50,
        locale: NS,
        inject: () => ({ service })
      },
      BalancePill
    )
  )

  // 设置行：挂进「设置 → 通用设置」。order 20 让它落在宿主的「键盘快捷键/网页链接(17)」
  // 之后、「性能与用量(30)」之前，即整页中部靠后的位置。
  ctx.slots.inject('settings.general.item', () =>
    ctx.slots.register(
      {
        name: 'settings.general.item',
        id: NS,
        order: 20,
        locale: NS,
        inject: () => ({ service })
      },
      BalanceSettingsRow
    )
  )

  // 跨档提醒 + 时段提醒：挂到宿主的浮层（`shell.overlay`，root 作用域）。
  // 必须独立于徽章条目：徽章是会话作用域的，切换会话会卸载重挂，
  // 而「余额掉档」与「进入高峰」都是账号级事件，不该跟着会话走。
  ctx.slots.inject('shell.overlay', () =>
    ctx.slots.register(
      {
        name: 'shell.overlay',
        id: `${NS}:alert`,
        order: 60,
        locale: NS,
        inject: () => ({
          hooks: { alert: service.alerts },
          settings: service.settings,
          tariff: service.tariff,
          dismiss: () => {
            service.alerts.set(null)
          }
        })
      },
      BalanceAlertHost
    )
  )
}

/**
 * 浮层里的提醒宿主。
 *
 * 它同时负责**驱动**时段看门狗：这里是 root 作用域，跨会话不卸载，
 * 正是「记住上一次是什么时段」需要的生命周期。徽章那边只读快照、不推进状态机，
 * 否则切换会话会把「首次观测」重来一遍，本该提醒的切换被吞掉。
 *
 * ## v1.4：从 `setInterval` 改成自愈的链式调度（D1）
 *
 * v1.3 用的是 `setInterval(run, TARIFF_TICK_MS)`，配 `[settings, tariff]` 依赖数组。
 * 两个恒定引用意味着**时钟前进本身永远不触发重算**，于是：
 *  - 机器从休眠唤醒后，看门狗要等定时器「补上一拍」才可能发现跨时段；
 *  - 定时器被后台节流到几分钟一次时，跨边界会被漏掉；
 *  - 真实 GUI 验证台注入时钟后，`offpeak` 相位 75 秒内 `latest().now` 冻在上一段，
 *    一张卡都没出（见 docs/V14-DEFECTS.md 的 D1）。
 *
 * 现在改成三件事：
 *  1. **链式 `setTimeout`**：每次 tick 后用 `nextTickDelay()` 重排 ——
 *     它会**对齐到下一个时段边界**（边界是整点，可预知），既不迟到也不更费；
 *  2. **可见性/焦点补拍**：`visibilitychange` 与 `focus` 立刻 tick 一次，
 *     覆盖休眠唤醒与切回标签页；
 *  3. **依赖里带订阅到的设置值**（修 D2）：用户改「时段切换提醒」后立刻生效，
 *     而不是等下一个 30 秒拍子。
 *
 * `nextTickDelay()` 返回 0 表示「已经跨过边界」，此时立刻再 tick 一次 ——
 * 这是「补上错过的边界」那条自愈路径。
 *
 * @param props - 渲染器注入的 props：`useAlert`（`hooks: {alert}` 变成的钩子）、
 *   `settings`（配置 store）、`tariff`（时段看门狗）、`dismiss` 与本地化函数 `t`。
 */
function BalanceAlertHost(props) {
  const { useAlert, settings, tariff, dismiss, t } = props
  const alert = useAlert((value) => value)

  // 订阅配置值：effect 依赖里必须出现**值**而不是 store 对象，否则改设置不会重跑
  // （D2）。只订阅这一个字段，避免「改阈值也把看门狗重排一次」。
  const alertOnTariff = useAlertOnTariff(settings)

  React.useEffect(() => {
    if (tariff === undefined || tariff === null || settings === undefined || settings === null) return undefined
    let timer = null
    let disposed = false

    const run = () => {
      try {
        // 余额只用于「同样的钱在空闲时段能用多久」这类换算，取徽章写进共享槽位的
        // 最近一次成功读数即可；还没读到过时快照照样可用，只是预估为空。
        const last = latestReading()
        tariff.tick({ settings: settings.get(), balance: last?.amount, ratePerHour: last?.perHour })
      } catch {
        /* 时段看门狗的任何异常都不该影响提醒卡本身的渲染 */
      }
    }

    /**
     * tick 一次并按「距下一个边界的剩余时间」重排下一次唤醒。
     *
     * 用 `setTimeout` 而不是 `setInterval`：间隔是每次算出来的（可能对齐到边界那一拍），
     * 固定间隔做不到这一点。`delay === 0` 时用 0 毫秒再排一拍，而不是同步递归 ——
     * 同步递归会在时钟被推很远、连续跨多个边界时把渲染线程占满。
     */
    const schedule = () => {
      if (disposed) return
      run()
      if (disposed) return
      let delay = TARIFF_TICK_MS
      try {
        delay = tariff.nextTickDelay({ settings: settings.get() })
      } catch {
        /* 算不出间隔就退回默认拍子 */
      }
      timer = setTimeout(schedule, Math.max(0, Math.min(TARIFF_TICK_MS, Number(delay) || 0)))
    }

    /** 立刻补一拍（可见性/焦点变化），并把已有的定时器重置到新的节奏上。 */
    const tickNow = () => {
      if (disposed) return
      if (timer !== null) clearTimeout(timer)
      schedule()
    }

    schedule()

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') tickNow()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    if (typeof window !== 'undefined') window.addEventListener('focus', tickNow)

    return () => {
      disposed = true
      if (timer !== null) clearTimeout(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
      if (typeof window !== 'undefined') window.removeEventListener('focus', tickNow)
    }
  }, [settings, tariff, alertOnTariff])

  if (alert === null || alert === undefined) return null
  return React.createElement(BalanceAlert, { alert, t, onDismiss: dismiss })
}

/**
 * 订阅「时段切换提醒」这个开关的值。
 *
 * 把 effect 的依赖从 store 对象换成**值**：store 的引用恒定，放进依赖数组等于
 * 什么都没依赖；用户在设置里勾上「时段切换提醒」后，本条目应当立刻重排看门狗，
 * 而不是等下一个 30 秒拍子（v1.3 契约里「也由它负责在设置变化时 tick」这句
 * 直到 v1.4 才真正成立）。
 *
 * store 不可用（测试替身）时退回 `undefined`：此时 effect 的依赖恒为 undefined，
 * 与 v1.3 的行为一致，不会因为「值从 undefined 变成 undefined」而反复重排。
 *
 * @param store - 配置 store（`{get, subscribe}`）；可能为 undefined。
 * @returns 当前 `alertOnTariff` 值，或 undefined。
 */
function useAlertOnTariff(store) {
  const read = () => {
    try {
      return store?.get()?.alertOnTariff
    } catch {
      return undefined
    }
  }
  const [value, setValue] = React.useState(read)
  React.useEffect(() => {
    if (store === undefined || store === null || typeof store.subscribe !== 'function') return undefined
    setValue(read())
    return store.subscribe(() => {
      setValue(read())
    })
  }, [store])
  return value
}
