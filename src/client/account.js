/**
 * 余额徽章 —— 账号能力的客户端桥。
 *
 * 余额不经过本插件自己的网络请求：宿主已经挂载了账号服务，并通过 Typert Remote
 * 把 `account` 命名空间暴露给渲染层（`@deepseek-ai/dsh-api-account-controller`
 * 的 `super(ctx, "accountController", { namespace: "account" })`）。客户端插件只要
 * 拿到 `ctx.remote.account` 就能调用它，凭据始终留在宿主进程里。
 *
 * 这里把「取服务 + 调用 + 失败降级」收在一处，让组件层只面对
 * `{available(), read()}` 两个方法，也方便在 Node 里用假对象测试。
 */

import { clientMetadata } from './balance.js'

/**
 * 组装账号客户端。
 *
 * @param ctx - 客户端 cordis 上下文。
 * @returns `{available(): boolean, read(): Promise<{balance, state}>}`。
 */
export function createAccountClient(ctx) {
  /**
   * 惰性解析 `remote.account`。
   *
   * 不在 apply 阶段硬注入这个服务名：`remote.account` 由 api-remotes 在
   * 运行时挂载，某些部署可能没有账号能力。惰性解析让插件照样加载，只是徽章
   * 自己进入「不可用」状态，而不是让整个插件卡在等待依赖里。
   */
  const resolve = () => {
    try {
      const direct = ctx.get('remote.account')
      if (direct !== null && direct !== undefined) return direct
    } catch {
      /* 服务未注册：继续尝试下面的回退路径 */
    }
    try {
      const remote = ctx.get('remote')
      if (remote !== null && remote !== undefined && remote.account !== undefined) return remote.account
    } catch {
      /* 同上 */
    }
    return null
  }

  /** 当前界面语言；locale 服务不可用时退回浏览器语言。 */
  const activeLocale = () => {
    try {
      const snapshot = ctx.locale.getSnapshot()
      if (snapshot !== null && typeof snapshot.active === 'string' && snapshot.active !== '') return snapshot.active
    } catch {
      /* locale 快照不可读 */
    }
    return globalThis.navigator?.language ?? 'zh-CN'
  }

  /**
   * 调一个 Remote 方法并把任何异常压成失败结果。
   *
   * Remote 的正常返回是 `{ok, value}|{ok, error}`；这里额外兜住三种情况：
   * 命名空间缺失、方法抛错、返回值不是 Result 形状。
   *
   * `available()` 与 `read()` 之间的竞态是真实存在的：插件加载时 `remote.account`
   * 可能还没挂载完成，等真的要读时它已经就绪（或反过来）。因此每次调用都重新
   * `resolve()`，而不是把结果缓存下来。
   */
  const call = async (method, ...args) => {
    const api = resolve()
    if (api === null) return { ok: false, error: { code: 'UNAVAILABLE' } }
    const fn = api[method]
    if (typeof fn !== 'function') return { ok: false, error: { code: 'UNAVAILABLE' } }
    try {
      const result = await fn.call(api, ...args)
      if (result !== null && typeof result === 'object' && typeof result.ok === 'boolean') return result
      return { ok: true, value: result }
    } catch (error) {
      return { ok: false, error: { code: 'THREW', message: String(error?.message ?? error) } }
    }
  }

  return {
    available: () => resolve() !== null,
    /** 当前界面语言（面板与设置的本地化都用它）。 */
    activeLocale,
    async read() {
      const metadata = clientMetadata(activeLocale())
      const [balance, state] = await Promise.all([
        call('getBalance', metadata),
        call('getState')
      ])
      return { balance, state }
    }
  }
}
