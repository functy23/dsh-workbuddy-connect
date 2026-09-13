/**
 * The card's account tab: the pool, and every action that changes it.
 *
 * Shape of the surface:
 * - a list of pooled accounts, each one row: name (editable), origin, balance,
 *   state (可用 / 限流中 / 额度耗尽 / 会话失效), and its own controls;
 * - one primary action, 「扫码添加账号」, which opens the QR dialog;
 * - one secondary action, 「刷新积分」, which re-reads every balance.
 *
 * The dialog is a portal on \`document.body\` rather than an in-flow panel. The
 * card lives inside the settings page's own scroll container, and an in-flow
 * panel either stretches that container or gets clipped by it; a portal keeps
 * the QR code fully visible regardless of where the card sits.
 *
 * @module dsh-workbuddy-connect/client/accounts-tab
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type {
  WorkBuddyAccountAction,
  WorkBuddyAccountResult,
  WorkBuddyQrChallenge,
  WorkBuddyWebAccount,
  WorkBuddyWebAccounts,
} from '../status-paths.ts'
import { encodeQrCode } from './qr-code.ts'
import type { WorkBuddySettingsKey } from './locales.ts'

/** Copy function injected by the client registration. */
type Translate = (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string

/** How often the dialog asks whether the scan has landed. */
const POLL_INTERVAL_MS = 2_000
/** How often the account list re-reads balances while the tab is open. */
const REFRESH_INTERVAL_MS = 60_000

const listStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 10 }
const rowCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-1)',
}
const rowTopStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }
const rowNameStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, fontSize: 14, fontWeight: 600, color: 'var(--dsw-alias-label-primary)' }
const rowMetaStyle: CSSProperties = { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary)' }
const rowActionsStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }
const smallButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 28,
  padding: '3px 10px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 14,
  background: 'var(--dsw-alias-bg-layer-1)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 12,
  lineHeight: '18px',
  cursor: 'pointer',
}
const dangerButtonStyle: CSSProperties = {
  ...smallButtonStyle,
  color: 'var(--dsw-alias-state-error-primary, #d92d20)',
}
const primaryButtonStyle: CSSProperties = {
  boxSizing: 'border-box',
  minHeight: 34,
  padding: '6px 14px',
  border: '1px solid var(--dsw-alias-button-primary-fill)',
  borderRadius: 18,
  background: 'var(--dsw-alias-button-primary-fill)',
  color: 'var(--dsw-alias-label-primary-foreground)',
  font: 'inherit',
  fontSize: 14,
  cursor: 'pointer',
}
const chipBaseStyle: CSSProperties = {
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 11,
  lineHeight: '18px',
  whiteSpace: 'nowrap',
}
const labelInputStyle: CSSProperties = {
  boxSizing: 'border-box',
  minWidth: 120,
  flex: '1 1 120px',
  padding: '4px 8px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 6,
  background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-primary)',
  font: 'inherit',
  fontSize: 13,
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
  width: 'min(380px, 100%)',
  maxHeight: '100%',
  overflowY: 'auto',
  padding: '18px 18px 16px',
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  boxShadow: 'var(--dsw-shadow-lv2)',
  color: 'var(--dsw-alias-label-primary)',
}
const dialogTitleStyle: CSSProperties = { margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600 }
const dialogBodyStyle: CSSProperties = { margin: 0, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' }
const qrFrameStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12,
  borderRadius: 8,
  // A QR code needs its light background even in dark mode; inverting it makes
  // the symbol unscannable for many phone cameras.
  background: '#fff',
}
const dialogActionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }

/**
 * Render a QR symbol into a canvas.
 *
 * Scaled to a whole number of device pixels per module: a fractional scale
 * blurs the module edges, and a blurred edge is exactly what makes a camera
 * struggle to lock on.
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
      // canvas simply stays blank rather than throwing into React's render.
      return
    }
    const ratio = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1
    const moduleSize = Math.max(1, Math.floor(modulePixels * ratio / code.size))
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

/** The cooldown/state chip, which is the row's most important fact. */
function stateChip(account: WorkBuddyWebAccount, t: Translate, now: number): { text: string, style: CSSProperties } | undefined {
  if (account.sessionDead === true) {
    return { text: t('accountStateSessionDead'), style: { ...chipBaseStyle, background: 'rgba(217, 45, 32, 0.12)', color: 'var(--dsw-alias-state-error-primary, #d92d20)' } }
  }
  if (account.enabled !== true) {
    return { text: t('accountStateDisabled'), style: { ...chipBaseStyle, background: 'var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.06))', color: 'var(--dsw-alias-label-tertiary)' } }
  }
  const cooldown = account.cooldown
  if (cooldown !== undefined && cooldown.untilMs > now) {
    const minutes = Math.max(1, Math.ceil((cooldown.untilMs - now) / 60_000))
    const reasonKey = cooldown.reason === 'credit'
      ? 'accountStateExhausted'
      : cooldown.reason === 'session' ? 'accountStateSessionDead' : 'accountStateLimited'
    return {
      text: t('accountStateWaiting', { reason: t(reasonKey), minutes }),
      style: { ...chipBaseStyle, background: 'rgba(245, 158, 11, 0.14)', color: 'var(--dsw-alias-state-warning-primary, #b45309)' },
    }
  }
  return undefined
}

