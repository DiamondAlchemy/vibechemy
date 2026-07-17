import React, { useCallback, useEffect, useState } from 'react'
import type { FleetSource } from '../data/FleetSource'
import { KeyBar } from '../components/KeyBar'
import { keyTokenToBytes, type KeyToken } from '../keys/keybar'

export function WorkerScreen({
  source,
  workerId,
  onBack,
  rawKeysEnabled = false
}: {
  source: FleetSource
  workerId: string
  onBack: () => void
  rawKeysEnabled?: boolean
}): React.JSX.Element {
  const [snapshot, setSnapshot] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setSnapshot(await source.readOutput(workerId))
  }, [source, workerId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const send = async (): Promise<void> => {
    if (!draft.trim() || busy) return
    setBusy(true)
    try {
      await source.sendToWorker(workerId, draft)
      setDraft('')
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  const onKey = async (t: KeyToken): Promise<void> => {
    // Raw control keys need a raw-input channel; until then this is inert.
    if (!rawKeysEnabled) return
    await source.sendToWorker(workerId, keyTokenToBytes(t))
    await refresh()
  }

  return (
    <div className="mc-worker">
      <header className="mc-worker-head">
        <button className="mc-back" onClick={onBack}>‹ Fleet</button>
        <span className="mc-worker-id">{workerId}</span>
        <button className="mc-refresh" onClick={() => void refresh()}>↻</button>
      </header>
      <pre className="mc-term" aria-label="pane">{snapshot}</pre>
      <KeyBar onKey={(t) => void onKey(t)} disabled={!rawKeysEnabled} />
      <div className="mc-input-row">
        <input
          type="text"
          value={draft}
          placeholder="Type a prompt…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void send()}
        />
        <button onClick={() => void send()} disabled={busy}>Send</button>
      </div>
    </div>
  )
}
