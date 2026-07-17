import React, { useCallback, useEffect, useState } from 'react'
import type { SessionRecord, UsageReport, UsageRow } from '@shared/types'
import { WIDGET_CATALOG, usageSeverity, type WidgetId } from '@shared/widgets/catalog'
import { api } from '../api'

// The widget-card BODIES. Each body owns its own poll — a collapsed card renders no body, so its
// polling stops by construction. All data comes from the existing preload seams (usage report,
// session list); presentation math is reused (the Usage panel's severity thresholds via
// usageSeverity) — never re-derived. Honesty contract as everywhere: a failed poll keeps the
// last-known data and shows the error verbatim; a missing source says so; never silent zeros.

interface Poll<T> {
  data: T | null
  error: string | null
}

// Poll `fetchFn` every `ms` while mounted. Generation-guarded per effect run (`alive`) so a result
// landing after unmount/refetch-cycle teardown is dropped, never set on stale state.
function usePoll<T>(fetchFn: () => Promise<T>, ms: number): Poll<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    const run = (): void => {
      fetchFn().then(
        (d) => {
          if (!alive) return
          setData(d)
          setError(null)
        },
        (e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        }
      )
    }
    run()
    const t = setInterval(run, ms)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [fetchFn, ms])
  return { data, error }
}

function ErrLine({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="wc-err" title={text}>
      {text}
    </div>
  )
}

function DimLine({ text }: { text: string }): React.JSX.Element {
  return <div className="wc-dim">{text}</div>
}

// --- Plan usage (UsageReport: remaining quota per agent) -------------------------------------------

const fetchUsage = (): Promise<UsageReport> => api.getUsageReport()

function UsageAgent({ row }: { row: UsageRow }): React.JSX.Element {
  return (
    <div className="wc-agent">
      <div className="wc-row">
        <span className="wc-name">{row.label}</span>
        {row.remaining?.plan && <span className="wc-plan">{row.remaining.plan}</span>}
      </div>
      {row.error ? (
        <ErrLine text={row.error} />
      ) : row.remaining?.windows.length ? (
        row.remaining.windows.map((w) => (
          <div key={w.id} className="wc-win">
            <span className="wc-win-label">{w.label}</span>
            <div className="wc-bar">
              <div
                className={`wc-bar-fill sev-${usageSeverity(w.remainingPct, w.severity)}`}
                style={{ width: `${Math.max(0, Math.min(100, w.remainingPct))}%` }}
              />
            </div>
            <span className="wc-win-pct">{w.remainingPct}%</span>
          </div>
        ))
      ) : row.remaining?.health ? (
        <div className="wc-row">
          <span className={`wc-dot ${row.remaining.health}`} />
          <span className="wc-dim">
            {row.remaining.health === 'live'
              ? 'signed in'
              : row.remaining.health === 'expired'
                ? 're-auth needed'
                : 'blocked'}
          </span>
        </div>
      ) : row.needsOptIn ? (
        // The consent gate belongs to the Usage panel's Enable button — the widget only reports
        // the state; it never flips the setting (and the service never reads the Keychain gated off).
        <DimLine text="opt-in — enable in the Usage panel" />
      ) : (
        <DimLine text="no source yet" />
      )}
    </div>
  )
}

export function UsageCard({ pollMs }: { pollMs: number }): React.JSX.Element {
  const { data, error } = usePoll(fetchUsage, pollMs)
  if (!data) return error ? <ErrLine text={error} /> : <DimLine text="reading plan usage…" />
  return (
    <div className="wc-rows">
      {data.agents.map((a) => (
        <UsageAgent key={a.id} row={a} />
      ))}
      {error && <ErrLine text={error} />}
    </div>
  )
}

// --- Sessions (this workspace's panes, from the session list) ---------------------------------------

const SESSIONS_SHOWN = 10

export function SessionsCard({ projectId, pollMs }: { projectId: string | null; pollMs: number }): React.JSX.Element {
  const fetchSessions = useCallback((): Promise<SessionRecord[]> => api.listSessions(projectId), [projectId])
  const { data, error } = usePoll(fetchSessions, pollMs)
  if (!data) return error ? <ErrLine text={error} /> : <DimLine text="reading sessions…" />
  const running = data.filter((s) => s.status === 'running').length
  return (
    <div className="wc-rows">
      <div className="wc-row wc-total">
        <span className="wc-name">
          {data.length} {data.length === 1 ? 'session' : 'sessions'}
        </span>
        {running > 0 && <span className="wc-note">{running} running</span>}
      </div>
      {data.length === 0 && <DimLine text="no sessions in this workspace" />}
      {data.slice(0, SESSIONS_SHOWN).map((s) => (
        <div key={s.id} className="wc-row">
          <span className={`wc-dot st-${s.status}`} />
          <span className="wc-name">{s.title || s.presetId}</span>
          <span className={`wc-note${s.taskState === 'needs_review' ? ' wc-warn' : ''}`}>
            {s.taskState === 'needs_review' ? '● ' : ''}
            {s.taskState ?? s.status}
          </span>
        </div>
      ))}
      {data.length > SESSIONS_SHOWN && <DimLine text={`+${data.length - SESSIONS_SHOWN} more`} />}
      {error && <ErrLine text={error} />}
    </div>
  )
}

// --- Shared body dispatch -------------------------------------------------------------------------

/** The one id→body switch, shared by the rail card and the free-floating canvas card so the widget
 *  CONTENT is never forked between the two homes. */
export function WidgetBody({ id, projectId }: { id: WidgetId; projectId: string | null }): React.JSX.Element {
  const pollMs = WIDGET_CATALOG[id].pollMs
  switch (id) {
    case 'usage':
      return <UsageCard pollMs={pollMs} />
    case 'sessions':
      return <SessionsCard projectId={projectId} pollMs={pollMs} />
  }
}
