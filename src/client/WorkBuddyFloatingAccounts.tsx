/**
 * The floating account window: both variants' accounts, over the conversation.
 *
 * Why a portal instead of a slot occupant that lays out in place: the window has
 * to sit over the conversation's top-right corner *without* taking header space,
 * and the only slot that renders inside the conversation is the header itself.
 * So the occupant renders nothing in flow, and everything it has to show goes
 * through a portal onto \`document.body\` with a fixed position derived from the
 * conversation's own scroll container.
 *
 * That derivation is the part worth reading: the offsets come from
 * \`[data-conversation-scroll]\`'s bounding box rather than from hardcoded
 * pixels, so the window follows the conversation when the sidebars open, the
 * window resizes, or the header height changes. A missing anchor falls back to a
 * viewport-relative corner, which keeps the window usable if DSH's markup moves.
 *
 * @module dsh-workbuddy-connect/client/floating-accounts
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties } from 'react'
import type { WorkBuddyWebAccounts, WorkBuddyWebStatus } from '../status-paths.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddySettingsKey } from './locales.ts'

/** Copy function injected by the client registration. */
type Translate = (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string

/** How often the window re-reads both status documents. */
const POLL_INTERVAL_MS = 60_000
/** Distance from the conversation's top-right corner, in px. */
const INSET = 16
/** Remembered collapsed/expanded state; a preference, not session state. */
const COLLAPSED_KEY = 'dsh-workbuddy-connect:floating-collapsed'

const panelStyle: CSSProperties = {
  position: 'fixed',
  zIndex: 900,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  width: 232,
  maxHeight: 'min(60vh, 420px)',
  overflowY: 'auto',
  padding: '10px 12px',
  border: '1px solid var(--dsw-alias-border-l2)',
  // Matched to the settings cards' radius rather than the button radius: the
  // window is a small panel, and DSH's own panels are noticeably rounder than
  // the 10px this started at.
  borderRadius: 14,
  background: 'var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, 0.96))',
  boxShadow: 'var(--dsw-shadow-lv2)',
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 12,
  lineHeight: '18px',
  // The window floats over the conversation, so it must not swallow scrolling
  // gestures aimed at the transcript behind it.
  overscrollBehavior: 'contain',
}
const headerStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }
const titleStyle: CSSProperties = { fontSize: 12, fontWeight: 600, color: 'var(--dsw-alias-label-secondary)' }
const iconButtonStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 20,
  height: 20,
  padding: 0,
  border: 0,
  borderRadius: 5,
  background: 'transparent',
  color: 'var(--dsw-alias-label-tertiary)',
  font: 'inherit',
  fontSize: 14,
  lineHeight: 1,
  cursor: 'pointer',
}
const groupStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 }
const groupNameStyle: CSSProperties = { fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' }
const accountRowStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }
const accountNameStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const valueStyle: CSSProperties = { flex: '0 0 auto', fontVariantNumeric: 'tabular-nums', color: 'var(--dsw-alias-label-secondary)' }
const waitingStyle: CSSProperties = { ...valueStyle, color: 'var(--dsw-alias-state-warning-primary, #b45309)' }
const collapsedStyle: CSSProperties = { ...panelStyle, width: 'auto', maxHeight: 'none', padding: '6px 10px' }

function statusColor(status: WorkBuddyWebStatus['status'] | undefined): string {
  if (status === 'signed-in') return 'var(--dsw-alias-state-success-primary, #22a06b)'
  if (status === 'error') return 'var(--dsw-alias-state-error-primary, #d92d20)'
  return 'var(--dsw-alias-label-dimmed, #9aa0a6)'
}

const dotStyle: CSSProperties = { width: 7, height: 7, borderRadius: '50%', flex: '0 0 auto' }

/** Where the floating window should sit, in viewport coordinates. */
interface Anchor { top: number, right: number }

/**
 * Compute the window's viewport position from the conversation's scroll area.
 *
 * Falls back to a viewport corner when the anchor is absent (a different DSH
 * build, or the settings page — where the window does not render at all).
 */
function anchorNow(): Anchor {
  const container = document.querySelector('[data-conversation-scroll]')
  if (container === null) return { top: INSET + 48, right: INSET }
  const rect = container.getBoundingClientRect()
  const right = Math.max(INSET, window.innerWidth - rect.right + INSET)
  return { top: Math.max(INSET, rect.top + INSET), right }
}

/** One account's line inside the window. */
function AccountLine({ account, now, t }: {
  account: WorkBuddyWebAccounts['accounts'][number]
  now: number
  t: Translate
}): React.ReactNode {
  const cooldown = account.cooldown
  const waiting = cooldown !== undefined && cooldown.untilMs > now
  return (
    <div style={accountRowStyle}>
      <span style={accountNameStyle} title={account.name}>
        <span
          aria-hidden="true"
          style={{
            ...dotStyle,
            background: account.available
              ? 'var(--dsw-alias-state-success-primary, #22a06b)'
              : waiting ? 'var(--dsw-alias-state-warning-primary, #b45309)' : 'var(--dsw-alias-label-dimmed, #9aa0a6)',
          }}
        />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{account.name}</span>
      </span>
      {waiting
        // A limited account shows when it comes back, not a balance: the
        // balance of an account that cannot be used yet is not actionable.
        ? <span style={waitingStyle}>{t('floatingRetryIn', { minutes: Math.max(1, Math.ceil(((cooldown?.untilMs ?? 0) - now) / 60_000)) })}</span>
        : <span style={valueStyle}>
            {account.credits === undefined
              ? '—'
              : new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(account.credits)}
          </span>}
    </div>
  )
}

