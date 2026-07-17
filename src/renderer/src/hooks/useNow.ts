import { useEffect, useState } from 'react'

/**
 * Shared clock: a Date that re-renders every `intervalMs`. Dedups hand-rolled clock
 * intervals (e.g. the top-bar clock). NOT for data refresh — polling fetch loops are
 * not clocks, and stay where they are.
 */
export function useNow(intervalMs: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
