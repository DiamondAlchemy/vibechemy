import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { openDatabase } from '../db/database'
import { PresetRegistry } from '../presets/PresetRegistry'
import { SessionManager } from './SessionManager'
import { PtyBridge } from './PtyBridge'
import { hasSession, killSession } from './tmux'
import type { Preset } from '@shared/types'

const MARKER = 'MC_SMOKE_OK_' + process.pid
const presets: Preset[] = [
  { id: 'smoke', name: 'Smoke', command: 'sh', args: ['-c', `echo ${MARKER}; sleep 30`], env: {} }
]

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let tmuxName: string | null = null
afterEach(async () => {
  if (tmuxName && (await hasSession(tmuxName))) await killSession(tmuxName)
  tmuxName = null
})

describe('end-to-end: spawn -> attach -> stream -> reattach', () => {
  it('streams spawned output through PtyBridge and reattaches after a simulated restart', async () => {
    const dbFile = `${tmpdir()}/mc-e2e-${process.pid}.sqlite`

    // --- app run #1: spawn + attach + see output ---
    const db1 = openDatabase(dbFile)
    const mgr1 = new SessionManager(db1, PresetRegistry.from(presets))
    let buffer = ''
    const bridge1 = new PtyBridge(
      (_id, d) => {
        buffer += d
      },
      () => {}
    )
    const rec = await mgr1.spawn('smoke', tmpdir(), null)
    tmuxName = rec.tmuxName
    bridge1.attach(rec.id, rec.tmuxName, 80, 24)
    await wait(2000)
    expect(buffer).toContain(MARKER) // proves spawn + tmux + pty streaming all work end-to-end
    bridge1.detach(rec.id) // viewer detaches; tmux session + process keep running
    db1.close()

    // --- app run #2 (simulated restart): reconcile + reattach + still see output ---
    const db2 = openDatabase(dbFile)
    const mgr2 = new SessionManager(db2, PresetRegistry.from(presets))
    const { reattached } = await mgr2.reconcile()
    expect(reattached.map((r) => r.tmuxName)).toContain(rec.tmuxName)
    let buffer2 = ''
    const bridge2 = new PtyBridge(
      (_id, d) => {
        buffer2 += d
      },
      () => {}
    )
    bridge2.attach(rec.id, rec.tmuxName, 80, 24)
    await wait(2000)
    expect(buffer2).toContain(MARKER) // tmux redraws the pane on attach -> reattach genuinely works
    bridge2.detach(rec.id)
    db2.close()
  })
})
