import React from 'react'
import type { Tombstone } from '../tombstones'

/**
 * In-place marker for a pane whose CLI exited UNEXPECTEDLY (Esc mishap, crash,
 * accidental Ctrl+C) — the pane never silently vanishes. Revive respawns the same
 * preset in the same cwd; for claude CLIs it lands in the /resume picker with the
 * dead conversation on top.
 */
export function TombstonePane({
  t,
  presetLabel,
  compact,
  onRevive,
  onDismiss
}: {
  t: Tombstone
  presetLabel: string
  compact?: boolean
  onRevive: (id: string) => void
  onDismiss: (id: string) => void
}): React.JSX.Element {
  const at = new Date(t.exitedAt)
  const hh = String(at.getHours()).padStart(2, '0')
  const mm = String(at.getMinutes()).padStart(2, '0')
  return (
    <div className={`tombstone${compact ? ' compact' : ''}`}>
      <div className="tombstone-head">
        <span className="tombstone-dot">⏻</span>
        <span className="tombstone-title">{presetLabel}</span>
        <span className="tombstone-when">
          exited {hh}:{mm}
        </span>
      </div>
      <div className="tombstone-body">
        {t.missingCli ? (
          <div className="tombstone-hint">
            This agent&apos;s CLI isn&apos;t installed on this machine — set it up in <b>Settings → Agents</b>. Reviving
            can&apos;t help until it is.
          </div>
        ) : (
          !compact && <div className="tombstone-hint">CLI exited — the conversation is recoverable.</div>
        )}
        {t.error && <div className="tombstone-error">{t.error}</div>}
        <div className="tombstone-actions">
          {!t.missingCli && (
            <button
              className="layout-btn tombstone-revive"
              disabled={t.reviving}
              onClick={() => onRevive(t.session.id)}
            >
              {t.reviving ? 'Reviving…' : '⟳ Revive'}
            </button>
          )}
          <button className="layout-btn" disabled={t.reviving} onClick={() => onDismiss(t.session.id)}>
            ✕ Dismiss
          </button>
        </div>
      </div>
    </div>
  )
}
