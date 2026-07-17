import { describe, it, expect, afterEach } from 'vitest'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { PtyBridge } from './PtyBridge'
import { newDetachedSession, hasSession, killSession, tmuxSocket } from './tmux'

const pexec = promisify(execFile)
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Count the attach clients tmux currently holds FOR THIS SESSION (never the user's real panes). */
async function countClients(name: string): Promise<number> {
  try {
    const { stdout } = await pexec('tmux', ['-L', tmuxSocket(), 'list-clients', '-t', name])
    return stdout.split('\n').filter((l) => l.trim().length > 0).length
  } catch {
    return 0 // session/server gone → no clients
  }
}

let names: string[] = []
afterEach(async () => {
  for (const n of names) if (await hasSession(n)) await killSession(n)
  names = []
})

function uniqueName(tag: string): string {
  const n = `vibechemy_selfheal_${tag}_${process.pid}_${Math.random().toString(36).slice(2, 8)}`
  names.push(n)
  return n
}

describe('PtyBridge self-heal (integration, real tmux)', () => {
  it('re-attaches when the attach client dies involuntarily but the tmux session is alive', async () => {
    const name = uniqueName('heal')
    await newDetachedSession(name, tmpdir(), "sh -c 'while true; do echo TICK; sleep 1; done'")
    const exited: string[] = []
    const bridge = new PtyBridge(
      () => {},
      (id) => exited.push(id)
    )
    bridge.attach(name, name, 80, 24, 'viewer-heal')
    await wait(600)
    expect(await countClients(name)).toBe(1)

    // Simulate an INVOLUNTARY client death (the self-heal trigger): tmux drops our client,
    // but the SESSION stays alive. PtyBridge did NOT call detach(), so this is not deliberate.
    await pexec('tmux', ['-L', tmuxSocket(), 'detach-client', '-s', name])
    await wait(300)
    expect(await countClients(name)).toBe(0) // proves the client really died (bug repro point)

    // Self-heal: after the backoff, exactly ONE client re-appears (no double-attach), and the
    // involuntary death was NOT reported as an exit (no tombstone — the pane recovers silently).
    await wait(1500)
    expect(await countClients(name)).toBe(1)
    expect(exited).toEqual([])

    bridge.disposeAll()
  })

  it('does NOT re-attach a DELIBERATE detach (viewer closed the pane)', async () => {
    const name = uniqueName('detach')
    await newDetachedSession(name, tmpdir(), "sh -c 'while true; do echo TICK; sleep 1; done'")
    const bridge = new PtyBridge(
      () => {},
      () => {}
    )
    bridge.attach(name, name, 80, 24, 'viewer-detach')
    await wait(600)
    expect(await countClients(name)).toBe(1)

    await bridge.detach(name) // deliberate: kill the viewer, keep the session
    await wait(1500) // well past the heal backoff — a heal would have re-attached by now
    expect(await countClients(name)).toBe(0) // stayed detached; the session is still alive though
    expect(await hasSession(name)).toBe(true)

    bridge.disposeAll()
  })

  it('does NOT re-attach when the tmux session is genuinely gone — it reports the exit instead', async () => {
    const name = uniqueName('gone')
    await newDetachedSession(name, tmpdir(), "sh -c 'while true; do echo TICK; sleep 1; done'")
    const exited: string[] = []
    const bridge = new PtyBridge(
      () => {},
      (id) => exited.push(id)
    )
    bridge.attach(name, name, 80, 24, 'viewer-gone')
    await wait(600)
    expect(await countClients(name)).toBe(1)

    await killSession(name) // the session itself dies → the client dies with it (involuntary, but gone)
    names = names.filter((n) => n !== name)
    await wait(1500)
    expect(exited).toEqual([name]) // reported once → the normal tombstone path, NOT a heal
    expect(await countClients(name)).toBe(0)

    bridge.disposeAll()
  })

  it('does NOT re-attach if the pane is deliberately closed DURING the heal backoff', async () => {
    const name = uniqueName('close-mid-heal')
    await newDetachedSession(name, tmpdir(), "sh -c 'while true; do echo TICK; sleep 1; done'")
    let capturedHeal: (() => void) | null = null
    const exited: string[] = []
    // Capture the scheduled heal instead of letting it fire, so we control the exact window where
    // the pane is closed mid-backoff — the race that would otherwise re-attach a ghost.
    const bridge = new PtyBridge(
      () => {},
      (id) => exited.push(id),
      () => Date.now(),
      hasSession,
      (fn) => {
        capturedHeal = fn
      }
    )
    bridge.attach(name, name, 80, 24, 'viewer-close-mid-heal')
    await wait(600)
    expect(await countClients(name)).toBe(1)

    // Involuntary client death → a heal is SCHEDULED (captured, not yet fired).
    await pexec('tmux', ['-L', tmuxSocket(), 'detach-client', '-s', name])
    await wait(300)
    expect(await countClients(name)).toBe(0)
    expect(capturedHeal).not.toBeNull()

    // The user closes/hides the pane during the backoff — a deliberate teardown, but the client is
    // already dead so detach() can't mark `closing`; it clears attachInfo, and the pending heal must
    // read that absence and BAIL rather than resurrect a client with no viewer.
    await bridge.detach(name)
    capturedHeal!()
    await wait(600)
    expect(await countClients(name)).toBe(0) // no ghost re-attach
    expect(await hasSession(name)).toBe(true) // session untouched — we just didn't reopen a closed pane
    expect(exited).toEqual([])

    bridge.disposeAll()
  })
})
