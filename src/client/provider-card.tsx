/**
 * The WorkBuddy card inside the harness Models settings page (browser half).
 *
 * Rendered through the `settings.models.provider-card` keyed slot, registered
 * under `entryKey = settingsNs` — the key the Models page dispatches for every
 * row of an adapter family. That row exists because the host half now
 * contributes a `registerConfigurableProviders` directory entry for the
 * variant; without it there would be no row and therefore nowhere for this card
 * to render (see `src/index.ts`).
 *
 * The Models page keeps its own editor, which for this namespace has no fields
 * to offer. This card is the real surface beside it: the pool's state, the
 * accounts and their balances, and the way through to the accounts page. It
 * deliberately does NOT duplicate the whole page — a row in a provider list is
 * a summary, and the full management surface is one click away.
 *
 * Styles ride the settings page's stylesheet (`wbp-` classes), injected once by
 * the client entry, so the card and the page it summarizes cannot drift apart
 * visually.
 *
 * @module dsh-workbuddy-connect/client/provider-card
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { WorkBuddyWebStatus } from '../status-paths.ts'
import { CARD_VARIANTS } from './card-variants.ts'
import type { WorkBuddyCardVariant } from './card-variants.ts'
import { ActionButton } from './ui-button.tsx'
import { Badge, StatTile, StatusDot } from './ui-rows.tsx'
import type { WorkBuddyTranslate } from './locales.ts'

/** Owner share of one provider-card occurrence, as the Models page supplies it. */
export interface ProviderCardOwnerProps {
  /** The card's directory row. */
  readonly provider: {
    readonly provider: string
    readonly displayName: string
    /** The settings namespace the row configures (the slot's dispatch key). */
    readonly settingsNs: string
    readonly settingsPath: readonly string[]
    readonly active: boolean
    readonly declared?: boolean
  }
  /** Whether any layer configures this provider (its profile resolves). */
  readonly configured: boolean
  /** Whether the row's referenced api-key credential is configured. */
  readonly keyConfigured: boolean
}

/** Props the registration's `inject` face hands the card. */
export interface WorkBuddyProviderCardProps extends Partial<ProviderCardOwnerProps> {
  t: WorkBuddyTranslate
}

/** How often the card re-reads its product while it is on screen. */
const REFRESH_INTERVAL_MS = 30_000

/**
 * Which variant this occurrence belongs to.
 *
 * The slot hands the card its directory row, so the provider id is the one
 * reliable answer; without a row (an older host that dispatches the slot with
 * no owner props) the card degrades to the first variant rather than refusing
 * to render.
 */
function variantFor(owner: Partial<ProviderCardOwnerProps> | undefined): WorkBuddyCardVariant {
  const id = owner?.provider?.provider
  return CARD_VARIANTS.find(variant => variant.id === id) ?? (CARD_VARIANTS[0] as WorkBuddyCardVariant)
}

/**
 * The card body. Reads its own product's status document, which is the same
 * route the accounts page and the dashboard read — one source, so the three
 * surfaces cannot disagree about a balance.
 */
