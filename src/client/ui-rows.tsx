/**
 * The layout pieces every WorkBuddy surface is built from: rows, groups,
 * fields, and the small figures (tiles, bars, rings) the dashboard is made of.
 *
 * Ported from the reference implementation this plugin's UI follows
 * (dsh-commandcode-provider, MIT), with the class prefix changed to \`wbp-\`
 * because these rules are global CSS and the reference plugin is installed on
 * this machine.
 *
 * Why classes instead of inline style objects: the page has to sit beside the
 * harness's own settings pages and follow the active theme. An inline object
 * can carry a token but not a \`:hover\`, a \`:focus-visible\`, a
 * \`::after\`, or a media query, so every interactive affordance ended up
 * reimplemented in JavaScript and every colour was a literal that got dark mode
 * wrong. One stylesheet plus these components is the whole replacement.
 *
 * @module dsh-workbuddy-connect/client/ui-rows
 */

import type { CSSProperties, ReactNode } from 'react'

/** Join class names, dropping the empty ones. */
export function cx(...values: readonly (string | undefined | false)[]): string {
  return values.filter(value => typeof value === 'string' && value !== '').join(' ')
}

/**
 * One settings row, laid out like the harness's own General page: the title and
 * description on the left, the control on the right, a hairline between rows.
 */
export function SettingRow({ title, titleFor, tag, description, error, control, className, controlClassName }: {
  title: ReactNode
  /** Makes the title a `<label>` for this control id. */
  titleFor?: string
  tag?: ReactNode
  description?: ReactNode
  /** Replaces the description while set. */
  error?: string | undefined
  control?: ReactNode
  className?: string
  controlClassName?: string
}): ReactNode {
  return (
    <div className={cx('wbp-row', className)}>
      <div className="wbp-rowText">
        <div className="wbp-rowTitleLine">
          {titleFor !== undefined
            ? <label className="wbp-rowTitle" htmlFor={titleFor}>{title}</label>
            : <span className="wbp-rowTitle">{title}</span>}
          {tag}
        </div>
        {error !== undefined ? <p className="wbp-rowError">{error}</p> : null}
        {error === undefined && description !== undefined ? <div className="wbp-rowDesc">{description}</div> : null}
      </div>
      {control !== undefined ? <div className={cx('wbp-rowControl', controlClassName)}>{control}</div> : null}
    </div>
  )
}

/** A heading over a run of rows — the page's one grouping device. */
export function SettingsGroup({ title, action, description, children }: {
  title: string
  /** A control rendered on the heading's line, e.g. "Add account". */
  action?: ReactNode
  description?: ReactNode
  children: ReactNode
}): ReactNode {
  return (
    <section className="wbp-group">
      <div className="wbp-groupHead">
        <h3 className="wbp-groupTitle">{title}</h3>
        <span className="wbp-spacer" />
        {action}
      </div>
      {description === undefined ? null : <p className="wbp-groupDesc">{description}</p>}
      <div className="wbp-rows">{children}</div>
    </section>
  )
}

/**
 * A collapsible group: the heading is the button, the chevron shows the state.
 *
 * Used for the parts of the page a reader checks rarely, so the default view
 * stays the one thing they came for.
 */
export function Disclosure({ title, description, open, onToggle, children }: {
  title: string
  description?: ReactNode
  open: boolean
  onToggle(): void
  children: ReactNode
}): ReactNode {
  return (
    <section className="wbp-group">
      <button type="button" className="wbp-disclosure" aria-expanded={open} onClick={onToggle}>
        <span className="wbp-groupHead">
          <span className={cx('wbp-chevron', open && 'wbp-chevronUp')} aria-hidden="true" />
          <span className="wbp-groupTitle">{title}</span>
        </span>
      </button>
      {description === undefined ? null : <p className="wbp-groupDesc">{description}</p>}
      {open ? <div className="wbp-rows">{children}</div> : null}
    </section>
  )
}

