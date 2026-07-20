import { stripVTControlCharacters } from 'node:util'

export const LAST_OUTPUT_MAX_LINES = 200
export const LAST_OUTPUT_MAX_CHARS = 64 * 1024

// Keep a little more raw PTY data than the persisted limit so split ANSI sequences survive until
// the final cleanup pass. This is still bounded for an always-on app and per live pane.
const RENDERED_TAIL_MAX_LINES = LAST_OUTPUT_MAX_LINES * 2
const RENDERED_TAIL_MAX_CHARS = LAST_OUTPUT_MAX_CHARS * 2

/** Append terminal data to the race-safe fallback captured from the already-rendered PTY stream. */
export function appendRenderedTail(previous: string, chunk: string): string {
  const combined = previous + chunk
  const byLines = combined.split('\n').slice(-RENDERED_TAIL_MAX_LINES).join('\n')
  return byLines.length > RENDERED_TAIL_MAX_CHARS ? byLines.slice(-RENDERED_TAIL_MAX_CHARS) : byLines
}

/** Normalize and hard-cap the text persisted for an unexpectedly-ended pane. */
export function boundLastOutput(output: string): string {
  const plain = stripVTControlCharacters(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const byLines = plain.split('\n').slice(-LAST_OUTPUT_MAX_LINES).join('\n')
  return byLines.length > LAST_OUTPUT_MAX_CHARS ? byLines.slice(-LAST_OUTPUT_MAX_CHARS) : byLines
}
