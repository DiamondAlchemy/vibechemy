// Textarea bulk inserts can deliver an entire phrase to xterm as one raw
// burst, NOT through the paste path — so xterm forwards it to the PTY without the bracketed-paste
// framing a real Cmd+V gets. The CLI then treats the burst as fast typing and re-wraps its input
// box character-by-character, with dictated text visibly reflowing as it lands.
// Wrapping the burst in bracketed-paste markers makes the CLI insert it atomically (one block, one
// redraw) — the same way it already handles a paste.

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/**
 * Frame a bulk text burst as a bracketed paste, but only when it's safe and useful:
 *  - the program must have bracketed-paste mode enabled (else the markers are literal junk);
 *  - single keystrokes are left alone (normal typing);
 *  - anything containing ESC is left alone — that's a control sequence, a terminal response, or a
 *    real Cmd+V that xterm already framed (don't double-wrap).
 */
export function bracketBulkInput(data: string, bracketedPasteMode: boolean): string {
  if (!bracketedPasteMode) return data
  if (data.length <= 1) return data
  if (data.includes('\x1b')) return data
  return PASTE_START + data + PASTE_END
}
