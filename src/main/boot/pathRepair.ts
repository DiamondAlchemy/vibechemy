import { spawnSync } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * login/Finder-launched macOS apps inherit launchd's bare PATH (no homebrew),
 * which would break every bare `tmux`/`git` exec, every preset command, and the
 * env every pane inherits. Repair process.env.PATH once at
 * boot, before the tmux gate and before anything spawns.
 */
export const HOMEBREW_SENTINEL = '/opt/homebrew/bin'

/**
 * Where the agent CLIs we ship presets for actually land. These are merged UNCONDITIONALLY
 * (see repairPath) because an agent installed AFTER the app booted must still be runnable —
 * a PATH entry for a not-yet-existing directory is harmless, and the lookup happens at exec
 * time. Verified against real installs on 2026-07-28:
 *   ~/.local/bin      claude, codex, cursor-agent, agy, grok (curl installers' common target)
 *   ~/.kimi-code/bin  kimi (code.kimi.com installer; it PATHs via ~/.zshrc, which the app never sources)
 *   ~/.grok/bin       grok (x.ai/cli installer's own target)
 *   ~/.bun/bin        anything installed with bun (an opencode install path)
 */
const FALLBACK_DIRS = [
  HOMEBREW_SENTINEL,
  '/usr/local/bin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.kimi-code', 'bin'),
  join(homedir(), '.grok', 'bin'),
  join(homedir(), '.bun', 'bin')
]

/** Current entries keep priority; captured + fallback dirs are appended, deduped. */
export function mergePath(current: string | undefined, captured: string | undefined, fallback: string[]): string {
  const parts: string[] = []
  const push = (p: string): void => {
    if (p && !parts.includes(p)) parts.push(p)
  }
  for (const p of (current ?? '').split(':')) push(p)
  for (const p of (captured ?? '').split(':')) push(p)
  for (const p of fallback) push(p)
  return parts.join(':')
}

/**
 * Ask the user's login shell for its real PATH. Interactive+login (-il) so the
 * usual rc files run; the \x1f markers isolate the value from any rc-file noise.
 */
export function captureLoginShellPath(shell = process.env.SHELL || '/bin/zsh'): string | undefined {
  try {
    const r = spawnSync(shell, ['-ilc', 'printf "\\x1f%s\\x1f" "$PATH"'], { timeout: 3000, encoding: 'utf8' })
    if (r.error) {
      console.warn('[pathRepair] login-shell PATH capture failed:', r.error.message)
      return undefined
    }
    // eslint-disable-next-line no-control-regex -- the \x1f markers are the point
    const m = /\x1f([^\x1f]*)\x1f/.exec(r.stdout ?? '')
    const path = m?.[1]?.trim()
    return path && path.includes('/') ? path : undefined
  } catch {
    return undefined
  }
}

/**
 * Repair PATH at boot. The static FALLBACK_DIRS are ALWAYS folded in (cheap, deduped) — a tool
 * installed into ~/.kimi-code/bin or ~/.local/bin after boot, or reachable only via a fallback
 * dir when homebrew already happens to be on PATH, must still be found. Only the EXPENSIVE
 * login-shell capture is gated on the homebrew sentinel: a normal dev terminal (homebrew
 * present) skips the ~80ms `zsh -ilc` spawn, but its fallbacks still land.
 *
 * (2026-07-28: the old early-return-when-homebrew-present made FALLBACK_DIRS dead on every
 * install launched from a terminal, so a fresh `curl … kimi` install into ~/.kimi-code/bin
 * stayed invisible and `kimi` panes exited 127 instantly.)
 */
export function repairPath(
  env: Record<string, string | undefined> = process.env,
  capture: () => string | undefined = captureLoginShellPath
): void {
  const current = env.PATH ?? ''
  const captured = current.split(':').includes(HOMEBREW_SENTINEL) ? undefined : capture()
  env.PATH = mergePath(current, captured, FALLBACK_DIRS)
}