/** A capsule tag. */
export function Badge({ tone = 'plain', title, children }: {
  tone?: 'plain' | 'muted' | 'warn' | 'error' | 'ok'
  title?: string
  children: ReactNode
}): ReactNode {
  const cls = tone === 'muted'
    ? 'wbp-badgeMuted'
    : tone === 'warn'
      ? cx('wbp-badge', 'wbp-badgeWarn')
      : tone === 'error'
        ? cx('wbp-badge', 'wbp-badgeError')
        : tone === 'ok'
          ? cx('wbp-badge', 'wbp-badgeOk')
          : 'wbp-badge'
  return <span className={cls} title={title}>{children}</span>
}

/** A labelled figure in a filled panel — the dashboard's stat unit. */
export function StatTile({ label, value, sub }: { label: string, value: string, sub?: string | undefined }): ReactNode {
  return (
    <div className="wbp-usageStat">
      <span className="wbp-usageStatLabel">{label}</span>
      <span className="wbp-usageStatValue">{value}</span>
      {sub === undefined || sub === '' ? null : <span className="wbp-usageStatSub">{sub}</span>}
    </div>
  )
}

/**
 * A labelled bar: a head line carrying the label and the figures, then the
 * full-width fill and an optional reset line.
 *
 * `percent` is the caption (it may say "unlimited"); `barPercent` is what the
 * fill is drawn from, and caps at 100 independently so a bar can be full while
 * its caption states the real number.
 */
export function QuotaBar({ label, value, percent, barPercent, warn, resetsAt, resetsLabel }: {
  label: string
  value?: string
  percent?: string
  barPercent: number
  warn?: string
  resetsAt?: string
  resetsLabel?: string
}): ReactNode {
  const clamped = Math.min(100, Math.max(0, barPercent))
  const warnText = warn ?? ''
  return (
    <div className="wbp-window">
      <div className="wbp-windowHead">
        <span className="wbp-windowLabel">{label}</span>
        {warnText === '' ? null : <span className="wbp-warnTag">{warnText}</span>}
        <span className="wbp-spacer" />
        {value === undefined || value === '' ? null : <span className="wbp-windowValue">{value}</span>}
        {percent === undefined ? null : <span className="wbp-windowPct">{percent}</span>}
      </div>
      <div className="wbp-bar" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={clamped}>
        <div className={warnText === '' ? 'wbp-barFill' : cx('wbp-barFill', 'wbp-barFillWarn')} style={{ width: `${String(clamped)}%` }} />
      </div>
      {resetsAt === undefined || resetsAt === '' ? null : <p className="wbp-windowReset">{resetsLabel ?? ''} {resetsAt}</p>}
    </div>
  )
}

/** One account's status dot. The colour is the class; the meaning is the title. */
export function StatusDot({ tone, title }: { tone: 'ok' | 'warn' | 'error' | 'off', title: string }): ReactNode {
  return <span aria-hidden="true" className={cx('wbp-tabDot', `wbp-tabDot${tone === 'ok' ? 'Ok' : tone === 'warn' ? 'Warn' : tone === 'error' ? 'Error' : 'Off'}`)} title={title} />
}

/**
 * The quota ring: one glyph serves the rail button, the footer card's head and
 * the dashboard header. A faint track plus an arc whose sweep is the
 * consumption, drawn from 12 o'clock. Circumference 2πr = 45.55 at r = 7.25.
 */
export function Ring({ percent, warn, size }: { percent: number, warn: boolean, size: number }): ReactNode {
  const clamped = Math.min(100, Math.max(0, percent))
  const circumference = 45.55
  // Rounded to three decimals: the raw product lands on floats like
  // 34.162499999999994, which is a needless DOM diff churn.
  const dashoffset = Math.round(circumference * (1 - clamped / 100) * 1000) / 1000
  return (
    <span className="wbp-glyph" aria-hidden="true">
      <svg viewBox="0 0 20 20" width={size} height={size} focusable="false">
        <circle cx="10" cy="10" r="7.25" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.4" />
        <circle
          cx="10"
          cy="10"
          r="7.25"
          fill="none"
          stroke={warn ? 'var(--dsw-alias-state-error-primary)' : 'currentColor'}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={String(circumference)}
          strokeDashoffset={String(dashoffset)}
          transform="rotate(-90 10 10)"
        />
      </svg>
    </span>
  )
}

/**
 * The platform's segmented control: a translucent track with one raised pill
 * sliding under the picked segment.
 *
 * The indicator's width and offset are computed arithmetically from the count
 * and the index (two custom properties), so it slides without measuring the
 * DOM — the platform's own technique.
 */