/** One pooled account row. */
function AccountRow({ account, busy, now, t, onAction }: {
  account: WorkBuddyWebAccount
  busy: boolean
  now: number
  t: Translate
  onAction: (action: WorkBuddyAccountAction) => void
}): React.ReactNode {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(account.label ?? '')
  const chip = stateChip(account, t, now)
  return (
    <div style={rowCardStyle}>
      <div style={rowTopStyle}>
        <span style={rowNameStyle}>
          {/* The label is what the user recognises the account by; the uid is
              only a fallback so an unlabelled row is never blank. */}
          {editing
            ? <input
                // eslint-disable-next-line jsx-a11y/no-autofocus -- the field
                // only exists because the user just asked to rename.
                autoFocus
                style={labelInputStyle}
                value={draft}
                placeholder={account.nickname ?? account.uid.slice(0, 8)}
                onChange={event => { setDraft(event.target.value) }}
                onKeyDown={event => {
                  if (event.key === 'Enter') { onAction({ action: 'label', id: account.id, label: draft }); setEditing(false) }
                  if (event.key === 'Escape') { setDraft(account.label ?? ''); setEditing(false) }
                }}
                onBlur={() => { onAction({ action: 'label', id: account.id, label: draft }); setEditing(false) }}
              />
            : <span>{account.name}</span>}
          {chip === undefined ? null : <span style={chip.style}>{chip.text}</span>}
        </span>
        <span style={rowActionsStyle}>
          <button type="button" style={smallButtonStyle} disabled={busy} onClick={() => { onAction({ action: 'test', id: account.id }) }}>
            {t('accountTest')}
          </button>
          <button
            type="button"
            style={smallButtonStyle}
            disabled={busy}
            onClick={() => { onAction({ action: 'enable', id: account.id, enabled: account.enabled !== true }) }}
          >
            {t(account.enabled === true ? 'accountDisable' : 'accountEnable')}
          </button>
          <button type="button" style={smallButtonStyle} disabled={busy} onClick={() => { setEditing(true) }}>
            {t('accountRename')}
          </button>
          <button
            type="button"
            style={dangerButtonStyle}
            disabled={busy}
            // Destructive and irreversible: the stored refresh token is gone.
            onClick={() => { if (window.confirm(t('accountRemoveConfirm', { name: account.name }))) onAction({ action: 'remove', id: account.id }) }}
          >
            {t('accountRemove')}
          </button>
        </span>
      </div>
      <span style={rowMetaStyle}>
        {account.credits === undefined
          ? account.creditsError === undefined ? t('accountCreditsPending') : t('creditsError', { message: account.creditsError })
          : t('accountCredits', { total: new Intl.NumberFormat(undefined).format(account.credits) })}
        {' · '}
        {t(account.origin === 'desktop' ? 'accountOriginDesktop' : 'accountOriginQr')}
        {account.sessionDead === true ? '' : ` · ${t('accountTokenExpires', { time: account.expiresAtMs > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(account.expiresAtMs)) : t('accountTokenUnknown') })}`}
      </span>
    </div>
  )
}

