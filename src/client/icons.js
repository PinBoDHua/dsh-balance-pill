/**
 * 余额徽章 —— 内联图标。
 *
 * 不依赖 `@deepseek-ai/dsh-client-ui-primitives`：那一层确实可以被 bundle
 * require，但图标集里没有钱包/余额语义的图标，而自带两个 16px 线性图标
 * （钱包、警示）比拉一个 500KB 的包更合适。描边宽度与颜色都跟随
 * `currentColor`，因此主题令牌换色时图标自动跟着变。
 */

/** 钱包图标：卡包外框 + 翻盖线 + 卡扣。 */
export function WalletIcon() {
  return React.createElement(
    'svg',
    {
      className: 'dbp_icon',
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      'aria-hidden': true,
      focusable: false
    },
    React.createElement('path', {
      d: 'M1.9 5.4c0-1.1.9-2 2-2h8.2c1.1 0 2 .9 2 2v5.2c0 1.1-.9 2-2 2H3.9c-1.1 0-2-.9-2-2V5.4Z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round'
    }),
    React.createElement('path', {
      d: 'M1.9 6.5h12.2',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    }),
    React.createElement('path', {
      d: 'M10.8 9.1h1.6',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    })
  )
}

/** 警示图标：三角叹号，用于余额不足与读取失败。 */
export function AlertIcon() {
  return React.createElement(
    'svg',
    {
      className: 'dbp_icon',
      viewBox: '0 0 16 16',
      width: 14,
      height: 14,
      'aria-hidden': true,
      focusable: false
    },
    React.createElement('path', {
      d: 'M8 2.7 14.1 13H1.9L8 2.7Z',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinejoin: 'round'
    }),
    React.createElement('path', {
      d: 'M8 6.6v3.1',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.3,
      strokeLinecap: 'round'
    }),
    React.createElement('path', {
      d: 'M8 11.6h.01',
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinecap: 'round'
    })
  )
}
