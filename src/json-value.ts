/**
 * The one shape predicate every parser in this plugin shares.
 *
 * A decoded JSON value is only safe to index when it is a plain object: `null`
 * is a valid JSON document, an array is one too, and a scalar is one as well.
 * Each of those reaches a `wrapped['field']` read as a TypeError, or worse,
 * silently as `undefined` — so every site that reads a field off parsed text
 * has to say the same thing first. Saying it once here is what keeps a new
 * route, store or decoder from having to remember it.
 *
 * @module dsh-workbuddy-connect/json-value
 */

/**
 * Whether a decoded value is a plain JSON object.
 *
 * Arrays are excluded deliberately rather than incidentally: `typeof []`
 * is `'object'`, so a check that forgets them lets a response shaped as a
 * list be indexed by field name.
 */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Parse JSON text into a plain object, or `undefined` when it is anything else.
 *
 * Covers both halves of the failure in one call — text that is not JSON at all
 * (an edge gateway's HTML error page, a proxy's login form) and JSON of the
 * wrong shape — because every caller in this plugin degrades the same way:
 * treat the body as absent and let its own default stand.
 *
 * @param text - the raw body, already decoded to a string.
 */
export function parseJsonObject(text: string): Record<string, unknown> | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  return isJsonObject(parsed) ? parsed : undefined
}