/** The scan-to-add dialog. */
export function QrDialog({ challenge, t, busy, error, onCancel, onCheck }: {
  challenge: WorkBuddyQrChallenge
  t: Translate
  busy: boolean
  error?: string
  onCancel: () => void
  onCheck: () => void
}): React.ReactNode {
  const [remaining, setRemaining] = useState(() => Math.max(0, challenge.expiresAtMs - Date.now()))
  useEffect(() => {
    const timer = window.setInterval(() => { setRemaining(Math.max(0, challenge.expiresAtMs - Date.now())) }, 1_000)
    return () => { window.clearInterval(timer) }
  }, [challenge.expiresAtMs])
  // Close on Escape: the dialog is modal and covers the page.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [onCancel])
  return createPortal(
    <div
      style={overlayStyle}
      role="presentation"
      onClick={event => { if (event.target === event.currentTarget) onCancel() }}
    >
      <div style={dialogStyle} role="dialog" aria-modal="true" aria-label={t('accountAddTitle')}>
        <h3 style={dialogTitleStyle}>{t('accountAddTitle')}</h3>
        <p style={dialogBodyStyle}>{t('accountAddBody')}</p>
        <div style={qrFrameStyle}>
          <QrCanvas text={challenge.authUrl} modulePixels={240} />
        </div>
        <p style={dialogBodyStyle}>{t('accountAddWaiting', { seconds: Math.ceil(remaining / 1_000) })}</p>
        {error === undefined ? null : <p style={{ ...dialogBodyStyle, color: 'var(--dsw-alias-state-error-primary, #d92d20)' }}>{error}</p>}
        <div style={dialogActionsStyle}>
          <button type="button" style={smallButtonStyle} onClick={onCancel}>{t('cancel')}</button>
          <button type="button" style={primaryButtonStyle} disabled={busy} onClick={onCheck}>
            {busy ? t('accountChecking') : t('accountCheckNow')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

/** Props of the account tab, as the card renders it. */
export interface WorkBuddyAccountsTabProps {
  accounts: WorkBuddyWebAccounts
  probeKey: string
  accountPath: string
  t: Translate
  busy: boolean
  /** Run one control action; resolves with the host's answer. */
  run: (action: WorkBuddyAccountAction) => Promise<WorkBuddyAccountResult | undefined>
  /** Re-read the status document. */
  refresh: () => Promise<void>
  /** Result line to show under the list, if any. */
  notice?: string
  noticeIsError?: boolean
}

export function WorkBuddyAccountsTab({
  accounts, accountPath, t, busy, run, refresh, notice, noticeIsError,
}: WorkBuddyAccountsTabProps): React.ReactNode {
  const [challenge, setChallenge] = useState<WorkBuddyQrChallenge>()
  const [dialogError, setDialogError] = useState<string>()
  const [dialogBusy, setDialogBusy] = useState(false)
  // Ticks the cooldown chips so "3 分钟后重试" counts down instead of freezing.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [])

  /**
   * Poll a challenge until it lands, expires, or is cancelled.
   *
   * Kept as a ref-driven loop rather than an interval so a slow round trip
   * cannot stack requests, and so cancelling stops the chain immediately.
   */
  const cancelled = useRef(false)
  const pollOnce = useCallback(async (state: string): Promise<boolean> => {
    setDialogBusy(true)
    try {
      const result = await run({ action: 'poll', state })
      if (result === undefined) { setDialogError(t('requestFailed')); return false }
      switch (result.state) {
        case 'waiting': return true
        case 'added':
          setChallenge(undefined)
          setDialogError(undefined)
          await refresh()
          return false
        case 'expired':
          setDialogError(t('accountQrExpired'))
          return false
        case 'invalid':
          setDialogError(t('accountQrInvalid'))
          return false
        default:
          setDialogError(result.reason ?? t('requestFailed'))
          return false
      }
    } finally {
      setDialogBusy(false)
    }
  }, [refresh, run, t])

  useEffect(() => {
    if (challenge === undefined) return
    cancelled.current = false
    const timer = window.setInterval(() => {
      if (cancelled.current) return
      void pollOnce(challenge.state).then(keep => { if (!keep) cancelled.current = true })
    }, POLL_INTERVAL_MS)
    return () => {
      cancelled.current = true
      window.clearInterval(timer)
    }
  }, [challenge, pollOnce])

  const startAdd = useCallback(async (): Promise<void> => {
    setDialogError(undefined)
    const result = await run({ action: 'add' })
    if (result?.challenge === undefined) {
      setDialogError(result?.reason ?? t('requestFailed'))
      return
    }
    setChallenge(result.challenge)
  }, [run, t])

  const closeDialog = useCallback((): void => {
    const state = challenge?.state
    setChallenge(undefined)
    setDialogError(undefined)
    if (state !== undefined) void run({ action: 'cancel', state })
  }, [challenge, run])

  return (
    <div style={listStyle}>
      <div style={rowTopStyle}>
        <h3 style={{ margin: 0, fontSize: 14, lineHeight: '20px', fontWeight: 600 }}>
          {t('accountHeading')}
        </h3>
        <span style={rowActionsStyle}>
          <button type="button" style={primaryButtonStyle} disabled={busy} onClick={() => { void startAdd() }}>
            {t('accountAdd')}
          </button>
          <button
            type="button"
            style={smallButtonStyle}
            disabled={busy}
            onClick={() => { void run({ action: 'refresh-credits' }).then(() => refresh()) }}
          >
            {t('accountRefreshCredits')}
          </button>
        </span>
      </div>
      <p style={rowMetaStyle}>{t('accountRotateHint')}</p>
      {accounts.accounts.length === 0
        ? <p style={dialogBodyStyle}>{t('accountEmpty')}</p>
        : accounts.accounts.map(account => (
            <AccountRow
              key={account.id}
              account={account}
              busy={busy || dialogBusy}
              now={now}
              t={t}
              onAction={action => { void run(action).then(() => refresh()) }}
            />
          ))}
      {notice === undefined ? null : (
        <p style={{ ...dialogBodyStyle, color: noticeIsError === true ? 'var(--dsw-alias-state-error-primary, #d92d20)' : 'var(--dsw-alias-state-success-primary, #22a06b)' }}>
          {notice}
        </p>
      )}
      {challenge === undefined ? null : (
        <QrDialog
          challenge={challenge}
          t={t}
          busy={dialogBusy}
          {...dialogError === undefined ? {} : { error: dialogError }}
          onCancel={closeDialog}
          onCheck={() => { void pollOnce(challenge.state) }}
        />
      )}
    </div>
  )
}

/** Re-export for the card's polling cadence. */
export { REFRESH_INTERVAL_MS }
