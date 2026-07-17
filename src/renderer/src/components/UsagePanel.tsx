import React, { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import type { UsageReport, UsageRow, UsageWindow } from '@shared/types'

/** Bar color: use the provider's severity hint if present, else derive from remaining %. */
function barColor(w: UsageWindow): string {
  const sev = w.severity ?? (w.remainingPct > 50 ? 'normal' : w.remainingPct >= 20 ? 'warning' : 'critical')
  return sev === 'critical' ? 'var(--red)' : sev === 'warning' ? 'var(--amber)' : 'var(--ok, #3ecf6a)'
}

function resetLabel(resetAt: number | null, now: number): string {
  if (!resetAt || !now) return ''
  const ms = resetAt - now
  if (ms <= 0) return 'resets now'
  const h = Math.round(ms / 3_600_000)
  if (h < 1) return `resets in ${Math.max(1, Math.round(ms / 60_000))}m`
  if (h < 48) return `resets in ${h}h`
  return `resets in ${Math.round(h / 24)}d`
}

/**
 * The "Usage" dock panel: one card per agent = what's REMAINING on its plan (from UsageService).
 * Honest by construction — a failed source shows SOURCE ERROR (verbatim on hover), a missing one
 * shows NO SOURCE YET, and the Keychain-reading cards (Claude, Antigravity) are opt-in.
 */
export function UsagePanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [usage, setUsage] = useState<UsageReport | null>(null)
  const [now, setNow] = useState(0)

  const refresh = useCallback((): void => {
    void api.getUsageReport().then((u) => {
      setUsage(u)
      setNow(Date.now())
    })
  }, [])
  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 60_000)
    return () => clearInterval(t)
  }, [refresh])

  const enable = (key: string): void => {
    void api.setSetting(key, 'on').then(refresh)
  }

  return (
    <div className="usage-panel">
      <div className="usage-head">
        <span className="usage-title">◔ Usage — what&apos;s left on each plan</span>
        <button className="usage-icon-btn" title="Refresh" onClick={refresh}>
          ↻
        </button>
        <button className="usage-icon-btn" title="Close" onClick={onClose}>
          ✕
        </button>
      </div>
      {!usage ? (
        <div className="usage-empty">Reading plan usage…</div>
      ) : (
        <div className="usage-list">
          {usage.agents.map((a) => (
            <UsageCard key={a.id} row={a} now={now} onEnable={enable} />
          ))}
          <div className="usage-foot">Remaining = your plan&apos;s quota. Missing sources are labeled explicitly.</div>
        </div>
      )}
    </div>
  )
}

function UsageCard({
  row,
  now,
  onEnable
}: {
  row: UsageRow
  now: number
  onEnable: (key: string) => void
}): React.JSX.Element {
  return (
    <div className="usage-card">
      <div className="usage-card-head">
        <span className="usage-agent">{row.label}</span>
        {row.remaining?.plan && <span className="usage-plan">{row.remaining.plan}</span>}
      </div>

      {row.error ? (
        <div className="usage-err" title={row.error}>
          {row.error}
        </div>
      ) : row.remaining?.windows.length ? (
        <div className="usage-windows">
          {row.remaining.windows.map((w) => (
            <div key={w.id} className="usage-win">
              <div className="usage-win-top">
                <span className="usage-win-label">{w.label}</span>
                <span className="usage-win-pct">{w.remainingPct}% left</span>
              </div>
              <div className="usage-bar">
                <div className="usage-bar-fill" style={{ width: `${w.remainingPct}%`, background: barColor(w) }} />
              </div>
              {resetLabel(w.resetAt, now) && <span className="usage-win-reset">{resetLabel(w.resetAt, now)}</span>}
            </div>
          ))}
        </div>
      ) : row.remaining?.health ? (
        <div className="usage-health">
          <span className={`usage-dot ${row.remaining.health}`} />
          <span className="usage-dim">
            {row.remaining.health === 'live'
              ? 'signed in'
              : row.remaining.health === 'expired'
                ? 're-auth needed (run: grok)'
                : 'blocked'}
            {row.remaining.note ? ` — ${row.remaining.note}` : ''}
          </span>
        </div>
      ) : row.needsOptIn ? (
        <div className="usage-optin">
          <span className="usage-dim">Reads your {row.label} token from the Keychain (local, read-only).</span>
          <button
            className="usage-enable"
            onClick={() => row.optInKey && onEnable(row.optInKey)}
            disabled={!row.optInKey}
          >
            Enable {row.label} usage
          </button>
        </div>
      ) : (
        <div className="usage-dim">no source yet</div>
      )}
    </div>
  )
}
