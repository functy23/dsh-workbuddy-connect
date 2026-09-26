/**
 * The WorkBuddy settings page: every pooled account, for both products, their
 * meters, their model lists, and the filter over each one.
 *
 * Why this is a settings *page* rather than a card in the Plugins tab: the two
 * products together are a resource the user checks and acts on — add an
 * account, see what is left, delete one that lapsed — and that is a destination,
 * not a footnote under a plugin list. The Plugins tab keeps the plugin's own
 * card; this page is where the accounts live.
 *
 * Layout, ported from the reference implementation's settings page
 * (`dsh-commandcode-provider`, whose `section.tsx` this page follows component
 * for component):
 *
 *   [accounts heading]                             [+ Add account]
 *   [account rows: state, ⋮ menu, balance meter, disclosure]
 *   [per-product total credit tiles]
 *   [<product> · Models]                            [Refresh]
 *   [filter row: model picker + switch] [row per model: window, detection]
 *   [sticky save bar, while the model filters are staged]
 *
 * What is WorkBuddy's rather than the reference's, and why:
 *
 * - **two products on one page.** The reference has one provider; here the two
 *   rosters stay separate all the way down — separate pools, separate totals,
 *   separate filters — because a sum across them would be a number that
 *   describes nothing (the credits are not convertible and the accounts are not
 *   interchangeable).
 * - **immediate writes where the reference stages.** Account actions (enable,
 *   test, remove, rename) and per-model detection/context writes go out at once:
 *   they are imperative ("stop using this account now", "probe this model now"),
 *   and staging an imperative behind a save button is how a user ends up staring
 *   at a page that has not done what they asked. The MODEL FILTER is staged, as
 *   the reference stages it — assembling "only these models" is a multi-step
 *   edit whose intermediate states are not decisions.
 * - **a picker trigger that states what the filter applies**, not what the
 *   calendar holds: with the filter off the menu edits the whole catalog (there
 *   is no stored list), while the row must not claim a selection that nothing is
 *   filtering.
 *
 * @module dsh-workbuddy-connect/client/settings-page
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ReactNode } from 'react'
import { describeWait } from '../status-paths.ts'
import { isWorkBuddySidebarCreditStyle } from '../status-paths.ts'
import type { WorkBuddySidebarCreditStyle } from '../status-paths.ts'
import type {
  WorkBuddyAccountAction,
  WorkBuddyAccountResult,
  WorkBuddyQrChallenge,
  WorkBuddyWebAccount,
  WorkBuddyWebModelBadge,
  WorkBuddyWebProbeSection,
  WorkBuddyWebStatus,
} from '../status-paths.ts'
import { encodeQrCode } from './qr-code.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import { readWorkBuddyStatus, statedPreference } from './status-document.ts'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import { openExternalLink } from './open-external.ts'
import type { WorkBuddyExternalOpenOptions } from './open-external.ts'
import { ModelPicker, selectableModels } from './model-picker.tsx'
import { ActionButton } from './ui-button.tsx'
import {
  Badge,
  Fact,
  FilterRow,
  SegmentedField,
  SettingRow,
  SettingsGroup,
  StatTile,
  StatusDot,
  ToggleField,
  cx,
} from './ui-rows.tsx'
import type { WorkBuddyCardVariant } from './card-variants.ts'
import type { WorkBuddySettingsKey } from './locales.ts'

/** Copy function injected by the client registration. */
type Translate = (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string

/** How often a QR challenge is checked. */
const POLL_INTERVAL_MS = 2_000
/** How often the page re-reads both products while it is open. */
const REFRESH_INTERVAL_MS = 60_000

/* ---------------------------------------------------------------- pieces */

/**
 * Paint a QR symbol into a canvas.
 *
 * An integer number of device pixels per module: a fractional scale softens the
 * module edges, which is the one thing that makes a camera struggle to lock on.
 */
function QrCanvas({ text, modulePixels }: { text: string, modulePixels: number }): React.ReactNode {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (canvas === null) return
    let code
    try {
      code = encodeQrCode(text)
    } catch {
      // A payload past the encoder's capacity is reported by the caller; the
      // canvas simply stays blank rather than throwing out of render.
      return
    }
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    const moduleSize = Math.max(1, Math.floor((modulePixels * ratio) / code.size))
    const side = moduleSize * code.size
    canvas.width = side
    canvas.height = side
    canvas.style.width = `${String(Math.round(side / ratio))}px`
    canvas.style.height = `${String(Math.round(side / ratio))}px`
    const context = canvas.getContext('2d')
    if (context === null) return
    context.fillStyle = '#fff'
    context.fillRect(0, 0, side, side)
    context.fillStyle = '#000'
    for (let y = 0; y < code.size; y += 1) {
      for (let x = 0; x < code.size; x += 1) {
        if (code.modules[y * code.size + x] !== true) continue
        context.fillRect(x * moduleSize, y * moduleSize, moduleSize, moduleSize)
      }
    }
  }, [text, modulePixels])
  return <canvas ref={ref} role="img" aria-label="QR" style={{ display: 'block' }} />
}

/**
 * What rotation thinks of this account right now, as a dot tone and one line of
 * copy.
 *
 * The state is computed once and read twice (the dot and the head line), so the
 * two can never disagree about whether an account is benched.
 */
function accountState(account: WorkBuddyWebAccount, now: number, t: Translate): {
  tone: 'ok' | 'warn' | 'error' | 'off'
  text: string
} {
  if (account.enabled !== true) return { tone: 'off', text: t('accountStateDisabled') }
  if (account.sessionDead === true) return { tone: 'error', text: t('accountStateSessionDead') }
  const cooldown = account.cooldown
  if (cooldown !== undefined && cooldown.untilMs > now) {
    return {
      tone: 'warn',
      text: t('accountStateWaiting', {
        reason: t(cooldown.reason === 'credit' ? 'accountStateExhausted' : cooldown.reason === 'session' ? 'accountStateSessionDead' : 'accountStateLimited'),
        when: waitLabel(cooldown.untilMs, now, t),
      }),
    }
  }
  // An expired pasted token is the one state the user must act on, and it is
  // indistinguishable from an idle account unless it is named.
  if (account.expiresAtMs > 0 && account.expiresAtMs <= now && account.renewable !== true) {
    return { tone: 'error', text: t('accountExpired') }
  }
  return { tone: 'ok', text: t('accountStateReady') }
}

/**
 * One account row — a straight port of the reference implementation's
 * `AccountItem` (`src/client/section.tsx` of dsh-commandcode-provider),
 * structure, class names and all.
 *
 * What was kept identical, because it is what the row IS:
 *
 * - the head line is a disclosure button carrying the status dot, the name, the
 *   quieter identity chips (upstream account name, plan/state chip, warn/error
 *   chips), a spacer, and the chevron — then the ⋮ `Menu` trigger beside it;
 * - the meters row (`MiniMeter` / `MonthlyBalance` shapes) sits directly
 *   under the head, outside the disclosure: a limit's fill and its reset are
 *   what the user checks at a glance, so they must not be behind a click;
 * - the ⋮ menu's rows come from one `MenuEntry[]` built in place, with
 *   separators before the edit group and before the destructive one;
 * - the three inline modes (key/rename/remove) are inline blocks inside the row
 *   — `InlineInput` as a bordered field, `ConfirmBar` as an error-edged
 *   panel — never a browser dialog.
 *
 * What had to differ, because WorkBuddy's data model is not Command Code's:
 *
 * - there is no per-account "not configured" state (an account exists only once
 *   it has a credential), so the reference's API-key setup block is absent;
 * - there is no pin/unpin (the pool's primary account is the desktop app's, not
 *   a user choice), so those two menu rows are absent;
 * - one upstream window exists (a cycle balance with an optional cap) rather
 *   than Command Code's five-hour/weekly/monthly trio, and a pasted token that
 *   lapsed is the other state worth a chip.
 */
