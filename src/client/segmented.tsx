/**
 * The two-or-more-way segmented switch, with a sliding selection.
 *
 * One component for every switch in this plugin — the sign-in method, and a
 * model's context length — because they are the same control: a small set of
 * mutually exclusive choices where the selection is what matters, not the
 * buttons. Keeping one implementation is also what makes the motion consistent;
 * two copies would drift the first time one of them was adjusted.
 *
 * The selection is an absolutely positioned pill that translates between slots,
 * rather than each button painting its own background. That is what makes the
 * movement read as *the selection moving* instead of one thing vanishing and
 * another appearing, and it is why the pill is measured from the buttons rather
 * than given an equal share of the track: the buttons size themselves to their
 * labels, so equal shares would drift out of alignment.
 *
 * @module dsh-workbuddy-connect/client/segmented
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

/** One choice in a {@link SegmentedControl}. */
export interface SegmentedOption<T extends string | number> {
  value: T
  label: string
  /** Announced instead of the label when the label is a terse figure. */
  title?: string
}

/** Props of {@link SegmentedControl}. */
export interface SegmentedControlProps<T extends string | number> {
  options: readonly SegmentedOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name for the group. */
  label: string
  /** Disables every slot; the selection stops moving while a write is in flight. */
  disabled?: boolean
  /** Compact sizing for a control that sits inside a table row. */
  dense?: boolean
  /** Stretch to the container's width instead of hugging the labels. */
  block?: boolean
}

const trackStyle: CSSProperties = {
  position: 'relative',
  display: 'inline-flex',
  alignItems: 'stretch',
  padding: 3,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 999,
  background: 'var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05))',
  // The pill is clipped to the track's rounding, so it cannot paint outside.
  overflow: 'hidden',
}

const itemStyle: CSSProperties = {
  position: 'relative',
  zIndex: 1,
  border: 0,
  borderRadius: 999,
  background: 'transparent',
  color: 'var(--dsw-alias-label-secondary)',
  // `font: inherit` plus a per-state `fontWeight` is the shorthand/non-shorthand
  // mix React warns about, so the family is spelled out.
  fontFamily: 'inherit',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'color 160ms ease',
}

/**
 * The moving selection.
 *
 * Colour and shadow live here so the buttons stay flat; only the text colour
 * changes on the selected one, which is what lets the pill animate underneath
 * without the label flashing.
 */
const pillStyle: CSSProperties = {
  position: 'absolute',
  top: 3,
  bottom: 3,
  zIndex: 0,
  borderRadius: 999,
  background: 'var(--dsw-alias-bg-layer-1, #fff)',
  boxShadow: 'var(--dsw-shadow-lv1, 0 1px 2px rgba(0, 0, 0, 0.08))',
  // The one animated property. `transform` and `width` are both layout-free for
  // the compositor only when combined with `will-change`; leaving the width
  // unanimated would make labels of different lengths jump, so both move and the
  // curve is short enough that the width change is not perceptible as layout.
  transition: 'transform 220ms cubic-bezier(0.4, 0, 0.2, 1), width 220ms cubic-bezier(0.4, 0, 0.2, 1)',
}

/** Whether the user has asked for less motion. */
function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function SegmentedControl<T extends string | number>({
  options, value, onChange, label, disabled, dense, block,
}: SegmentedControlProps<T>): React.ReactNode {
  const trackRef = useRef<HTMLDivElement | null>(null)
  /** The selected slot's geometry within the track, in px. */
  const [pill, setPill] = useState<{ left: number, width: number }>()
  const [animate, setAnimate] = useState(false)

  const selectedIndex = options.findIndex(option => option.value === value)

  /**
   * Measure the selected button.
   *
   * `useLayoutEffect` rather than an effect: measuring after paint would show
   * the pill at its previous position for one frame on first render, which reads
   * as a flicker. The measurement is repeated on resize because the labels'
   * widths depend on the font the browser actually resolved.
   */
  useLayoutEffect(() => {
    const track = trackRef.current
    if (track === null) return
    const measure = (): void => {
      const buttons = [...track.querySelectorAll('button')]
      const button = buttons[selectedIndex]
      if (button === undefined) return
      setPill({ left: button.offsetLeft, width: button.offsetWidth })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(track)
    return () => { observer.disconnect() }
  }, [selectedIndex, options, dense, block])

  // Animate only after the first placement, so the initial pill does not slide
  // in from the left edge.
  useEffect(() => {
    if (pill === undefined) return
    const timer = window.setTimeout(() => { setAnimate(true) }, 30)
    return () => { window.clearTimeout(timer) }
  }, [pill === undefined])

  const reduced = prefersReducedMotion()

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      style={{ ...trackStyle, ...(block === true ? { display: 'flex' } : {}), ...(disabled === true ? { opacity: 0.6 } : {}) }}
    >
      {pill === undefined ? null : (
        <span
          aria-hidden="true"
          style={{
            ...pillStyle,
            transform: `translateX(${String(pill.left - 3)}px)`,
            width: pill.width,
            ...(animate && !reduced ? {} : { transition: 'none' }),
          }}
        />
      )}
      {options.map((option, index) => (
        <button
          key={String(option.value)}
          type="button"
          role="radio"
          aria-checked={index === selectedIndex}
          aria-label={option.title ?? option.label}
          disabled={disabled === true}
          onClick={() => { if (index !== selectedIndex) onChange(option.value) }}
          style={{
            ...itemStyle,
            ...(dense === true
              ? { padding: '2px 10px', fontSize: 12, lineHeight: '18px' }
              : { padding: '5px 18px', fontSize: 13, lineHeight: '18px' }),
            ...(block === true ? { flex: 1 } : {}),
            ...(index === selectedIndex
              ? { color: 'var(--dsw-alias-label-primary)', fontWeight: 600 }
              : {}),
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
