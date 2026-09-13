/**
 * The WorkBuddy settings page: every pooled account, for both products, with
 * the total credit each product has left.
 *
 * Why this is a settings *page* rather than a card in the Plugins tab: the two
 * products together are a resource the user checks and acts on — add an
 * account, see what is left, delete one that lapsed — and that is a destination,
 * not a footnote under a plugin list. The Plugins tab keeps the plugin's own
 * card; this page is where the accounts live.
 *
 * Layout, per product:
 *
 *   [grey heading  WorkBuddy]                     [+ Add account]
 *   [account rows: name, balance, test, remove]
 *   [total credit]
 *
 * The two products stay separate all the way down — separate pools, separate
 * totals — because a sum across them would be a number that describes nothing:
 * the credits are not convertible and the accounts are not interchangeable.
 *
 * @module dsh-workbuddy-connect/client/settings-page
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type {
  WorkBuddyAccountAction,
  WorkBuddyAccountResult,
  WorkBuddyQrChallenge,
  WorkBuddyWebAccount,
  WorkBuddyWebStatus,
} from '../status-paths.ts'
import { encodeQrCode } from './qr-code.ts'
import { SegmentedControl } from './segmented.tsx'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddyCardVariant } from './card-variants.ts'
import type { WorkBuddySettingsKey } from './locales.ts'

/** Copy function injected by the client registration. */
type Translate = (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string

/** How often a QR challenge is checked. */
const POLL_INTERVAL_MS = 2_000
/** How often the page re-reads both products while it is open. */
const REFRESH_INTERVAL_MS = 60_000

/* ------------------------------------------------------------------ styles */

const pageStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 16, padding: '4px 0 24px' }
const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
  padding: '18px 20px 20px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'var(--dsw-alias-bg-module-platform)',
}
const groupStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const groupHeadStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
/**
 * The product heading. Deliberately small, grey, and unprominent: it labels a
 * block inside one card, and a full-size heading here would read as a second
 * card boundary.
 */
const groupTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: 12,
  lineHeight: '18px',
  fontWeight: 600,
  letterSpacing: 0.2,
  color: 'var(--dsw-alias-label-tertiary)',
}
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '9px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-layer-1)',
}
const rowMainStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }
const dotStyle: CSSProperties = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' }
const nameStyle: CSSProperties = {
  fontSize: 14,
  lineHeight: '20px',
  color: 'var(--dsw-alias-label-primary)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
}
const balanceStyle: CSSProperties = {
  fontSize: 13,
  lineHeight: '20px',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--dsw-alias-label-secondary)',
  whiteSpace: 'nowrap',
}
const metaStyle: CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
/** A promotional or "free" chip beside a model name. */
const badgeStyle: CSSProperties = {
  flex: '0 0 auto',
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 11,
  lineHeight: '18px',
  background: 'var(--dsw-alias-state-success-subtle, rgba(34, 160, 107, 0.12))',
  color: 'var(--dsw-alias-state-success-primary, #22a06b)',
  whiteSpace: 'nowrap',
}
const rowEndStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }
const buttonStyle: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 30,
  padding: '4px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 15,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
  lineHeight: '18px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}
const dangerStyle: CSSProperties = { ...buttonStyle, color: 'var(--dsw-alias-state-error-primary, #d92d20)' }
const primaryStyle: CSSProperties = {
  ...buttonStyle,
  border: '1px solid var(--dsw-alias-button-primary-fill)',
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
}
const totalRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  justifyContent: 'space-between',
  gap: 12,
  paddingTop: 10,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}
