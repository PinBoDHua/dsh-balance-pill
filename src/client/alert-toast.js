/**
 * 余额徽章 —— 跨档提醒。
 *
 * 余额掉进新档位时浮出一张提示卡，几秒后自动淡出，也可以手动关掉。
 *
 * ## 为什么走 `shell.overlay` + 宿主 `Toast`
 * 徽章挂在 `conversation.composer.dock`（**会话作用域**），而渲染器对会话作用域的
 * 条目按「会话代次」设 key —— 切换会话会把它整体卸载重挂，写在组件 state 里的提醒
 * 会被顺手清掉。提醒本身是账号级事件，所以它住在 `alert.js` 的共享 store 里，
 * 由 `shell.overlay` 上的独立条目渲染：那是宿主自己的浮层位置（`z-index:20`，
 * 条目自动获得 `pointer-events:auto`），不用自己往 body 上钉元素。
 *
 * 提示卡优先用宿主 primitives 的 `Toast`：它自带 portal、`z-index:1100`、
 * 淡出计时与无障碍语义，视觉上与本机其他提示完全一致。该模块在平台种子表里
 * （`react` / `react-dom` / `@deepseek-ai/*-ui-primitives` 等九个 id 之一），
 * 已装的第三方插件 `dsh-better-sidebar` 也直接 require 它。
 *
 * 万一解析失败（平台裁剪了种子表），这里退回自带的卡片：提示是「余额快没了」
 * 这种内容，宁可样式朴素一点，也不能整条提醒消失。
 *
 * ## v1.3：多一种卡（`kind: 'tariff'`）
 * 时段切换提醒与余额提醒共用这条通路（`service.alerts` 已经是共享仓库、浮层也
 * 已经挂好），数据形状多一个 `kind`：`kind` 缺省即 `'balance'`，v1.2 的形状与
 * 渲染一个字都不动。两种卡的区别只在**文案**：余额卡的正文由词条自己拼好
 * （`alert.low.withAmount`），时段卡是「标题 + 正文」两条独立词条，因此这里先用
 * `alertCopy()` 把文案归一，再由两条渲染路径各自呈现。
 */

import { formatAmount, formatBeijingTime, formatMoney } from './format.js'

/** 宿主 Toast 的停留时长（毫秒）；3 秒对一句话偏短，这里放宽到 9 秒。 */
export const HOLD_MS = 9000

/**
 * 渲染一次提醒。
 *
 * @param props - `{alert, t, onDismiss}`：
 *   `alert` 是共享仓库里的一条提醒 —— 余额跨档是
 *   `{level, from, amount, currency, at, seq}`（`kind` 缺省），
 *   时段切换是 `{kind:'tariff', period, model, outputPrice, nextAt, at, seq}`。
 */
export function BalanceAlert(props) {
  const { alert, t, onDismiss } = props
  const copy = alertCopy(alert, t)
  const dismiss = () => {
    onDismiss()
  }

  const actions = [
    {
      label: t('alert.dismiss'),
      onClick: dismiss
    }
  ]

  const Toast = globalThis.__DBP_TOAST__
  if (Toast !== null && Toast !== undefined) {
    return React.createElement(
      Toast,
      {
        // 用 key 绑定一次提醒：同一张卡重新出现时，淡出计时会从头开始。
        key: alert.seq ?? alert.at,
        text: copy.toastText,
        ...copy.toastProps,
        holdMs: HOLD_MS,
        actions,
        onDone: dismiss
      },
      alert.seq ?? alert.at
    )
  }

  return React.createElement(FallbackCard, {
    alert,
    title: copy.title,
    body: copy.body,
    actions
  })
}

/**
 * 一次提醒要显示什么。
 *
 * 两条渲染路径能拿到的空间不一样，所以这里返回三种形态：
 *  - `title` / `body`：自带卡片能分两行，标题一行、正文一行；
 *  - `toastText`：宿主 `Toast` 只有**一个文本槽**（`text` 是字符串，动作按钮像
 *    半个句子一样接在它后面），标题与正文必须先合成一句话；
 *  - `toastProps`：只剩视觉差异的部分（图标 / 语气），由调用方展开进 Toast。
 *
 * `body` 为 null 表示「只有一句话」—— 余额提醒就是这种形状，v1.2 的渲染不变。
 *
 * @param alert - 一条提醒（见 `BalanceAlert`）。
 * @param t - 本地化函数。
 */
