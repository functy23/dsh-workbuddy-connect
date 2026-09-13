// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SegmentedControl } from '../src/client/segmented.tsx'

/**
 * The sliding segmented switch.
 *
 * Two things are worth pinning, and neither is visual: the selection must be
 * driven by the value the caller passes (not internal state that could drift
 * from it), and the moving pill must be *measured from the buttons* rather than
 * given an equal share of the track — the buttons size to their labels, so equal
 * shares misalign the moment one label is longer than another.
 */

describe('SegmentedControl', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    // jsdom has no layout engine and no matchMedia; both are stubbed so the
    // component's measuring path runs rather than throwing.
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
  })

  afterEach(() => {
    act(() => { root?.unmount() })
    container?.remove()
    root = undefined
    container = undefined
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function mount(props: {
    options: { value: string | number, label: string, title?: string }[]
    value: string | number
    onChange?: (value: never) => void
    disabled?: boolean
  }): void {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      // The component is generic over its value type; `createElement` cannot
      // infer it from a spread, so the props are asserted here. The behaviour
      // under test is the registry of radios, not the inference.
      root?.render(createElement(SegmentedControl, {
        label: 'Test group',
        onChange: props.onChange ?? (() => {}),
        ...props,
      } as never))
    })
  }

  const radios = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[role="radio"]')]

  it('marks exactly the selected option as checked', () => {
    mount({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'b' })
    expect(radios().map(node => node.getAttribute('aria-checked'))).toEqual(['false', 'true'])
  })

  it('reports the value clicked, and not the one already selected', () => {
    const onChange = vi.fn()
    mount({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', onChange })
    act(() => { radios()[1]?.click() })
    expect(onChange).toHaveBeenCalledWith('b')
    onChange.mockClear()
    // Clicking the current selection is not a change; dispatching one would
    // make a parent that writes on change issue a redundant request.
    act(() => { radios()[0]?.click() })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('announces the group and each option', () => {
    mount({ options: [{ value: '200000', label: '200K', title: 'Run at 200K' }], value: '200000' })
    const group = document.querySelector('[role="radiogroup"]')
    expect(group?.getAttribute('aria-label')).toBe('Test group')
    // A terse figure like "200K" is not a sentence; the title is what a screen
    // reader should read.
    expect(radios()[0]?.getAttribute('aria-label')).toBe('Run at 200K')
  })

  it('refuses to change while disabled', () => {
    const onChange = vi.fn()
    mount({ options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], value: 'a', onChange, disabled: true })
    act(() => { radios()[1]?.click() })
    expect(onChange).not.toHaveBeenCalled()
    expect(radios()[1]?.hasAttribute('disabled')).toBe(true)
  })

  /**
   * The pill is measured from the selected button, not given an equal share.
   *
   * jsdom has no layout, so the offsets are stubbed: what the test proves is
   * that the pill reads *that button's* geometry and offsets it by the track's
   * padding, which is the part that would break if someone replaced the
   * measurement with `100 / options.length` percents.
   */
  it('positions the pill from the selected button\'s own geometry', () => {
    mount({ options: [{ value: 'a', label: 'A' }, { value: 'bbbb', label: 'BBBB' }], value: 'a' })
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('button')]
    const second = buttons[1] as HTMLButtonElement
    Object.defineProperty(second, 'offsetLeft', { value: 120, configurable: true })
    Object.defineProperty(second, 'offsetWidth', { value: 90, configurable: true })
    // Select the second slot; the pill must move to the geometry measured above.
    const onChange = vi.fn()
    act(() => { root?.unmount() })
    container?.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    act(() => {
      root?.render(createElement(Controlled, { onChange }))
    })
    const live = [...document.querySelectorAll<HTMLButtonElement>('button')]
    const liveSecond = live[1] as HTMLButtonElement
    Object.defineProperty(liveSecond, 'offsetLeft', { value: 120, configurable: true })
    Object.defineProperty(liveSecond, 'offsetWidth', { value: 90, configurable: true })
    act(() => { liveSecond.click() })
    const pill = document.querySelector('[aria-hidden="true"]') as HTMLElement | null
    // 120 (the button's own offsetLeft) - 3 (the track's padding) = 117
    expect(pill?.style.transform).toBe('translateX(117px)')
    expect(pill?.style.width).toBe('90px')
  })
})

/** A host that lets the test drive the selection past the first render. */
function Controlled({ onChange }: { onChange: (value: string) => void }): React.ReactNode {
  const [value, setValue] = useState<string>('a')
  return createElement(SegmentedControl, {
    label: 'Test group',
    value,
    // The segment values are strings here, so the callback's union narrows to
    // the string branch.
    onChange: next => { setValue(String(next)); onChange(String(next)) },
    options: [{ value: 'a', label: 'A' }, { value: 'bbbb', label: 'BBBB' }],
  })
}
