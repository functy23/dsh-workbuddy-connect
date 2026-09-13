/**
 * The account-pool CLI: read-only inspection of what the pool holds and which
 * account a variant would use right now.
 *
 * Read-only on purpose. Adding an account is a QR scan (a phone is required)
 * and the rest of the mutations are one click in the card, so a CLI that could
 * delete credentials would be a foot-gun with no workflow behind it.
 *
 * @module dsh-workbuddy-connect/account-cli
 */

import type { WorkBuddyAccountPool } from './account-pool.ts'
import type { WorkBuddyAccountService } from './account-service.ts'
import type { WorkBuddyVariant } from './variants.ts'

/** One row of the human-readable listing. */
function describeCooldown(untilMs: number, reason: string, now: number): string {
  const remaining = Math.max(0, untilMs - now)
  const minutes = Math.ceil(remaining / 60_000)
  const label = reason === 'credit' ? '额度耗尽' : reason === 'session' ? '会话失效' : '限流'
  return `${label}，${minutes} 分钟后重试`
}

/** Render the pool as one text block per account. */
export function formatAccounts(options: {
  variant: WorkBuddyVariant
  snapshot: Awaited<ReturnType<WorkBuddyAccountService['snapshot']>>
  pool: WorkBuddyAccountPool
  now?: number
}): string {
  const now = options.now ?? Date.now()
  const { snapshot, pool } = options
  const lines: string[] = []
  const desktop = snapshot.desktop
  const primary = snapshot.primary
  lines.push(`${options.variant.displayName}: ${snapshot.accounts.length} account(s) in the pool`)
  if (snapshot.accounts.length === 0) {
    lines.push('  (empty) add one by QR from the plugin card, or sign in to the desktop app')
    return lines.join('\n')
  }
  for (const [index, account] of snapshot.accounts.entries()) {
    const marks = [
      account.id === primary ? 'primary' : undefined,
      account.id === desktop ? 'desktop' : undefined,
      account.origin === 'qr' ? 'qr' : undefined,
      account.enabled ? undefined : 'disabled',
      account.sessionDead === true ? 'session-dead' : undefined,
    ].filter((mark): mark is string => mark !== undefined)
    const balance = account.credits === undefined
      ? account.creditsError === undefined ? 'credit unknown' : `credit unavailable (${account.creditsError})`
      : `credit ${account.credits}`
    const expiry = account.expiresAtMs > 0
      ? `token expires ${new Date(account.expiresAtMs).toISOString()}`
      : 'token expiry unknown'
    const benched = account.cooldown === undefined
      ? undefined
      : describeCooldown(account.cooldown.untilMs, account.cooldown.reason, now)
    lines.push([
      `  ${index + 1}. ${account.name}`,
      balance,
      expiry,
      ...marks.length === 0 ? [] : [marks.join(', ')],
      ...benched === undefined ? [] : [benched],
    ].join(' · '))
  }
  const disabled = pool.list().filter(account => !account.enabled).length
  const benched = pool.list().filter(account => account.cooldown !== undefined && account.cooldown.untilMs > now).length
  lines.push(`  ${pool.list().length - disabled - benched} available · ${benched} benched · ${disabled} disabled`)
  return lines.join('\n')
}

/** The machine-readable shape, secret-free by construction. */
export function accountsJson(options: {
  variant: WorkBuddyVariant
  snapshot: Awaited<ReturnType<WorkBuddyAccountService['snapshot']>>
  pool: WorkBuddyAccountPool
}): Record<string, unknown> {
  return {
    provider: options.variant.id,
    displayName: options.variant.displayName,
    accountsFile: options.pool.filePath(),
    total: options.snapshot.accounts.length,
    primary: options.snapshot.primary,
    desktop: options.snapshot.desktop,
    accounts: options.snapshot.accounts.map(account => ({
      id: account.id,
      name: account.name,
      origin: account.origin,
      enabled: account.enabled,
      available: account.available,
      ...account.credits === undefined ? {} : { credits: account.credits },
      ...account.creditsError === undefined ? {} : { creditsError: account.creditsError },
      ...account.expiresAtMs > 0 ? { accessTokenExpires: new Date(account.expiresAtMs).toISOString() } : {},
      ...account.sessionDead === true ? { sessionDead: true } : {},
      ...account.cooldown === undefined ? {} : {
        cooldown: {
          until: new Date(account.cooldown.untilMs).toISOString(),
          reason: account.cooldown.reason,
          strikes: account.cooldown.strikes,
        },
      },
    })),
  }
}
