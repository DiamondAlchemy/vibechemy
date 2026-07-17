import React from 'react'
import { KEY_BAR_LAYOUT, type KeyToken } from '../keys/keybar'

const LABEL: Record<KeyToken, string> = {
  esc: 'esc', 'ctrl-c': '^C', tab: 'tab', enter: '⏎',
  up: '↑', down: '↓', left: '←', right: '→', pipe: '|', tilde: '~'
}

export function KeyBar({
  onKey,
  disabled
}: {
  onKey: (t: KeyToken) => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <div className="mc-keybar" role="toolbar" aria-label="Terminal keys">
      {KEY_BAR_LAYOUT.map((t) => (
        <button key={t} className="mc-key" disabled={disabled} onClick={() => onKey(t)} title={t}>
          {LABEL[t]}
        </button>
      ))}
    </div>
  )
}
