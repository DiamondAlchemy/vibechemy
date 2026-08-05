import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const pexec = promisify(execFile)

/**
 * execFile buffers stdout in memory and rejects once it passes maxBuffer (default 1 MB) with
 * RangeError [ERR_CHILD_PROCESS_STDIO_MAXBUFFER]: "stdout maxBuffer length exceeded". A pane capture is the one tmux call that routinely exceeds that: the pane
 * History button asks for 5000 lines, and a wide pane full of coloured agent output carries far
 * more than 200 bytes a line. The rejection is swallowed by the History handler's `.catch(() => '')`,
 * so the operator sees "(no scrollback captured yet)" on exactly the busiest panes — the ones with
 * the most worth reading. 32 MB comfortably covers a full-width 5000-line capture.
 */
export const CAPTURE_MAX_BUFFER = 32 * 1024 * 1024

/**
 * Vibechemy runs its own tmux server on a dedicated socket so our mouse,
 * copy-mode and clipboard config never touches the user's personal tmux (the
 * default socket). Every tmux invocation in the app — including PtyBridge's
 * `attach-session` — MUST go through this socket, or it'll talk to the wrong
 * server and our sessions/bindings won't be found. The dev identity points this
 * at 'vibechemy-dev' at boot so a dev instance never touches the
 * production fleet.
 */
let SOCKET = 'vibechemy'

export function tmuxSocket(): string {
  return SOCKET
}

/** Called once at boot by index.ts with the resolved identity's socket. */
export function setTmuxSocket(name: string): void {
  SOCKET = name
}

/** Prefix every tmux call with `-L <socket>` (our private server). */
function t(...args: string[]): string[] {
  return ['-L', SOCKET, ...args]
}

/** True if `name` resolves on PATH. `name` is always one of our own literals, never user input. */
async function binaryExists(name: string): Promise<boolean> {
  try {
    await pexec('sh', ['-c', `command -v ${name}`])
    return true
  } catch {
    return false
  }
}

let clipboardCommand: string | null | undefined

/**
 * The command tmux's copy-pipe binding pipes a selection into.
 *
 * macOS has pbcopy and nothing else is needed. On Linux the right tool depends on the session
 * (Wayland vs X11) and on what the user actually installed, so resolve once at boot instead of
 * baking in a binary that may not exist — a missing one makes copy-pipe fail silently, which
 * presents as "drag-select just doesn't copy" with nothing in any log.
 *
 * Returns null when nothing suitable is installed; the caller then skips the copy-pipe bindings
 * entirely rather than installing a binding that cannot work.
 */
export async function resolveClipboardCommand(
  opts: {
    platform?: NodeJS.Platform
    env?: NodeJS.ProcessEnv
    exists?: (binary: string) => Promise<boolean>
  } = {}
): Promise<string | null> {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const exists = opts.exists ?? binaryExists
  // Injected options mean a test case, not the live app — don't read or poison the cache.
  const live = !opts.platform && !opts.env && !opts.exists
  if (live && clipboardCommand !== undefined) return clipboardCommand

  const resolve = async (): Promise<string | null> => {
    if (platform === 'darwin') return 'pbcopy'
    // Gate each tool on the display server ACTUALLY being present, not merely on the binary being
    // on PATH. xclip/xsel without DISPLAY, or wl-copy without WAYLAND_DISPLAY, install happily and
    // then fail at COPY time — which is the exact silent failure this function exists to avoid.
    // A headless session has no clipboard to reach, so it correctly resolves to null.
    const candidates: string[] = []
    // stdout is redirected because xclip and xsel hold the selection by staying resident; left
    // attached to tmux's pipe, tmux can wait on them and the pane appears to hang after a drag.
    if (env.WAYLAND_DISPLAY) candidates.push('wl-copy')
    if (env.DISPLAY) {
      candidates.push('xclip -selection clipboard -i >/dev/null 2>&1', 'xsel --clipboard --input >/dev/null 2>&1')
    }
    for (const candidate of candidates) {
      if (await exists(candidate.split(' ')[0])) return candidate
    }
    return null
  }

  const resolved = await resolve()
  if (live) clipboardCommand = resolved
  return resolved
}

