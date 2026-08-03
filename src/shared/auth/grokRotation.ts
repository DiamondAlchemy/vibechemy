/**
 * Policy for whether Vibechemy may rotate the grok CLI's OAuth token.
 *
 * Rotation is not a read. It POSTs the refresh token to x.ai and then REWRITES
 * `~/.grok/auth.json` — a credential file this app does not own. Two consequences follow, and
 * both are why it is opt-in rather than automatic:
 *
 *  1. x.ai may return a NEW refresh token (the caller does `t.refresh_token ?? session.refresh`),
 *     which typically invalidates the old one server-side. If the write-back then fails, the new
 *     token is lost with the process and the file holds a dead one — silently signing the operator
 *     out of a CLI they never asked us to touch.
 *  2. The write is read-modify-write. The atomic rename prevents a half-written file, but not a
 *     lost update if the grok CLI rotates the same file concurrently.
 *
 * Reading an existing valid token is unaffected: that is what every other usage adapter does.
 */

/** Setting key. Deliberately not `usage.*` — this governs Studio image generation too. */
export const GROK_ROTATION_OPT_IN_KEY = 'grok.allowTokenRotation'

/** Refresh once under this many seconds of life remain. */
export const GROK_SKEW_S = 120

export type GrokTokenPlan =
  /** The current access token is good — hand it over, touch nothing. */
  | 'use-current'
  /** Expiring or expired AND rotation is permitted — refresh and write back. */
  | 'rotate'
  /** Expiring or expired and rotation is NOT permitted — do not write; try other sources. */
  | 'fallback'

/**
 * Decide what to do with a grok session, given the clock and the operator's consent.
 *
 * `allowRotation` defaults to false at every call site: an un-set setting must mean "do not write
 * to someone else's credential file", never "assume yes".
 */
export function planGrokToken(input: {
  /** JWT `exp` in SECONDS since epoch; 0 when unparseable. */
  accessExpSec: number
  nowMs: number
  allowRotation: boolean
}): GrokTokenPlan {
  const secondsLeft = input.accessExpSec - input.nowMs / 1000
  if (secondsLeft > GROK_SKEW_S) return 'use-current'
  if (input.allowRotation) return 'rotate'
  // Still a few seconds of life: better to spend them than to write to a file we do not own.
  return secondsLeft > 0 ? 'use-current' : 'fallback'
}
