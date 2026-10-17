/**
 * 余额徽章 —— 配置模型与持久化。
 *
 * ## 为什么是 localStorage 而不是宿主 configForms
 * 宿主的 `configForms` 面向的是「有宿主侧服务、由 cordis 配置块驱动」的插件
 * （它需要 package 声明配置 schema 并挂 Host 服务）。本插件的宿主侧只有空壳，
 * 全部行为在渲染层，因此配置存在浏览器里最贴合实际，也最不容易在宿主升级时炸掉。
 *
 * ## 兼容性
 * v1.0 只有 `dsh-balance-pill:thresholds` 一个键（`{low, warn}`）。v1.1 换成
 * 单个 `dsh-balance-pill:settings` 对象；读取时先看新键，没有就用旧键迁移，
 * 迁移后旧键保留不动（回滚到 v1.0 时用户的自定义阈值还在）。
 *
 * ## 硬约束
 * 任何一项解析失败都只回落到该项的默认值，绝不让配置把徽章打挂：
 * 这个模块的每个分支都对应 tests/runtime.test.mjs 里的一条用例。
 */

import { DEFAULT_MODEL_KEY, MODELS } from './pricing.js'

/** 插件 id，与 package.json 的 name 一致。 */
export const NS = 'dsh-balance-pill'

/** v1.1 配置键。 */
export const SETTINGS_KEY = `${NS}:settings`

/** v1.0 遗留的阈值键（读取时迁移，不删除）。 */
export const LEGACY_THRESHOLDS_KEY = `${NS}:thresholds`

/** 徽章数字口径。 */
export const FORMATS = ['total', 'recharge', 'bonus']

/** 币种选择；`auto` 表示优先人民币、其次美元。 */
export const CURRENCIES = ['auto', 'CNY', 'USD']

/**
 * 面板价格口径的白名单。
 *
 * 从 `pricing.js` 的 `MODELS` 派生而不是再抄一份：价格表只有一处定义，
 * 设置层的白名单跟着它走，模型换代时不会出现「设置里能选、引擎里没有」的缝。
 */
export const TARIFF_MODELS = MODELS.map((model) => model.key)

/** 轮询间隔的可选档位（毫秒）；0 表示只在手动与焦点事件时读取。 */
export const POLL_CHOICES = [0, 30000, 60000, 300000]

/** 轮询间隔默认值：60 秒。 */
export const DEFAULT_POLL_MS = 60000

/** 距离上次读取多久之内不再重复请求（手动刷新与自动刷新共用）。 */
export const MIN_REFRESH_GAP_MS = 10000

/** 全部默认配置。 */
export const DEFAULT_SETTINGS = {
  /** 徽章数字口径：可用总额 / 仅充值余额 / 仅赠金余额。 */
  format: 'total',
  /** 展示币种：auto / CNY / USD。 */
  currency: 'auto',
  /** 低于该金额判红。 */
  low: 3,
  /** 低于该金额判橙。 */
  warn: 10,
  /** 轮询间隔（毫秒）。 */
  pollMs: DEFAULT_POLL_MS,
  /** 是否显示消费速度与预估可用时长。 */
  showRate: true,
  /** 紧凑模式：不显示币种符号。 */
  compact: false,
  /** 面板里是否画余额趋势图（v1.2）。 */
  showTrend: true,
  /** 面板里是否显示「本轮会话消耗」（v1.2）。 */
  showSessionSpend: true,
  /** 余额跨档（变差）时是否提醒（v1.2）。 */
  alertOnCross: true,
  /** 状态行徽章上是否标出当前计费时段（高峰 / 空闲）（v1.3）。 */
  showTariff: true,
  /** 面板价格与预估使用的价格口径（v1.3）；取值来自 `TARIFF_MODELS`。 */
  tariffModel: DEFAULT_MODEL_KEY,
  /**
   * 时段切换（进入高峰 / 进入空闲）时是否提醒（v1.3）。
   *
   * 默认**关**：余额不足是「会打断你」的事件，值得主动弹卡；而时段切换是
   * 规律的、每天都会发生的事，默认弹卡会变成噪音。用户想要就被动打开。
   */
  alertOnTariff: false
}

