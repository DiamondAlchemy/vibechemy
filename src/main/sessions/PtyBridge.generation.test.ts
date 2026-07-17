import { beforeEach, describe, expect, it, vi } from 'vitest'

interface FakeClientControl {
  emitData: (data: string) => void
  emitExit: () => void
  kill: ReturnType<typeof vi.fn>
}

const fakePty = vi.hoisted(() => ({
  clients: [] as FakeClientControl[]
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let dataCb: (data: string) => void = () => {}
    let exitCb: () => void = () => {}
    const control: FakeClientControl = {
      emitData: (data) => dataCb(data),
      emitExit: () => exitCb(),
      kill: vi.fn()
    }
    fakePty.clients.push(control)
    return {
      onData: (cb: (data: string) => void) => {
        dataCb = cb
        return { dispose: () => {} }
      },
      onExit: (cb: () => void) => {
        exitCb = cb
        return { dispose: () => {} }
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: control.kill
    }
  })
}))

import { PtyBridge } from './PtyBridge'

describe('PtyBridge attach generations', () => {
  beforeEach(() => {
    fakePty.clients = []
  })

  it('invalidates a deliberate detach before kill and ignores every late event from it', async () => {
    const data: Array<{ id: string; value: string; viewerId: string }> = []
    const exits: string[] = []
    const bridge = new PtyBridge(
      (id, value, viewerId) => data.push({ id, value, viewerId }),
      (id) => exits.push(id)
    )

    bridge.attach('session', 'tmux-name', 40, 10, 'viewer-old')
    const oldClient = fakePty.clients[0]
    oldClient.emitData('old-current')

    const detached = bridge.detach('session')
    let acknowledged = false
    void detached.then(() => {
      acknowledged = true
    })
    expect(oldClient.kill).toHaveBeenCalledOnce()
    oldClient.emitData('old-after-detach')
    await Promise.resolve()
    expect(acknowledged).toBe(false)

    // Even a replacement created before the OS reports the old exit is protected by the physical
    // generation. The Free-canvas transaction is stricter and awaits `detached` before doing this.
    bridge.attach('session', 'tmux-name', 120, 40, 'viewer-new')
    const newClient = fakePty.clients[1]
    oldClient.emitExit()
    await detached
    expect(acknowledged).toBe(true)
    oldClient.emitData('old-after-replacement')
    newClient.emitData('new-current')

    expect(data).toEqual([
      { id: 'session', value: 'old-current', viewerId: 'viewer-old' },
      { id: 'session', value: 'new-current', viewerId: 'viewer-new' }
    ])
    expect(exits).toEqual([])
  })
})
