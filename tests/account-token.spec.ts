import { afterEach, describe, expect, it } from 'vitest'
import { decodeTokenPayload, domainForIssuer, profileFromToken } from '../src/account-token.ts'
import { WorkBuddyAccountPool } from '../src/account-pool.ts'
import { WorkBuddyAccountService } from '../src/account-service.ts'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

/**
 * Reading an account out of a pasted sign-in token.
 *
 * This is the only route into the international product and the fallback route
 * into the CN one, and it is pure decoding — so it is also the part where a
 * wrong claim name or a mangled base64 would produce an account that looks fine
 * and fails at the first request. The fixtures below are shaped like the real
 * tokens, including the control character the live CN token carries at the
 * front of its nickname.
 */

/** Build an unsigned JWT with the given claims. */
function jwt(claims: Record<string, unknown>): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
  return `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode(claims)}.signature`
}

const CN_ISSUER = 'https://www.workbuddy.cn/auth/realms/copilot'
const AI_ISSUER = 'https://www.workbuddy.ai/auth/realms/copilot'

describe('profileFromToken', () => {
  it('reads the uid, name, expiry, and region out of a CN token', () => {
    const profile = profileFromToken(jwt({
      sub: 'cd37aae0-2e1a-4551-867f-c8f897bb44a8',
      nickname: '微信支付',
      iss: CN_ISSUER,
      exp: 1_794_242_287,
    }))
    expect(profile).toEqual({
      uid: 'cd37aae0-2e1a-4551-867f-c8f897bb44a8',
      nickname: '微信支付',
      expiresAtMs: 1_794_242_287_000,
      domain: 'www.workbuddy.cn',
    })
  })

  /**
   * The live token's nickname begins with a no-break space, which would be
   * stored and then rendered as part of the account's name.
   */
  it('strips the control characters the real tokens carry around the nickname', () => {
    const profile = profileFromToken(jwt({ sub: 'u', nickname: '\u00a0微信支付\u200b', iss: CN_ISSUER }))
    expect(profile?.nickname).toBe('微信支付')
  })

  it('falls back to preferred_username when there is no nickname', () => {
    const profile = profileFromToken(jwt({ sub: 'u', preferred_username: '19224837177', iss: CN_ISSUER }))
    expect(profile?.nickname).toBe('19224837177')
  })

  it('reports the international region for an international issuer', () => {
    expect(profileFromToken(jwt({ sub: 'u', iss: AI_ISSUER }))?.domain).toBe('www.workbuddy.ai')
  })

  it('leaves the region empty for an issuer it does not recognise', () => {
    // Empty rather than guessed: filing the token under a product by default
    // would pool a credential every request is guaranteed to be refused for.
    expect(profileFromToken(jwt({ sub: 'u', iss: 'https://example.com/auth' }))?.domain).toBe('')
  })

  it('treats a missing exp as unknown rather than expired', () => {
    expect(profileFromToken(jwt({ sub: 'u', iss: CN_ISSUER }))?.expiresAtMs).toBe(0)
  })

  it('refuses a value that is not a decodable JWT', () => {
    for (const value of ['', 'not-a-token', 'aaa.bbb', 'aaa.bbb.ccc', 'a.b.c']) {
      expect(profileFromToken(value)).toBeUndefined()
    }
    // Two segments is a JWE: its payload is ciphertext, not claims.
    expect(decodeTokenPayload('aaa.bbb')).toBeUndefined()
  })

  it('refuses a token with no sub, which is the identity the pool keys on', () => {
    expect(profileFromToken(jwt({ nickname: 'x', iss: CN_ISSUER }))).toBeUndefined()
  })

  it('reads the host suffix rather than the whole issuer string', () => {
    expect(domainForIssuer('https://www.workbuddy.cn/anything')).toBe('www.workbuddy.cn')
    expect(domainForIssuer('https://workbuddy.ai')).toBe('www.workbuddy.ai')
    expect(domainForIssuer('not a url')).toBeUndefined()
    expect(domainForIssuer(undefined)).toBeUndefined()
  })
})

