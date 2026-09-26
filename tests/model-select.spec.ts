/**
 * The model picker's data shaping.
 *
 * Ported alongside the picker itself (see the module header): the rules that
 * decide what the search matches, which selections count as retired, and how a
 * click changes the set are the picker's actual behaviour, so they are tested
 * here as plain functions rather than through the DOM.
 */
import { describe, expect, it } from 'vitest'
import {
  buildModelSelectOptions,
  catalogIsReady,
  groupModelSelectOptions,
  matchesModelQuery,
  staleModelIds,
  toggleModelSelection,
} from '../src/client/model-select.ts'

const CATALOG = [
  { id: 'glm-5.3', name: 'GLM-5.3' },
  { id: 'hy4-preview', name: 'Hy4 preview' },
  { id: 'glm-5.1', name: 'GLM-5.1' },
]

describe('matchesModelQuery', () => {
  it('matches id or display name, case-insensitively, and everything on a blank query', () => {
    expect(matchesModelQuery(CATALOG[0]!, '')).toBe(true)
    expect(matchesModelQuery(CATALOG[0]!, '   ')).toBe(true)
    expect(matchesModelQuery(CATALOG[0]!, 'GLM')).toBe(true)
    expect(matchesModelQuery(CATALOG[1]!, 'preview')).toBe(true)
    expect(matchesModelQuery(CATALOG[1]!, 'hy4')).toBe(true)
    expect(matchesModelQuery(CATALOG[2]!, 'glm-5.3')).toBe(false)
  })
})

describe('buildModelSelectOptions', () => {
  it('lists the catalog in its own order, unmarked', () => {
    expect(buildModelSelectOptions(CATALOG, [])).toEqual([
      { value: 'glm-5.3', label: 'GLM-5.3', stale: false },
      { value: 'hy4-preview', label: 'Hy4 preview', stale: false },
      { value: 'glm-5.1', label: 'GLM-5.1', stale: false },
    ])
  })

  it('keeps a selected id the catalog no longer carries, flagged and last', () => {
    const options = buildModelSelectOptions(CATALOG, ['glm-5.3', 'retired-model'])
    expect(options.at(-1)).toEqual({ value: 'retired-model', label: 'retired-model', stale: true })
    // The live row it also names stays a live row, once.
    expect(options.filter(option => option.value === 'glm-5.3')).toHaveLength(1)
  })

  it('filters live and retired rows together by the query', () => {
    const options = buildModelSelectOptions(CATALOG, ['retired-model'], 'retired')
    expect(options).toEqual([{ value: 'retired-model', label: 'retired-model', stale: true }])
    // A search for a live model must not surface unrelated retired ids.
    expect(buildModelSelectOptions(CATALOG, ['retired-model'], 'glm').map(option => option.value))
      .toEqual(['glm-5.3', 'glm-5.1'])
  })

  it('ignores blank and repeated selections instead of rendering duplicate menu ids', () => {
    const options = buildModelSelectOptions(CATALOG, ['', 'glm-5.3', 'glm-5.3'])
    expect(options).toHaveLength(3)
  })
})

describe('groupModelSelectOptions', () => {
  it('renders one unheaded group when nothing is ranked (WorkBuddy today)', () => {
    const groups = groupModelSelectOptions(buildModelSelectOptions(CATALOG, []), () => undefined)
    expect(groups).toHaveLength(1)
    expect(groups[0]?.heading).toBeUndefined()
    expect(groups[0]?.options).toHaveLength(3)
  })

  it('merges repeats of one heading and leaves retired ids unheaded', () => {
    const options = buildModelSelectOptions(CATALOG, ['retired-model'])
    const groups = groupModelSelectOptions(options, id => id === 'glm-5.3' || id === 'glm-5.1' ? 'GLM' : id === 'hy4-preview' ? 'Hy' : undefined)
    expect(groups.map(group => group.heading)).toEqual(['GLM', 'Hy', undefined])
    expect(groups[0]?.options.map(option => option.value)).toEqual(['glm-5.3', 'glm-5.1'])
  })
})

describe('toggleModelSelection', () => {
  it('appends an absent id and removes a present one', () => {
    expect(toggleModelSelection(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggleModelSelection(['a', 'b'], 'a')).toEqual(['b'])
    // Removing the last one is allowed HERE: whether an empty list is legal is
    // the caller's policy (an empty allowlist means "no filter" to WorkBuddy's
    // host, which is what makes the picker refuse the click instead).
    expect(toggleModelSelection(['a'], 'a')).toEqual([])
  })
})

describe('catalog readiness and retired ids', () => {
  it('refuses to call anything retired while the catalog is empty or failed', () => {
    expect(catalogIsReady({ catalogIds: [], catalogFailed: false })).toBe(false)
    expect(catalogIsReady({ catalogIds: ['a'], catalogFailed: true })).toBe(false)
    expect(catalogIsReady({ catalogIds: ['a'], catalogFailed: false })).toBe(true)
  })

  it('names the selected ids outside the catalog, in selection order', () => {
    expect(staleModelIds(['a', 'gone-1', 'b', 'gone-2'], { catalogIds: ['a', 'b'], catalogFailed: false }))
      .toEqual(['gone-1', 'gone-2'])
  })
})