const totalLabelStyle: CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
const totalValueStyle: CSSProperties = {
  fontSize: 20,
  lineHeight: '26px',
  fontWeight: 600,
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--dsw-alias-label-primary)',
}
const overlayStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 4000,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
  background: 'rgba(0, 0, 0, 0.45)',
}
const dialogStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  width: 'min(400px, 100%)',
  maxHeight: '100%',
  overflowY: 'auto',
  padding: '18px 18px 16px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  boxShadow: 'var(--dsw-shadow-lv2)',
  color: 'var(--dsw-alias-label-primary)',
}
const dialogTitleStyle: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, textAlign: 'center' }
const dialogBodyStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }
const dialogActionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
const qrFrameStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
  borderRadius: 10,
  // A QR symbol needs its light background even in dark mode; inverting it
  // makes it unscannable for many phone cameras.
  background: '#fff',
}
const tokenAreaStyle: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  minHeight: 96,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 10,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  resize: 'vertical',
  wordBreak: 'break-all',
}

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

/** The dot's colour: what rotation thinks of this account right now. */
function statusColor(account: WorkBuddyWebAccount, now: number): string {
  if (account.sessionDead === true || account.enabled !== true) return 'var(--dsw-alias-label-dimmed, #9aa0a6)'
  const cooldown = account.cooldown
  if (cooldown !== undefined && cooldown.untilMs > now) return 'var(--dsw-alias-state-warning-primary, #b45309)'
  return 'var(--dsw-alias-state-success-primary, #22a06b)'
}

/** One account row: name, balance, and the two things you can do to it. */
function AccountRow({ account, busy, now, t, onAction }: {
  account: WorkBuddyWebAccount
  busy: boolean
  now: number
  t: Translate
  onAction: (action: WorkBuddyAccountAction) => void
}): React.ReactNode {
  const cooldown = account.cooldown
  const waiting = cooldown !== undefined && cooldown.untilMs > now
  // An expired pasted token is the one state the user must act on, and it is
  // indistinguishable from a benching unless it is named.
  const expired = account.expiresAtMs > 0 && account.expiresAtMs <= now && account.renewable !== true
  return (
    <div style={rowStyle}>
      <span style={rowMainStyle}>
        <span aria-hidden="true" style={{ ...dotStyle, background: statusColor(account, now) }} />
        <span style={nameStyle} title={account.name}>{account.name}</span>
      </span>
      <span style={rowEndStyle}>
        <span style={waiting ? { ...balanceStyle, color: 'var(--dsw-alias-state-warning-primary, #b45309)' } : balanceStyle}>
          {waiting
            ? t('accountStateWaiting', {
                reason: t(cooldown?.reason === 'credit' ? 'accountStateExhausted' : cooldown?.reason === 'session' ? 'accountStateSessionDead' : 'accountStateLimited'),
                minutes: Math.max(1, Math.ceil(((cooldown?.untilMs ?? 0) - now) / 60_000)),
              })
            : expired
              ? t('accountExpired')
              : account.credits === undefined
                ? t('accountCreditsPending')
                : t('accountCredits', { total: new Intl.NumberFormat(undefined).format(account.credits) })}
        </span>
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { onAction({ action: 'test', id: account.id }) }}>
          {t('accountTest')}
        </button>
        <button
          type="button"
          style={dangerStyle}
          disabled={busy}
          // Destructive: the stored sign-in goes with it, and restoring the
          // account means signing in again.
          onClick={() => { if (window.confirm(t('accountRemoveConfirm', { name: account.name }))) onAction({ action: 'remove', id: account.id }) }}
        >
          {t('accountRemove')}
        </button>
      </span>
    </div>
  )
}

