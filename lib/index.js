/**
 * 余额徽章 —— 宿主侧入口。
 *
 * 本插件的全部工作在浏览器侧（`client/client.js`，由 package.json 的
 * `dsh.client` 声明加载）。余额不是本插件自己去开放平台取的：宿主已经挂载了
 * `@deepseek-ai/dsh-deepseek-account-platform`，并把账号能力以 Typert Remote
 * 的 `account` 命名空间暴露给渲染层；客户端 bundle 直接调用
 * `ctx.remote.account.getBalance(...)` 即可，凭据始终留在宿主进程里。
 *
 * 因此宿主侧没有服务、路由和配置面。仍然提供这个入口是因为 bundle patch 插入的
 * 条目由宿主加载器解析，加载器要读本模块的 `name` 做身份校验，缺失会让整个
 * profile 启动失败。
 */

/** cordis 插件名，必须与 package.json 的 name 及 patch 条目的目标一致。 */
export const name = 'dsh-balance-pill'

/**
 * 无副作用的宿主侧 apply。
 *
 * 显式保留空实现而不是省略：这是「此处有意不做任何事」的声明，
 * 避免后续维护者以为宿主侧接线被遗漏。
 */
export function apply() {}
