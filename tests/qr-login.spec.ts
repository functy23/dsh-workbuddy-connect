import { describe, expect, it, vi } from 'vitest'
import { WorkBuddyQrLogin } from '../src/qr-login.ts'
import { AI_VARIANT, CN_VARIANT } from '../src/variants.ts'

/**
 * The QR sign-in protocol, driven against a stubbed fetch.
 *
 * The wire details asserted here are the ones the real endpoints were observed
 * to require (verified live against both products): the `platform=CLI` query,
 * the CLI User-Agent, and — the part that is easy to get wrong — a non-zero
 * business code (`11217`) meaning "the user has not scanned yet", not "failed".
 */

interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}

/** A fetch that answers the three endpoints in sequence. */
function stubFetch(overrides: {
  state?: unknown
  token?: unknown
  account?: unknown
  tokenStatus?: number
} = {}): { calls: Call[], fetch: typeof fetch } {
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input)
    const headers = (init?.headers ?? {}) as Record<string, string>
    calls.push({ url, method: init?.method ?? 'GET', headers, ...init?.body === undefined ? {} : { body: String(init.body) } })
    const answer = (payload: unknown, status = 200): Response => new Response(JSON.stringify(payload), { status })
    if (url.includes('/v2/plugin/auth/state')) {
      return answer(overrides.state ?? {
        code: 0,
        msg: 'OK',
        data: { state: 'state-1', authUrl: 'https://copilot.tencent.com/login?platform=CLI&state=state-1' },
      })
    }
    if (url.includes('/v2/plugin/auth/token')) {
      return answer(overrides.token ?? { code: 11217, msg: '11217:login ing...' }, overrides.tokenStatus ?? 200)
    }
    if (url.includes('/v2/plugin/login/account')) {
      return answer(overrides.account ?? { code: 0, msg: 'OK', data: { uid: 'u-1', nickname: '昵称', enterpriseId: 'ent' } })
    }
    return answer({ code: -1, msg: 'unexpected url' }, 404)
  }) as unknown as typeof fetch
  return { calls, fetch: fetchImpl }
}

const READY_TOKEN = {
  code: 0,
  msg: 'OK',
  data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, domain: 'copilot.tencent.com' },
}