export function SegmentedField({ label, value, options, disabled, onChange, className }: {
  label: string
  value: string
  options: ReadonlyArray<{ value: string, label: string, title?: string }>
  disabled?: boolean
  onChange(value: string): void
  className?: string
}): ReactNode {
  const index = Math.max(0, options.findIndex(option => option.value === value))
  return (
    <div
      className={cx('wbp-segmented', className)}
      role="radiogroup"
      aria-label={label}
      style={{ '--wbp-segment-count': options.length, '--wbp-segment-index': index } as CSSProperties}
    >
      <span className="wbp-segmentIndicator" aria-hidden="true" />
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          className="wbp-segment"
          disabled={disabled === true}
          {...option.title === undefined ? {} : { title: option.title }}
          onClick={() => { if (value !== option.value) onChange(option.value) }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** A labelled checkbox row: the box, then its name. */
export function CheckRow({ id, checked, disabled, label, onChange }: {
  id: string
  checked: boolean
  disabled?: boolean
  label: string
  onChange(checked: boolean): void
}): ReactNode {
  return (
    <label className="wbp-checkRow" htmlFor={id}>
      <input
        id={id}
        className="wbp-check"
        type="checkbox"
        checked={checked}
        disabled={disabled === true}
        onChange={event => { onChange(event.target.checked) }}
      />
      <span className="wbp-checkName">{label}</span>
    </label>
  )
}

/** A switch row: the platform Switch's shape, as a labelled control. */
export function ToggleField({ id, checked, disabled, label, onChange }: {
  id: string
  checked: boolean
  disabled?: boolean
  label: string
  onChange(checked: boolean): void
}): ReactNode {
  return (
    <input
      id={id}
      className="wbp-toggle"
      type="checkbox"
      role="switch"
      aria-label={label}
      checked={checked}
      disabled={disabled === true}
      onChange={event => { onChange(event.target.checked) }}
    />
  )
}

/**
 * The "only show the ones I pick" control: the value editor, a switch, a count,
 * and a way back.
 *
 * Modelled on the reference implementation's visible-models row
 * (`VisibleModelsRow` in the Command Code provider): the assignment editor
 * sits in the row's control column, and the switch beside it decides whether
 * that assignment reaches the picker at all. Off is "show everything", on is
 * "show what I picked", and turning it off clears the filter rather than leaving
 * an invisible one behind.
 *
 * The editor arrives through {@link FilterRow.control} rather than being built
 * in: this row owns the switch semantics, not the value's shape — a filter over
 * a checkbox column, a multi-select menu, or a text box all read as the same row.
 */
export function FilterRow({ id, enabled, label, description, summary, clearLabel, control, disabled, onToggle, onClear }: {
  id: string
  enabled: boolean
  label: string
  description: ReactNode
  /** What the current filter shows, e.g. "3 of 12 models". */
  summary: string
  clearLabel: string
  /**
   * The value editor the switch governs, rendered BEFORE the switch.
   *
   * A switch that only turns something on is a switch over nothing: the filter
   * needs a selection to be about, and the selection needs a surface. The
   * reference implementation's row does the same with its multi-select.
   */
  control?: ReactNode
  disabled?: boolean
  onToggle(enabled: boolean): void
  onClear(): void
}): ReactNode {
  return (
    <SettingRow
      title={label}
      titleFor={id}
      description={description}
      className="wbp-rowNested"
      control={
        <>
          {control}
          {!enabled ? null : (
            <>
              <span className="wbp-hint">{summary}</span>
              <button type="button" className="wbp-linkButton" disabled={disabled === true} onClick={onClear}>
                {clearLabel}
              </button>
            </>
          )}
          <ToggleField
            id={id}
            label={label}
            checked={enabled}
            disabled={disabled === true}
            onChange={onToggle}
          />
        </>
      }
    />
  )
}

/** A label paired with a value on one baseline. */
export function Fact({ label, value }: { label: string, value: ReactNode }): ReactNode {
  return (
    <>
      <span className="wbp-factLabel">{label}</span>
      <span className="wbp-factValue">{value}</span>
    </>
  )
}
