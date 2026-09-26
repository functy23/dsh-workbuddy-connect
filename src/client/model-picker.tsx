/**
 * The model picker: a searchable checkbox dropdown over one account's catalog.
 *
 * Ported from the Command Code provider's `ModelMultiSelect` +
 * `VisibleModelsRow` (the settings page's model filter), with two changes
 * that are WorkBuddy's rather than the reference's:
 *
 * 1. **The selection means "only show these".** Command Code's picker chooses
 *    which models route to which account; here the list IS the picker filter the
 *    host stores under `uid:enterpriseId`, and an EMPTY selection is "no
 *    filter" rather than "nothing shown". The dropdown therefore refuses to
 *    remove the last remaining entry and marks the row instead — writing an
 *    empty list would silently reopen the whole catalog, which is the opposite
 *    of what the click asked for.
 * 2. **Commits are deferred to close.** A checkbox menu that wrote on every
 *    click would send one host write per tick; the draft is handed over once, on
 *    close, and the owner decides whether that write is immediate (the
 *    per-account editors) or staged for the settings page's save bar.
 *
 * The dropdown's data shaping lives in `model-select.ts` (React-free, so
 * the search/stale/grouping rules are unit-testable without a DOM); this module
 * is only the surface.
 *
 * @module dsh-workbuddy-connect/client/model-picker
 */

import { useEffect, useMemo, useState } from 'react'
import { Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MenuEntry } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import type { WorkBuddyWebModelBadge } from '../status-paths.ts'
import { buildModelSelectOptions, groupModelSelectOptions, toggleModelSelection } from './model-select.ts'
import type { SelectableModel } from './model-select.ts'
import type { WorkBuddySettingsKey, WorkBuddyTranslate } from './locales.ts'

/** The translator shape this module needs; the page passes its own bound one. */
export type ModelPickerTranslate = (key: WorkBuddySettingsKey, params?: Record<string, unknown>) => string

/**
 * The catalog rows a picker may offer.
 *
 * Only the two fields a dropdown row needs are required: the rest of
 * {@link WorkBuddyWebModelBadge} (rates, context windows, promotions) belongs to
 * the model LIST, and a picker that rendered them would be a second copy of the
 * page. Structural rather than an interface the caller has to satisfy: the page
 * hands over the badges it already has.
 */
export function selectableModels(models: readonly WorkBuddyWebModelBadge[] | undefined): SelectableModel[] {
  return (models ?? []).map(model => ({ id: model.id, name: model.name }))
}

/**
 * One account's "only show these models" control.
 *
 * @param selected - the committed selection (the host's allowlist, or a staged
 * draft the owner is holding).
 * @param onPick - called once per open/close cycle, only when the set changed.
 */
export function ModelPicker({ id, selected, labelled, catalog, disabled, label, t, onPick }: {
  id: string
  /** The ticks: what the menu marks as checked, and what it edits. */
  selected: readonly string[]
  /**
   * What the TRIGGER's label counts.
   *
   * Separate from {@link selected} because the two answer different questions in
   * exactly one state: with the filter off the menu edits the whole catalog
   * (there is no stored list to edit), while the row must not claim a selection
   * the filter is not applying. Defaults to `selected`.
   */
  labelled?: readonly string[]
  catalog: readonly SelectableModel[]
  disabled: boolean
  /** Accessible label for the trigger and the menu. */
  label: string
  t: ModelPickerTranslate
  onPick(ids: string[]): void
}): ReactNode {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  /** Ticks made since this menu opened; undefined while nothing is staged. */
  const [draft, setDraft] = useState<string[] | undefined>(undefined)
  const current = draft ?? selected
  // The search box must not inherit a stale query from a previous open.
  useEffect(() => {
    if (open) setQuery('')
  }, [open])
  /**
   * Close, committing the draft once.
   *
   * Committed here rather than per click: the reference implementation writes on
   * close for the same reason (one host write per visit instead of one per tick),
   * and the "changed" comparison keeps a look-and-close from sending an
   * identical list back.
   */
  const close = (): void => {
    setOpen(false)
    if (draft === undefined) return
    const next = draft
    setDraft(undefined)
    const changed = next.length !== selected.length || next.some(id => !selected.includes(id))
    if (changed) onPick(next)
  }
  const options = useMemo(() => buildModelSelectOptions(catalog, current, query), [catalog, current, query])
  // No tiers exist in WorkBuddy's catalogs today, so this is the one unheaded
  // group; {@link groupModelSelectOptions} is kept for the day one appears.
  const groups = useMemo(() => groupModelSelectOptions(options, () => undefined), [options])
  const items: MenuEntry[] = groups.flatMap(group => [
    ...group.heading === undefined
      ? []
      : [{ type: 'label' as const, id: `wbp-model-group-${group.heading}`, text: group.heading }],
    ...group.options.map(option => ({
      id: option.value,
      label: (
        <span className="wbp-checkRow">
          <input type="checkbox" className="wbp-check" checked={current.includes(option.value)} readOnly tabIndex={-1} />
          <span className="wbp-checkName">{option.label}</span>
          {option.stale ? <span className="wbp-badge">{t('modelStale')}</span> : null}
        </span>
      ),
    })),
  ])
  return (
    <Menu
      open={open}
      onClose={close}
      onSelect={modelId => {
        const next = toggleModelSelection(current, modelId)
        // The last tick cannot be removed: an empty list is the host's "no
        // filter", so the click that would produce one is refused here rather
        // than written and explained afterwards.
        if (next.length === 0) return
        setDraft(next)
      }}
      selectedIds={current}
      items={items}
      footer={options.length === 0 ? [{ type: 'label' as const, id: 'wbp-model-search-empty', text: t('modelSearchEmpty') }] : []}
      portal
      listClassName="wbp-modelMenu"
      anchor={
        <span className="wbp-modelSelectAnchor">
          <button
            id={id}
            type="button"
            className="wbp-selector"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-label={label}
            disabled={disabled || catalog.length === 0}
            onClick={() => { if (open) close(); else setOpen(true) }}
          >
            <span className="wbp-selectorText">
              {(labelled ?? current).length === 0
                ? t('modelPick')
                : t('modelPickCount', { count: (labelled ?? current).length })}
            </span>
            <span className="wbp-selectorCaret" aria-hidden="true" />
          </button>
          {/*
            * The search box lives INSIDE the Menu anchor, which renders in place
            * inside the Menu's root span: a pointerdown here counts as "inside",
            * so focusing and typing never trips the outside-click close. A box
            * rendered as a sibling would close the menu on the first click.
            */}
          {open ? (
            <input
              type="search"
              className="wbp-input wbp-modelSearch"
              placeholder={t('modelSearchPlaceholder')}
              aria-label={t('modelSearchPlaceholder')}
              value={query}
              disabled={disabled}
              autoFocus
              onChange={event => { setQuery(event.target.value) }}
            />
          ) : null}
        </span>
      }
    />
  )
}