/** 取一个可用的 localStorage；不可用时返回 undefined（隐私模式、Node 测试）。 */
export function resolveStorage() {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/** 内部别名：本模块多处按「默认存储」语义使用它。 */
function defaultStorage() {
  return resolveStorage()
}

/** 解析存储里的 JSON 对象；任何异常返回 null。 */
function readObject(store, key) {
  if (store === undefined || store === null) return null
  try {
    const raw = store.getItem(key)
    if (typeof raw !== 'string' || raw === '') return null
    const parsed = JSON.parse(raw)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * 读取一个有限非负数；非法返回 fallback。
 *
 * v1.5 修正：**不能**直接 `Number(value)` —— `Number(null)`、`Number('')`、
 * `Number(false)` 都是 0，会被当成一个合法的「0 元阈值」静默吞掉。用户把设置里
 * 的输入框清空（或存储里写进 `null`）时，阈值会变成 0，于是**任何余额都判红**，
 * 而界面上看不出任何异常。这与 `history.billingDayOf` / `tariff-alert` 里
 * 「null 不是 1970」是同一条教训：只接受数字，或**非空**的数字字符串。
 */
function numberOr(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : fallback
  if (typeof value !== 'string' || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback
}

/** 读取一个枚举值；不在白名单内返回 fallback。 */
function enumOr(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback
}

/** 读取一个布尔值；非布尔返回 fallback。 */
function boolOr(value, fallback) {
  return typeof value === 'boolean' ? value : fallback
}

/**
 * 把一份原始配置归一化成完整配置。
 *
 * 单独导出是因为「归一化」是这层唯一有分支的逻辑，值得被直接单测；
 * `loadSettings` 只是它加上「找存储」。
 *
 * 关于写反的阀值：这里采用**对调**（`low:50, warn:10` → `low:10, warn:50`）。
 * 读到坏数据时对调能保住两个档位都还在，是对未知来源数据最无害的修复。
 * 注意这与设置面板里的编辑行为不同：那里用户意图明确（「我在改红色阈值」），
 * 因此改成推动兄弟字段而不是对调 —— 否则用户把红色阈值填到 42 会看到
 * 红色档位反而变成 1，语义被静默颠倒。见 `settings-row.js` 的 clampSibling。
 *
 * @param raw - 存储里读出来的对象（可能残缺、可能带非法类型）。
 * @param legacy - v1.0 的阈值对象，作为 low/warn 的兜底来源。
 * @returns 完整的配置对象。
 */
export function normalizeSettings(raw, legacy) {
  const source = raw ?? {}
  const thresholds = legacy ?? {}
  const warn = numberOr(source.warn, numberOr(thresholds.warn, DEFAULT_SETTINGS.warn))
  const low = numberOr(source.low, numberOr(thresholds.low, DEFAULT_SETTINGS.low))
  return {
    format: enumOr(source.format, FORMATS, DEFAULT_SETTINGS.format),
    currency: enumOr(source.currency, CURRENCIES, DEFAULT_SETTINGS.currency),
    low: Math.min(low, warn),
    warn: Math.max(low, warn),
    pollMs: normalizePoll(source.pollMs),
    showRate: boolOr(source.showRate, DEFAULT_SETTINGS.showRate),
    compact: boolOr(source.compact, DEFAULT_SETTINGS.compact),
    showTrend: boolOr(source.showTrend, DEFAULT_SETTINGS.showTrend),
    showSessionSpend: boolOr(source.showSessionSpend, DEFAULT_SETTINGS.showSessionSpend),
    alertOnCross: boolOr(source.alertOnCross, DEFAULT_SETTINGS.alertOnCross),
    showTariff: boolOr(source.showTariff, DEFAULT_SETTINGS.showTariff),
    tariffModel: enumOr(source.tariffModel, TARIFF_MODELS, DEFAULT_SETTINGS.tariffModel),
    alertOnTariff: boolOr(source.alertOnTariff, DEFAULT_SETTINGS.alertOnTariff)
  }
}

/**
 * 保持 `low <= warn` 不变量的编辑补丁。
 *
 * 用户改红色阈值时，橙色阈值只往上让路；改橙色阈值时，红色阈值只往下让路。
 * 结果可能让某一个档位塌缩成空区间（例如两者都变成 42），但**语义不会被颠倒** ——
 * 空区间是用户一眼能看出来的，静默对调不是。
 *
 * @param settings - 当前配置。
 * @param patch - 待写入的补丁（只需含 low/warn 之一）。
 * @returns 补齐了兄弟字段的补丁。
 */
export function clampThresholdPatch(settings, patch) {
  const next = { ...patch }
  if (patch.low !== undefined) {
    const low = numberOr(patch.low, settings.low)
    next.low = low
    // 只在用户没有同时编辑橙色阈值时才推动它。
    if (patch.warn === undefined && settings.warn < low) next.warn = low
  }
  if (patch.warn !== undefined) {
    const warn = numberOr(patch.warn, settings.warn)
    next.warn = warn
    if (patch.low === undefined && settings.low > warn) next.low = warn
  }
  return next
}

/**
 * 轮询间隔归一化：非法值回落默认，合法值对齐到最近的档位（允许任意非负值）。
 *
 * v0.1.6 修：`Number('')` / `Number(false)` 同样是 0，会被当成合法的
 * 「仅手动」档位。用户把存储写坏成空串时，插件会静默停止轮询，看起来像
 * 「余额不再更新」。这里与 `numberOr()` 用同一条规则：只接受数字或非空数字
 * 字符串；数值 0 仍然合法（那是明确的「仅手动」）。
 */
function normalizePoll(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return DEFAULT_SETTINGS.pollMs
  } else if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_SETTINGS.pollMs
    return normalizePollNumber(parsed)
  } else {
    return DEFAULT_SETTINGS.pollMs
  }
  return normalizePollNumber(value)
}

/** 轮询数值的档位修正：小于 5 秒会把宿主打到限流，视为误配。 */
function normalizePollNumber(value) {
  const parsed = Math.round(value)
  if (parsed > 0 && parsed < 5000) return 5000
  return parsed
}

/**
 * 读取配置：新键优先，其次迁移 v1.0 的阈值键，最后是默认值。
 * @param storage - 形如 localStorage 的对象；缺省读全局。
 */
export function loadSettings(storage = defaultStorage()) {
  return normalizeSettings(readObject(storage, SETTINGS_KEY), readObject(storage, LEGACY_THRESHOLDS_KEY))
}

/**
 * 写入配置。
 * @param settings - 待写入的配置（会先归一化）。
 * @param storage - 形如 localStorage 的对象；缺省读全局。
 * @returns 实际写入的配置；存储不可用时返回归一化结果但不报错。
 */
export function saveSettings(settings, storage = defaultStorage()) {
  const normalized = normalizeSettings(settings)
  if (storage !== undefined && storage !== null) {
    try {
      storage.setItem(SETTINGS_KEY, JSON.stringify(normalized))
    } catch {
      /* 配额或隐私模式：配置本次有效即可，不打断使用 */
    }
  }
  return normalized
}

/**
 * 一个极小的可订阅配置存储。
 *
 * 组件层用 `subscribe` + `get` 绑定到 React state：这样「设置里改了阈值，
 * 徽章立刻变红」不需要刷新页面，也不需要把配置塞进 cordis 服务。
 *
 * @param initial - 初始配置；缺省从 localStorage 读。
 * @param storage - 持久化目标；缺省 localStorage。
 */
export function createSettingsStore(initial, storage = defaultStorage()) {
  let current = initial ?? loadSettings(storage)
  const listeners = new Set()
  return {
    /** 当前配置（只读快照）。 */
    get: () => current,
    /** 合并写入若干字段并通知订阅者；返回写入后的配置。 */
    update(patch) {
      const next = saveSettings({ ...current, ...patch }, storage)
      const changed = Object.keys(next).some((key) => next[key] !== current[key])
      current = next
      if (changed) for (const listener of [...listeners]) listener(current)
      return current
    },
    /** 恢复默认值并写入。 */
    reset() {
      return this.update(DEFAULT_SETTINGS)
    },
    /** 订阅变更；返回取消订阅函数。 */
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    }
  }
}