function alertCopy(alert, t) {
  if (alert.kind === 'tariff') {
    // 契约里 period 只有两个取值，词条键却是驼峰的 `offPeak`，这里做一次映射；
    // 防御性地把「不是 peak」的写法都当空闲时段（正常数据走不到这一支）。
    const side = alert.period === 'peak' ? 'peak' : 'offPeak'
    const title = t(`alert.tariff.${side}.title`)
    const body = t(`alert.tariff.${side}.body`, {
      // 展示名缺失时给 `--`：契约里 model 是价格口径的展示名，卡片不该凭空
      // 编一个模型名出来（`--` 是全插件对「未知」的统一写法）。
      model: typeof alert.model === 'string' && alert.model !== '' ? alert.model : '--',
      // 词条里已经写死了 `¥`，所以这里只取数字 —— 直接用 formatPrice 会拼成 `¥¥8.00`。
      output: formatAmount(alert.outputPrice, { digits: 2 }),
      // nextAt 为 null（算不出边界）时 formatBeijingTime 给 `--`，句子照样成立。
      time: formatBeijingTime(alert.nextAt)
    })
    return {
      title,
      body,
      toastText: `${title}${titleSeparator(title)}${body}`,
      // 空闲时段对用户是好消息，用宿主 Toast 自带的绿色对勾（`tone="success"`，
      // 该语气下宿主会忽略 icon）；进入高峰则沿用余额提醒那只铃铛，宿主给它警示色。
      toastProps: alert.period === 'peak' ? { icon: React.createElement(AlertBell) } : { tone: 'success' }
    }
  }

  const amount = alert.amount === null || alert.amount === undefined
    ? null
    : formatMoney(alert.amount, alert.currency)
  const text = amount === null
    ? t(`alert.${alert.level}.title`)
    : t(`alert.${alert.level}.withAmount`, { amount, title: t(`alert.${alert.level}.title`) })

  return { title: text, body: null, toastText: text, toastProps: { icon: React.createElement(AlertBell) } }
}

/**
 * 合成一句话时，标题与正文之间的分隔符。
 *
 * 词条表把时段卡的标题与正文拆成了两条键（`alert.tariff.*.title` / `.body`），
 * 没有留分隔符的位置，而宿主 Toast 只能收一个字符串。中文用全角冒号、英文用
 * 半角冒号加空格 —— 沿用 `alert.low.withAmount` 那种「标题：正文」的写法，
 * 同时不让英文卡里冒出全角标点。判据是标题里有没有汉字：标题由本插件自己的
 * 词条提供，两种语言各一套，不会误判。
 */
function titleSeparator(title) {
  return /[\u3400-\u9fff]/.test(String(title)) ? '：' : ': '
}

/** 兜底卡片的自动收起时间：与宿主 Toast 的 hold + fade 大致对齐。 */
const FALLBACK_HOLD_MS = HOLD_MS + 1000

/**
 * 兜底卡片。
 *
 * 只在宿主 primitives 不可用时使用；自己管 portal 之外的定位由样式表负责。
 * 鼠标停上去暂停倒计时：用户正要读或正要动手时，卡片不该自己消失。
 *
 * 时段卡（`kind === 'tariff'`）多一行正文：正文嵌在同一个 `.dbp_alertText` 容器里
 * 当一个块级子元素 —— 卡片的样式是 `display:flex` 的横排，把两段文字做成兄弟节点
 * 会并排显示。复用现有的类名而不是新造一个，是因为样式表不归这里改。
 */
function FallbackCard(props) {
  const { alert, title, body, actions } = props
  const [paused, setPaused] = React.useState(false)

  React.useEffect(() => {
    if (paused) return undefined
    const timer = setTimeout(() => {
      for (const action of actions) action.onClick()
    }, FALLBACK_HOLD_MS)
    return () => {
      clearTimeout(timer)
    }
  }, [alert.at, paused, actions])

  // 余额卡依旧只带 data-level；时段卡给 data-balance-alert-kind / data-period，
  // 便于 GUI 验证直接断言是哪一种卡。`kind` 缺省时下面的分支与 v1.2 完全一致。
  const tariff = alert.kind === 'tariff'

  return React.createElement(
    'div',
    {
      className: 'dbp_alert',
      role: 'status',
      'aria-live': 'polite',
      'data-balance-alert': true,
      ...(tariff
        ? { 'data-balance-alert-kind': 'tariff', 'data-period': alert.period }
        : { 'data-level': alert.level }),
      onPointerEnter: () => {
        setPaused(true)
      },
      onPointerLeave: () => {
        setPaused(false)
      }
    },
    React.createElement(
      'div',
      { className: 'dbp_alertText' },
      title,
      tariff && body !== null
        ? React.createElement('div', { 'data-balance-alert-body': true }, body)
        : null
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'dbp_alertAction',
        'data-balance-alert-close': true,
        onClick: () => {
          for (const action of actions) action.onClick()
        }
      },
      actions[0].label
    )
  )
}

/** 提醒图标：铃铛轮廓，跟随 `currentColor`。 */
function AlertBell() {
  return React.createElement(
    'svg',
    { viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: false },
    React.createElement('path', {
      d: 'M8 2.2c-2.1 0-3.4 1.5-3.4 3.5 0 2.6-.7 3.4-1.3 4.1-.2.2-.1.6.2.6h9c.3 0 .4-.4.2-.6-.6-.7-1.3-1.5-1.3-4.1 0-2-1.3-3.5-3.4-3.5Z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round'
    }),
    React.createElement('path', {
      d: 'M6.6 12.3a1.5 1.5 0 0 0 2.8 0',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    })
  )
}
