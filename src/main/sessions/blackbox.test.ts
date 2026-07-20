import { beforeEach, describe, expect, it, vi } from 'vitest'
import { openDatabase } from '../db/database'
import { PresetRegistry } from '../presets/PresetRegistry'
import * as tmuxApi from './tmux'
import { SessionManager } from './SessionManager'
import { appendRenderedTail, boundLastOutput, LAST_OUTPUT_MAX_CHARS, LAST_OUTPUT_MAX_LINES } from './blackbox'

const fakePty = vi.hoisted(() => ({
  emitData: (() => {}) as (data: string) => void,
  emitExit: (() => {}) as (exitCode: number) => void
}))

vi.mock('node-pty', () => ({
  spawn: vi.fn(() => {
    let dataCb: (data: string) => void = () => {}
    let exitCb: (event: { exitCode: number }) => void = () => {}
    fakePty.emitData = (data) => dataCb(data)
    fakePty.emitExit = (exitCode) => exitCb({ exitCode })
    return {
      onData: (cb: (data: string) => void) => {
        dataCb = cb
        return { dispose: () => {} }
      },
      onExit: (cb: (event: { exitCode: number }) => void) => {
        exitCb = cb
        return { dispose: () => {} }
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn()
    }
  })
}))

import { PtyBridge, type PtyExitSnapshot } from './PtyBridge'

describe('black-box output bounds', () => {
  it('keeps only the final 200 plain-text lines', () => {
    const output = Array.from({ length: LAST_OUTPUT_MAX_LINES + 5 }, (_, i) => `line-${i}`).join('\n')
    const bounded = boundLastOutput(`\u001b[31m${output}\u001b[0m`)

    expect(bounded.split('\n')).toHaveLength(LAST_OUTPUT_MAX_LINES)
    expect(bounded).not.toContain('\u001b[')
    expect(bounded.startsWith('line-5')).toBe(true)
    expect(bounded.endsWith(`line-${LAST_OUTPUT_MAX_LINES + 4}`)).toBe(true)
  })

  it('caps a single giant line and the live rendered fallback', () => {
    expect(boundLastOutput('x'.repeat(LAST_OUTPUT_MAX_CHARS + 50))).toHaveLength(LAST_OUTPUT_MAX_CHARS)
    expect(appendRenderedTail('', 'x'.repeat(LAST_OUTPUT_MAX_CHARS * 3)).length).toBeLessThanOrEqual(
      LAST_OUTPUT_MAX_CHARS * 2
    )
  })
})

describe('PtyBridge black-box fallback', () => {
  beforeEach(() => {
    fakePty.emitData = () => {}
    fakePty.emitExit = () => {}
  })

  it('reports the bounded rendered tail and exit code when a pane is gone', async () => {
    const exits: PtyExitSnapshot[] = []
    const bridge = new PtyBridge(
      () => {},
      (_id, snapshot) => exits.push(snapshot),
      () => 1,
      async () => false
    )
    bridge.attach('session', 'tmux-name', 80, 24)
    fakePty.emitData('\u001b[33mfinal words\u001b[0m\r\n')
    fakePty.emitExit(17)

    await vi.waitFor(() => expect(exits).toEqual([{ exitCode: 17, output: 'final words\n' }]))
  })
})

describe('SessionManager black-box persistence', () => {
  it('prefers capture-pane and persists the snapshot on an unexpected exit', async () => {
    const db = openDatabase(':memory:')
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run('dead', null, 'shell', 'mc_dead', '/tmp', 'Shell', 'running', 1, 1)
    const tmux = {
      ...tmuxApi,
      capturePane: vi.fn(async () => 'captured final line'),
      hasSession: vi.fn(async () => false)
    }
    const sessions = new SessionManager(db, PresetRegistry.from([]), tmux)

    expect(await sessions.markExitedIfGone('dead', { exitCode: 9, output: 'fallback' })).toBe(true)
    expect(tmux.capturePane).toHaveBeenCalledWith('mc_dead', LAST_OUTPUT_MAX_LINES)
    expect(sessions.rowById('dead')).toMatchObject({
      status: 'exited',
      lastOutput: 'captured final line',
      lastExitCode: 9
    })
    db.close()
  })

  it('uses the rendered tail when capture-pane loses the teardown race', async () => {
    const db = openDatabase(':memory:')
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run('dead', null, 'shell', 'mc_dead', '/tmp', 'Shell', 'running', 1, 1)
    const tmux = {
      ...tmuxApi,
      capturePane: vi.fn(async () => {
        throw new Error('pane is gone')
      }),
      hasSession: vi.fn(async () => false)
    }
    const sessions = new SessionManager(db, PresetRegistry.from([]), tmux)

    expect(await sessions.markExitedIfGone('dead', { exitCode: 1, output: 'the fallback tail' })).toBe(true)
    expect(sessions.rowById('dead')).toMatchObject({ lastOutput: 'the fallback tail', lastExitCode: 1 })
    db.close()
  })

  it('does not capture a deliberate close even if its pty exit arrives during kill', async () => {
    const db = openDatabase(':memory:')
    db.prepare(
      'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?,?,?)'
    ).run('closing', null, 'shell', 'mc_closing', '/tmp', 'Shell', 'running', 1, 1)
    let hasSessionCalls = 0
    const managerRef: { current?: SessionManager } = {}
    let exitMarked: Promise<boolean> | undefined
    const tmux = {
      ...tmuxApi,
      capturePane: vi.fn(async () => 'must not be retained'),
      hasSession: vi.fn(async () => ++hasSessionCalls === 1),
      killSession: vi.fn(async () => {
        exitMarked = managerRef.current!.markExitedIfGone('closing', {
          exitCode: 0,
          output: 'must not be retained'
        })
        await exitMarked
      })
    }
    const sessions = new SessionManager(db, PresetRegistry.from([]), tmux)
    managerRef.current = sessions

    await sessions.kill('closing')
    expect(await exitMarked).toBe(true)
    expect(tmux.capturePane).not.toHaveBeenCalled()
    expect(sessions.rowById('closing')).toMatchObject({ lastOutput: null, lastExitCode: null })
    db.close()
  })

  it('adds nullable snapshot columns to existing session databases', () => {
    const db = openDatabase(':memory:')
    const columns = db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]
    expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining(['last_output', 'last_exit_code']))
    db.close()
  })
})
