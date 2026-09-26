/**
 * Reading an account out of a pasted sign-in token.
 *
 * The token a user copies out of the WorkBuddy web console is a JWT, and its
 * payload already answers everything the pool needs — who the account is, what
 * it should be called, when it expires — so adding an account this way costs no
 * network round trip and cannot fail because an endpoint moved.
 *
 * Two things this module deliberately does *not* do:
 *
 * - **It verifies nothing.** A JWT's signature is the issuer's business; this
 *   code only reads claims. A forged token fails at the first real request,
 *   which is where a forged credential belongs, and pretending to validate
 *   here would mean shipping a second, weaker judge of the same question.
 * - **It invents a refresh token.** The console's token carries none, so a
 *   pasted account cannot renew itself; {@link WorkBuddyProfile.refreshToken}
 *   is always empty and the pool treats the account as usable until its `exp`.
 *
 * @module dsh-workbuddy-connect/account-token
 */

import { parseJsonObject } from './json-value.ts'

/** What a pasted token says about its account. */
export interface WorkBuddyProfile {
  /** The `sub` claim, which matches the uid the QR endpoint returns. */
  uid: string
  /** Display name: `nickname`, else `preferred_username`, else empty. */
  nickname?: string
  /** Enterprise the sign-in belongs to, when the token names one. */
  enterpriseId?: string
  /** Token expiry, epoch ms. 0 when the token carries no `exp`. */
  expiresAtMs: number
  /**
   * Login domain, inferred from the token's `iss`, so a pasted international
   * token is filed under the international variant rather than the CN one.
   *
   * Always present; empty means the issuer was not one this plugin recognises,
   * which the caller reports rather than guessing a region from.
   */
  domain: string
}

/**
 * Decode the payload segment of a JWT, without verifying it.
 *
 * @returns the parsed claims, or undefined when the value is not a JWT with a
 *   JSON object payload — which is what a truncated paste looks like.
 */
export function decodeTokenPayload(token: string): Record<string, unknown> | undefined {
  const parts = token.trim().split('.')
  // A JWS has three segments; a two-segment value is a JWE and its payload is
  // ciphertext, not claims.
  if (parts.length !== 3) return undefined
  const payload = parts[1]
  if (payload === undefined || payload === '') return undefined
  try {
    const base64 = payload.replace(/-/gu, '+').replace(/_/gu, '/')
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    // `atob` is available in both Node 22+ and the browser; decoding here rather
    // than with Buffer keeps this module loadable by the browser bundle too,
    // which matters because the dialog previews the name before submitting.
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    const text = new TextDecoder().decode(bytes)
    return parseJsonObject(text)
  } catch {
    return undefined
  }
}

/** Read one claim as a trimmed non-empty string. */
function claim(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key]
  if (typeof value !== 'string') return undefined
  // Real tokens carry control characters around the nickname, which would
  // otherwise be stored and rendered as part of the account's name. This is not
  // hypothetical: the live CN token's `nickname` starts with U+00A0.
  const trimmed = value.replace(/[\u0000-\u001f\u007f\u00a0\u200b-\u200d\ufeff]/gu, ' ').trim()
  return trimmed === '' ? undefined : trimmed
}

/**
 * The login domain a token's issuer implies.
 *
 * The CN console issues under `https://www.workbuddy.cn/auth/realms/copilot`
 * and the international one under a `workbuddy.ai` host, so the issuer is what
 * tells the two products apart when a user pastes a token into the wrong
 * dialog. Matching is on the host suffix, not the whole string, because the
 * realm path is not part of the contract this plugin relies on.
 */
export function domainForIssuer(issuer: string | undefined): string | undefined {
  if (issuer === undefined) return undefined
  let host: string
  try {
    host = new URL(issuer).host.toLowerCase()
  } catch {
    return undefined
  }
  if (host === 'workbuddy.ai' || host.endsWith('.workbuddy.ai')) return 'www.workbuddy.ai'
  if (host === 'workbuddy.cn' || host.endsWith('.workbuddy.cn')) return 'www.workbuddy.cn'
  return undefined
}

/**
 * Read the account a pasted token describes.
 *
 * @returns the profile, or undefined when the value has no readable `sub` —
 *   the one claim the pool cannot work without, because it is the account's
 *   identity.
 */
export function profileFromToken(token: string): WorkBuddyProfile | undefined {
  const payload = decodeTokenPayload(token)
  if (payload === undefined) return undefined
  const uid = claim(payload, 'sub')
  if (uid === undefined) return undefined
  const nickname = claim(payload, 'nickname') ?? claim(payload, 'preferred_username')
  const exp = payload['exp']
  const expiresAtMs = typeof exp === 'number' && Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0
  const enterpriseId = claim(payload, 'enterpriseId') ?? claim(payload, 'enterprise_id')
  const domain = domainForIssuer(claim(payload, 'iss'))
  return {
    uid,
    ...nickname === undefined ? {} : { nickname },
    ...enterpriseId === undefined ? {} : { enterpriseId },
    expiresAtMs,
    domain: domain ?? '',
  }
}
