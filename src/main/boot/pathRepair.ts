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

// ~/.kimi-code/bin = the official Kimi installer's default target (it PATHs via ~/.zshrc, which
// login-shell probes never source — without this entry a fresh curl install stays invisible).
const FALLBACK_DIRS = [
  HOMEBREW_SENTINEL,
  '/usr/local/bin',
  join(homedir(), '.local', 'bin'),
  join(homedir(), '.kimi-code', 'bin')
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

/** No-op when homebrew is already reachable (a normal dev terminal). */
export function repairPath(
  env: Record<string, string | undefined> = process.env,
  capture: () => string | undefined = captureLoginShellPath
): void {
  const current = env.PATH ?? ''
  if (current.split(':').includes(HOMEBREW_SENTINEL)) return
  env.PATH = mergePath(current, capture(), FALLBACK_DIRS)
}
