/**
 * 余额徽章 —— 设置行组件。
 *
 * 挂进宿主的「设置 → 通用设置」里的 `settings.general.item`（list 槽），与宿主
 * 自己的「外观 / 字号大小 / 显示代码工作视图」并排，因此必须沿用宿主的行版式：
 * 左侧标题 + 描述，右侧控件，上下 16px 内边距、底部 0.5px 分隔线。
 * （宿主的分区中文标签是「通用设置」，不是「常规」。）
 *
 * 控件刻意用原生 `select` / `input[type=number]` / `input[type=checkbox]` 而不是
 * 宿主 primitives 里的封装件：本插件的构建是零依赖拼接，引用
 * `@deepseek-ai/dsh-client-ui-primitives` 会把产物绑到该包的内部导出上，
 * 而这里需要的三个控件用原生元素 + 主题令牌就能做到视觉一致。
 *
 * v1.3 的「计费时段」三行（显示徽标 / 价格口径 / 时段切换提醒）插在「显示余额趋势」
 * 之后，前面另给一句规则说明 —— 开关自己解释不了「为什么会有两个价」。
 */

import { CURRENCIES, DEFAULT_SETTINGS, FORMATS, POLL_CHOICES, clampThresholdPatch } from './settings.js'
import { MODELS } from './pricing.js'
import { formatThreshold } from './format.js'

/**
 * 订阅一个小型 store 并跟随其变化重渲染。
 *
 * 不用 `useSyncExternalStore`：那是 React 18 才有的钩子，而这个组件在测试里
 * 由自带的微型 hook 运行时渲染（见 tests/runtime.test.mjs），
 * useState + 订阅 + 卸载清理这一组合在任何 React 16.8+ 上都成立。
 *
 * @param store - `{get, subscribe}`。
 * @returns 当前值。
 */
function useStoreValue(store) {
  const [value, setValue] = React.useState(() => store.get())
  React.useEffect(() => {
    setValue(store.get())
    return store.subscribe((next) => {
      setValue(next)
    })
  }, [store])
  return value
}

/** 一行设置：左侧标题+描述，右侧控件。 */
function Row(props) {
  const { title, description, disabled, children, testId } = props
  return React.createElement(
    'div',
    { className: 'dbp_setRow', 'data-balance-setting': testId, 'data-disabled': disabled === true ? 'true' : undefined },
    React.createElement(
      'div',
      { className: 'dbp_setCopy' },
      React.createElement('div', { className: 'dbp_setTitle' }, title),
      description === undefined || description === null
        ? null
        : React.createElement('div', { className: 'dbp_setDescription' }, description)
    ),
    React.createElement('div', { className: 'dbp_setControl' }, children)
  )
}

/** 下拉选择。 */
function Select(props) {
  const { value, options, onChange, label, testId } = props
  return React.createElement(
    'select',
    {
      className: 'dbp_select',
      'aria-label': label,
      value,
      'data-balance-control': testId,
      onChange: (event) => {
        onChange(event.target.value)
      }
    },
    options.map((option) =>
      React.createElement('option', { key: option.value, value: option.value }, option.label)
    )
  )
}

/** 复选框。 */
function Checkbox(props) {
  const { checked, onChange, label, testId } = props
  return React.createElement(
    'label',
    { className: 'dbp_check' },
    React.createElement('input', {
      type: 'checkbox',
      checked,
      'aria-label': label,
      'data-balance-control': testId,
      onChange: (event) => {
        onChange(event.target.checked)
      }
    })
  )
}

/**
 * 数字输入：受控但允许中间态。
 *
 * 直接把输入框绑到数值上会让「想输入 10 却先删成空」时立刻弹回旧值，
 * 因此这里维护一个本地草稿串，只在能解析成合法数字时才写回配置。
 */
