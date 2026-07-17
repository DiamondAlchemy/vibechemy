import React, { useEffect, useState } from 'react'
import type { FleetSource, MobileWorker } from '../data/FleetSource'

export function FleetScreen({
  source,
  onOpen
}: {
  source: FleetSource
  onOpen: (workerId: string) => void
}): React.JSX.Element {
  const [workers, setWorkers] = useState<MobileWorker[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    source
      .listWorkers()
      .then((w) => alive && setWorkers(w))
      .catch((e) => alive && setError(String(e?.message ?? e)))
    return () => {
      alive = false
    }
  }, [source])

  return (
    <div className="mc-fleet">
      <header className="mc-fleet-head">Fleet</header>
      {error && <div className="mc-error">{error}</div>}
      <ul className="mc-worker-list">
        {workers.map((w) => (
          <li key={w.workerId}>
            <button className="mc-worker-row" onClick={() => onOpen(w.workerId)}>
              <span className={`mc-dot mc-${w.status}`} />
              <span className="mc-worker-preset">{w.preset}</span>
              <span className="mc-worker-cwd">{w.cwd}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