export function WorkBuddyProviderCard(props: WorkBuddyProviderCardProps): ReactNode {
  const variant = variantFor(props)
  const { t } = props
  const [status, setStatus] = useState<WorkBuddyWebStatus>()
  const [failed, setFailed] = useState(false)
  const [reading, setReading] = useState(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const read = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (signal === undefined) setReading(true)
    try {
      const response = await fetch(variant.statusPath, {
        headers: { accept: 'application/json' },
        credentials: 'same-origin',
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        if (mounted.current && signal?.aborted !== true) setFailed(true)
        return
      }
      const next = await response.json() as WorkBuddyWebStatus
      if (!mounted.current || signal?.aborted === true) return
      setStatus(next)
      setFailed(false)
    } catch {
      // A card that cannot read says so quietly; the page it summarizes reports
      // the diagnosis.
      if (mounted.current && signal?.aborted !== true) setFailed(true)
    } finally {
      if (signal === undefined && mounted.current) setReading(false)
    }
  }, [variant.statusPath])

  useEffect(() => {
    const controller = new AbortController()
    void read(controller.signal)
    const tick = window.setInterval(() => { void read(controller.signal) }, REFRESH_INTERVAL_MS)
    return () => {
      window.clearInterval(tick)
      controller.abort()
    }
  }, [read])

  const accounts = status !== undefined && 'accounts' in status ? status.accounts?.accounts ?? [] : []
  const signedIn = status !== undefined && status.status === 'signed-in'
  const ready = accounts.filter(account => account.available).length
  const benched = accounts.filter(account => account.cooldown !== undefined && account.cooldown.untilMs > Date.now()).length
  const models = signedIn ? status.models?.length ?? 0 : 0

  return (
    <div className="wbp-providerCard">
      {failed && status === undefined ? (
        <p className="wbp-rowError">{t('requestFailed')}</p>
      ) : null}

      <div className="wbp-tiles">
        <StatTile
          label={t('cardAccounts')}
          value={String(accounts.length)}
          sub={accounts.length === 0 ? undefined : t('cardReady', { ready, total: accounts.length })}
        />
        <StatTile label={t('cardModels')} value={String(models)} />
        <StatTile
          label={t('cardBenched')}
          value={String(benched)}
          {...benched === 0 ? {} : { sub: t('accountStateLimited') }}
        />
      </div>

      {accounts.length === 0 ? (
        <p className="wbp-hint">{t('accountEmpty')}</p>
      ) : (
        <div className="wbp-accountList">
          {accounts.map(account => (
            <div className="wbp-modelRow" key={account.id}>
              <StatusDot
                tone={account.enabled !== true
                  ? 'off'
                  : account.sessionDead === true
                    ? 'error'
                    : account.available ? 'ok' : 'warn'}
                title={account.available ? t('accountStateReady') : t('accountStateLimited')}
              />
              <span className="wbp-modelName" title={account.name}>{account.name}</span>
              <span className="wbp-spacer" />
              {account.credits === undefined
                ? <span className="wbp-hint">{t('accountCreditsPending')}</span>
                : <Badge>{t('accountCredits', { total: new Intl.NumberFormat(undefined).format(account.credits) })}</Badge>}
            </div>
          ))}
        </div>
      )}

      {/*
        * The full surface stays one click away rather than being rebuilt here:
        * adding, removing, testing and re-enabling an account belong on the
        * page that owns them, and a provider row that tried to do all of it
        * would be a worse version of that page inside a list.
        */}
      <div className="wbp-inlineActions">
        {/*
          * A re-read, not a jump.
          *
          * The reference provider card is entirely self-contained — it never
          * navigates, because the settings shell exposes no navigation seam to a
          * plugin (the only settings-side service a client bundle can reach is
          * the section slot it is already inside). Inventing a URL scheme here
          * would be a button that appears to work and silently does nothing on
          * any host that routes differently, so the card offers the one action
          * it can actually perform.
          *
          * Managing the pool — adding, removing, enabling, testing — belongs to
          * the accounts page, which the user reaches from the settings
          * navigation the shell already draws for it.
          */}
        <ActionButton label={t('cardRefresh')} disabled={reading} onClick={() => { void read() }} />
      </div>
    </div>
  )
}

/**
 * The slot this card registers into, restated so the registration site is
 * checked against the exact contract.
 *
 * The slot belongs to `@deepseek-ai/dsh-client-ui-settings-models`, which
 * declares it and dispatches it once per provider row with
 * `entryKey = settingsNs`. That package is NOT a dependency of this bundle (its
 * types are not imported anywhere here), so unlike the panel's two slots there
 * is nothing to merge with — this declaration is the only thing that types the
 * registration, and it must stay structurally identical to upstream's or a host
 * carrying its own copy would fail the duplicate-merge check at runtime.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** One provider card's adapter extension area, keyed by the row's settingsNs. */
    'settings.models.provider-card': { kind: 'keyed', scope: 'root', owner: ProviderCardOwnerProps }
  }
}
