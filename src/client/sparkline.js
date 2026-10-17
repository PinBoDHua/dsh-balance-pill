/**
 * 余额徽章 —— 趋势折线。
 *
 * 一段 SVG 折线 + 面积填充，纯展示：所有几何计算都在 `history.js` 的
 * `sparklinePath()` 里完成（并可单测），这里只负责把它铺成元素。
 *
 * 刻意不引图表库：面板宽 264px、数据几十个点，一条 path 足够；引库既会撑大产物，
 * 也会把第三方依赖带进宿主渲染进程。
 */

import { sparklinePath } from './history.js'

/** 折线画布尺寸；`viewBox` 用同一坐标系，宽度自适应由 CSS 负责。 */
const WIDTH = 232
const HEIGHT = 40

/**
 * 趋势折线。
 *
 * @param props - `{points, currency, t}`：
 *   `points` 是 `{at, amount}[]`（升序），`currency` 用于无障碍文本。
 */
export function TrendSparkline(props) {
  const { points, currency, t } = props
  // 一个点画不出「趋势」：它只会渲染成一条贴边的短线或一个孤点，读者会误以为
  // 余额一直没变。少于两点时整个组件不渲染，由面板决定要不要给出别的说明。
  if (!Array.isArray(points) || points.length < 2) return null
  const geometry = sparklinePath(points, { width: WIDTH, height: HEIGHT })
  if (geometry === null) return null

  const rising = geometry.delta > 0
  const flat = geometry.delta === 0
  // 涨（充值）与跌（消耗）用不同色：跌用主题的 warning 色，涨用 success 色。
  const tone = flat ? 'flat' : rising ? 'up' : 'down'

  return React.createElement(
    'div',
    { className: 'dbp_trend', 'data-balance-trend': true, 'data-tone': tone },
    React.createElement(
      'svg',
      {
        className: 'dbp_spark',
        viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
        preserveAspectRatio: 'none',
        role: 'img',
        'aria-label': t('panel.trend.aria', {
          points: geometry.points,
          from: `${currency ?? ''}${geometry.first.toFixed(2)}`,
          to: `${currency ?? ''}${geometry.last.toFixed(2)}`
        })
      },
      React.createElement('path', { className: 'dbp_sparkArea', d: geometry.area }),
      React.createElement('path', { className: 'dbp_sparkLine', d: geometry.d })
    ),
    React.createElement(
      'div',
      { className: 'dbp_trendFoot' },
      React.createElement('span', { className: 'dbp_trendRange', 'data-balance-trend-min': true }, `${currency ?? ''}${geometry.min.toFixed(2)}`),
      React.createElement('span', { className: 'dbp_trendRange', 'data-balance-trend-max': true }, `${currency ?? ''}${geometry.max.toFixed(2)}`)
    )
  )
}
