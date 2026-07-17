import React, { useEffect, useRef, useState } from 'react'
import { layoutsFor, colsOf, rowsOf, type LayoutDef } from '../layouts'

/** A miniature diagram of a layout — little cyan tiles placed exactly as the panes would be. */
function Preview({ def, n }: { def: LayoutDef | null; n: number }): React.JSX.Element {
  if (def?.areas) {
    return (
      <div
        className="lp-prev"
        style={{
          gridTemplateColumns: `repeat(${colsOf(def)}, 1fr)`,
          gridTemplateRows: `repeat(${rowsOf(def)}, 1fr)`,
          gridTemplateAreas: def.areas.map((r) => `"${r}"`).join(' ')
        }}
      >
        {Array.from({ length: n }).map((_, i) => (
          <span key={i} style={{ gridArea: `p${i}` }} />
        ))}
      </div>
    )
  }
  const cols = def?.cols ?? Math.max(1, Math.ceil(Math.sqrt(n))) // cols-based or Auto
  return (
    <div className="lp-prev" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
      {Array.from({ length: n }).map((_, i) => (
        <span key={i} />
      ))}
    </div>
  )
}

export function LayoutPicker({
  n,
  selected,
  onSelect
}: {
  n: number
  selected: string | null
  onSelect: (id: string | null) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as HTMLElement
      if (ref.current && !ref.current.contains(t) && !t.closest('[data-layout-toggle]')) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const opts = layoutsFor(n)
  const choose = (id: string | null): void => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <div className="layout-pick" ref={ref}>
      <button
        data-layout-toggle
        className={'layout-btn' + (open ? ' on' : '')}
        title="Choose how the worker terminals are arranged"
        onClick={() => setOpen((v) => !v)}
        disabled={n === 0}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <rect x="3" y="3" width="8" height="8" rx="1.2" />
          <rect x="13" y="3" width="8" height="8" rx="1.2" />
          <rect x="3" y="13" width="8" height="8" rx="1.2" />
          <rect x="13" y="13" width="8" height="8" rx="1.2" />
        </svg>
        Layout
      </button>
      {open && (
        <div className="layout-menu">
          <div className="layout-menu-head">
            Layout · {n} terminal{n === 1 ? '' : 's'}
          </div>
          <div className="layout-grid">
            <button className={'layout-opt' + (selected === null ? ' active' : '')} onClick={() => choose(null)}>
              <Preview def={null} n={n} />
              <span className="layout-opt-name">Auto</span>
            </button>
            <button className={'layout-opt' + (selected === 'free' ? ' active' : '')} onClick={() => choose('free')}>
              <span className="lp-prev lp-prev-free">
                <span style={{ left: '8%', top: '12%', width: '52%', height: '46%' }} />
                <span style={{ left: '46%', top: '40%', width: '46%', height: '50%' }} />
              </span>
              <span className="layout-opt-name">Free</span>
            </button>
            {opts.map((o) => (
              <button
                key={o.id}
                className={'layout-opt' + (selected === o.id ? ' active' : '')}
                onClick={() => choose(o.id)}
              >
                <Preview def={o} n={n} />
                <span className="layout-opt-name">{o.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