/** Props injected for the floating window's occupant. */
export interface WorkBuddyFloatingAccountsProps {
  t: Translate
}

/**
 * The window itself, driven by both variants' status documents.
 *
 * Registered **once**, not per variant: the window merges both products' pools,
 * so a per-variant occupant would paint two identical windows on top of each
 * other. The occupant renders nothing in flow — its output is the portal below.
 */
export function WorkBuddyFloatingAccounts({ t }: WorkBuddyFloatingAccountsProps): React.ReactNode {
  const [statuses, setStatuses] = useState<Partial<Record<string, WorkBuddyWebStatus>>>({})
  const [anchor, setAnchor] = useState<Anchor | undefined>()
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(COLLAPSED_KEY) === '1'
    } catch {
      // Private mode or a blocked storage partition: default to expanded.
      return false
    }
  })
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const readAll = useCallback(async (signal?: AbortSignal): Promise<void> => {
    const entries = await Promise.all(CARD_VARIANTS.map(async variant => {
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
    for (const entry of entries) if (entry !== undefined) next[entry[0]] = entry[1]
    setStatuses(next)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void readAll(controller.signal)
    const timer = window.setInterval(() => { void readAll(controller.signal) }, POLL_INTERVAL_MS)
    return () => {
      window.clearInterval(timer)
      controller.abort()
    }
  }, [readAll])

  // Follow the conversation container: a window positioned once would drift as
  // the sidebars open or the viewport resizes.
  useEffect(() => {
    const update = (): void => { setAnchor(anchorNow()) }
    update()
    window.addEventListener('resize', update)
    const container = document.querySelector('[data-conversation-scroll]')
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(update)
    if (container !== null) observer?.observe(container)
    observer?.observe(document.body)
    return () => {
      window.removeEventListener('resize', update)
      observer?.disconnect()
    }
  }, [])

  const toggle = useCallback((): void => {
    setCollapsed(previous => {
      const next = !previous
      try {
        window.localStorage.setItem(COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        // Persisting the preference is best-effort.
      }
      return next
    })
  }, [])

  // Tick the "retry in N minutes" labels.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => { setNow(Date.now()) }, 30_000)
    return () => { window.clearInterval(timer) }
  }, [])

  // The window is chrome for the conversation, and the conversation is where a
  // model is picked; on any other page there is nothing to float over.
  const showing = CARD_VARIANTS.filter(variant => statuses[variant.id] !== undefined)
  if (showing.length === 0 || anchor === undefined) return null
  // One variant can switch the window off and the other on; either saying "off"
  // would be an arbitration rule, so the window shows when at least one card
  // still wants it.
  const wanted = showing.some(variant => {
    const status = statuses[variant.id]
    return status?.status === 'signed-in' && status.accounts?.floatingWindow === true
  })
  if (!wanted) return null

  return createPortal(
    <div
      style={{ ...(collapsed ? collapsedStyle : panelStyle), top: anchor.top, right: anchor.right }}
      role="complementary"
      aria-label={t('floatingTitle')}
      data-workbuddy-floating-accounts=""
    >
      <div style={headerStyle}>
        <span style={titleStyle}>{collapsed ? t('floatingTitle') : t('floatingTitle')}</span>
        <button
          type="button"
          style={iconButtonStyle}
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? 'floatingExpand' : 'floatingCollapse')}
          title={t(collapsed ? 'floatingExpand' : 'floatingCollapse')}
          onClick={toggle}
        >
          {collapsed ? '⌃' : '⌄'}
        </button>
      </div>
      {collapsed ? (
        <span style={{ ...groupNameStyle, display: 'flex', gap: 6, alignItems: 'center' }}>
          {showing.map(variant => (
            <span key={variant.id} aria-hidden="true" style={{ ...dotStyle, background: statusColor(statuses[variant.id]?.status) }} />
          ))}
        </span>
      ) : showing.map(variant => {
        const status = statuses[variant.id]
        const accounts = status?.status === 'signed-in' ? status.accounts : undefined
        return (
          <div key={variant.id} style={groupStyle}>
            {/*
              * The product name carries no status dot: the dot belongs beside an
              * account name, where it answers "which account is this and can it
              * serve". A dot on the heading would repeat the same signal one
              * level up and read as decoration.
              */}
            <span style={groupNameStyle}>{t(variant.titleKey)}</span>
            {accounts === undefined || accounts.accounts.length === 0
              ? <span style={groupNameStyle}>{t('floatingNoAccount')}</span>
              : accounts.accounts
                  // Disabled accounts are not part of what rotation will use, so
                  // they do not belong in a window whose job is "what is
                  // serving me right now".
                  .filter(account => account.enabled)
                  .map(account => <AccountLine key={account.id} account={account} now={now} t={t} />)}
          </div>
        )
      })}
    </div>,
    document.body,
  )
}