describe('adding a pasted token to the pool', () => {
  const CLEANUP: (() => Promise<void>)[] = []
  afterEach(async () => { await Promise.all(CLEANUP.splice(0).map(clean => clean())) })

  async function serviceFor(variant: typeof CN_VARIANT): Promise<{
    service: WorkBuddyAccountService
    pool: WorkBuddyAccountPool
  }> {
    const dir = await mkdtemp(join(tmpdir(), 'wb-cookie-'))
    CLEANUP.push(() => rm(dir, { recursive: true, force: true }))
    const pool = new WorkBuddyAccountPool({ variant, path: join(dir, 'accounts.json') })
    const service = new WorkBuddyAccountService({
      variant,
      pool,
      store: { desktopCredential: async () => undefined, current: async () => undefined } as never,
      client: { fetchCredits: async () => ({ total: 0, accounts: [] }), refreshToken: async () => ({ accessToken: 'x' }) } as never,
      qr: { start: async () => { throw new Error('unused') }, poll: async () => ({ status: 'invalid' }), cancel: () => {} } as never,
    })
    return { service, pool }
  }

  it('pools the account with no refresh token, so it cannot pretend to renew', async () => {
    const { service, pool } = await serviceFor(CN_VARIANT)
    const result = service.addCookieAccount(jwt({ sub: 'u-1', nickname: '粘贴的账号', iss: CN_ISSUER, exp: 2_000_000_000 }))
    expect(result.created).toBe(true)
    expect(result.account?.origin).toBe('cookie')
    expect(result.account?.refreshToken).toBe('')
    expect(result.account?.nickname).toBe('粘贴的账号')
    expect(pool.list()).toHaveLength(1)
  })

  it('replaces the token of an account that is already pooled instead of duplicating it', async () => {
    const { service, pool } = await serviceFor(CN_VARIANT)
    service.addCookieAccount(jwt({ sub: 'u-1', iss: CN_ISSUER, exp: 1 }))
    const second = service.addCookieAccount(jwt({ sub: 'u-1', iss: CN_ISSUER, exp: 2 }))
    expect(second.created).toBe(false)
    expect(pool.list()).toHaveLength(1)
    expect(pool.list()[0]?.expiresAtMs).toBe(2_000)
  })

  /**
   * The same refusal the desktop file gets. Accepting the other product's token
   * would pool a credential every request is guaranteed to be refused for, and
   * nothing in the card would explain why.
   */
  it('refuses the other product\'s token and says which dialog it belongs in', async () => {
    const { service, pool } = await serviceFor(AI_VARIANT)
    const refused = service.addCookieAccount(jwt({ sub: 'u-1', iss: CN_ISSUER }))
    expect(refused.account).toBeUndefined()
    expect(refused.reason).toMatch(/WorkBuddy \(CN\)/)
    expect(pool.list()).toHaveLength(0)
  })

  it('refuses an unrecognised issuer rather than assuming a region', async () => {
    const { service, pool } = await serviceFor(CN_VARIANT)
    const refused = service.addCookieAccount(jwt({ sub: 'u-1', iss: 'https://example.com/x' }))
    expect(refused.account).toBeUndefined()
    expect(refused.reason).toMatch(/does not recognise/)
    expect(pool.list()).toHaveLength(0)
  })

  it('refuses junk without throwing', async () => {
    const { service } = await serviceFor(CN_VARIANT)
    expect(service.addCookieAccount('not-a-token').account).toBeUndefined()
    expect(service.addCookieAccount('').account).toBeUndefined()
  })

  it('reports a pasted account as non-renewable in the card view', async () => {
    const { service } = await serviceFor(CN_VARIANT)
    service.addCookieAccount(jwt({ sub: 'u-1', iss: CN_ISSUER }))
    const snapshot = await service.snapshot()
    expect(snapshot.accounts[0]?.renewable).toBe(false)
    expect(snapshot.accounts[0]?.origin).toBe('cookie')
  })
})
