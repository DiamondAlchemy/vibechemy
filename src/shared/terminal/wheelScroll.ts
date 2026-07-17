/**
 * Fallback wheel policy for terminal panes. tmux mouse normally stays ON and forwards the wheel;
 * this seam handles the no-mouse-mode fallback without sacrificing single-click-to-type. One rule:
 *
 * - Primary screen (plain shell; anything rendering line-by-line) → let xterm
 *   scroll its local 5000-line viewport (native scrollback feel).
 * - ALTERNATE screen (any full-screen TUI that owns the viewport) → wheel-UP
 *   opens the app's capture-pane History overlay; wheel-DOWN over the live view is
 *   inert. MOUSE-TRACKING NO LONGER BYPASSES THIS: the agent CLIs (Claude,
 *   OpenCode) request mouse reporting and map wheel→arrow keys, which CYCLES
 *   THE USER'S TYPED PROMPTS instead of scrolling. Handling every alt-screen pane identically
 *   prevents mouse-reporting CLIs from bypassing the fallback.
 *
 * Trade-off, accepted deliberately: full-screen apps that scroll properly on a
 * forwarded wheel (vim, htop) also get the overlay on wheel-up instead of
 * in-app scrolling. App panes are overwhelmingly agent CLIs; consistency wins. Keyboard inside
 * vim still works.
 *
 * Pure and stateless → unit-testable.
 */
export type WheelAction = { kind: 'xterm' } | { kind: 'inert' } | { kind: 'history' }

export function wheelToAction(deltaY: number, opts: { mouseTracking: boolean; alternate: boolean }): WheelAction {
  // Natural scroll v2: tmux mouse is ON, so mouseTracking is the NORMAL state — forward the wheel
  // as SGR reports; tmux routes them (agent TUIs scroll their own transcripts; shells get copy-mode
  // real history via the WheelUpPane binding). Clicks are swallowed separately in TerminalPane.
  if (opts.mouseTracking) return { kind: 'xterm' }
  if (!opts.alternate) return { kind: 'xterm' } // primary screen, no mouse mode: xterm local viewport
  // Fallback ONLY (no mouse mode at all — e.g. tmux config failed): alt-screen wheel-up surfaces
  // the History overlay rather than being dead; wheel-down over the live view is inert.
  if (deltaY < 0) return { kind: 'history' }
  return { kind: 'inert' }
}
