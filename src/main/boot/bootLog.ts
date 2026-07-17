/**
 * Tiny persistent boot ledger for the packaged always-on app. Launchd swallows
 * the console of login-item launches, so before this existed there was NO trace
 * of which binary ran, what it registered, or whether the MCP port bound. One line
 * per event in <userData>/boot.log; best-effort
 * everywhere — logging must never take the app down.
 */
import { appendFileSync, renameSync, statSync } from 'fs'

export type BootFields = Record<string, string | number | boolean>

export function formatBootLine(now: Date, fields: BootFields): string {
  const pairs = Object.entries(fields).map(([k, v]) => {
    const s = String(v)
    return `${k}=${/\s/.test(s) ? JSON.stringify(s) : s}`
  })
  return `${now.toISOString()} ${pairs.join(' ')}`
}

const DEFAULT_MAX_BYTES = 512 * 1024

export function createBootLogger(
  file: string,
  opts: { maxBytes?: number; now?: () => Date } = {}
): (fields: BootFields) => void {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES
  const now = opts.now ?? ((): Date => new Date())
  return (fields: BootFields): void => {
    try {
      try {
        if (statSync(file).size > maxBytes) renameSync(file, `${file}.1`) // single-slot rotation
      } catch {
        // file missing — nothing to rotate
      }
      appendFileSync(file, formatBootLine(now(), fields) + '\n')
    } catch {
      // best-effort: an unwritable log must never break boot
    }
  }
}