/** Test seam: forget the cached probe so a test can exercise a different platform/session. */
export function resetClipboardCommand(): void {
  clipboardCommand = undefined
}

export async function hasTmux(): Promise<boolean> {
  try {
    // Intentionally no -L: just checks the binary exists, not our server.
    await pexec('tmux', ['-V'])
    return true
  } catch {
    return false
  }
}

/**
 * Configure OUR tmux server for the way Vibechemy drives panes.
 * Server-global, idempotent, and re-applied on every spawn on purpose: a tmux
 * server exits once its last session dies, so a fresh server (default config)
 * can appear at any time — re-asserting here keeps the config from silently
 * reverting.
 */
export async function configureServer(): Promise<void> {
  // Mouse ON keeps both wheel scrolling and the single-click-to-type guarantee. The wheel is
  // forwarded below, while unmodified left-CLICKS are intercepted renderer-side in TerminalPane
  // (capture phase → pure focus, never sent to tmux/the app). An overlay alone cannot recover
  // alt-screen transcripts because those panes have no tmux history (history_size=0).
  await pexec('tmux', t('set-option', '-g', 'mouse', 'on'))
  await pexec('tmux', t('set-option', '-g', 'set-clipboard', 'on'))
  // Real scrollback for shells/primary-screen panes (agent TUIs keep their transcript internally).
  await pexec('tmux', t('set-option', '-g', 'history-limit', '50000'))
  // Vibechemy renders its own pane chrome — hide tmux's status line (it also leaks the hostname).
  await pexec('tmux', t('set-option', '-g', 'status', 'off'))
  // Wheel routing: an app that requested mouse (Claude/OpenCode/Codex TUIs) gets the wheel events
  // and scrolls ITS OWN transcript — exactly like iTerm2; anything else on the primary screen
  // (plain shell, pagers) enters copy-mode (-e = auto-exit at the bottom) and scrolls real tmux
  // history. Alt-screen without mouse has nothing to scroll (no history) — the wheel is a no-op
  // there and the pane History button remains the fallback.
  const wheelCond = '#{mouse_any_flag}'
  await pexec(
    'tmux',
    t(
      'bind-key',
      '-n',
      'WheelUpPane',
      'if-shell',
      '-Ft=',
      wheelCond,
      'send-keys -Mt=',
      'if-shell -Ft= "#{alternate_on}" "" "copy-mode -et="'
    )
  )
  await pexec('tmux', t('bind-key', '-n', 'WheelDownPane', 'if-shell', '-Ft=', wheelCond, 'send-keys -Mt=', ''))
  // Drag-select in copy-mode pipes straight to the macOS clipboard and KEEPS the selection lit;
  // default copy-pipe-and-cancel drops the highlight and loses the copy. A PLAIN CLICK while
  // scrolled back EXITS copy-mode to the live prompt so the next click or keystroke is not trapped.
  // Drag-select still works: the mousedown cancels, the drag re-enters copy-mode selection via the
  // root MouseDrag1Pane default, and release copy-pipes.
  const clipboard = await resolveClipboardCommand()
  for (const table of ['copy-mode', 'copy-mode-vi']) {
    if (clipboard) {
      await pexec('tmux', t('bind-key', '-T', table, 'MouseDragEnd1Pane', 'send-keys', '-X', 'copy-pipe', clipboard))
    } else {
      // Explicitly UNBIND rather than just skipping: leaving tmux's default MouseDragEnd1Pane in
      // place runs copy-selection-and-cancel, which drops the highlight and exits copy mode while
      // reaching no system clipboard. Unbound, a drag leaves the selection lit and the operator can
      // still copy it through the pane's own Copy menu.
      await pexec('tmux', t('unbind-key', '-T', table, 'MouseDragEnd1Pane')).catch(() => {})
    }
    await pexec('tmux', t('bind-key', '-T', table, 'MouseDown1Pane', 'send-keys', '-X', 'cancel'))
  }
}

