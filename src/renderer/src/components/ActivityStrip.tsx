import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ActivityEvent } from '@shared/types'

// Per-kind accent for the dots in the strip + feed.
const KIND_DOT: Record<string, string> = {
  spawn: '#7fe3ff', // cyan
  merge: '#5dffb0', // mint
  discard: '#ff7a85' // coral
}

function fmtClock(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Live activity strip for the title-bar center. Collapsed: a one-liner with the latest event.
 * Click to expand a panel (capped at ~half the screen, scrolls beyond) with today's full feed —
 * what spawned, merged, or was discarded across every project. Refreshes in real time via the
 * main-process activity ledger (the mc:event bus, kind 'activity').
 */
export function ActivityStrip(): React.JSX.Element {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // Load now + refresh whenever the ledger records something.
  useEffect(() => {
    let stale = false
    const load = (): void => {
      api
        .activityFeed()
        .then((rows) => {
          if (!stale) setEvents(rows)
        })
        .catch(() => {})
    }
    load()
    const off = api.onMcEvent((e) => {
      if (e.kind === 'activity') load()
    })
    return () => {
      stale = true
      off()
    }
  }, [])

  // Close the expanded panel on an outside click.
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const latest = events[0]

  return (
    <div className={'activity-strip' + (open ? ' open' : '')} ref={ref}>
      <button className="activity-bar" onClick={() => setOpen((v) => !v)} title="Today's activity — click to expand">
        <span
          className="activity-pulse"
          style={{ background: latest ? (KIND_DOT[latest.kind] ?? '#7fe3ff') : '#2f6e8f' }}
        />
        <span className="activity-latest">{latest ? latest.summary : 'No activity yet today'}</span>
        {events.length > 0 && <span className="activity-count">{events.length} today</span>}
        <svg
          className="activity-caret"
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div className="activity-panel">
          <div className="activity-panel-head">
            Today · {events.length} event{events.length === 1 ? '' : 's'}
          </div>
          <div className="activity-feed">
            {events.length === 0 ? (
              <div className="activity-empty">
                Nothing yet today — spawns, merges, ships, and discards show up here as they happen.
              </div>
            ) : (
              events.map((e) => (
                <div className="activity-row" key={e.id}>
                  <span className="activity-dot" style={{ background: KIND_DOT[e.kind] ?? '#7fe3ff' }} />
                  <span className="activity-summary">{e.summary}</span>
                  <span className="activity-time">{fmtClock(e.ts)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
