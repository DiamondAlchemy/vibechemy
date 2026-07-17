import React, { useState } from 'react'
import { MockFleetSource } from './data/MockFleetSource'
import type { FleetSource } from './data/FleetSource'
import { FleetScreen } from './screens/FleetScreen'
import { WorkerScreen } from './screens/WorkerScreen'

const source: FleetSource = new MockFleetSource()

export function App(): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  return open
    ? <WorkerScreen source={source} workerId={open} onBack={() => setOpen(null)} />
    : <FleetScreen source={source} onOpen={setOpen} />
}
