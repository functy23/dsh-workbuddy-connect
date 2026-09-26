/**
 * Copy for the WorkBuddy dashboard: the sidebar footer card and the centre
 * column panel.
 *
 * Its own namespace (panel.workbuddy), separate from the settings page's
 * settings.workbuddy, because the panel is not part of the settings page —
 * but it follows the SAME active language: both slots declare this namespace
 * at registration, which is what binds their t seat, and a language switch
 * mints a fresh t that re-renders the surfaces (see panel-view.tsx).
 *
 * @module dsh-workbuddy-connect/client/panel-copy
 */

/** Locale namespace the panel's surfaces register under. */
export const PANEL_LOCALE_NS = 'panel.workbuddy'

/** English dictionary; the key domain for both surfaces. */
export const PANEL_COPY_EN = {
  /** Panel title and the sidebar card's own label. */
  nav: 'WorkBuddy',
  /** Heading over the per-product account totals. */
  accounts: 'Accounts',
  /** Heading over the per-product model figures. */
  models: 'Models',
  /** Heading listing the per-product sign-in states. */
  signIn: 'Sign-in',
  /** The dashboard's refresh action. */
  refresh: 'Refresh',
  /** The dashboard's way back to the Conversation. */
  close: 'Close',
  /** Shown while a read is in flight and nothing has arrived yet. */
  loading: 'Reading the WorkBuddy pools…',
  /** Shown when nothing has ever been read (no host route answered). */
  unavailable: 'The host did not report its pools. Update the plugin, or restart DSH.',
  /** Accounts in the pool, per product. */
  accountCount: '{count}',
  /** One product's total remaining credit. */
  creditTotal: '{total}',
  /** A product whose accounts report no balance yet. */
  creditPending: '—',
  /** Models currently served, per product. */
  modelCount: '{count}',
  /** Where the served model list came from: a live upstream fetch. */
  sourceLive: 'Live',
  /** Where the served model list came from: this account's last saved fetch. */
  sourceSaved: 'Saved',
  /** Where the served model list came from: the roster compiled into the plugin. */
  sourceFallback: 'Built-in',
  /** The product's pool has an account and can serve requests. */
  signedIn: 'Signed in',
  /** No account: the product can serve nothing. */
  signedOut: 'Not signed in',
  /** The pool has accounts but none may be used right now. */
  allUnavailable: 'All accounts are set aside',
  /** The host reported a failure for this product. */
  failure: 'Read failed',
  /** A limit leaves N accounts benched until their stated reset. */
  benched: '{count} set aside',
  /** The card's spend line, laid out as "used / total" like the reference card. */
  creditUsed: '{used} / {total}',
  /** Shown instead when the pool's capacity cannot be stated: the balance alone. */
  creditRemaining: '{remaining} left',
  /**
   * The sidebar card's one line per product: the label names the figure, so the
   * number needs no column header beside it.
   */
  creditRemainingLabel: '{product} remaining',
  /**
   * The composer badge's text and accessible name: the product, then the balance
   * — "WorkBuddy: 5,266". The colon is the whole label, so the figure never
   * needs a heading above it.
   */
  creditBadgeLabel: '{product}: {remaining}',
  /** The footer card's accessible name and tooltip. */
  footerLabel: 'WorkBuddy — open the dashboard',
  /** The rail icon's accessible name. */
  railLabel: 'WorkBuddy dashboard',
} as const

/** Key domain of the panel's dictionary. */
export type PanelKey = keyof typeof PANEL_COPY_EN

/** Chinese dictionary; every key above, in the same order. */
export const PANEL_COPY_ZH: Record<PanelKey, string> = {
  nav: 'WorkBuddy',
  accounts: '账号',
  models: '模型',
  signIn: '登录状态',
  refresh: '刷新',
  close: '关闭',
  loading: '正在读取 WorkBuddy 账号池…',
  unavailable: '宿主未返回账号池。请更新插件或重启 DSH。',
  accountCount: '{count}',
  creditTotal: '{total}',
  creditPending: '—',
  modelCount: '{count}',
  sourceLive: '实时',
  sourceSaved: '已保存',
  sourceFallback: '内置',
  signedIn: '已登录',
  signedOut: '未登录',
  allUnavailable: '全部账号被搁置',
  failure: '读取失败',
  benched: '{count} 个搁置中',
  creditUsed: '{used} / {total}',
  creditRemaining: '剩余 {remaining}',
  /** 侧边栏每行一条：标签自己说明这个数字是什么。 */
  creditRemainingLabel: '{product} 剩余额度',
  /** 聊天框那枚徽标的文字与无障碍名：产品名 + 余额。 */
  creditBadgeLabel: '{product}: {remaining}',
  footerLabel: 'WorkBuddy —— 打开仪表盘',
  railLabel: 'WorkBuddy 仪表盘',
}

/** Translate one panel key with optional {name} parameters. */
export type PanelTranslator = (key: PanelKey, params?: Record<string, unknown>) => string

/** Fill {name} placeholders from a parameter record. */
function interpolate(template: string, params: Record<string, unknown>): string {
  return template.replace(/\{(\w+)\}/gu, (match, name: string) =>
    name in params ? String(params[name]) : match)
}

/** English fallback used when a registration carries no locale seat. */
export const panelTextEN: PanelTranslator = (key, params = {}) =>
  interpolate(PANEL_COPY_EN[key], params)

/**
 * A translator that prefers the harness's active language and falls back to
 * English per key, so a dictionary missing one string (an older bundle, a
 * partially translated locale) still renders a readable panel.
 */
export function panelTranslator(
  t: ((key: string, params?: Record<string, unknown>) => string) | undefined,
): PanelTranslator {
  if (t === undefined) return panelTextEN
  return (key, params = {}) => {
    const translated = t(key, params)
    // A namespace-bound t answers the key itself when the namespace misses,
    // which is indistinguishable from a legitimately identical word (WorkBuddy).
    return translated === key ? interpolate(PANEL_COPY_EN[key], params) : translated
  }
}
