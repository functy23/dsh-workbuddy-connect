/**
 * Model-select helpers for the settings page's model picker (browser half).
 *
 * Ported from the Command Code provider's `model-select.ts` and kept
 * dependency-free and React-free for the same two reasons: the data shaping is
 * what the picker's behaviour actually is (what the search matches, which
 * selections count as retired, how a click changes the set), so node tests can
 * drive it directly; and the browser half may only import platform/seed
 * modules, so a helper module with no imports stays portable.
 *
 * What is WorkBuddy's rather than Command Code's:
 *
 * - there are no plan tiers here. The upstream publishes one roster per product
 *   and nothing that ranks models into tiers, so the dropdown is ungrouped —
 *   {@link groupModelSelectOptions} is kept but called with a `tierOf` that
 *   answers `undefined` for everything, which is what lets a future grouping
 *   land without rewriting the picker;
 * - a selection belongs to one ACCOUNT (the `uid:enterpriseId` bucket the
 *   host keys visibility by), not to a routing rule, which is why the picker
 *   component in the settings page passes the account's own list through.
 *
 * @module dsh-workbuddy-connect/client/model-select
 */

/** One selectable catalog model: the host's own model row, narrowed to what a picker shows. */
export interface SelectableModel {
  /** Catalog model id. */
  id: string
  /** Display name from the catalog. */
  name: string
}

/** One dropdown row: a live catalog model or a selection the catalog no longer carries. */
export interface ModelSelectOption {
  /** Catalog model id (retired ids keep their raw id as the value). */
  value: string
  /** Display name (retired ids fall back to the raw id). */
  label: string
  /** True when the id is selected but the catalog no longer carries it. */
  stale: boolean
}

/** One dropdown section: an optional heading plus its rows. */
export interface ModelSelectGroup {
  /** Section heading, or undefined for rows outside every known group. */
  heading: string | undefined
  /** Rows in this section, in picker order. */
  options: ModelSelectOption[]
}

/**
 * Whether `text` matches `query` as a case-insensitive substring over the
 * model id AND display name. An empty/blank query matches everything.
 */
export function matchesModelQuery(model: SelectableModel, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return model.id.toLowerCase().includes(needle)
    || model.name.toLowerCase().includes(needle)
}

/**
 * Build the dropdown options: the catalog (already in picker order) plus any
 * selected id the catalog no longer carries, flagged stale so the UI can mark
 * it — a saved selection never silently loses an entry, and the user can see
 * which ones went stale upstream.
 *
 * When `query` is non-blank, catalog rows are filtered by
 * {@link matchesModelQuery}; stale rows are kept only while they match too, so
 * a search for a live model does not surface unrelated retired ids.
 */
export function buildModelSelectOptions(
  catalog: readonly SelectableModel[],
  selected: readonly string[],
  query = '',
): ModelSelectOption[] {
  const catalogIds = new Set(catalog.map(model => model.id))
  const options = catalog
    .filter(model => matchesModelQuery(model, query))
    .map(model => ({ value: model.id, label: model.name, stale: false }))
  // Dedupe defensively (order-preserving): the stored list is hand-editable, so
  // a repeated or blank id is possible, and duplicate Menu ids would confuse
  // the selection state the dropdown renders.
  const seen = new Set(catalogIds)
  for (const id of selected) {
    if (id === '' || seen.has(id)) continue
    seen.add(id)
    if (catalogIds.has(id)) continue
    if (!matchesModelQuery({ id, name: id }, query)) continue
    options.push({ value: id, label: id, stale: true })
  }
  return options
}

/**
 * Group dropdown options under headings (`headingOf` maps a model id to its
 * heading, or undefined for ungrouped rows).
 *
 * WorkBuddy has no tiers today, so every caller passes a function that answers
 * `undefined`: the group is then exactly one trailing section, which is what
 * the dropdown renders when it is handed a single group. The mechanism stays
 * because the alternative — an ungrouped flat list with a separate code path —
 * is the thing that has to be rewritten the day the upstream does rank its
 * models. Retired ids always render unheaded (their group is unknowable).
 */
export function groupModelSelectOptions(
  options: readonly ModelSelectOption[],
  headingOf: (modelId: string) => string | undefined,
): ModelSelectGroup[] {
  const groups: ModelSelectGroup[] = []
  const byHeading = new Map<string | undefined, ModelSelectGroup>()
  for (const option of options) {
    const heading = option.stale ? undefined : headingOf(option.value)
    let group = byHeading.get(heading)
    if (group === undefined) {
      group = { heading, options: [] }
      byHeading.set(heading, group)
      groups.push(group)
    }
    group.options.push(option)
  }
  return groups
}

/**
 * Toggle one model id in a selection: remove it when present, append it when
 * absent.
 *
 * A plain set operation with no policy of its own. The "never leave the list
 * empty" rule belongs to the caller, because what an empty list MEANS is the
 * host's answer to give: for WorkBuddy's allowlist an empty list is "no filter"
 * rather than "nothing shown", so the picker refuses the removal instead of
 * writing a list that reopens the whole catalog.
 */
export function toggleModelSelection(selected: readonly string[], modelId: string): string[] {
  return selected.includes(modelId)
    ? selected.filter(value => value !== modelId)
    : [...selected, modelId]
}

/**
 * The catalog facts the picker reads before it is willing to call anything
 * "retired".
 *
 * `catalogIds` is empty before the first fetch lands and after a failure, and
 * an empty catalog makes EVERY selection look retired — which would turn the
 * one-click stale cleanup into a button that silently empties the allowlist.
 * Hence {@link catalogIsReady}: the cleanup is offered only when the answer is
 * trustworthy, while the explicit "show all" entry stays available either way,
 * because clearing the list is then the user's stated intent rather than an
 * inference from missing data.
 */
export interface CatalogReadiness {
  /** Catalog model ids the host reported (`[]` before the first fetch lands). */
  catalogIds: readonly string[]
  /** Whether the catalog fetch failed, or the host reported no catalog at all. */
  catalogFailed: boolean
}

/**
 * Whether the catalog is trustworthy enough to call an unlisted selection
 * "retired".
 *
 * A successfully loaded but EMPTY catalog counts as untrustworthy too: an empty
 * list is far more likely a host problem than every model being retired at
 * once.
 */
export function catalogIsReady(readiness: CatalogReadiness): boolean {
  return readiness.catalogIds.length > 0 && !readiness.catalogFailed
}

/**
 * Selected ids the loaded catalog no longer carries, in selection order.
 * Callers gate user-visible "retired" affordances on {@link catalogIsReady} —
 * the list itself is informational.
 */
export function staleModelIds(selected: readonly string[], readiness: CatalogReadiness): string[] {
  const catalogIds = new Set(readiness.catalogIds)
  return selected.filter(id => !catalogIds.has(id))
}
