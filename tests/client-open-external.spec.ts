// @vitest-environment jsdom
/**
 * The sign-in hand-off: which strategies run, in what order, and what happens
 * when the ones in front of them silently do nothing.
 *
 * The desktop failure this guards against is invisible — the shell answers
 * `window.open` with nothing at all — so the assertions are about the
 * *chain*: that a strategy which cannot work is skipped, that one which returns
 * without opening anything is not treated as success, and that the link never
 * reaches a launcher unless it is http(s).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { isExternalWebLink, openExternalLink } from '../src/client/open-external.ts'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** A host route answer. */
function answer(state: string, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => ({ state }) } as unknown as Response
}

describe('isExternalWebLink', () => {
  it('admits only absolute http(s)', () => {
    expect(isExternalWebLink('https://copilot.tencent.com/login?platform=CLI')).toBe(true)
    expect(isExternalWebLink('http://127.0.0.1/app')).toBe(true)
    expect(isExternalWebLink('file:///etc/passwd')).toBe(false)
    expect(isExternalWebLink('javascript:alert(1)')).toBe(false)
    expect(isExternalWebLink('/relative')).toBe(false)
    expect(isExternalWebLink('')).toBe(false)
  })
})

describe('openExternalLink', () => {
  it('prefers a real browser tab when the window API works', async () => {
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    const send = vi.fn()
    const url = 'https://copilot.tencent.com/login?state=abc'
    await expect(openExternalLink(url, { key: 'k', probePath: '/p', fetch: send as unknown as typeof fetch }))
      .resolves.toBe(true)
    expect(opened).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer')
    // The window API already claimed it; asking the host too would open the page
    // twice in the web GUI.
    expect(send).not.toHaveBeenCalled()
  })

  it('falls through to the host when window.open throws', async () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('blocked') }))
    const send = vi.fn(async () => answer('opened'))
    const url = 'https://www.workbuddy.ai/login?state=x'
    await expect(openExternalLink(url, { key: 'k', probePath: '/probe', fetch: send as unknown as typeof fetch }))
      .resolves.toBe(true)
    expect(send).toHaveBeenCalledTimes(1)
    const [path, init] = send.mock.calls[0] as unknown as [string, RequestInit]
    expect(path).toBe('/probe')
    expect((init.headers as Record<string, string>)['X-WorkBuddy-Probe-Key']).toBe('k')
    expect(JSON.parse(String(init.body))).toEqual({ action: 'open-link', url })
  })

  it('keeps going when the host refuses, and reports failure when nothing works', async () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('blocked') }))
    const send = vi.fn(async () => answer('failed', false))
    // No sidebar context either: the last strategy is the anchor, and this is
    // the case the caller has to be told about.
    const result = await openExternalLink('https://example.com/login', {
      key: 'k',
      probePath: '/probe',
      fetch: send as unknown as typeof fetch,
      document: { createElement: () => { throw new Error('no anchor') } } as unknown as Document,
    })
    expect(result).toBe(false)
  })

  it('uses the sidebar browser when the host route is unavailable', async () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('blocked') }))
    const openTab = vi.fn()
    const context = {
      get: (name: string) => name === 'sidebarRightTabs'
        ? { get: (kind: string) => kind === 'browser' ? { kind } : undefined }
        : { openTab },
    }
    await expect(openExternalLink('https://example.com/login', { context })).resolves.toBe(true)
    expect(openTab).toHaveBeenCalledWith('browser', {
      params: { url: 'https://example.com/login' },
      revealIfOpened: true,
    })
  })

  it('skips the host route when the page has no key or no route', async () => {
    vi.stubGlobal('open', vi.fn(() => { throw new Error('blocked') }))
    const send = vi.fn()
    const options = { fetch: send as unknown as typeof fetch, document: { createElement: () => { throw new Error('no anchor') } } as unknown as Document }
    await expect(openExternalLink('https://example.com/login', { ...options, key: 'k' })).resolves.toBe(false)
    await expect(openExternalLink('https://example.com/login', { ...options, probePath: '/p' })).resolves.toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('refuses a non-web link before any strategy runs', async () => {
    const opened = vi.fn()
    vi.stubGlobal('open', opened)
    const send = vi.fn()
    await expect(openExternalLink('file:///etc/passwd', { key: 'k', probePath: '/p', fetch: send as unknown as typeof fetch }))
      .resolves.toBe(false)
    expect(opened).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
