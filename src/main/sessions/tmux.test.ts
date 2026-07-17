import { describe, it, expect, afterEach } from 'vitest'
import {
  hasTmux,
  newDetachedSession,
  hasSession,
  listSessions,
  killSession,
  sendKeys,
  sendKeysNoEnter,
  capturePane,
  tmuxSocket
} from './tmux'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'

const pexec = promisify(execFile)
const NAME = 'mc_test_' + process.pid

afterEach(async () => {
  if (await hasSession(NAME)) await killSession(NAME)
})

describe('tmux helpers (integration)', () => {
  it('detects tmux is installed', async () => {
    expect(await hasTmux()).toBe(true)
  })

  it('creates, lists, detects and kills a detached session', async () => {
    await newDetachedSession(NAME, tmpdir(), 'sleep 120')
    expect(await hasSession(NAME)).toBe(true)
    expect(await listSessions()).toContain(NAME)
    await killSession(NAME)
    expect(await hasSession(NAME)).toBe(false)
  })

  it('runs on a dedicated socket, isolated from the default tmux server', async () => {
    await newDetachedSession(NAME, tmpdir(), 'sleep 120')
    // The session must NOT be visible on the user's default tmux server.
    let onDefaultServer = false
    try {
      await pexec('tmux', ['has-session', '-t', NAME]) // default socket, no -L
      onDefaultServer = true
    } catch {
      onDefaultServer = false
    }
    expect(onDefaultServer).toBe(false)
  })

  it('sends literal input to a pane (task injection)', async () => {
    await newDetachedSession(NAME, tmpdir(), 'cat') // cat echoes each submitted line back into the pane
    await sendKeys(NAME, 'MARKER123')
    await new Promise((r) => setTimeout(r, 400))
    const { stdout } = await pexec('tmux', ['-L', tmuxSocket(), 'capture-pane', '-t', NAME, '-p'])
    expect(stdout).toContain('MARKER123')
    await killSession(NAME)
  })

  it('captures a pane’s recent output', async () => {
    await newDetachedSession(NAME, tmpdir(), 'cat')
    await sendKeys(NAME, 'CAPTURE_ME_42')
    await new Promise((r) => setTimeout(r, 400))
    const out = await capturePane(NAME)
    expect(out).toContain('CAPTURE_ME_42')
    await killSession(NAME)
  })

  it('configures the server on every spawn: mouse ON (natural scroll v2), history 50k, wheel bindings, set-clipboard on', async () => {
    await newDetachedSession(NAME, tmpdir(), 'sleep 120')
    // With mouse ON, the wheel forwards to apps / copy-mode; clicks are swallowed renderer-side in
    // TerminalPane so the single-click-to-type guarantee survives.
    const { stdout: mouse } = await pexec('tmux', ['-L', tmuxSocket(), 'show-options', '-g', 'mouse'])
    expect(mouse.trim()).toBe('mouse on')
    const { stdout: hist } = await pexec('tmux', ['-L', tmuxSocket(), 'show-options', '-g', 'history-limit'])
    expect(hist.trim()).toBe('history-limit 50000')
    const { stdout: binds } = await pexec('tmux', ['-L', tmuxSocket(), 'list-keys'])
    expect(binds).toContain('WheelUpPane')
    expect(binds).toContain('copy-pipe pbcopy')
    // A scrolled-back pane must exit copy-mode instead of trapping the next click.
    expect(binds).toMatch(/copy-mode\s+MouseDown1Pane\s+send-keys -X cancel/)
    const { stdout: clip } = await pexec('tmux', ['-L', tmuxSocket(), 'show-options', '-g', 'set-clipboard'])
    expect(clip.trim()).toBe('set-clipboard on')
    // status line OFF: the app draws its own pane chrome; the tmux bar would leak the hostname
    const { stdout: status } = await pexec('tmux', ['-L', tmuxSocket(), 'show-options', '-g', 'status'])
    expect(status.trim()).toBe('status off')
  })
})

it('sendKeysNoEnter types WITHOUT submitting (insert-only cross-workspace dispatch)', async () => {
  await newDetachedSession(NAME, tmpdir(), 'cat') // cat echoes each SUBMITTED line back
  await sendKeysNoEnter(NAME, 'STAGED_ONLY_99')
  await new Promise((r) => setTimeout(r, 400))
  const before = await capturePane(NAME)
  // typed on the input line (tty echo) but NOT submitted — cat has not echoed a second copy
  expect(before.match(/STAGED_ONLY_99/g)?.length).toBe(1)
  await sendKeys(NAME, '') // the lone-Enter rescue submits it
  await new Promise((r) => setTimeout(r, 400))
  const after = await capturePane(NAME)
  expect(after.match(/STAGED_ONLY_99/g)?.length).toBe(2)
  await killSession(NAME)
})

it('dash-leading operator text is sent literally, not parsed as flags', async () => {
  await newDetachedSession(NAME, tmpdir(), 'cat')
  await sendKeys(NAME, '--force -v hello')
  await new Promise((r) => setTimeout(r, 400))
  const out = await capturePane(NAME)
  expect(out).toContain('--force -v hello')
  await killSession(NAME)
})