describe('QR sign-in', () => {
  it('mints a challenge with the CLI query, UA, and origin the endpoint requires', async () => {
    const { calls, fetch } = stubFetch()
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    const challenge = await qr.start()
    expect(challenge.authUrl).toContain('state-1')
    const call = calls[0] as Call
    expect(call.url).toContain('/v2/plugin/auth/state?platform=CLI')
    expect(call.method).toBe('POST')
    // The upstream checks the UA; without it the endpoint refuses.
    expect(call.headers['User-Agent']).toBe('CLI/2.63.2 CodeBuddy/2.63.2')
    expect(call.headers['Origin']).toBe('https://www.codebuddy.cn')
    expect(call.body).toBe('{}')
  })

  it('reports "waiting" for the normal not-yet-scanned answer', async () => {
    const { fetch } = stubFetch()
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    const { state } = await qr.start()
    // code 11217 with no token is the user not having scanned yet: a state of
    // the flow, not an error to surface.
    await expect(qr.poll(state)).resolves.toEqual({ status: 'waiting' })
  })

  it('refuses to poll a state this process never minted', async () => {
    const { calls, fetch } = stubFetch()
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    await expect(qr.poll('made-up')).resolves.toEqual({ status: 'invalid' })
    expect(calls).toHaveLength(0)
  })

  it('expires a challenge past its TTL without asking upstream again', async () => {
    let now = 1_000_000
    const { calls, fetch } = stubFetch()
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch, now: () => now })
    const { state } = await qr.start()
    now += 6 * 60_000
    await expect(qr.poll(state)).resolves.toEqual({ status: 'expired' })
    expect(calls).toHaveLength(1)
  })

  it('completes with the uid, tokens, and expiry once the scan lands', async () => {
    const { fetch } = stubFetch({ token: READY_TOKEN })
    const now = 1_700_000_000_000
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch, now: () => now })
    const { state } = await qr.start()
    const poll = await qr.poll(state)
    expect(poll).toMatchObject({
      status: 'ready', uid: 'u-1', nickname: '昵称', enterpriseId: 'ent',
      domain: 'copilot.tencent.com', accessToken: 'at', refreshToken: 'rt',
      expiresAtMs: now + 3_600_000,
    })
  })

  it('sends the fresh access token when asking who signed in', async () => {
    const { calls, fetch } = stubFetch({ token: READY_TOKEN })
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    const { state } = await qr.start()
    await qr.poll(state)
    const account = calls.find(call => call.url.includes('/v2/plugin/login/account')) as Call
    expect(account.headers['Authorization']).toBe('Bearer at')
  })

  it('keeps waiting when the token lands but the account call has no uid yet', async () => {
    const { fetch } = stubFetch({ token: READY_TOKEN, account: { code: 0, msg: 'OK', data: {} } })
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    const { state } = await qr.start()
    await expect(qr.poll(state)).resolves.toEqual({ status: 'waiting' })
  })

  it('stops polling a state once it has been consumed', async () => {
    const { fetch } = stubFetch({ token: READY_TOKEN })
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    const { state } = await qr.start()
    await qr.poll(state)
    // A second poll must not be able to mint a second account from one scan.
    await expect(qr.poll(state)).resolves.toEqual({ status: 'invalid' })
  })

  it('forgets a cancelled challenge', async () => {
    const { fetch } = stubFetch()
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    const { state } = await qr.start()
    qr.cancel(state)
    await expect(qr.poll(state)).resolves.toEqual({ status: 'invalid' })
  })

  it('refuses a scan that belongs to the other product', async () => {
    // The international variant mints against its own host; a credential
    // carrying the CN domain means the user scanned the wrong app's code, and
    // adopting it would build a pool whose every request is refused.
    const { fetch } = stubFetch({
      token: { code: 0, msg: 'OK', data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, domain: 'copilot.tencent.com' } },
    })
    const qr = new WorkBuddyQrLogin({ variant: AI_VARIANT, fetch })
    const { state } = await qr.start()
    await expect(qr.poll(state)).rejects.toThrow(/WorkBuddy \(CN\)/)
  })

  it('points the international variant at its own host and origin', async () => {
    const { calls, fetch } = stubFetch()
    const qr = new WorkBuddyQrLogin({ variant: AI_VARIANT, fetch })
    await qr.start()
    const call = calls[0] as Call
    expect(call.url).toContain('https://www.workbuddy.ai/v2/plugin/auth/state')
    expect(call.headers['Origin']).toBe('https://www.workbuddy.ai')
  })

  it('defaults the international domain when the token answer omits one', async () => {
    const { fetch } = stubFetch({
      token: { code: 0, msg: 'OK', data: { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 } },
    })
    const qr = new WorkBuddyQrLogin({ variant: AI_VARIANT, fetch })
    const { state } = await qr.start()
    const poll = await qr.poll(state)
    expect(poll).toMatchObject({ status: 'ready', domain: 'workbuddy.ai' })
  })

  it('reports a failed start rather than returning a broken challenge', async () => {
    const { fetch } = stubFetch({ state: { code: 500, msg: 'boom' } })
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch })
    await expect(qr.start()).rejects.toThrow(/could not obtain an authorization link/)
  })

  it('reports a non-JSON answer instead of pretending the flow started', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>401</html>', { status: 401 })) as unknown as typeof fetch
    const qr = new WorkBuddyQrLogin({ variant: CN_VARIANT, fetch: fetchImpl })
    await expect(qr.start()).rejects.toThrow(/non-JSON/)
  })
})