function NumberInput(props) {
  const { value, min, step, onCommit, label, testId } = props
  const [draft, setDraft] = React.useState(() => String(value))
  const focused = React.useRef(false)

  // 外部改了值（例如点了「恢复默认」）而用户没有正在编辑时，跟随外部。
  React.useEffect(() => {
    if (focused.current !== true) setDraft(String(value))
  }, [value])

  return React.createElement('input', {
    type: 'number',
    className: 'dbp_number',
    inputMode: 'decimal',
    min,
    step,
    value: draft,
    'aria-label': label,
    'data-balance-control': testId,
    onFocus: () => {
      focused.current = true
    },
    onBlur: () => {
      focused.current = false
      setDraft(String(value))
    },
    onChange: (event) => {
      const next = event.target.value
      setDraft(next)
      if (next.trim() === '') return
      const parsed = Number(next)
      if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed)
    }
  })
}

/**
 * 设置行。
 *
 * @param props - 渲染器注入的 props：`t`（本插件词条）与 `service`
 *   （`{settings, account, pollMs 语义由 settings.pollMs 决定}`）。
 */
export function BalanceSettingsRow(props) {
  const { t, service } = props
  const settings = useStoreValue(service.settings)
  const available = service.account.available()

  const set = (patch) => {
    service.settings.update(patch)
  }

  return React.createElement(
    'div',
    { className: 'dbp_setRoot', 'data-balance-settings': true },
    React.createElement(
      'div',
      { className: 'dbp_setHead' },
      React.createElement('div', { className: 'dbp_setTitle dbp_setHeadTitle' }, t('settings.title')),
      React.createElement('div', { className: 'dbp_setDescription' }, t('settings.description'))
    ),

    !available &&
      React.createElement('div', { className: 'dbp_setNotice', role: 'status', 'data-balance-setting': 'unavailable' }, t('settings.unavailable')),

    React.createElement(
      Row,
      { title: t('settings.format.title'), description: t('settings.format.description'), testId: 'format' },
      React.createElement(Select, {
        value: settings.format,
        label: t('settings.format.title'),
        testId: 'format',
        onChange: (value) => {
          set({ format: value })
        },
        options: FORMATS.map((value) => ({ value, label: t(`settings.format.${value}`) }))
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.currency.title'), description: t('settings.currency.description'), testId: 'currency' },
      React.createElement(Select, {
        value: settings.currency,
        label: t('settings.currency.title'),
        testId: 'currency',
        onChange: (value) => {
          set({ currency: value })
        },
        options: CURRENCIES.map((value) => ({ value, label: t(`settings.currency.${value}`) }))
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.thresholds.title'),
        description: t('settings.thresholds.description', {
          low: formatThreshold(settings.low),
          warn: formatThreshold(settings.warn)
        }),
        testId: 'thresholds'
      },
      React.createElement(
        'div',
        { className: 'dbp_setPair' },
        React.createElement(NumberInput, {
          value: settings.low,
          min: 0,
          step: 1,
          label: t('settings.low'),
          testId: 'low',
          onCommit: (value) => {
            // 用 clampThresholdPatch 而不是直接写 low：否则把红色阈值填到 42
            // 会被归一化对调成 low:1/warn:42，红色档位的语义被静默颠倒。
            set(clampThresholdPatch(settings, { low: value }))
          }
        }),
        React.createElement(NumberInput, {
          value: settings.warn,
          min: 0,
          step: 1,
          label: t('settings.warn'),
          testId: 'warn',
          onCommit: (value) => {
            set(clampThresholdPatch(settings, { warn: value }))
          }
        })
      )
    ),

    React.createElement(
      Row,
      { title: t('settings.poll.title'), description: t('settings.poll.description'), testId: 'poll' },
      React.createElement(Select, {
        value: String(settings.pollMs),
        label: t('settings.poll.title'),
        testId: 'poll',
        onChange: (value) => {
          set({ pollMs: Number(value) })
        },
        options: POLL_CHOICES.map((ms) => ({
          value: String(ms),
          label: ms === 0 ? t('settings.poll.manual') : t('settings.poll.seconds', { count: ms / 1000 })
        }))
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.showRate.title'), description: t('settings.showRate.description'), testId: 'showRate' },
      React.createElement(Checkbox, {
        checked: settings.showRate,
        label: t('settings.showRate.title'),
        testId: 'showRate',
        onChange: (value) => {
          set({ showRate: value })
        }
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.showSessionSpend.title'),
        description: t('settings.showSessionSpend.description'),
        testId: 'showSessionSpend'
      },
      React.createElement(Checkbox, {
        checked: settings.showSessionSpend,
        label: t('settings.showSessionSpend.title'),
        testId: 'showSessionSpend',
        onChange: (value) => {
          set({ showSessionSpend: value })
        }
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.showTrend.title'), description: t('settings.showTrend.description'), testId: 'showTrend' },
      React.createElement(Checkbox, {
        checked: settings.showTrend,
        label: t('settings.showTrend.title'),
        testId: 'showTrend',
        onChange: (value) => {
          set({ showTrend: value })
        }
      })
    ),

    // ---- v1.3 计费时段（高峰 / 空闲）----
    // 三行设置前面先给一句总说明：高峰/空闲的规则本身要在界面上讲清楚一次，
    // 否则「显示计费时段」这个开关打开后用户仍然不知道为什么会有两个价。
    React.createElement(
      'div',
      { className: 'dbp_setGroup', 'data-balance-setting': 'tariff' },
      React.createElement('div', { className: 'dbp_setTitle dbp_setGroupTitle' }, t('settings.tariff.title')),
      React.createElement('div', { className: 'dbp_setDescription' }, t('settings.tariff.description'))
    ),

    React.createElement(
      Row,
      { title: t('settings.showTariff.title'), description: t('settings.showTariff.description'), testId: 'showTariff' },
      React.createElement(Checkbox, {
        checked: settings.showTariff,
        label: t('settings.showTariff.title'),
        testId: 'showTariff',
        onChange: (value) => {
          set({ showTariff: value })
        }
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.tariffModel.title'),
        description: t('settings.tariffModel.description'),
        testId: 'tariffModel'
      },
      React.createElement(Select, {
        value: settings.tariffModel,
        label: t('settings.tariffModel.title'),
        testId: 'tariffModel',
        onChange: (value) => {
          set({ tariffModel: value })
        },
        // 选项名直接用价格表里的 `label`（deepseek-flash / deepseek-v4-pro）：
        // 它是官方模型名，翻译成中文反而对不上文档里的叫法。
        options: MODELS.map((model) => ({ value: model.key, label: model.label }))
      })
    ),

    React.createElement(
      Row,
      {
        title: t('settings.alertOnTariff.title'),
        description: t('settings.alertOnTariff.description'),
        testId: 'alertOnTariff'
      },
      React.createElement(Checkbox, {
        checked: settings.alertOnTariff,
        label: t('settings.alertOnTariff.title'),
        testId: 'alertOnTariff',
        onChange: (value) => {
          set({ alertOnTariff: value })
        }
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.alert.title'), description: t('settings.alert.description'), testId: 'alert' },
      React.createElement(Checkbox, {
        checked: settings.alertOnCross,
        label: t('settings.alert.title'),
        testId: 'alertOnCross',
        onChange: (value) => {
          set({ alertOnCross: value })
        }
      })
    ),

    React.createElement(
      Row,
      { title: t('settings.compact.title'), description: t('settings.compact.description'), testId: 'compact' },
      React.createElement(Checkbox, {
        checked: settings.compact,
        label: t('settings.compact.title'),
        testId: 'compact',
        onChange: (value) => {
          set({ compact: value })
        }
      })
    ),

    React.createElement(
      'div',
      { className: 'dbp_setFoot' },
      React.createElement(
        'button',
        {
          type: 'button',
          className: 'dbp_setButton',
          'data-balance-control': 'reset',
          onClick: () => {
            service.settings.update(DEFAULT_SETTINGS)
          }
        },
        t('settings.reset')
      ),
      React.createElement('span', { className: 'dbp_setHint' }, t('settings.historyHint'))
    )
  )
}