/** A token count as the switch's label: 1M reads better than 1000000. */
function shortTokens(tokens: number): string {
  if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${String(tokens / 1_000_000)}M`
  if (tokens >= 1_000 && tokens % 1_000 === 0) return `${String(tokens / 1_000)}K`
  return String(tokens)
}

/**
 * The model list for one product, with a context-length switch where there is a
 * choice and a detection button per model.
 *
 * The switch is the reason this block is not read-only: a model the upstream
 * publishes several windows for runs at whichever one is selected, which is what
 * lets a long transcript continue. It is a write, so it goes through the same
 * key-bearing route the account actions use.
 */
function ModelsBlock({ variant, status, busy, t, onContext, onRefresh }: {
  variant: WorkBuddyCardVariant
  status: WorkBuddyWebStatus | undefined
  busy: boolean
  t: Translate
  onContext: (model: string, length: number) => void
  onRefresh: () => void
}): React.ReactNode {
  const signedIn = status !== undefined && status.status === 'signed-in' ? status : undefined
  const models = signedIn?.models ?? []
  const catalog = signedIn?.catalog
  const format = new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' })
  return (
    <div style={groupStyle}>
      <div style={groupHeadStyle}>
        <h3 style={groupTitleStyle}>
          {t('modelsHeading')}
          {models.length === 0 ? '' : ` · ${t('modelsCount', { count: models.length })}`}
        </h3>
        <span style={rowEndStyle}>
          {catalog === undefined ? null : (
            <span style={metaStyle}>
              {catalog.source === 'live' && catalog.fetchedAt !== undefined
                ? t('modelsSourceLive', { time: format.format(new Date(catalog.fetchedAt)) })
                : catalog.source === 'saved' && catalog.fetchedAt !== undefined
                  ? t('modelsSourceSaved', { time: format.format(new Date(catalog.fetchedAt)) })
                  : t('modelsSourceFallback')}
            </span>
          )}
          <button type="button" style={buttonStyle} disabled={busy} onClick={onRefresh}>
            {t('modelsRefresh')}
          </button>
        </span>
      </div>
      {models.length === 0
        ? <p style={metaStyle}>{t('modelsEmpty')}</p>
        : models.map(model => (
            <div key={model.id} style={rowStyle}>
              <span style={rowMainStyle}>
                <span style={nameStyle} title={model.name}>{model.name}</span>
                {/* Promotions sit beside the name: they are part of what the
                    row is offering, and a separate column would push the
                    switch off the edge. */}
                {model.badges?.map(badge => (
                  <span key={badge} style={badgeStyle}>{badge}</span>
                ))}
                {model.free === true ? <span style={badgeStyle}>{t('freeModel')}</span> : null}
                {model.credits === undefined
                  ? model.rateUnknown === true ? <span style={metaStyle}>{t('rateUnknown')}</span> : null
                  : <span style={metaStyle}>{t('rate', { rate: model.credits })}</span>}
              </span>
              <span style={rowEndStyle}>
                {model.contextChoices === undefined || model.contextChoices.length < 2
                  // A single declared window has nothing to switch between, so
                  // it is reported as a fact rather than offered as a control.
                  ? model.contextWindow === undefined
                    ? null
                    : <span style={metaStyle}>{t('contextHeading')} {shortTokens(model.contextWindow)}</span>
                  : <SegmentedControl
                      dense
                      label={`${t('contextLabel')}: ${model.name}`}
                      disabled={busy}
                      value={model.contextChoice ?? model.contextChoices[0] ?? 0}
                      options={model.contextChoices.map(length => ({
                        value: length,
                        // Short and honest at both scales: 1M, not 1000K.
                        label: shortTokens(length),
                        title: t('contextSwitchTitle', { size: shortTokens(length) }),
                      }))}
                      onChange={length => { onContext(model.id, length) }}
                    />}
              </span>
            </div>
          ))}
    </div>
  )
}

/** Everything one product's block contains. */
function VariantBlock({ variant, status, busy, now, t, onAdd, onAction, onContext, onRefreshModels }: {
  variant: WorkBuddyCardVariant
  status: WorkBuddyWebStatus | undefined
  busy: boolean
  now: number
  t: Translate
  onAdd: (variant: WorkBuddyCardVariant) => void
  onAction: (action: WorkBuddyAccountAction) => void
  onContext: (model: string, length: number) => void
  onRefreshModels: () => void
}): React.ReactNode {
  const accounts = status !== undefined && 'accounts' in status ? status.accounts : undefined
  const list = accounts?.accounts ?? []
  // Only accounts whose balance is actually known contribute: an unknown figure
  // is not a zero, and adding it as one would understate the total.
  const known = list.map(account => account.credits).filter((value): value is number => typeof value === 'number')
  const total = known.reduce((sum, value) => sum + value, 0)
  return (
    <div style={groupStyle}>
      <div style={groupHeadStyle}>
        <h3 style={groupTitleStyle}>{t(variant.titleKey)}</h3>
        <button type="button" style={buttonStyle} disabled={busy} onClick={() => { onAdd(variant) }}>
          {t('accountAdd')}
        </button>
      </div>
      {list.length === 0
        ? <p style={metaStyle}>{t('accountEmpty')}</p>
        : list.map(account => (
            <AccountRow key={account.id} account={account} busy={busy} now={now} t={t} onAction={onAction} />
          ))}
      <div style={totalRowStyle}>
        <span style={totalLabelStyle}>{t('accountTotalCredits')}</span>
        <span style={totalValueStyle}>
          {known.length === 0
            ? '—'
            : new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(total)}
        </span>
      </div>
      {/* Accounts first, models below: the model list is the longer one and the
          one you come back to, so putting the pool above it keeps the short,
          occasionally-changed block out of its way. */}
      <ModelsBlock
        variant={variant}
        status={status}
        busy={busy}
        t={t}
        onContext={onContext}
        onRefresh={onRefreshModels}
      />
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
    <div style={overlayStyle} role="presentation" onClick={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={t('accountAddTitle')}>
        <h3 style={dialogTitleStyle}>{t('accountAddTitle')}</h3>
        <button type="button" style={buttonStyle} onClick={() => { onPick(CARD_VARIANTS[0] as WorkBuddyCardVariant) }}>
          {t('accountAddCn')}
        </button>
        <button type="button" style={buttonStyle} onClick={() => { onPick(CARD_VARIANTS[1] as WorkBuddyCardVariant) }}>
          {t('accountAddAi')}
        </button>
        <div style={dialogActionsStyle}>
          <button type="button" style={buttonStyle} onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/**
 * The sign-in dialog for one product.
 *
 * The CN product offers both routes; the international one offers only the
 * pasted token, because there is no app that can scan for it — the QR endpoint
 * answers, but there is nothing on the user's phone that completes it, so
 * showing the segment would be offering a path that cannot be walked.
 */
function AddAccountDialog({ variant, t, busy, error, onCancel, onSubmitQr, onPollQr, onSubmitToken }: {
  variant: WorkBuddyCardVariant
  t: Translate
  busy: boolean
  error?: string
  onCancel: () => void
  onSubmitQr: () => Promise<WorkBuddyQrChallenge | undefined>
  onPollQr: (state: string) => Promise<boolean>
  onSubmitToken: (token: string) => Promise<boolean>
}): React.ReactNode {
  const qrSupported = variant.id === 'workbuddy'
  const [mode, setMode] = useState<'qr' | 'token'>(qrSupported ? 'qr' : 'token')
  const [challenge, setChallenge] = useState<WorkBuddyQrChallenge>()
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

  // Mint the challenge as soon as the QR half is shown.
  useEffect(() => {
    if (mode !== 'qr' || asked.current) return
    asked.current = true
    stopped.current = false
    void onSubmitQr().then(next => {
      if (stopped.current || next === undefined) return
      setChallenge(next)
    })
  }, [mode, onSubmitQr])

  useEffect(() => {
    if (challenge === undefined) return
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
    <div style={overlayStyle} role="presentation" onClick={event => { if (event.target === event.currentTarget) onCancel() }}>
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={t(variant.titleKey)}>
        <h3 style={dialogTitleStyle}>{t('accountAddTitle')}</h3>
        {qrSupported
          ? (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <SegmentedControl
                label={t('accountActionLogin')}
                value={mode}
                options={[
                  { value: 'qr' as const, label: t('accountLoginQr') },
                  { value: 'token' as const, label: t('accountLoginToken') },
                ]}
                onChange={setMode}
              />
            </div>
          )
          : null}

        {mode === 'qr'
          ? <>
              <p style={dialogBodyStyle}>{t('accountAddBody')}</p>
              <div style={qrFrameStyle}>
                {challenge === undefined
                  ? <span style={metaStyle}>{t('loading')}</span>
                  : <QrCanvas text={challenge.authUrl} modulePixels={232} />}
              </div>
              {challenge === undefined ? null : (
                <p style={dialogBodyStyle}>{t('accountAddWaiting', { seconds: Math.ceil(remaining / 1_000) })}</p>
              )}
              <div style={dialogActionsStyle}>
                <button
                  type="button"
                  style={buttonStyle}
                  disabled={challenge === undefined}
                  // System browser, not an in-app window: the sign-in happens on
                  // the provider's own page, where the user's existing session
                  // and password manager already live.
                  onClick={() => { if (challenge !== undefined) window.open(challenge.authUrl, '_blank', 'noopener,noreferrer') }}
                >
                  {t('accountOpenLink')}
                </button>
              </div>
            </>
          : <>
              <p style={dialogBodyStyle}>{t('accountTokenBody')}</p>
              <textarea
                style={tokenAreaStyle}
                value={token}
                placeholder={t('accountTokenPlaceholder')}
                spellCheck={false}
                onChange={event => { setToken(event.target.value) }}
              />
              <div style={dialogActionsStyle}>
                <button
                  type="button"
                  style={primaryStyle}
                  disabled={busy || token.trim() === ''}
                  onClick={() => { void onSubmitToken(token) }}
                >
                  {busy ? t('accountChecking') : t('accountSubmit')}
                </button>
              </div>
            </>}

        {error === undefined ? null : (
          <p style={{ ...dialogBodyStyle, color: 'var(--dsw-alias-state-error-primary, #d92d20)' }}>{error}</p>
        )}
        <div style={dialogActionsStyle}>
          <button type="button" style={buttonStyle} onClick={onCancel}>{t('cancel')}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ------------------------------------------------------------------- page */

/** Props injected for the settings page. */
export interface WorkBuddySettingsPageProps {
  t: Translate
}

/**
 * The page itself: one card, two product blocks.
 *
 * Each product is driven by its own status document, so a failure or a slow
 * answer on one never blocks or blanks the other.
 */
export function WorkBuddySettingsPage({ t }: WorkBuddySettingsPageProps): React.ReactNode {
  const [statuses, setStatuses] = useState<Partial<Record<string, WorkBuddyWebStatus>>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState<WorkBuddyCardVariant>()
  const [now, setNow] = useState(() => Date.now())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  useEffect(() => {
    const tick = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(tick) }
  }, [])

  const readAll = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const answers = await Promise.all(CARD_VARIANTS.map(async variant => {
      try {
        const response = await fetch(variant.statusPath, {
          headers: { accept: 'application/json' },
          credentials: 'same-origin',
          ...signal === undefined ? {} : { signal },
        })
        if (!response.ok) return undefined
        return [variant.id, await response.json() as WorkBuddyWebStatus] as const
      } catch {
        return undefined
      }
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

  const run = useCallback(async (variant: WorkBuddyCardVariant, action: WorkBuddyAccountAction): Promise<WorkBuddyAccountResult | undefined> => {
    const key = keyFor(variant)
    if (key === undefined) {
      setError(t('requestFailed'))
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
      })
      .finally(() => { if (mounted.current) setBusy(false) })
  }, [readAll, run, t])

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        {CARD_VARIANTS.map(variant => (
          <VariantBlock
            key={variant.id}
            variant={variant}
            status={statuses[variant.id]}
            busy={busy}
            now={now}
            t={t}
            // The block's own button opens the product picker, which then
            // decides whose dialog opens. Passing the block's variant through
            // would skip the choice the user was just offered.
            onAdd={() => { setError(undefined); setPicking(true) }}
            onAction={action => { accountAction(variant, action) }}
            onContext={(model, length) => { accountAction(variant, { action: 'context', model, length }) }}
            onRefreshModels={() => { refreshModels(variant) }}
          />
        ))}
      </div>
      {error === undefined ? null : (
        <p style={{ ...metaStyle, color: 'var(--dsw-alias-state-error-primary, #d92d20)' }}>{error}</p>
      )}
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
        />
      )}
    </div>
  )
}