/** Creates a detached session; `command` is run by tmux via `sh -c`. */
export async function newDetachedSession(name: string, cwd: string, command: string): Promise<void> {
  await pexec('tmux', t('new-session', '-d', '-s', name, '-c', cwd, command))
  await configureServer()
}

export async function hasSession(name: string): Promise<boolean> {
  try {
    await pexec('tmux', t('has-session', '-t', name))
    return true
  } catch {
    return false
  }
}

export async function killSession(name: string): Promise<void> {
  await pexec('tmux', t('kill-session', '-t', name))
}

/**
 * Send literal text to a session's active pane, then Enter to submit it. Used by
 * the control plane to inject a task prompt into a freshly-spawned worker. `-l`
 * sends the text literally (no key-name interpretation, so e.g. "Enter" in the
 * task isn't turned into a keypress).
 *
 * The pause before Enter is load-bearing: a fast multi-char burst
 * trips Claude Code's paste heuristic, and an Enter arriving in the SAME burst
 * gets folded into the paste as a literal newline — the prompt stages in the
 * input box and never submits. The gap lets the
 * TUI close the paste so the Enter lands as a discrete keypress.
 */
export const SUBMIT_DELAY_MS = 300
// The `--` end-of-options marker is load-bearing: user text starting with a dash
// ("--force", "-v") is otherwise parsed as send-keys flags and errors.
export async function sendKeys(name: string, text: string): Promise<void> {
  if (text.length > 0) {
    await pexec('tmux', t('send-keys', '-t', name, '-l', '--', text))
    // unref so an in-flight injection during before-quit never holds the process open (matches
    // paneReady's defaultDelay).
    await new Promise<void>((r) => {
      const h = setTimeout(r, SUBMIT_DELAY_MS)
      if (typeof h.unref === 'function') h.unref()
    })
  }
  await pexec('tmux', t('send-keys', '-t', name, 'Enter'))
}

/** Type literal text WITHOUT submitting — the insert-only half of cross-workspace
 *  dispatch: the user proofreads and presses Enter themselves. */
export async function sendKeysNoEnter(name: string, text: string): Promise<void> {
  if (text.length === 0) return
  await pexec('tmux', t('send-keys', '-t', name, '-l', '--', text))
}

/** Capture a session pane's recent visible output (incl. `lines` of scrollback) — used
 *  by the control plane so the orchestrator can read a worker's own narrative. */
export async function capturePane(name: string, lines = 200): Promise<string> {
  const { stdout } = await pexec('tmux', t('capture-pane', '-t', name, '-p', '-S', `-${lines}`), {
    maxBuffer: CAPTURE_MAX_BUFFER
  })
  return stdout
}

/**
 * Cancel tmux copy-mode on a pane — a no-op if the pane isn't in a mode (the error is ignored).
 * A primary-screen pane (Codex, plain shells) enters copy-mode on a wheel-scroll to show history;
 * the app's focus-click swallow means a click alone never reaches tmux to exit it, so paste/typing
 * would stay trapped in copy-mode instead of reaching the app. The renderer fires this on the
 * focusing click so one click both focuses AND un-sticks.
 */
export async function cancelCopyMode(name: string): Promise<void> {
  await pexec('tmux', t('send-keys', '-t', name, '-X', 'cancel')).catch(() => {})
}

export async function listSessions(): Promise<string[]> {
  try {
    const { stdout } = await pexec('tmux', t('list-sessions', '-F', '#{session_name}'))
    return stdout
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
  } catch {
    return [] // no server running → no sessions
  }
}
