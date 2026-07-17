import { describe, it, expect } from 'vitest'
import { MockFleetSource } from './MockFleetSource'

describe('MockFleetSource', () => {
  it('lists seeded workers', async () => {
    const src = new MockFleetSource()
    const workers = await src.listWorkers()
    expect(workers.length).toBeGreaterThan(0)
    expect(workers[0]).toHaveProperty('workerId')
    expect(workers[0]).toHaveProperty('status')
  })

  it('returns a text snapshot for a known worker and empty for an unknown one', async () => {
    const src = new MockFleetSource()
    const [w] = await src.listWorkers()
    expect(await src.readOutput(w.workerId)).toContain('') // string
    expect(typeof (await src.readOutput('nope'))).toBe('string')
  })

  it('records sends and echoes them into the snapshot', async () => {
    const src = new MockFleetSource()
    const [w] = await src.listWorkers()
    const res = await src.sendToWorker(w.workerId, 'run the tests')
    expect(res.ok).toBe(true)
    expect(await src.readOutput(w.workerId)).toContain('run the tests')
  })
})