function AccountRow({ account, product, busy, now, t, onAction }: {
  account: WorkBuddyWebAccount
  /** Which product this account belongs to, as its chip label. */
  product: string
  busy: boolean
  now: number
  t: Translate
  onAction: (action: WorkBuddyAccountAction) => void
}): React.ReactNode {
  const [expanded, setExpanded] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  /** The inline editor this row has open, if any (the reference's `mode`). */
  const [mode, setMode] = useState<'rename' | 'remove' | undefined>(undefined)
  const [label, setLabel] = useState('')
  const { tone, text: stateLabel } = accountState(account, now, t)
  const stateDetail = account.cooldown === undefined || account.cooldown.untilMs <= now
    ? stateLabel
    : `${stateLabel} · ${t('accountStrikes', { count: account.cooldown.strikes })}`
  /** The account's own name from the upstream, when it differs from the label. */
  const upstreamName = account.nickname ?? ''
  const creditValue = account.credits === undefined
    ? undefined
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 })
  const cap = account.creditsTotal
  const ratio = account.credits === undefined || cap === undefined || cap <= 0
    ? undefined
    : Math.min(1, Math.max(0, account.credits / cap))

  const items: MenuEntry[] = [
    {
      id: 'toggle',
      label: account.enabled === true ? t('accountDisable') : t('accountEnable'),
      disabled: busy,
    },
    { id: 'test', label: t('accountTest'), disabled: busy },
    { type: 'separator', id: 'sep-edit' },
    { id: 'rename', label: t('accountRename'), disabled: busy },
    { type: 'separator', id: 'sep-danger' },
    // Destructive: the stored sign-in goes with it, and restoring the account
    // means signing in again. `danger` makes the row error-coloured before its
    // text is read.
    { id: 'remove', label: t('accountRemoveAction'), disabled: busy, danger: true },
  ]
  const onMenuSelect = (id: string): void => {
    setMenuOpen(false)
    if (id === 'toggle') onAction({ action: 'enable', id: account.id, enabled: account.enabled !== true })
    else if (id === 'test') onAction({ action: 'test', id: account.id })
    else if (id === 'rename') {
      setLabel(account.name)
      setMode('rename')
    } else if (id === 'remove') setMode('remove')
  }
  return (
    <div className={cx('wbp-accountItem', account.enabled === true && tone === 'ok' && 'wbp-accountItemActive')}>
      <div className="wbp-accountHead">
        <button
          type="button"
          className="wbp-accountToggle"
          aria-expanded={expanded}
          aria-controls={`wbp-account-${account.id}-details`}
          onClick={() => { setExpanded(value => !value) }}
        >
          <StatusDot tone={tone} title={stateLabel} />
          <span className="wbp-accountName" title={account.name}>{account.name}</span>
          {upstreamName === '' || upstreamName === account.name ? null : (
            <span className="wbp-accountProduct" title={upstreamName}>{upstreamName}</span>
          )}
          {/*
            * The product, as a plan-style chip: the reference puts the upstream
            * plan there, and the product is WorkBuddy's equivalent fact — the one
            * thing about a row that must not be inferred, because the two
            * products' credits are not convertible and their accounts are not
            * interchangeable.
            */}
          <span className="wbp-usagePlan">{product}</span>
          {/*
            * The account's state, in the head line: a benching's remaining wait
            * is the figure that decides whether the account serves the next
            * message, so it belongs where the eye lands, not behind a
            * disclosure — and it is error-coloured, as the reference colours its
            * rate-limit and invalid-key marks.
            */}
          {tone === 'ok' ? null : <span className="wbp-usagePlanStatus">{stateLabel}</span>}
          <span className="wbp-spacer" />
          <span className={cx('wbp-chevron', expanded && 'wbp-chevronUp')} aria-hidden="true" />
        </button>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          onSelect={onMenuSelect}
          items={items}
          align="end"
          portal
          anchor={
            <button
              type="button"
              className="wbp-iconButton"
              aria-label={`${account.name} — ${t('accountActions')}`}
              title={t('accountActions')}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => { setMenuOpen(value => !value) }}
            >
              <span className="wbp-kebab" aria-hidden="true" />
            </button>
          }
        />
      </div>

      {/*
        * The meters, outside the disclosure: the reference's MiniMeter row (its
        * five-hour and weekly fills) reduced to the one window this upstream
        * publishes — a cycle balance and the cap it is drawn against. The fill is
        * omitted when no cap was declared, because a bar over an unknown total is
        * a guess dressed as a measurement.
        */}
      {account.credits === undefined ? null : (
        <div className="wbp-accountMeters">
          <span className="wbp-miniMeter">
            <span className="wbp-miniMeterLabel">{t('accountCycleBalance')}</span>
            {ratio === undefined ? null : (
              <span className="wbp-miniMeterTrack" role="progressbar" aria-label={t('accountCycleBalance')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(ratio * 100)}>
                <span
                  className={account.credits <= 0 ? 'wbp-miniMeterFill wbp-miniMeterFillWarn' : 'wbp-miniMeterFill'}
                  style={{ width: `${String(Math.round(ratio * 100))}%` }}
                />
              </span>
            )}
            <span className="wbp-miniMeterValue">
              {cap === undefined
                ? creditValue?.format(account.credits)
                : `${creditValue?.format(account.credits) ?? ''} / ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(cap)}`}
            </span>
          </span>
        </div>
      )}

      {!expanded ? null : (
        <div id={`wbp-account-${account.id}-details`} className="wbp-accountDetails">
          <div className="wbp-factRow">
            <Fact label={t('accountBalance')} value={
              account.credits === undefined
                ? t('accountCreditsPending')
                : t('accountCredits', { total: new Intl.NumberFormat(undefined).format(account.credits) })
            } />
            <Fact label={t('accountStatus')} value={stateDetail} />
            {account.expiresAtMs <= 0 ? null : (
              <Fact label={t('accountExpires')} value={new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(account.expiresAtMs))} />
            )}
          </div>
          <div className="wbp-factRow">
            <Fact label={t('accountSource')} value={t(
              account.origin === 'desktop' ? 'accountOriginDesktop'
                : account.origin === 'qr' ? 'accountOriginQr'
                  : 'accountOriginCookie',
            )} />
            <Fact label={t('accountDomain')} value={account.domain} />
            <Fact label={t('accountAddedAt')} value={new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(account.addedAtMs))} />
            {account.lastUsedAtMs <= 0 ? null : (
              <Fact label={t('accountLastUsed')} value={new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(account.lastUsedAtMs))} />
            )}
          </div>
          {/*
            * The usage report — the reference implementation's AccountReport
            * stat grid, filled with the figures WorkBuddy actually publishes or
            * this plugin actually counts:
            *
            *   [used this cycle] [remaining] [requests]
            *   [input tokens]    [output tokens] [cache hit rate]
            *
            * A tile that has no number is OMITTED rather than shown as zero:
            * "the upstream does not report this" and "this is zero" are different
            * answers, and the second one is the kind of wrong-but-plausible
            * figure a reader acts on.
            */}
          {account.credits === undefined && account.usage === undefined
            ? <p className="wbp-hint">{t('usageNone')}</p>
            : (
              <div className="wbp-usageStats">
                {account.creditsUsed === undefined ? null : (
                  <UsageStat
                    label={t('usageUsed')}
                    value={new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(account.creditsUsed)}
                    sub={account.creditsTotal === undefined ? undefined : `/ ${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(account.creditsTotal)}`}
                  />
                )}
                {account.credits === undefined ? null : (
                  <UsageStat
                    label={t('usageRemaining')}
                    value={new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(account.credits)}
                    sub={account.creditsTotal === undefined ? t('accountCycleUncapped') : undefined}
                  />
                )}
                {account.usage === undefined ? null : (
                  <UsageStat
                    label={t('usageRequests')}
                    value={String(account.usage.requests)}
                    sub={t('usageReported', { requests: account.usage.requests, reported: account.usage.reported })}
                  />
                )}
                {account.usage === undefined || account.usage.reported === 0 ? null : (
                  <>
                    <UsageStat label={t('usagePromptTokens')} value={shortTokens(account.usage.promptTokens)} />
                    <UsageStat label={t('usageOutputTokens')} value={shortTokens(account.usage.completionTokens)} />
                    <UsageStat
                      label={t('usageCacheHitRate')}
                      value={account.usage.cacheHitRate === undefined
                        ? t('usageCacheUnknown')
                        : `${(account.usage.cacheHitRate * 100).toFixed(1)}%`}
                      sub={account.usage.cacheReadTokens === 0
                        ? undefined
                        : t('usageSince', { date: new Intl.DateTimeFormat(undefined, { dateStyle: 'short' }).format(new Date(account.usage.sinceMs)) })}
                    />
                  </>
                )}
              </div>
            )}
          {account.creditsError === undefined ? null : (
            <p className="wbp-rowError">{account.creditsError}</p>
          )}
          <div className="wbp-inlineActions">
            {/*
              * Enable/disable is the user's override for everything rotation
              * decided on its own — a benching, a judged-dead session, or simply
              * an account they do not want spent. It is an IMMEDIATE write, the
              * one place this port departs from the reference's staging: "stop
              * using this account now" is not a change to hold until Save.
              */}
            <ActionButton
              label={account.enabled === true ? t('accountDisable') : t('accountEnable')}
              disabled={busy}
              onClick={() => { onAction({ action: 'enable', id: account.id, enabled: account.enabled !== true }) }}
            />
            <ActionButton
              label={t('accountTest')}
              disabled={busy}
              onClick={() => { onAction({ action: 'test', id: account.id }) }}
            />
            <ActionButton
              label={t('accountRename')}
              disabled={busy}
              onClick={() => { setLabel(account.name); setMode('rename') }}
            />
            <span className="wbp-spacer" />
            <ActionButton
              label={t('accountRemove')}
              tone="danger"
              disabled={busy}
              onClick={() => { setMode('remove') }}
            />
          </div>
        </div>
      )}

      {/*
        * The inline editors, below the disclosure they belong to (the
        * reference's InlineInput / ConfirmBar): a bordered field for an input,
        * an error-edged panel for a confirmation, both inside the row so the
        * question never travels to a browser dialog.
        */}
      {mode !== 'rename' ? null : (
        <div className="wbp-inlineForm">
          <div className="wbp-fieldHead">
            <span className="wbp-label">{t('accountRename')}</span>
          </div>
          <div className="wbp-inlineActions">
            <input
              className="wbp-input"
              value={label}
              placeholder={t('accountRenamePlaceholder')}
              aria-label={t('accountRename')}
              disabled={busy}
              autoFocus
              onChange={event => { setLabel(event.target.value) }}
            />
            <span className="wbp-spacer" />
            <ActionButton label={t('cancel')} onClick={() => { setMode(undefined) }} />
            <ActionButton
              label={t('accountApply')}
              tone="primary"
              disabled={busy || label.trim() === ''}
              onClick={() => { onAction({ action: 'label', id: account.id, label: label.trim() }); setMode(undefined) }}
            />
          </div>
        </div>
      )}

      {mode !== 'remove' ? null : (
        <div className="wbp-confirmBar">
          <p className="wbp-confirmText">{t('accountRemoveConfirm', { name: account.name })}</p>
          <div className="wbp-dialogActions">
            <ActionButton label={t('cancel')} onClick={() => { setMode(undefined) }} />
            <ActionButton
              label={t('accountRemove')}
              tone="danger"
              disabled={busy}
              onClick={() => { onAction({ action: 'remove', id: account.id }); setMode(undefined) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The promotional chips one model row shows, without saying "free" twice.
 *
 * The upstream's own badge text is shown verbatim rather than translated — it is
 * the product's own wording for its own promotion ("Free now", "限时免费"), and
 * restating it in this plugin's language would be inventing copy for a claim the
 * upstream made.
 *
 * The deduplication exists because a free model can arrive with *both* facts: a
 * badge naming the promotion, and the `free` flag the rate was derived from. The
 * international catalog does exactly that, which rendered "Free now" and "Free"
 * side by side. When a badge already says the model is free, the derived chip is
 * dropped — the badge is the specific claim, and this one is only the summary.
 */
function promotionChips(model: WorkBuddyWebModelBadge, freeLabel: string): string[] {
  const badges = model.badges ?? []
  // Covers both products' wording: the international catalog says "Free now",
  // the CN one says "限时免费", and either already carries the claim.
  const alreadySaysFree = badges.some(badge => /free/i.test(badge) || badge.includes('免费'))
  return [
    ...badges,
    ...model.free === true && !alreadySaysFree ? [freeLabel] : [],
  ]
}

/**
 * A cooldown's remaining time, worded for the reader.
 *
 * The unit decision is shared (`describeWait`); only the words are local, which
 * is why this composes them here rather than inside the document contract.
 */
function waitLabel(untilMs: number, now: number, t: Translate): string {
  const wait = describeWait(untilMs, now)
  return t(wait.unit === 'hour' ? 'waitHours' : 'waitMinutes', { value: wait.value })
}

/** A token count as the switch's label: 1M reads better than 1000000. */
function shortTokens(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${String(tokens / 1_000_000)}M`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${String(tokens / 1_000)}K`
  return String(tokens)
}

/**
 * The model list for one product: a context-length switch where the upstream
 * declares a choice, and a reasoning-level detection button where the model has
 * levels worth discovering.
 *
 * Both controls are writes and share the key-bearing route the account actions
 * use. Detection sits here rather than only in the composer because it is a
 * property of the model you are looking at — reading down the list with the
 * models in front of you is the moment you notice one has no levels declared,
 * and having to go and pick that model first to fix it was the roundabout part.
 */
function ModelsBlock({ variant, status, probe, busy, t, staged, context, onContext, onRefresh, onDetect, onClearProbe, onStage, onOpenLink }: {
  variant: WorkBuddyCardVariant
  status: WorkBuddyWebStatus | undefined
  /** Detection state, from the status document: consent, candidates, results. */
  probe: WorkBuddyWebProbeSection | undefined
  busy: boolean
  t: Translate
  /** Ambient seams for a sign-in hand-off; see {@link openExternalLink}. */
  context: WorkBuddyExternalOpenOptions['context']
  /** This product's uncommitted model selection; see {@link ModelsPageEdit}. */
  staged: { filterOn: boolean, allowlist: readonly string[] } | undefined
  onContext: (model: string, length: number) => void
  onRefresh: () => void
  onDetect: (model: string) => void
  onClearProbe: () => void
  /** Stage one product's model filter; `undefined` stages a discard. */
  onStage: (next: { filterOn: boolean, allowlist: readonly string[] } | undefined) => void
  onOpenLink: (url: string) => void
}): React.ReactNode {
  const signedIn = status !== undefined && status.status === 'signed-in' ? status : undefined
  const models = signedIn?.models ?? []
  const catalog = signedIn?.catalog
  /**
   * The account bucket the model filter belongs to; undefined renders no
   * filter row at all.
   *
   * Absent for an account with no stable user id: the preference is keyed by
   * `uid:enterpriseId`, so there is no bucket to store it in, and a control
   * that cannot be saved is worse than one that is not offered.
   */
  const visibility = signedIn?.visibility
  /**
   * The selection in force for this product: the staged draft when one exists,
   * else what the host reports.
   *
   * The draft is absolute rather than a patch — `allowlist.length === 0` IS the
   * "no filter" state — so there is exactly one source of truth per render and
   * no precedence puzzle between two lists that could disagree.
   */
  const filterOn = staged !== undefined ? staged.filterOn : visibility?.allowlist !== undefined
  /**
   * The selection the picker reads and writes.
   *
   * With the filter ON it is the staged draft or the host's list. With it OFF
   * the host keeps no list — "off" and "everything visible" are the same state —
   * so the menu edits a calendar of the whole catalog, and the first untick
   * there turns the filter on (see the picker's commit below). That is what
   * keeps the menu usable without flipping the switch first, and what stops an
   * untick from hiding the entire catalog through a list that only ever named
   * the one model.
   *
   * The CALENDAR is read-only for the trigger's label ({@link displayed}): while
   * the filter is off nothing is filtered, and a label counting the whole
   * catalog would read as a filter that is on.
   */
  const pickerSelection = staged !== undefined
    ? staged.allowlist
    : visibility?.allowlist ?? (filterOn ? [] : models.map(model => model.id))
  /**
   * What the FILTER is currently about, which is what the row's label states.
   *
   * Off is "everything", so the label says nothing about models rather than
   * counting them; on names the count the filter is actually applying.
   */
  const displayed = filterOn ? pickerSelection : visibility?.allowlist ?? []
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
  /**
   * Which model is waiting for the user to agree to a detection.
   *
   * Detection sends real requests against the user's own quota, so it asks
   * first — inline, in the row the button belongs to, rather than in a modal:
   * the question is one line about the model beside it, and a dialog for that is
   * heavier than the action it guards.
   */
  const [pending, setPending] = useState<string>()
  // A re-read can drop a model from the candidates; a stale confirmation for a
  // row that no longer renders would hang around invisibly.
  useEffect(() => {
    if (pending !== undefined && !(probe?.candidates ?? []).includes(pending)) setPending(undefined)
  }, [pending, probe?.candidates])
  const catalogNote = catalog === undefined
    ? undefined
    : <span className="wbp-hint">
        {catalog.source === 'live' && catalog.fetchedAt !== undefined
          ? t('modelsSourceLive', { time: format.format(new Date(catalog.fetchedAt)) })
          : catalog.source === 'saved' && catalog.fetchedAt !== undefined
            ? t('modelsSourceSaved', { time: format.format(new Date(catalog.fetchedAt)) })
            : t('modelsSourceFallback')}
      </span>
  // The product prefix is not decoration: the two variants share model ids and
  // render as two groups of the same names, so a heading without it leaves the
  // reader to infer which list they are reading from its position on the page.
  const heading = `${variant.appName} · ${t('modelsHeading')}${models.length === 0 ? '' : ` · ${t('modelsCount', { count: models.length })}`}`
  return (
    <SettingsGroup
      title={heading}
      action={<ActionButton label={t('modelsRefresh')} disabled={busy} onClick={onRefresh} />}
    >
      {catalogNote === undefined ? null : (
        <div className="wbp-row wbp-rowFlush">
          <div className="wbp-rowText">{catalogNote}</div>
        </div>
      )}
      {/*
        * The filter row: a switch plus the model picker, above the list they
        * govern.
        *
        * The two controls answer the two halves of one decision, which is why
        * they share a row rather than each owning one:
        *
        * - the PICKER says which models the filter is about. It is a searchable
        *   checkbox menu rather than a checkbox column beside the list, so the
        *   models a product offers and the models it ships to DSH are two
        *   different lists: every catalog model keeps its row below (context
        *   window, detection, promotions), while the filter is edited in one
        *   place regardless of how long the catalog grows;
        * - the SWITCH decides whether that selection reaches the model picker at
        *   all. Off shows everything, which is the state a fresh account is in.
        *
        * Both are STAGED (see {@link ModelsPageEdit}): nothing is written until
        * the page's save bar is used, so a filter the user is still assembling
        * never half-lands on the host.
        *
        * Turning the switch on needs a selection to apply, and the whole catalog
        * is the seed only when nothing is selected at all — "only show what I
        * pick" starting from nothing picked would be a picker with no models in
        * it, and the user's next move (unticking the few they do not want) is
        * the same either way. Turning it off stages the clear while keeping the
        * selection, so flipping it back on restores exactly what was there.
        *
        * Absent entirely when the document carries no visibility section: an
        * account with no stable uid has no bucket to key the preference by.
        */}
      {models.length === 0 || visibility === undefined ? null : (
        <FilterRow
          id={`wbp-filter-${variant.id}`}
          enabled={filterOn}
          disabled={busy}
          label={t('filterModelsLabel')}
          description={filterOn ? t('filterModelsHint') : t('filterModelsIdle')}
          summary={t('filterModelsCount', { ticked: displayed.length, total: models.length })}
          clearLabel={t('filterModelsClear')}
          onToggle={next => {
            const ids = pickerSelection.length > 0 ? pickerSelection : models.map(model => model.id)
            onStage({ filterOn: next, allowlist: ids })
          }}
          onClear={() => { onStage({ filterOn: false, allowlist: displayed }) }}
          control={
            <ModelPicker
              id={`wbp-filter-models-${variant.id}`}
              // The menu's ticks follow the calendar (the whole catalog while the
              // filter is off, which is what makes the first pick possible); the
              // trigger's label states what the FILTER is about, so an off row
              // names no count instead of one the picker is not applying.
              selected={pickerSelection}
              labelled={displayed}
              catalog={selectableModels(models)}
              disabled={busy}
              label={t('filterModelsLabel')}
              t={t}
              // Picking is a statement about which models to keep, so it turns
              // the filter on: the alternative — staging a list while the
              // switch stays off — is a choice the picker would not honour, and
              // the user would have to find the switch to find out.
              onPick={ids => { onStage({ filterOn: true, allowlist: ids }) }}
            />
          }
        />
      )}
      {signedIn === undefined && status?.status === 'error' ? (
        <p className="wbp-rowError" role="status">{status.message}</p>
      ) : null}
      {models.length === 0
        ? <SettingRow title={<span className="wbp-hint">{t('modelsEmpty')}</span>} className="wbp-rowFlush" />
        : models.map(model => (
            <div key={model.id} className="wbp-modelRow">
              <span className="wbp-accountToggle">
                {/*
                  * A model excluded by the filter wears its state on the row.
                  *
                  * The mark is the PICKER's answer, not a second checkbox: the
                  * selection is edited in the filter row above, and a tick here
                  * would be a control that duplicates it while looking like it
                  * meant something else. Reading it here is what makes the two
                  * lists line up at a glance — every model the product offers,
                  * with the ones that will not reach DSH marked.
                  *
                  * Absent when the filter is off, because then nothing is
                  * excluded and a column of identical dim rows would read as a
                  * state rather than as the absence of one.
                  */}
                {!filterOn || models.length === 0 || pickerSelection.includes(model.id) ? null : (
                  <span className="wbp-modelFiltered" title={t('filterModelsLabel')} aria-label={t('filterModelsLabel')} />
                )}
                <span className="wbp-modelName" title={model.name}>{model.name}</span>
                {/* Promotions sit beside the name: they are part of what the
                    row is offering, and a separate column would push the
                    switch off the edge. */}
                {promotionChips(model, t('freeModel')).map(chip => (
                  <Badge key={chip} tone="ok">{chip}</Badge>
                ))}
                {model.credits === undefined
                  ? model.rateUnknown === true ? <span className="wbp-hint">{t('rateUnknown')}</span> : null
                  : <span className="wbp-hint">{t('rate', { rate: model.credits })}</span>}
              </span>
              {/*
                * The control column is where "from top to bottom, tidy" is
                * decided, and it needs the pieces in a fixed order and fixed
                * slots to survive rows whose contents differ:
                *
                *   [ probe result ] [ Detect button ] [ context window ]
                *
                * `wbp-modelControl` is a CSS grid with a column per slot, so the
                * context figure sits at the same x on every row whether or not
                * that row has a button — with inline flow, a row without a
                * button would slide its figure left and the column would read as
                * ragged.
                */}
              <span className="wbp-modelControl">
                <span className="wbp-modelProbeResult">
                  {probe === undefined || !probe.candidates.includes(model.id) ? null : (() => {
                    const result = probe.results.find(entry => entry.id === model.id)
                    if (result === undefined) return null
                    return (
                      <Badge tone="ok" title={t('probeTooltipVerified', { levels: result.efforts.join(' / ') })}>
                        {result.validation === 'validating' && result.efforts.length > 0
                          ? result.efforts.join(' / ')
                          : t(result.validation === 'non-validating' ? 'probeResultNotValidating' : 'probeResultUnknown')}
                      </Badge>
                    )
                  })()}
                </span>
                <span className="wbp-modelProbeAction">
                  {probe === undefined || !probe.candidates.includes(model.id) ? null : (
                    <ActionButton
                      label={t((() => {
                        const result = probe.results.find(entry => entry.id === model.id)
                        return result === undefined ? 'probeStart' : 'probeRedetect'
                      })())}
                      title={t('probeTooltipIdle', { model: model.name })}
                      disabled={busy || probe.running === true}
                      onClick={() => { setPending(model.id) }}
                    />
                  )}
                </span>
                <span className="wbp-modelContext">
                  {model.contextChoices === undefined || model.contextChoices.length < 2
                    // A single declared window has nothing to switch between, so
                    // it is reported as a fact rather than offered as a control.
                    ? model.contextWindow === undefined
                      ? null
                      : <span className="wbp-hint">{t('contextHeading')} {shortTokens(model.contextWindow)}</span>
                    : <SegmentedField
                        label={`${t('contextLabel')}: ${model.name}`}
                        disabled={busy}
                        value={String(model.contextChoice ?? model.contextChoices[0] ?? 0)}
                        options={model.contextChoices.map(length => ({
                          value: String(length),
                          // Short and honest at both scales: 1M, not 1000K.
                          label: shortTokens(length),
                          title: t('contextSwitchTitle', { size: shortTokens(length) }),
                        }))}
                        onChange={next => { onContext(model.id, Number(next)) }}
                      />}
                </span>
              </span>
              {/*
                * The confirmation opens inside the row it belongs to, so the
                * question ("send real requests to this model?") stays beside the
                * button that asked it instead of appearing at the bottom of a long
                * list, a screen away from its subject.
                */}
              {pending !== model.id ? null : (
                <div className="wbp-confirmBar">
                  <p className="wbp-confirmText">{t('probeConfirmBody', { model: model.name })}</p>
                  <div className="wbp-dialogActions">
                    <ActionButton label={t('cancel')} onClick={() => { setPending(undefined) }} />
                    <ActionButton
                      label={t('probeConfirmAction')}
                      tone="primary"
                      disabled={busy || probe?.running === true}
                      onClick={() => { setPending(undefined); onDetect(model.id) }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
    </SettingsGroup>
  )
}

/** One pooled account together with the product it belongs to. */
interface TaggedAccount {
  account: WorkBuddyWebAccount
  variant: WorkBuddyCardVariant
}

/**
 * Every account from every product, as one list.
 *
 * Why the two pools are shown together: an account is an account — the user is
 * looking at "what can serve a request right now", and splitting that answer by
 * product made the list read as two separate features when it is one. Which
 * product a row belongs to is still on the row, as a quiet label under the name,
 * because that is the one fact that must not be inferred: the two products'
 * credits are not convertible and their models are not shared.
 *
 * The totals stay separate for the same reason; summing them would produce a
 * number that describes nothing.
 */
function AccountsSection({ entries, statuses, busy, now, t, onAdd, onAction }: {
  entries: readonly TaggedAccount[]
  statuses: Partial<Record<string, WorkBuddyWebStatus>>
  busy: boolean
  now: number
  t: Translate
  onAdd: () => void
  onAction: (variant: WorkBuddyCardVariant, action: WorkBuddyAccountAction) => void
}): React.ReactNode {
  return (
    <SettingsGroup
      title={t('accountHeading')}
      description={entries.length > 1 ? t('accountRotateHint') : t('accountEmptyHint')}
    >
      {/*
        * The reference implementation's account list shape: the rows, then the
        * per-product totals, then the dashed add button that opens the product
        * picker. The button carries the "new account" affordance INTO the block
        * it adds to, rather than leaving it as a control in the heading whose
        * effect (which list grows) the reader has to work out.
        */}
      {/*
        * One line per product whose status read failed, naming the product and
        * the host's own diagnosis. Without it the product simply vanished from
        * the page — no accounts, no models, no explanation — and every action on
        * it answered "request failed".
        */}
      {CARD_VARIANTS.map(variant => {
        const status = statuses[variant.id]
        if (status === undefined || status.status !== 'error') return null
        return (
          <p key={variant.id} className="wbp-rowError" role="status">
            {variant.appName}: {status.message}
          </p>
        )
      })}
      {/*
        * A desktop-credential problem while the pool is otherwise healthy: the
        * group looks fine, so nothing else would tell the user that the file
        * they pointed the plugin at is being refused.
        */}
      {CARD_VARIANTS.map(variant => {
        const status = statuses[variant.id]
        if (status === undefined || status.status !== 'signed-in' || status.desktopError === undefined) return null
        return (
          <p key={variant.id} className="wbp-notice" role="status">
            {variant.appName}: {status.desktopError}
          </p>
        )
      })}
      {entries.length === 0 ? null : (
        <div className="wbp-accountList">
          {entries.map(({ account, variant }) => (
            <AccountRow
              key={account.id}
              account={account}
              product={variant.appName}
              busy={busy}
              now={now}
              t={t}
              onAction={action => { onAction(variant, action) }}
            />
          ))}
        </div>
      )}
      {totalRows(statuses, t)}
      <button type="button" className="wbp-addButton" disabled={busy} onClick={onAdd}>
        <span className="wbp-addGlyph" aria-hidden="true" />
        {t('accountAdd')}
      </button>
    </SettingsGroup>
  )
}

/** One product's total, when that product has accounts at all. */
function totalRows(
  statuses: Partial<Record<string, WorkBuddyWebStatus>>,
  t: Translate,
): React.ReactNode {
  const rows = CARD_VARIANTS.flatMap(variant => {
    const status = statuses[variant.id]
    const list = status !== undefined && 'accounts' in status ? status.accounts?.accounts ?? [] : []
    if (list.length === 0) return []
    // Only accounts whose balance is actually known contribute: an unknown
    // figure is not a zero, and adding it as one would understate the total.
    const known = list.map(account => account.credits).filter((value): value is number => typeof value === 'number')
    const total = known.reduce((sum, value) => sum + value, 0)
    return [{ id: variant.id, name: variant.appName, total: known.length === 0 ? undefined : total }]
  })
  if (rows.length === 0) return null
  // One tile per product, never a cross-product sum: the credits are not
  // convertible, so a combined figure would describe nothing.
  return (
    <div className="wbp-usageStats">
      {rows.map(row => (
        <StatTile
          key={row.id}
          label={t('accountTotalCredits')}
          value={row.total === undefined
            ? '—'
            : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(row.total)}
          sub={row.name}
        />
      ))}
    </div>
  )
}

/** The list a user picks a product from before the login dialog opens. */
function ProductPicker({ t, onPick, onCancel }: {
  t: Translate
  onPick: (variant: WorkBuddyCardVariant) => void
  onCancel: () => void
}): React.ReactNode {
  return createPortal(
    <div className="wbp-overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="wbp-dialog" role="dialog" aria-modal="true" aria-label={t('accountAddTitle')}>
        <h3 className="wbp-dialogTitle">{t('accountAddTitle')}</h3>
        {/* The question is stated, not implied by two bare buttons: an account
            belongs to one product, and the two pools never mix. */}
        <p className="wbp-dialogBody">{t('accountAddPickHint')}</p>
        <ActionButton label={t('accountAddCn')} onClick={() => { onPick(CARD_VARIANTS[0] as WorkBuddyCardVariant) }} />
        <ActionButton label={t('accountAddAi')} onClick={() => { onPick(CARD_VARIANTS[1] as WorkBuddyCardVariant) }} />
        <div className="wbp-dialogActions">
          <ActionButton label={t('cancel')} onClick={onCancel} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * One tile in an account's usage grid, ported from the reference
 * implementation's `UsageStat`: label, figure, and an optional qualifier line
 * under it ("/ 2000", "since 09-24").
 */
function UsageStat({ label, value, sub }: {
  label: string
  value: string
  sub?: string | undefined
}): React.ReactNode {
  return (
    <div className="wbp-usageStat">
      <span className="wbp-usageStatLabel">{label}</span>
      <span className="wbp-usageStatValue">{value}</span>
      {sub === undefined || sub === '' ? null : <span className="wbp-usageStatSub">{sub}</span>}
    </div>
  )
}

/**
 * The save bar's leading mark once there is an outcome: a circled tick or a
 * circled bang, ported from the reference implementation's `SaveBarIcon` (same
 * 16px viewBox, same 1.6 stroke). Drawn rather than a glyph character so it
 * inherits the bar's tone colour and never picks up a font's own metrics.
 */
function SaveBarGlyph({ tone }: { tone: 'success' | 'error' }): React.ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.5" />
      {tone === 'success' ? <path d="M5.2 8.2l1.9 1.9 3.7-3.9" /> : <path d="M8 4.8v3.6M8 11.1v.1" />}
    </svg>
  )
}

/** How one product can be signed into. */
type SignInMode = 'qr' | 'web' | 'token'

/**
 * The sign-in dialog for one product.
 *
 * Both products offer a browser sign-in and a pasted token. Only the CN product
 * offers the scannable code: the international QR endpoint answers, but there is
 * no app on a phone that completes it, so showing a code would be offering a
 * path that cannot be walked. The international product's browser route is
 * therefore a plain link to its console rather than a QR.
 *
 * The browser route only *starts* a sign-in — it is the console, and the plugin
 * cannot observe what happens there. So the token half is not a fallback for it
 * but its other half: the user signs in on the web, copies the token, and pastes
 * it. The copy says so rather than leaving the two tabs unexplained.
 */
function AddAccountDialog({ variant, t, busy, error, onCancel, onSubmitQr, onPollQr, onSubmitToken, onOpenLink }: {
  variant: WorkBuddyCardVariant
  t: Translate
  busy: boolean
  error?: string
  onCancel: () => void
  onSubmitQr: () => Promise<WorkBuddyQrChallenge | undefined>
  onPollQr: (state: string) => Promise<boolean>
  onSubmitToken: (token: string) => Promise<boolean>
  /** Hand the minted sign-in page to the user's browser; false when it could not. */
  onOpenLink: (url: string) => Promise<boolean>
}): React.ReactNode {
  const qrSupported = variant.id === 'workbuddy'
  const [mode, setMode] = useState<SignInMode>(qrSupported ? 'qr' : 'web')
  const [challenge, setChallenge] = useState<WorkBuddyQrChallenge>()
  /**
   * Whether the last hand-off failed.
   *
   * A hand-off can only fail in one place (the browser route, where the dialog
   * itself asks for the page), and when it does the address has to reach the
   * user: every strategy in the chain is silent by design, so without this the
   * dialog would keep a button that appears to work and does not.
   */
  const [linkFailed, setLinkFailed] = useState(false)
  const [token, setToken] = useState('')
  const [remaining, setRemaining] = useState(0)
  const stopped = useRef(false)
  /**
   * Whether this dialog has already asked for a challenge.
   *
   * A ref, not the `challenge` state: a failed `add` answers with no challenge
   * at all, so keying the effect on the state alone would re-run it on every
   * render the failure caused, firing `add` in a loop. The dialog asks once per
   * opening and offers the explicit actions below after that.
   */
  const asked = useRef(false)

  /**
   * Mint a challenge as soon as a route that needs one is shown.
   *
   * Both routes do: the code route renders the URL as a QR, and the browser
   * route opens it. That is what makes the browser route a real sign-in rather
   * than a link to a marketing page — the `authUrl` the host mints *is* the
   * product's login page, carrying the state the host is already polling.
   */
  useEffect(() => {
    if ((mode !== 'qr' && mode !== 'web') || asked.current) return
    asked.current = true
    stopped.current = false
    void onSubmitQr().then(next => {
      if (stopped.current || next === undefined) return
      setChallenge(next)
    })
  }, [mode, onSubmitQr])

  /**
   * Open the minted login page in the system browser, once.
   *
   * Automatic rather than behind a button: the user already chose "sign in on
   * the web", so making them click again to reach the page that choice names
   * would be asking the same question twice. A ref keeps a re-render from
   * opening a second tab.
   */
  const opened = useRef(false)
  useEffect(() => {
    if (mode !== 'web' || challenge === undefined || opened.current) return
    opened.current = true
    void onOpenLink(challenge.authUrl).then(opened => { if (!opened) setLinkFailed(true) })
  }, [mode, challenge, onOpenLink])

  useEffect(() => {
    if (challenge === undefined) return
    setLinkFailed(false)
    setRemaining(Math.max(0, challenge.expiresAtMs - Date.now()))
    const tick = window.setInterval(() => { setRemaining(Math.max(0, challenge.expiresAtMs - Date.now())) }, 1_000)
    return () => { window.clearInterval(tick) }
  }, [challenge])

  useEffect(() => {
    if (challenge === undefined || stopped.current) return
    const poll = window.setInterval(() => {
      void onPollQr(challenge.state).then(keep => { if (!keep) stopped.current = true })
    }, POLL_INTERVAL_MS)
    return () => { window.clearInterval(poll) }
  }, [challenge, onPollQr])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onCancel])

  // Leaving the QR half releases the challenge; the host keeps the state until
  // it expires, and an abandoned one is dead weight.
  useEffect(() => () => { stopped.current = true }, [])

  return createPortal(
    <div className="wbp-overlay" role="presentation" onClick={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div className="wbp-dialog" role="dialog" aria-modal="true" aria-label={variant.appName}>
        <h3 className="wbp-dialogTitle">{t('accountAddTitle')}</h3>
        <div className="wbp-dialogActions" style={{ justifyContent: 'center' }}>
          <SegmentedField
            label={t('accountActionLogin')}
            value={mode}
            options={qrSupported
              // The scannable code is the CN product's default because that is
              // the flow its app completes on its own.
              ? [
                  { value: 'qr', label: t('accountLoginQr') },
                  { value: 'token', label: t('accountLoginToken') },
                ]
              : [
                  { value: 'web', label: t('accountLoginWeb') },
                  { value: 'token', label: t('accountLoginToken') },
                ]}
            onChange={next => { setMode(next as SignInMode) }}
          />
        </div>

        {/*
          * The address itself, when no strategy could open it.
          *
          * Shown inside the dialog rather than as an alert because it is a thing
          * to copy, and a modal's text is not selectable. Every strategy above is
          * silent when it fails, so this is the only place the user learns that
          * the page did not open — and the one way through without it is to read
          * the URL off the QR code with another device.
          */}
        {!linkFailed || challenge === undefined ? null : (
          <div className="wbp-linkFallback">
            <p className="wbp-dialogBody">{t('accountOpenLinkFailed')}</p>
            <input
              className="wbp-input"
              readOnly
              value={challenge.authUrl}
              aria-label={t('accountOpenLink')}
              onFocus={event => { event.currentTarget.select() }}
            />
          </div>
        )}

        {mode === 'qr'
          ? <>
              <p className="wbp-dialogBody">{t('accountAddBody')}</p>
              <div className="wbp-qrFrame">
                {challenge === undefined
                  ? <span className="wbp-hint">{t('loading')}</span>
                  : <QrCanvas text={challenge.authUrl} modulePixels={232} />}
              </div>
              {challenge === undefined ? null : (
                <p className="wbp-dialogBody">{t('accountAddWaiting', { seconds: Math.ceil(remaining / 1_000) })}</p>
              )}
              <div className="wbp-dialogActions">
                <ActionButton
                  label={t('accountOpenLink')}
                  disabled={challenge === undefined}
                  // System browser, not an in-app window: the sign-in happens on
                  // the provider's own page, where the user's existing session
                  // and password manager already live. The chain behind this
                  // click is what makes that work on the desktop too — see
                  // `open-external`.
                  onClick={() => {
                    if (challenge === undefined) return
                    void onOpenLink(challenge.authUrl).then(opened => { setLinkFailed(!opened) })
                  }}
                />
              </div>
            </>
          : mode === 'web'
            ? <>
                <p className="wbp-dialogBody">{t('accountWebBody')}</p>
                {/*
                  * The same wait the code route shows, because it is the same
                  * wait: the host is polling the state either way, so a sign-in
                  * completed in the browser lands in the pool on its own.
                  */}
                {challenge === undefined
                  ? <span className="wbp-hint">{t('loading')}</span>
                  : <p className="wbp-dialogBody">{t('accountWebWaiting', { seconds: Math.ceil(remaining / 1_000) })}</p>}
                <div className="wbp-dialogActions">
                  <ActionButton
                    label={t('accountOpenLink')}
                    disabled={challenge === undefined}
                    // The tab usually opened on its own; this is the way back to
                    // it when the browser blocked the pop-up, the user closed it
                    // by accident, or the desktop shell swallowed the automatic
                    // hand-off entirely.
                    onClick={() => {
                      if (challenge === undefined) return
                      void onOpenLink(challenge.authUrl).then(opened => { setLinkFailed(!opened) })
                    }}
                  />
                </div>
              </>
            : <>
              <p className="wbp-dialogBody">{t('accountTokenBody')}</p>
              <textarea
                className="wbp-tokenArea"
                value={token}
                placeholder={t('accountTokenPlaceholder')}
                spellCheck={false}
                onChange={event => { setToken(event.target.value) }}
              />
              <div className="wbp-dialogActions">
                <ActionButton
                  label={busy ? t('accountChecking') : t('accountSubmit')}
                  tone="primary"
                  disabled={busy || token.trim() === ''}
                  onClick={() => { void onSubmitToken(token) }}
                />
              </div>
            </>}

        {error === undefined ? null : (
          <p className="wbp-rowError">{error}</p>
        )}
        <div className="wbp-dialogActions">
          <ActionButton label={t('cancel')} onClick={onCancel} />
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------- page */

/**
 * What one allowlist write did.
 *
 * `unsupported` is not a failure but a capability answer: an older host answers
 * 400 to an action it does not know, which is exactly when the client can still
 * express the same filter through the per-model hide list.
 */
type AllowlistWriteResult = 'updated' | 'unsupported' | 'failed'

/** Props injected for the settings page. */
export interface WorkBuddySettingsPageProps {
  t: Translate
  /**
   * The cordis seam source a sign-in hand-off may use beyond `window.open` —
   * the right sidebar's browser, when this profile mounts one.
   *
   * Injected rather than reached for inside the dialog for the reason the other
   * external services are: this bundle must render on a profile with no sidebar
   * at all, and a missing seam has to degrade to the next strategy instead of
   * throwing out of the settings page.
   */
  context?: WorkBuddyExternalOpenOptions['context']
  /**
   * Re-read the status documents for the SURFACES OUTSIDE this page — the
   * sidebar card and the dashboard.
   *
   * They poll on their own minute-long schedule, so without this a preference
   * that changes how the card is DRAWN (the sidebar credit line) would appear to
   * do nothing for up to a minute. Injected rather than reached for: the store
   * belongs to the client entry point that creates both surfaces, and a page
   * that imported it would tie itself to a module the harness may not mount.
   */
  refreshPanel?: () => void
  /**
   * Select the dashboard in the centre column.
   *
   * Injected because the sidebar card is this plugin's ONLY other way in, and
   * the card can be switched off from this very page. Without this row the
   * switch would take the dashboard with it and leave no way back — a trap
   * rather than a setting. Optional so a page mounted without the seam (tests,
   * a profile with no layout) renders the switch alone instead of throwing.
   */
  openPanel?: () => void
}

/**
 * The page itself: one card, two product blocks.
 *
 * Each product is driven by its own status document, so a failure or a slow
 * answer on one never blocks or blanks the other.
 */
export function WorkBuddySettingsPage({ t, context, refreshPanel, openPanel }: WorkBuddySettingsPageProps): React.ReactNode {
  const [statuses, setStatuses] = useState<Partial<Record<string, WorkBuddyWebStatus>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState<WorkBuddyCardVariant>()
  const [now, setNow] = useState(() => Date.now())
  /**
   * Uncommitted model filters, one per product.
   *
   * The settings page collects model edits and writes them on Save, matching the
   * reference implementation's staged form: assembling "only these models" is a
   * multi-step decision (open the picker, search, tick, close), and a page that
   * wrote on every close would put three intermediate filters into the host's
   * store on the way to the one the user meant. A per-product map rather than a
   * single draft because the two products' filters are independent rows on one
   * page, and staging one must not discard the other.
   *
   * Each entry is ABSOLUTE, not a patch: `allowlist.length === 0` is the "no
   * filter" state, so there is no precedence puzzle between the draft and the
   * document.
   */
  const [stagedModels, setStagedModels] = useState<Record<string, { filterOn: boolean, allowlist: readonly string[] }>>({})
  /** True while the staged edits are being written; the bar says so. */
  const [saving, setSaving] = useState(false)
  /**
   * An informational line about what a save actually did.
   *
   * Not `error`: the old-host path is a downgrade, not a failure — the filter is
   * in force, it is just stored as a hide list. Rendering it as an error would
   * turn the save bar red and (worse) hide the "Saved" acknowledgement that says
   * the write landed.
   */
  const [notice, setNotice] = useState<string>()
  /** True for the moment after a save landed, which is all the bar needs to say. */
  const [justSaved, setJustSaved] = useState(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    const tick = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(tick) }
  }, [])
  /**
   * Let the "Saved" state retire on its own.
   *
   * The bar exists to be noticed and then to get out of the way: a save that
   * landed has nothing left to act on, and a bar that stayed until the next
   * click would sit over the page's last rows for as long as the reader is
   * reading. A timer rather than a dismiss button for the same reason —
   * confirming a confirmation is one interaction too many.
   */
  useEffect(() => {
    if (!justSaved) return
    const timer = window.setTimeout(() => { setJustSaved(false) }, 3_000)
    return () => { window.clearTimeout(timer) }
  }, [justSaved])

  const readAll = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const answers = await Promise.all(CARD_VARIANTS.map(async variant => {
      const result = await readWorkBuddyStatus(variant, signal)
      // An unreadable read is dropped, so the previous document stays: the page
      // keeps showing what it last knew rather than blanking over a transient
      // failure. A refused one is kept as an ERROR document, because the host's
      // own sentence is the only thing that tells the user what to fix.
      if (result.state === 'unreadable') return undefined
      if (result.state === 'refused') {
        return [variant.id, { status: 'error', message: result.message } satisfies WorkBuddyWebStatus] as const
      }
      return [variant.id, result.status] as const
    }))
    if (!mounted.current || signal?.aborted === true) return
    const next: Partial<Record<string, WorkBuddyWebStatus>> = {}
    for (const answer of answers) if (answer !== undefined) next[answer[0]] = answer[1]
    setStatuses(next)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void readAll(controller.signal)
    const tick = window.setInterval(() => { void readAll(controller.signal) }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(tick)
      controller.abort()
    }
  }, [readAll])

  /** The control key, which the status documents hand out in both sign-in states. */
  const keyFor = useCallback((variant: WorkBuddyCardVariant): string | undefined => {
    const status = statuses[variant.id]
    return status !== undefined && 'probeKey' in status ? status.probeKey : undefined
  }, [statuses])

  /**
   * Why this product cannot be written to right now, in the host's own words.
   *
   * The control key arrives with the status document, so a read that failed (or a
   * signed-out host) leaves the page unable to POST anything. That used to be
   * reported as a bare "request failed" — the reported symptom when adding the
   * international product — even though the host had said exactly what was wrong
   * and the sentence was sitting in the response body.
   */
  const blockedReason = useCallback((variant: WorkBuddyCardVariant): string | undefined => {
    const status = statuses[variant.id]
    if (status === undefined) return undefined
    if (status.status === 'error') return status.message
    if (status.status === 'signed-out') return status.reason
    return undefined
  }, [statuses])

  const run = useCallback(async (variant: WorkBuddyCardVariant, action: WorkBuddyAccountAction): Promise<WorkBuddyAccountResult | undefined> => {
    const key = keyFor(variant)
    if (key === undefined) {
      setError(blockedReason(variant) ?? t('requestFailed'))
      return undefined
    }
    const response = await fetch(variant.accountPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
      credentials: 'same-origin',
      body: JSON.stringify(action),
    })
    const value: unknown = await response.json().catch(() => undefined)
    if (!response.ok) {
      const message = typeof value === 'object' && value !== null && 'error' in value
        ? String((value as Record<string, unknown>)['error'])
        : `HTTP ${String(response.status)}`
      setError(message)
      return undefined
    }
    return value as WorkBuddyAccountResult
  }, [keyFor, t])

  const submitQr = useCallback(async (variant: WorkBuddyCardVariant): Promise<WorkBuddyQrChallenge | undefined> => {
    setError(undefined)
    setBusy(true)
    try {
      const result = await run(variant, { action: 'add' })
      if (result?.challenge === undefined) {
        setError(result?.reason ?? t('requestFailed'))
        return undefined
      }
      return result.challenge
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [run, t])

  /**
   * Hand one sign-in page to the user's own browser.
   *
   * The chain lives in `open-external`; what this adds is the two facts only
   * the page has — which route serves the product the dialog is open for, and
   * the control key that proves this page was the one the host talked to. A
   * signed-out host hands out no key, so the host strategy is simply skipped and
   * the chain falls through to the browser's own APIs.
   *
   * Returns whether the link was handed off at all, so the dialog can name the
   * address instead of leaving the user with a button that did nothing.
   */
  const openSignInPage = useCallback(async (variant: WorkBuddyCardVariant, url: string): Promise<boolean> => {
    const key = keyFor(variant)
    const options: WorkBuddyExternalOpenOptions = { probePath: variant.probePath }
    // Assigned rather than sent as `undefined`: the option types are exact, and
    // an explicit undefined would be a key the host is asked to check.
    if (key !== undefined) options.key = key
    if (context !== undefined) options.context = context
    return openExternalLink(url, options)
  }, [context, keyFor])

  const pollQr = useCallback(async (variant: WorkBuddyCardVariant, state: string): Promise<boolean> => {
    const result = await run(variant, { action: 'poll', state })
    if (result === undefined) return false
    if (result.state === 'waiting') return true
    if (result.state === 'added') {
      setAdding(undefined)
      setError(undefined)
      await readAll()
      return false
    }
    setError(result.reason ?? t(result.state === 'expired' ? 'accountQrExpired' : 'accountQrInvalid'))
    return false
  }, [readAll, run, t])

  const submitToken = useCallback(async (variant: WorkBuddyCardVariant, token: string): Promise<boolean> => {
    setError(undefined)
    setBusy(true)
    try {
      const result = await run(variant, { action: 'add-cookie', token })
      if (result === undefined) return false
      if (result.state !== 'added') {
        setError(result.reason ?? t('requestFailed'))
        return false
      }
      setAdding(undefined)
      await readAll()
      return true
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [readAll, run, t])

  /**
   * Ask the host to re-fetch this product's model list.
   *
   * Shares the probe route's `refresh` action rather than the account route:
   * the work is a catalog fetch, and that is what the probe route already does.
   */
  const refreshModels = useCallback((variant: WorkBuddyCardVariant): void => {
    const key = keyFor(variant)
    if (key === undefined) return
    setBusy(true)
    setError(undefined)
    void fetch(variant.probePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'refresh' }),
    })
      .then(async response => {
        const value: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          setError(`HTTP ${String(response.status)}`)
        } else if (typeof value === 'object' && value !== null && 'state' in value && value.state === 'failed') {
          setError(String((value as Record<string, unknown>)['reason'] ?? t('requestFailed')))
        }
        await readAll()
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : t('requestFailed')) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }, [keyFor, readAll, t])

  /**
   * Detect one model's reasoning levels.
   *
   * A write on the probe route, beside its `refresh`: the probe endpoint owns
   * detection, and the account route owns the pool. Returns nothing — the
   * re-read afterwards is what updates the row.
   */
  const probeAction = useCallback((variant: WorkBuddyCardVariant, body: { action: 'probe', model: string } | { action: 'clear' }): void => {
    const key = keyFor(variant)
    if (key === undefined) return
    setBusy(true)
    setError(undefined)
    void fetch(variant.probePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(async response => {
        const value: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          setError(`HTTP ${String(response.status)}`)
        } else if (typeof value === 'object' && value !== null && 'state' in value && value.state === 'unavailable') {
          // A detection that spent credit and could not finish has to say why;
          // silence would look like the button did nothing. The route's failure
          // state is `unavailable`, which is worth naming here — the obvious
          // guess of `failed` is a *different* action's state and would swallow
          // every real reason.
          setError(String((value as Record<string, unknown>)['reason'] ?? t('requestFailed')))
        }
        await readAll()
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : t('requestFailed')) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }, [keyFor, readAll, t])

  /**
   * Stage one product's model filter, or discard with `undefined`.
   *
   * Staging is pure local state: nothing here talks to the host, which is the
   * point of the save bar. A discard drops this product's entry and leaves the
   * other product's alone.
   */
  const stageModels = useCallback((variant: WorkBuddyCardVariant, next: { filterOn: boolean, allowlist: readonly string[] } | undefined): void => {
    setJustSaved(false)
    // Editing something new retires the previous outcome's messages — an error
    // or a note from the last save sitting over this edit would read as this
    // edit's.
    setError(undefined)
    setNotice(undefined)
    setStagedModels(current => {
      if (next === undefined) {
        if (!(variant.id in current)) return current
        const { [variant.id]: _dropped, ...rest } = current
        return rest
      }
      return { ...current, [variant.id]: next }
    })
  }, [])

  /** Discard every staged model edit, for the bar's Discard. */
  const discardStaged = useCallback((): void => {
    setStagedModels({})
    setError(undefined)
    setJustSaved(false)
  }, [])

  const accountAction = useCallback((variant: WorkBuddyCardVariant, action: WorkBuddyAccountAction): void => {
    setError(undefined)
    setBusy(true)
    void run(variant, action)
      .then(async result => {
        if (result === undefined) return
        if (result.state === 'failed') setError(result.reason ?? t('requestFailed'))
        else if (action.action === 'test' && result.test !== undefined) {
          setError(result.test.ok ? undefined : `${t('accountTestFailed')}: ${result.test.message}`)
        }
        await readAll()
        // The card states the pool's accounts and credit, so a write that
        // changed either has to reach it now rather than within the minute.
        refreshPanel?.()
      })
      .finally(() => { if (mounted.current) setBusy(false) })
  }, [readAll, refreshPanel, run, t])

  /** The bucket this product's preferences are keyed by, when the document has one. */
  const visibilityAccount = useCallback((variant: WorkBuddyCardVariant): string | undefined => {
    const status = statuses[variant.id]
    return status === undefined || !('visibility' in status) ? undefined : status.visibility?.account
  }, [statuses])

  /** The catalog rows the document currently publishes for one product. */
  const catalogIds = useCallback((variant: WorkBuddyCardVariant): readonly string[] => {
    const status = statuses[variant.id]
    return status === undefined || !('models' in status) ? [] : (status.models ?? []).map(model => model.id)
  }, [statuses])

  /**
   * Replace one product's model filter.
   *
   * A write on the probe route, beside the per-model visibility toggle: the two
   * edit different lists on the host (the hide-list and the allowlist), so one
   * cannot be expressed as the other. The account the document was rendered from
   * travels with the request — the host refuses a write aimed at a different
   * account than the one signed in, which is what keeps a stale page from
   * landing A's filter in B's bucket.
   *
   * Reports WHICH failure it was, because the caller answers them differently: an
   * unrecognized action is a host old enough to predate the feature, and that has
   * a working alternative (the per-model hide list — see {@link applyFilterByHiding});
   * anything else is an error the user has to read.
   */
  const allowlistAction = useCallback((variant: WorkBuddyCardVariant, ids: readonly string[]): Promise<AllowlistWriteResult> => {
    const key = keyFor(variant)
    const account = visibilityAccount(variant)
    // Refused locally rather than sent unguarded: the host requires the account
    // and there is no honest fallback, so a document without one cannot be
    // edited at all (an account with no stable uid has no bucket to key).
    if (key === undefined || account === undefined) return Promise.resolve('failed')
    setBusy(true)
    setError(undefined)
    // The result is returned, not swallowed: the model list mirrors the switch's
    // position locally so the list reacts within the same click, and that mirror
    // can only stay honest if it is told a write failed. Reporting it through
    // `error` alone was the reported defect — the switch stayed on over a filter
    // the host never accepted, so the next click looked like it did nothing.
    return fetch(variant.probePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
      credentials: 'same-origin',
      body: JSON.stringify({ action: 'set-model-allowlist', allowlist: ids, account }),
    })
      .then(async response => {
        const value: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          setError(response.status === 400 || response.status === 404
            ? t('filterModelsUnsupported')
            : `HTTP ${String(response.status)}`)
          await readAll()
          return response.status === 400 || response.status === 404 ? 'unsupported' : 'failed'
        }
        if (typeof value === 'object' && value !== null && 'state' in value && value.state !== 'updated') {
          setError(String((value as Record<string, unknown>)['reason'] ?? t('requestFailed')))
          await readAll()
          return 'failed'
        }
        await readAll()
        return 'updated'
      })
      .catch((cause: unknown): AllowlistWriteResult => {
        setError(cause instanceof Error ? cause.message : t('requestFailed'))
        return 'failed'
      })
      .finally(() => { if (mounted.current) setBusy(false) })
  }, [keyFor, readAll, t, visibilityAccount])

  /**
   * Enforce a filter through the per-model hide list, for a host that does not
   * know the allowlist action.
   *
   * The hide list is the plugin's oldest visibility write and every host build
   * has it, so this is the one way to make the switch work TODAY rather than
   * after a DSH restart. It is a translation, not the same write: `disabled`
   * names what to hide rather than what to keep, so the unticked models are
   * hidden and every ticked one is shown again. Applying the filter twice must
   * be idempotent (it is the same two sets), and the tick list itself is not
   * stored — this host has nowhere to put it — so the selection is derived from
   * the hide list on the next read.
   *
   * Unfiltering (the switch going off) shows every model the catalog names,
   * which is what "show everything" means here.
   */
  const applyFilterByHiding = useCallback(async (
    variant: WorkBuddyCardVariant,
    ids: readonly string[],
  ): Promise<boolean> => {
    const key = keyFor(variant)
    const account = visibilityAccount(variant)
    const catalog = catalogIds(variant)
    if (key === undefined || account === undefined || catalog.length === 0) return false
    const keep = new Set(ids)
    const writes = catalog.map(model => ({ model, visible: keep.has(model) }))
    const results = await Promise.all(writes.map(async write => {
      try {
        const response = await fetch(variant.probePath, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
          credentials: 'same-origin',
          body: JSON.stringify({
            action: 'set-model-visibility',
            model: write.model,
            visible: write.visible,
            account,
          }),
        })
        return response.ok
      } catch {
        return false
      }
    }))
    await readAll()
    return results.every(Boolean)
  }, [catalogIds, keyFor, readAll, visibilityAccount])

  /**
   * Write one plugin-wide sidebar preference.
   *
   * An IMMEDIATE write, unlike the model filter beside it: both of these change
   * how an always-visible surface is drawn, and staging them would leave the
   * sidebar keeping a card (or stating the credit one way) while the control
   * claims the other. The value comes back on the next status read, which is
   * what redraws the card.
   *
   * One helper for both preferences because they are one wire shape — an action
   * plus its value — and because the failure handling is the part that must not
   * drift between them: a 400/404 means this host does not know the action, and
   * that is the same story whichever control asked.
   */
  const writeSidebarPreference = useCallback((body: Record<string, unknown>): void => {
    const variant = CARD_VARIANTS[0]
    const key = variant === undefined ? undefined : keyFor(variant)
    if (variant === undefined || key === undefined) {
      setError(blockedReason(variant ?? CARD_VARIANTS[1] as WorkBuddyCardVariant) ?? t('requestFailed'))
      return
    }
    setBusy(true)
    setError(undefined)
    setNotice(undefined)
    void fetch(variant.probePath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-WorkBuddy-Probe-Key': key },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    })
      .then(async response => {
        const value: unknown = await response.json().catch(() => undefined)
        if (!response.ok) {
          setError(response.status === 400 || response.status === 404
            ? t('sidebarSettingUnsupported')
            : `HTTP ${String(response.status)}`)
        } else if (typeof value === 'object' && value !== null && 'state' in value && value.state !== 'updated') {
          setError(String((value as Record<string, unknown>)['reason'] ?? t('requestFailed')))
        }
        await readAll()
        // The sidebar is drawn from ITS OWN read of the same documents, so it is
        // told to re-read now rather than at its next minute tick: the user just
        // changed how that card looks and will be looking at it.
        refreshPanel?.()
      })
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : t('requestFailed')) })
      .finally(() => { if (mounted.current) setBusy(false) })
  }, [blockedReason, keyFor, readAll, refreshPanel, t])

  /** Store the sidebar's credit-line style. */
  const setCreditStyle = useCallback((style: WorkBuddySidebarCreditStyle): void => {
    writeSidebarPreference({ action: 'set-sidebar-credit-style', creditStyle: style })
  }, [writeSidebarPreference])

  /**
   * Show or hide the sidebar's credit card.
   *
   * The one preference on this page that removes a surface rather than
   * reshaping it, which is why the group grows a way into the dashboard while it
   * is off: the card is the plugin's only other route there.
   */
  const setCreditVisible = useCallback((visible: boolean): void => {
    writeSidebarPreference({ action: 'set-sidebar-credit-visible', enabled: visible })
  }, [writeSidebarPreference])

  /**
   * Write every staged model filter.
   *
   * All-or-nothing in what it REPORTS rather than in what it sends: each
   * product's write goes out on its own (they are independent rows, and one
   * failing must not silently drop the other), and the bar clears only when
   * every write landed — a half-applied save stays visible as unsaved work
   * instead of leaving the page claiming a state the host does not have.
   *
   * `allowlistAction` already surfaces the refusal (HTTP status, host reason,
   * or the "this host does not know the action" copy for a 400/404), which is
   * what the page's error line renders.
   */
  const saveStaged = useCallback((): void => {
    const entries = CARD_VARIANTS.flatMap(variant => {
      const staged = stagedModels[variant.id]
      return staged === undefined ? [] : [{ variant, staged }]
    })
    if (entries.length === 0) return
    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    setJustSaved(false)
    void Promise.all(entries.map(async entry => {
      // Off is written as an empty list: the host reads that as "no filter",
      // which is exactly what the switch being off means.
      const ids = entry.staged.filterOn ? entry.staged.allowlist : []
      const result = await allowlistAction(entry.variant, ids)
      if (result !== 'unsupported') return result === 'updated'
      // The host predates the action. Its hide list can express the same
      // filter, so the switch still works — with a note, because what lands on
      // the host is a translation and an untick is no longer reversible by a
      // re-tick alone.
      const applied = await applyFilterByHiding(entry.variant, ids)
      if (applied) {
        // The "host does not support this" error belonged to the attempt that
        // just succeeded by another route: leaving it up would contradict the
        // note that explains what actually happened.
        setError(undefined)
        setNotice(t('filterModelsFallback'))
      }
      return applied
    }))
      .then(results => {
        if (!mounted.current) return
        if (results.every(Boolean)) {
          setStagedModels({})
          setJustSaved(true)
        }
      })
      .catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : t('requestFailed'))
      })
      .finally(() => { if (mounted.current) setSaving(false) })
  }, [allowlistAction, applyFilterByHiding, stagedModels, t])

  /**
   * This product's detection state, when the document carries one.
   *
   * Read off the document rather than narrowed through `status`, for the same
   * reason the account section is: `probe` is optional, and a narrowed union
   * loses it.
   */
  const probeFor = useCallback((variant: WorkBuddyCardVariant): WorkBuddyWebProbeSection | undefined => {
    const status = statuses[variant.id]
    return status === undefined || !('probe' in status) ? undefined : status.probe
  }, [statuses])

  /**
   * Every product's accounts in one list, each tagged with its product.
   *
   * Tagged rather than looked up later: a row's controls must post to the route
   * of the pool the account actually lives in, and the only thing that decides
   * that is which status document it came from.
   */
  const taggedAccounts: TaggedAccount[] = CARD_VARIANTS.flatMap(variant => {
    const status = statuses[variant.id]
    if (status === undefined || !('accounts' in status)) return []
    return (status.accounts?.accounts ?? []).map(account => ({ account, variant }))
  })

  /** Whether anything is waiting to be written; the bar's whole condition. */
  const hasStaged = Object.keys(stagedModels).length > 0

  /**
   * The sidebar style the host reports, when it reports one.
   *
   * Read from whichever document carries it (both variants are told the same
   * value — it is one setting, not a per-product one). Absent on a host that
   * cannot persist the preference, and the row is then not rendered at all: a
   * control that cannot be saved is worse than no control.
   */
  const currentCreditStyle: WorkBuddySidebarCreditStyle | undefined =
    statedPreference(statuses, status => status.sidebarCreditStyle)

  /**
   * Whether the host says the sidebar keeps its card, when it says anything.
   *
   * `undefined` — not `true` — when no document carries the field: that is an
   * older host which cannot persist the preference, and the switch is then not
   * rendered at all, exactly like the style row beside it. Once the field IS
   * there, an absent value can no longer stand in for "on": the stored value is
   * what the sidebar draws from, and a page that second-guessed it would lie
   * about the state it is editing.
   */
  const currentCreditVisible: boolean | undefined =
    statedPreference(statuses, status => status.sidebarCreditVisible)

  return (
    // The reference layout: a 720px column of groups of hairline-separated rows.
    // No card surfaces — the page has to read as one of the harness's own
    // settings pages, which are exactly this shape.
    <section className="wbp-section" aria-label={t('accountHeading')}>
      <>
        {/* Accounts first, models below: the pool is short and rarely changed,
            while the model list is the long one a reader scans. */}
        <AccountsSection
          entries={taggedAccounts}
          statuses={statuses}
          busy={busy}
          now={now}
          t={t}
          // One button, and it opens the product picker: which product an
          // account belongs to is the first thing the dialog has to know, and
          // it cannot be inferred from the click.
          onAdd={() => { setError(undefined); setPicking(true) }}
          onAction={accountAction}
        />
        {CARD_VARIANTS.map(variant => (
          <ModelsBlock
            key={variant.id}
            variant={variant}
            status={statuses[variant.id]}
            probe={probeFor(variant)}
            busy={busy}
            t={t}
            context={context}
            staged={stagedModels[variant.id]}
            onContext={(model, length) => { accountAction(variant, { action: 'context', model, length }) }}
            onRefresh={() => { refreshModels(variant) }}
            onDetect={model => { probeAction(variant, { action: 'probe', model }) }}
            onClearProbe={() => { probeAction(variant, { action: 'clear' }) }}
            onStage={next => { stageModels(variant, next) }}
            onOpenLink={url => { void openSignInPage(variant, url) }}
          />
        ))}
      </>
      {error === undefined ? null : (
        <p className="wbp-rowError">{error}</p>
      )}
      {notice === undefined ? null : (
        <p className="wbp-notice" role="status">{notice}</p>
      )}
      {/*
        * How the sidebar is drawn, and whether it is drawn at all.
        *
        * One plugin-wide choice, shown by both products' cards, so it lives in a
        * group of its own rather than under either product's model list — and it
        * writes IMMEDIATELY, because the surface it redraws is on screen while
        * the control is being used: staging it would let the sidebar state the
        * credit one way while this row claims the other.
        *
        * Two rows, in dependency order: whether the card exists, then how it
        * states the credit. The style row is hidden while the card is off
        * because it would describe a surface that is not there — and it is
        * hidden on `false` only, never on `undefined`: a host that cannot state
        * the preference is not a host that turned the card off.
        */}
      {currentCreditVisible === undefined && currentCreditStyle === undefined ? null : (
        <SettingsGroup title={t('sidebarStyleHeading')}>
          {currentCreditVisible === undefined ? null : (
            <SettingRow
              title={t('sidebarVisibleLabel')}
              titleFor="wbp-sidebar-visible"
              description={t('sidebarVisibleHint')}
              control={
                <ToggleField
                  id="wbp-sidebar-visible"
                  label={t('sidebarVisibleLabel')}
                  checked={currentCreditVisible}
                  disabled={busy}
                  onChange={setCreditVisible}
                />
              }
            />
          )}
          {currentCreditStyle === undefined || currentCreditVisible === false ? null : (
            <SettingRow
              title={t('sidebarStyleLabel')}
              description={t('sidebarStyleHint')}
              control={
                <SegmentedField
                  label={t('sidebarStyleLabel')}
                  disabled={busy}
                  value={currentCreditStyle}
                  options={[
                    { value: 'remaining', label: t('sidebarStyleRemaining') },
                    { value: 'usage', label: t('sidebarStyleUsage') },
                  ]}
                  onChange={next => {
                    const style = isWorkBuddySidebarCreditStyle(next) ? next : undefined
                    if (style !== undefined && style !== currentCreditStyle) setCreditStyle(style)
                  }}
                />
              }
            />
          )}
          {/*
            * The way into the dashboard while the card is off.
            *
            * Only rendered when there is somewhere to navigate AND the surface
            * that normally does it has been removed — a permanently visible
            * duplicate of the sidebar card's own click would be one more row on
            * a page whose whole design is that every row earns its place.
            */}
          {currentCreditVisible !== false || openPanel === undefined ? null : (
            <SettingRow
              title={t('sidebarDashboardLabel')}
              description={t('sidebarDashboardHint')}
              control={<ActionButton label={t('sidebarDashboardOpen')} onClick={openPanel} />}
            />
          )}
        </SettingsGroup>
      )}

      {/*
        * The staged-edit bar — a straight port of the reference implementation's
        * SaveBar (`saveBarView` + `SaveBar` + `useSavedFlash`): a
        * floating capsule pinned to the bottom of the page's scrollport, sliding
        * out of view when there is nothing to save, carrying a tone dot (warn
        * while pending, a tick/error glyph once there is an outcome) and two
        * concentric buttons.
        *
        * It stays MOUNTED and animates, exactly as the reference does: a bar that
        * mounted and unmounted would have nothing to animate out from, and the
        * message it is showing when it goes is the one the user is reading.
        */}
      <div className="wbp-saveBarDock">
        <div
          className={cx(
            'wbp-saveBar',
            error !== undefined ? 'wbp-saveBarError' : justSaved && !hasStaged ? 'wbp-saveBarSuccess' : undefined,
            hasStaged || justSaved || error !== undefined ? 'wbp-saveBarShown' : undefined,
          )}
          role="region"
          aria-label={t('saveBarSave')}
          aria-hidden={!(hasStaged || justSaved || error !== undefined)}
        >
          <span className="wbp-saveBarIcon" aria-hidden="true">
            {!hasStaged && error === undefined
              ? <SaveBarGlyph tone="success" />
              : error !== undefined
                ? <SaveBarGlyph tone="error" />
                : <span className="wbp-saveBarPulse" />}
          </span>
          {/*
            * The bar stays MOUNTED so it can slide out, which means its text is
            * in the DOM while it is hidden. An empty string until there is an
            * outcome: a hidden "Saved" is still read by assistive tech and still
            * found by anything scanning the page's text.
            */}
          <p className="wbp-saveBarText" role="status" aria-live="polite">
            {error !== undefined
              ? error
              : hasStaged
                ? t('saveBarUnsaved')
                : justSaved ? t('saveBarSaved') : ''}
          </p>
          {hasStaged ? (
            <div className="wbp-saveBarActions">
              {/* Own buttons rather than the panel's: they are sized to sit
                  concentrically inside the bar's 44px capsule. */}
              <button
                type="button"
                className="wbp-saveBarButton wbp-saveBarGhost"
                disabled={saving}
                onClick={() => { discardStaged() }}
              >
                {t('saveBarDiscard')}
              </button>
              <button
                type="button"
                className="wbp-saveBarButton wbp-saveBarPrimary"
                disabled={saving}
                onClick={() => { saveStaged() }}
              >
                {t(saving ? 'saveBarSaving' : 'saveBarSave')}
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {picking
        ? <ProductPicker t={t} onPick={picked => { setPicking(false); setAdding(picked) }} onCancel={() => { setPicking(false) }} />
        : null}
      {adding === undefined ? null : (
        <AddAccountDialog
          variant={adding}
          t={t}
          busy={busy}
          {...error === undefined ? {} : { error }}
          onCancel={() => { setAdding(undefined); setError(undefined) }}
          onSubmitQr={() => submitQr(adding)}
          onPollQr={state => pollQr(adding, state)}
          onSubmitToken={token => submitToken(adding, token)}
          onOpenLink={url => openSignInPage(adding, url)}
        />
      )}
    </section>
  )
}
