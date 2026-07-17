import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { api } from '../api'
import { bracketBulkInput } from '@shared/terminal/bracketPaste'
import { wheelToAction } from '@shared/terminal/wheelScroll'
import { PANE_THEMES, resolvePaneTheme, xtermThemeFor } from '@shared/terminal/paneTheme'
import { paneRegistry } from '../paneRegistry'
import { dictationAmplitude, dictationStore, type DictationPhase } from '../dictation'
import { SettledResizeCoordinator } from '@shared/terminal/settledResize'
import type { SessionRecord } from '@shared/types'
import { panePresetMeta } from '../presetMeta'

const shortHome = (p: string): string => p.replace(/^\/Users\/[^/]+/, '~')

// The terminal's colors are a LIVE theme from the PaneTheme catalog (paneTheme.ts) keyed by the
// pane's stored token. allowTransparency is CONSTRUCTOR-ONLY in xterm, so every terminal is built
// transparency-capable and both knobs (theme pick + glass) apply at runtime via options.theme (the
// retheme effect below the mount effect). With an opaque color the DOM renderer paints exactly as
// it would without allowTransparency, so always-on costs nothing.

// Single-quote a path for a shell prompt only if it contains characters that need it.
function quoteForShell(p: string): string {
  return /[^A-Za-z0-9_@%/.,:+-]/.test(p) ? `'${p.replace(/'/g, "'\\''")}'` : p
}

export function TerminalPane({
  session,
  presetLabel,
  isLead = false,
  accent,
  onToggleLead,
  onClose,
  onHide,
  onReorderDrop,
  onSetColor,
  closeTitle,
  onMoveStart,
  transparentBackground = false,
  freshViewerOnResize = false
}: {
  session: SessionRecord
  presetLabel?: string
  isLead?: boolean
  accent?: string // this pane's THEME token: a PaneTheme id (or a legacy accent hex, mapped) — drives terminal colors + frame
  onToggleLead?: () => void
  onClose?: () => void // the ✕ — ends/closes the pane (falls back to killing the session)
  onHide?: () => void // the – (minimize) — hides the pane but keeps the session running, reopenable
  onReorderDrop?: (draggedId: string) => void // another pane was dropped here → swap their slots
  onSetColor?: (hex: string) => void // pin this pane to a chosen color
  closeTitle?: string // overrides the ✕ tooltip (the dock routes ✕ through close/demote)
  onMoveStart?: (e: React.MouseEvent) => void // Free mode: mousedown on the header starts a pane move
  transparentBackground?: boolean // Free-mode glass — rethemed LIVE; mounted panes flip with the toggle
  /** Free canvas only: settled resizes replace the tmux viewer and reset xterm instead of reflowing it live. */
  freshViewerOnResize?: boolean
}): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const [dropOver, setDropOver] = useState(false) // a reorder drag is hovering this pane
  const [dragging, setDragging] = useState(false) // THIS pane is the one being dragged
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [palettePos, setPalettePos] = useState<{ top: number; left: number } | null>(null)
  const swatchRef = useRef<HTMLButtonElement>(null)
  const paletteElRef = useRef<HTMLDivElement>(null)
  const [history, setHistory] = useState<string | null>(null) // null = closed; string = scrollback shown
  // Mirror the overlay's open-state into a ref so the wheel handler (attached once on mount) can
  // open History on scroll-up over an alt-screen pane without re-subscribing on every toggle, and
  // without re-fetching while it's already up. Reset on failure so a later scroll can retry.
  const historyOpenRef = useRef(false)
  useEffect(() => {
    historyOpenRef.current = history !== null
  }, [history])
  // Open the scrollback pinned to the BOTTOM (most recent) — the live view you just left — not the
  // top (start of the whole 5000-line capture). Scroll up from there for older content. useLayoutEffect
  // so the jump lands before paint (no flash of the top). Re-runs on ⟳ refresh (new string) too.
  const historyPreRef = useRef<HTMLPreElement>(null)
  useLayoutEffect(() => {
    if (history === null) return
    const el = historyPreRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [history])
  const openHistoryFromWheel = (): void => {
    if (historyOpenRef.current) return
    historyOpenRef.current = true // optimistic: swallow repeat wheels until the capture resolves
    api
      .paneHistory(session.id)
      .then(setHistory)
      .catch(() => {
        historyOpenRef.current = false
      })
  }
  const [renaming, setRenaming] = useState(false) // callsign editor (double-click the name)
  const callsignRef = useRef<HTMLInputElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const commitNames = (): void => {
    void api.renameSession(session.id, {
      callsign: callsignRef.current?.value ?? undefined,
      title: titleRef.current?.value || undefined
    })
    setRenaming(false)
  }
  // Handle to this pane's xterm so we can focus it on click and on first attach.
  // With tmux mouse-mode on (see tmux.ts:configureServer), a click is delivered to the
  // program as a mouse event instead of doing xterm's normal click-to-focus — so the
  // textarea never gets keyboard focus, so typing appears dead. Focusing explicitly fixes it.
  const termRef = useRef<Terminal | null>(null)
  // Construction-time snapshots only (the mount effect keys on session.id alone); the retheme
  // effect below re-asserts the CURRENT accent/glass right after construction and on any change.
  const transparentBackgroundOnMountRef = useRef(transparentBackground)
  const accentOnMountRef = useRef(accent)

  const meta = panePresetMeta(session.presetId, presetLabel)
  // Isolation + branch come straight from the persisted session fields (set at spawn).
  const isolated = !!session.branch
  const branch = session.branch ?? ''

  useEffect(() => {
    // xterm's DOM renderer carries theme-background alpha correctly. WebGL stays intentionally
    // disabled below because its rectangle renderer forces cell alpha opaque, in addition to the
    // historical per-pane context losses.
    const terminalOptions: ITerminalOptions = {
      fontFamily: "'IBM Plex Mono', Menlo, monospace",
      fontSize: 13,
      // Solid (non-blinking) cursor: cursorBlink:true injects `animation: blink 1s step-end
      // infinite` on the focused pane's cursor — a compositor-thread animation that keeps the GPU
      // process repainting at idle. The cursor is still fully visible, it just doesn't blink.
      cursorBlink: false,
      scrollback: 5000,
      // With tmux mouse-mode on, a normal drag drives tmux copy-mode, which we've
      // bound to copy-pipe→pbcopy (drag-release copies to the macOS clipboard and
      // stays lit — see tmux.ts:configureServer). This flag keeps Option (⌥)-drag
      // as a secondary path: a purely LOCAL xterm selection you Cmd+C without
      // entering tmux copy-mode.
      macOptionClickForcesSelection: true,
      theme: xtermThemeFor(accentOnMountRef.current, transparentBackgroundOnMountRef.current),
      // Constructor-only in xterm — see paneTheme.ts. The actual colors are theme values,
      // rethemed live by the effect that follows the mount effect.
      allowTransparency: true
    }
    const term = new Terminal(terminalOptions)
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host.current!)
    termRef.current = term

    // Passive focus bookkeeping for the pane registry. Observes xterm's textarea only — per the
    // doctrine below, nothing here fights xterm's own click-to-focus. typeText frames the payload
    // as a bracketed paste; pressEnter submits separately after the paste-heuristic gap.
    paneRegistry.register(session.id, {
      focus: () => term.focus(),
      typeText: (text) => api.write(session.id, bracketBulkInput(text, term.modes.bracketedPasteMode)),
      pressEnter: () => api.write(session.id, '\r')
    })
    const ta = term.textarea
    const onTaFocus = (): void => paneRegistry.noteFocused(session.id)
    const onTaBlur = (): void => paneRegistry.noteBlurred(session.id)
    ta?.addEventListener('focus', onTaFocus)
    ta?.addEventListener('blur', onTaBlur)

    // Cmd+C copies the current xterm selection to the clipboard. The WebGL renderer paints the
    // selection on a canvas (it's not a DOM selection), so the Edit menu's Copy role can't see it —
    // we copy it explicitly via Electron's clipboard. Paste (Cmd+V) is left to the Edit menu, which
    // pastes into xterm's textarea, so we don't double-handle it. A mouse drag-select still copies
    // via tmux (copy-pipe pbcopy); this adds the keyboard path.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.metaKey && (e.key === 'c' || e.key === 'C') && term.hasSelection()) {
        api.clipboardWriteText(term.getSelection())
        return false
      }
      return true
    })

    // AUTO-COPY on select: under tmux mouse-on a
    // plain drag forwards to the app, so local selection is Option-drag — and to keep copying
    // one-gesture, ANY completed selection lands on the clipboard immediately (Cmd+C still works).
    term.onSelectionChange(() => {
      const s = term.getSelection()
      if (s) api.clipboardWriteText(s)
    })

    // Wheel policy: tmux mouse is ON, so the WHEEL becomes SGR reports that tmux
    // routes — to the app (Claude/Codex/OpenCode scroll their OWN transcripts, like iTerm2) or into
    // copy-mode real history for shells. The wheel handler stays only as a fallback for the rare
    // no-mouse-mode state (wheelScroll.ts) — under mouse-on it always returns 'xterm' (forward).
    term.attachCustomWheelEventHandler((ev) => {
      // Ctrl+wheel (and trackpad pinch, which Chromium delivers the same way) is the canvas
      // SEMANTIC ZOOM gesture — never scroll the app/tmux with it. Returning false only
      // suppresses the SGR report: xterm's mouse-protocol wheel listener still cancels
      // (preventDefault + stopPropagation) unconditionally, so this bail alone can NOT let the
      // event bubble — the Free canvas claims ctrl-wheels in the CAPTURE phase instead
      // (FreePaneLayout). The bail stays so grid-layout panes never scroll on a stray pinch.
      if (ev.ctrlKey) return false
      const action = wheelToAction(ev.deltaY, {
        mouseTracking: term.modes.mouseTrackingMode !== 'none',
        alternate: term.buffer.active.type === 'alternate'
      })
      if (action.kind === 'xterm') return true
      if (action.kind === 'history') openHistoryFromWheel()
      return false
    })

    // THE single-click-to-type keeper (the other half of natural scroll v2): with tmux mouse on,
    // xterm would forward CLICKS to tmux/the TUI too, causing double-click/click-then-Enter behavior.
    // Intercept UNMODIFIED left-button events in
    // the CAPTURE phase (they never reach xterm's handlers → never become SGR press reports) and
    // just focus the terminal. Everything else passes through: Option-drag = xterm local selection
    // (macOptionClickForcesSelection), plain drag after an Option start, right/middle clicks, and
    // the wheel. When no app/tmux mouse mode is active, clicks behave as before (xterm handles).
    // CLICK-THROUGH refinement: swallow only the FOCUSING click — a click on an UNfocused pane is
    // pure focus (type immediately, preserving the single-click-to-type guarantee). Once the pane
    // HAS focus, clicks pass
    // through to the app, so mouse-aware TUIs (OpenCode menus) are clickable while you work in
    // them. Same convention as macOS windows. The latch pairs mouseup/click with a swallowed
    // mousedown so the app never sees an orphan button-release.
    // A primary-screen pane (Codex, plain shells) enters tmux copy-mode on a wheel-scroll to show
    // history; our focus-click swallow means a plain click never reaches tmux to run its
    // MouseDown1Pane→cancel binding, so the pane stays trapped in copy-mode and paste/typing never
    // reach the app. Cancel copy-mode on the
    // focusing click so ONE click both focuses and un-sticks. Fire UNCONDITIONALLY: tmux copy-mode
    // renders on the ALTERNATE screen, so we can't gate on buffer type (that would skip the exact
    // panes that are stuck); the tmux cancel is a harmless no-op for any pane not in a mode.
    const exitCopyMode = (): void => api.paneCancelCopyMode(session.id)
    let swallowedDown = false
    const swallowPlainClicks = (ev: MouseEvent): void => {
      // RIGHT-CLICK = Copy/Paste menu: never forwarded to the app — standard terminal
      // UX, and the reliable paste path now that plain-drag selection is gone under mouse-on.
      if (ev.button === 2) {
        ev.stopImmediatePropagation()
        ev.preventDefault()
        if (ev.type === 'mousedown') {
          term.focus() // so Paste lands in THIS pane even when it wasn't focused
          exitCopyMode() // un-stick a scrolled-into-copy-mode pane so Paste reaches the app
          api.paneContextMenu(term.getSelection())
        }
        return
      }
      if (ev.button !== 0 || ev.altKey || ev.metaKey || ev.ctrlKey || ev.shiftKey) return
      if (term.modes.mouseTrackingMode === 'none') return // no one is listening — let xterm be
      if (ev.type === 'mousedown') {
        if (host.current?.contains(document.activeElement)) return // already focused → app's click
        swallowedDown = true
        ev.stopImmediatePropagation()
        // preventDefault is LOAD-BEARING: mousedown's default action runs AFTER handlers and moves
        // focus to the (non-focusable) click target — silently BLURRING the textarea we just focused.
        ev.preventDefault()
        term.focus()
        exitCopyMode() // one click focuses AND exits copy-mode (else paste/type stay trapped)
        return
      }
      if (!swallowedDown) return // paired with a forwarded mousedown → let it through too
      ev.stopImmediatePropagation()
      ev.preventDefault()
      if (ev.type === 'click') swallowedDown = false // click fires last in the pair — reset
    }
    const clickKinds: (keyof HTMLElementEventMap)[] = [
      'mousedown',
      'mouseup',
      'click',
      'dblclick',
      'contextmenu',
      'auxclick'
    ]
    for (const kind of clickKinds) {
      host.current?.addEventListener(kind, swallowPlainClicks as EventListener, { capture: true })
    }

    // Use xterm's DOM renderer (no addon). The WebGL renderer opens a GPU context PER pane, and
    // with several panes open Electron/macOS runs out of WebGL contexts and starts losing them —
    // which showed up as a terminal frozen on a stale frame (a "layer" you had to click/Enter
    // through to refresh). The DOM renderer is a touch slower under heavy output but never freezes
    // or loses a context. (The anti-throttling switches in index.ts keep it painting steadily.)

    let attached = false
    let lastCols = 0
    let lastRows = 0
    let raf = 0
    let debounce = 0
    let disposed = false
    let activeViewerId: string | null = null

    const nextViewerId = (): string => crypto.randomUUID()
    const attachViewer = (cols: number, rows: number): Promise<void> => {
      const viewerId = nextViewerId()
      activeViewerId = viewerId
      return api.attach(session.id, cols, rows, viewerId)
    }
    const settledResize = new SettledResizeCoordinator(
      async ({ cols, rows }) => {
        // Seal the old generation before asking main to detach. Main acknowledges the physical
        // client exit; only then do we clear xterm, size the empty grid, and create one fresh viewer.
        activeViewerId = null
        await api.detach(session.id)
        if (disposed) return
        const restoreFocus = !!host.current?.contains(document.activeElement)
        term.reset()
        term.resize(cols, rows)
        lastCols = cols
        lastRows = rows
        await attachViewer(cols, rows)
        if (!disposed && restoreFocus) term.focus()
      },
      (error) => console.error(`[TerminalPane] fresh viewer resize failed for ${session.id}:`, error)
    )

    // Only fit (a DOM mutation) when the proposed size actually changed — checking
    // proposeDimensions() first avoids the fit→reflow→observe→fit feedback loop.
    const sync = (): void => {
      const el = host.current
      if (!el || el.clientWidth < 2 || el.clientHeight < 2) return
      const dims = fit.proposeDimensions()
      if (!dims || !isFinite(dims.cols) || !isFinite(dims.rows) || dims.cols < 1 || dims.rows < 1) return
      if (!attached) {
        fit.fit()
        void attachViewer(dims.cols, dims.rows)
        attached = true
        lastCols = dims.cols
        lastRows = dims.rows
        term.focus() // focus once on first attach so a freshly-spawned pane is typeable
      } else if (dims.cols !== lastCols || dims.rows !== lastRows) {
        if (freshViewerOnResize) {
          settledResize.request(dims)
        } else {
          fit.fit()
          api.resize(session.id, dims.cols, dims.rows)
          lastCols = dims.cols
          lastRows = dims.rows
        }
      }
    }

    const offData = api.onData((msg) => {
      if (msg.sessionId === session.id && msg.viewerId === activeViewerId) term.write(msg.data)
    })
    // Some text inputs deliver a whole phrase as one raw burst, which a CLI can re-wrap
    // character-by-character into visible corruption. Frame such bulk bursts as a
    // bracketed paste so the CLI inserts them atomically; single keystrokes pass through untouched.
    const dispInput = term.onData((d) => api.write(session.id, bracketBulkInput(d, term.modes.bracketedPasteMode)))

    // Fit synchronously now (no open-jump when the pane already has a size); the
    // rAF is a fallback for when layout isn't ready yet on first mount.
    sync()
    raf = requestAnimationFrame(sync)
    // Refit once IBM Plex Mono is loaded so glyph metrics (and thus cols/rows) are correct.
    void document.fonts.ready.then(() => {
      if (host.current) sync()
    })

    // Debounce resize (defer out of the RO callback) so a grid re-layout coalesces
    // into one fit instead of a burst — also avoids the "ResizeObserver loop" error.
    const ro = new ResizeObserver(() => {
      clearTimeout(debounce)
      debounce = window.setTimeout(sync, 120)
    })
    if (host.current) ro.observe(host.current)

    // If the window was backgrounded/occluded the renderer may have paused painting; force a
    // repaint (and refit) when it becomes visible/focused so the pane isn't "frozen" until a keypress.
    const repaint = (): void => {
      if (document.visibilityState !== 'visible') return
      try {
        term.refresh(0, term.rows - 1)
      } catch {
        /* term may be mid-dispose */
      }
      sync()
    }
    document.addEventListener('visibilitychange', repaint)
    window.addEventListener('focus', repaint)

    return () => {
      disposed = true
      activeViewerId = null
      settledResize.stop()
      cancelAnimationFrame(raf)
      clearTimeout(debounce)
      document.removeEventListener('visibilitychange', repaint)
      window.removeEventListener('focus', repaint)
      ta?.removeEventListener('focus', onTaFocus)
      ta?.removeEventListener('blur', onTaBlur)
      for (const kind of clickKinds) {
        host.current?.removeEventListener(kind, swallowPlainClicks as EventListener, { capture: true })
      }
      // BEFORE dispose: if this pane held keyboard focus, the registry hands it to the
      // MRU pane once the unmount settles — otherwise Esc/typing silently dies on <body>.
      paneRegistry.unregister(session.id)
      offData()
      dispInput.dispose()
      ro.disconnect()
      void api.detach(session.id) // detach the pty viewer; tmux session survives for re-attach
      term.dispose() // also disposes the WebGL addon → frees its GPU context
      termRef.current = null
    }
  }, [session.id, freshViewerOnResize])

  // Glass and the pane theme are LIVE inputs, not construction choices: the toolbar toggle and
  // the theme picker retheme every mounted terminal in place (allowTransparency, the
  // constructor-only piece, is always on above). Also re-asserts after a session.id
  // reconstruction, whose new xterm sampled possibly-stale mount refs. Without live re-theming,
  // toggling Glass leaves already-running panes as opaque slabs while the pane chrome (CSS-driven)
  // goes glass because each xterm's inline background stays frozen at its construction value.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    const next = xtermThemeFor(accent, transparentBackground)
    const cur = term.options.theme
    if (cur?.background !== next.background || cur?.foreground !== next.foreground) {
      term.options.theme = next
    }
  }, [transparentBackground, accent, session.id])

  const onDropFiles = (e: React.DragEvent): void => {
    e.preventDefault()
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => api.pathForFile(f))
      .filter((p) => p && p.length > 0)
    if (paths.length === 0) return
    api.write(session.id, paths.map(quoteForShell).join(' ') + ' ')
  }

  // Focus is handled NATIVELY by xterm: clicking the terminal focuses its own textarea, exactly like
  // a normal terminal. We deliberately add NO custom click->focus handler — every attempt (capture
  // phase, rAF re-focus, blur->refocus) ended up fighting xterm's own focus and forced double/triple
  // clicks. With tmux mouse mode off, native focus gives clean single-click-to-type.

  // Close the color palette on an outside click. The palette is portaled to <body>, so check
  // both the swatch button and the portaled palette itself.
  useEffect(() => {
    if (!paletteOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (swatchRef.current?.contains(t) || paletteElRef.current?.contains(t)) return
      setPaletteOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [paletteOpen])

  // Overflow ⋯ menu (responsive header): below ~300px the secondary controls (history, color,
  // lead) collapse into this one portaled menu — same pane-failmenu pattern — so the pinned
  // controls (− ✕) always fit.
  const [moreOpen, setMoreOpen] = useState(false)
  const [morePos, setMorePos] = useState<{ top: number; left: number } | null>(null)
  const moreRef = useRef<HTMLButtonElement>(null)
  const moreElRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!moreOpen) return
    const onDoc = (e: MouseEvent): void => {
      const t = e.target as Node
      if (moreRef.current?.contains(t) || moreElRef.current?.contains(t)) return
      setMoreOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [moreOpen])

  // The pane accepts two drop kinds: a worker drag (application/mc-handoff) dropped onto a
  // DIFFERENT pane → swap their grid slots; or OS files → type their paths into the shell.
  // (Dropping that same drag on the orchestrator dock is the handoff — a separate target.)
  const onPaneDragOver = (e: React.DragEvent): void => {
    if (!dragging && onReorderDrop && e.dataTransfer.types.includes('application/mc-handoff')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      setDropOver(true)
    } else if (
      e.dataTransfer.types.includes('application/mc-image') ||
      e.dataTransfer.types.includes('application/mc-text')
    ) {
      // A staged canvas image (→ paste its path) or note (→ paste its text) dragged over the pane.
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setDropOver(true)
    } else if (e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setDropOver(true) // show the drop-highlight for an OS file drag too (onPaneDrop handles it)
    }
  }
  const onPaneDrop = (e: React.DragEvent): void => {
    setDropOver(false)
    // A worker drag dropped on a DIFFERENT grid pane → swap slots. If this pane has no reorder
    // handler (e.g. the orchestrator pane in the dock), leave the event to bubble to the dock's
    // handoff drop zone instead of consuming it.
    if (onReorderDrop && e.dataTransfer.types.includes('application/mc-handoff')) {
      e.preventDefault()
      try {
        const w = JSON.parse(e.dataTransfer.getData('application/mc-handoff')) as { id: string }
        if (w.id && w.id !== session.id) onReorderDrop(w.id)
      } catch {
        /* malformed payload → ignore */
      }
      return
    }
    // A staged canvas image dropped onto this pane → paste its saved file path into the shell so the
    // CLI (Claude Code / Codex …) can attach the picture. Bracket-wrapped = one atomic paste.
    if (e.dataTransfer.types.includes('application/mc-image')) {
      e.preventDefault()
      e.stopPropagation()
      const path = e.dataTransfer.getData('application/mc-image')
      if (path) {
        api.write(
          session.id,
          bracketBulkInput(quoteForShell(path) + ' ', termRef.current?.modes.bracketedPasteMode ?? false)
        )
      }
      return
    }
    // A staged note dropped onto this pane → paste its raw text (a reusable prompt/command) into the
    // shell. No shell-quoting — it's freeform text, not a path; bracket-wrapped = one atomic paste.
    if (e.dataTransfer.types.includes('application/mc-text')) {
      e.preventDefault()
      e.stopPropagation()
      const text = e.dataTransfer.getData('application/mc-text')
      if (text) api.write(session.id, bracketBulkInput(text, termRef.current?.modes.bracketedPasteMode ?? false))
      return
    }
    if (e.dataTransfer.types.includes('Files')) {
      e.stopPropagation() // don't let an orchestrator-pane file drop bubble to the sidebar (which would create projects)
      onDropFiles(e)
    }
  }

  const dictation = useSyncExternalStore(dictationStore.subscribe, dictationStore.get)
  const isDictationTarget = dictation.targetId === session.id && dictation.phase !== 'idle'

  return (
    <div
      className={
        'pane' +
        (dropOver ? ' drop-target' : '') +
        (dragging ? ' dragging' : '') +
        (isDictationTarget ? ' dictating' : '')
      }
      style={{ ['--pane-accent']: accent ? resolvePaneTheme(accent).accent : 'transparent' } as React.CSSProperties}
      onDragOver={onPaneDragOver}
      onDragLeave={(e) => {
        // dragleave also fires when crossing into a child — only clear when truly leaving the pane.
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropOver(false)
      }}
      onDrop={onPaneDrop}
    >
      {/* Responsive header: three sections — ph-left (grip) and pane-ctrls are PINNED
          (flex-shrink 0); ph-mid absorbs all width loss (min-width 0, overflow hidden) so the ✕
          can never be pushed off the right edge. Container queries on .pane drive the priority
          ladder (global.css). */}
      <div className={'pane-head' + (session.callsign ? ' has-callsign' : '')} onMouseDown={onMoveStart}>
        <span className="ph-left">
          {isDictationTarget && <DictationChip phase={dictation.phase} />}
          <span
            className="pane-grip"
            draggable={!onMoveStart}
            title="Drag to reorder these panes — or onto the orchestrator to hand this worker off"
            onMouseDown={onMoveStart ? undefined : (e) => e.stopPropagation()}
            onDragStart={(e) => {
              e.dataTransfer.setData(
                'application/mc-handoff',
                JSON.stringify({ id: session.id, label: meta.label, branch })
              )
              e.dataTransfer.effectAllowed = 'copyMove'
              setDragging(true)
            }}
            onDragEnd={() => setDragging(false)}
          >
            <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor">
              <circle cx="2.5" cy="3" r="1.2" />
              <circle cx="7.5" cy="3" r="1.2" />
              <circle cx="2.5" cy="7" r="1.2" />
              <circle cx="7.5" cy="7" r="1.2" />
              <circle cx="2.5" cy="11" r="1.2" />
              <circle cx="7.5" cy="11" r="1.2" />
            </svg>
          </span>
          {onMoveStart && (
            <span
              className="pane-handoff"
              draggable
              title="Drag onto the orchestrator to hand this worker off for review"
              onMouseDown={(e) => e.stopPropagation()}
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  'application/mc-handoff',
                  JSON.stringify({ id: session.id, label: meta.label, branch })
                )
                e.dataTransfer.effectAllowed = 'copyMove'
                setDragging(true)
              }}
              onDragEnd={() => setDragging(false)}
            >
              ↗
            </span>
          )}
        </span>
        <span className="ph-mid">
          <span className={'preset-pill ' + meta.color}>
            <span className={'sdot ' + meta.color} />
            <span className="pill-txt">{meta.label}</span>
          </span>
          {/* Double-click to name a pane; titles feed dock tabs and pane resolution. */}
          {renaming ? (
            <span className="pane-namer" onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
              <input
                className="pane-callsign-input"
                placeholder="callsign — Beacon"
                defaultValue={session.callsign ?? ''}
                autoFocus
                ref={callsignRef}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitNames()
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
              <input
                className="pane-callsign-input pane-title-input"
                placeholder="title — Example UI terminal"
                defaultValue={session.title}
                ref={titleRef}
                onKeyDown={(e) => {
                  e.stopPropagation()
                  if (e.key === 'Enter') commitNames()
                  if (e.key === 'Escape') setRenaming(false)
                }}
              />
              <button className="pane-ctrl" title="Save" onClick={commitNames}>
                ✓
              </button>
            </span>
          ) : (
            <span
              className="pane-callsign"
              title="Double-click to set a callsign and title"
              onDoubleClick={(e) => {
                e.stopPropagation()
                setRenaming(true)
              }}
            >
              {session.callsign ?? (session.title && session.title !== meta.label ? session.title : '✎')}
            </span>
          )}
          {isolated && (
            <span className="iso-badge">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M11 20A7 7 0 0 1 9.8 6.1C16 5 17 3 18 2c1 1 1 8-1 12a7 7 0 0 1-6 6Z" strokeLinejoin="round" />
                <path d="M2 22c1.5-2.5 3.5-4 7-5" />
              </svg>
              <span className="iso-txt">isolated</span>
            </span>
          )}
          <span className="pane-cwd">{shortHome(session.cwd)}</span>
          {isolated && branch && (
            <span className="branch-chip">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="6" cy="6" r="2.4" />
                <circle cx="6" cy="18" r="2.4" />
                <circle cx="18" cy="9" r="2.4" />
                <path d="M6 8.4v7.2M8.4 6h6.2a2 2 0 0 1 2 2v.8" />
              </svg>
              {branch}
            </span>
          )}
        </span>
        <span className="pane-ctrls">
          <button
            className="pane-ctrl secondary"
            title="History — full scrollback in a scrollable view (search with Cmd+F)"
            onClick={(e) => {
              e.stopPropagation()
              api.paneHistory(session.id).then(setHistory)
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6h16M4 12h16M4 18h10" strokeLinecap="round" />
            </svg>
          </button>
          {onSetColor && (
            <>
              <button
                ref={swatchRef}
                className="pane-ctrl swatch secondary"
                title="Set this pane's color"
                style={{ color: resolvePaneTheme(accent).accent }}
                onClick={(e) => {
                  e.stopPropagation()
                  if (paletteOpen) {
                    setPaletteOpen(false)
                    return
                  }
                  const r = swatchRef.current?.getBoundingClientRect()
                  if (r) setPalettePos({ top: r.bottom + 6, left: Math.max(8, r.right - 116) })
                  setPaletteOpen(true)
                }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="6" fill="currentColor" />
                </svg>
              </button>
              {/* Portaled to <body> so the pane's overflow:hidden can't clip it in short panes. */}
              {paletteOpen &&
                palettePos &&
                createPortal(
                  <div
                    ref={paletteElRef}
                    className="pane-palette"
                    style={{ top: palettePos.top, left: palettePos.left }}
                  >
                    {PANE_THEMES.map((t) => (
                      <button
                        key={t.id}
                        className={'swatch-opt' + (t.id === resolvePaneTheme(accent).id ? ' on' : '')}
                        style={{ background: t.bg, borderColor: t.accent }}
                        title={t.label}
                        onClick={() => {
                          onSetColor(t.id)
                          setPaletteOpen(false)
                        }}
                      />
                    ))}
                  </div>,
                  document.body
                )}
            </>
          )}
          {onToggleLead && (
            <button
              className={'pane-ctrl lead secondary' + (isLead ? ' on' : '')}
              title={
                isLead ? 'Release from lead — move back to the grid' : 'Make lead — move this pane into the left rail'
              }
              onClick={(e) => {
                e.stopPropagation()
                onToggleLead()
              }}
            >
              {isLead ? (
                // chevron pointing back out to the grid (release)
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M13 6l6 6-6 6" strokeLinejoin="round" strokeLinecap="round" />
                  <path d="M19 5v14" strokeLinecap="round" />
                </svg>
              ) : (
                // chevron pointing into the left rail (promote)
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M11 6l-6 6 6 6" strokeLinejoin="round" strokeLinecap="round" />
                  <path d="M5 5v14" strokeLinecap="round" />
                </svg>
              )}
            </button>
          )}
          {/* ⋯ — visible only below the ~300px container breakpoint (CSS), where the secondary
              controls above are hidden; their actions live here so nothing is ever unreachable. */}
          <button
            ref={moreRef}
            className="pane-ctrl pane-more"
            title="More controls"
            onClick={(e) => {
              e.stopPropagation()
              if (moreOpen) {
                setMoreOpen(false)
                return
              }
              const r = moreRef.current?.getBoundingClientRect()
              if (r) setMorePos({ top: r.bottom + 6, left: Math.max(8, r.right - 190) })
              setMoreOpen(true)
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
          {moreOpen &&
            morePos &&
            createPortal(
              <div ref={moreElRef} className="pane-failmenu" style={{ top: morePos.top, left: morePos.left }}>
                <div className="pane-failmenu-head">Pane controls</div>
                <button
                  className="pane-failmenu-item"
                  onClick={() => {
                    setMoreOpen(false)
                    void api.paneHistory(session.id).then(setHistory)
                  }}
                >
                  History
                </button>
                {onSetColor && (
                  <button
                    className="pane-failmenu-item"
                    onClick={() => {
                      setMoreOpen(false)
                      setPalettePos({ top: morePos.top, left: Math.max(8, morePos.left) })
                      setPaletteOpen(true)
                    }}
                  >
                    Pane color…
                  </button>
                )}
                {onToggleLead && (
                  <button
                    className="pane-failmenu-item"
                    onClick={() => {
                      setMoreOpen(false)
                      onToggleLead()
                    }}
                  >
                    {isLead ? 'Release from lead' : 'Make lead'}
                  </button>
                )}
              </div>,
              document.body
            )}
          {onHide && (
            <button
              className="pane-ctrl"
              title="Hide — keep it running, reopen from Sessions (top-right)"
              onClick={(e) => {
                e.stopPropagation()
                onHide()
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                <path d="M5 12h14" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button
            className="pane-ctrl close"
            title={closeTitle ?? 'Close — end this terminal'}
            onClick={(e) => {
              e.stopPropagation()
              onClose ? onClose() : api.killSession(session.id)
            }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </span>
      </div>
      <div ref={host} className="pane-body" />
      {history !== null && (
        <div className="pane-history">
          <div className="pane-history-head">
            <span>scrollback — {shortHome(session.cwd)}</span>
            <span className="pane-history-actions">
              <button title="Refresh" onClick={() => api.paneHistory(session.id).then(setHistory)}>
                ⟳
              </button>
              <button title="Close" onClick={() => setHistory(null)}>
                ✕
              </button>
            </span>
          </div>
          <pre ref={historyPreRef} className="pane-history-text">
            {history || '(no scrollback captured yet)'}
          </pre>
        </div>
      )}
    </div>
  )
}

function DictationChip({ phase }: { phase: DictationPhase }): React.JSX.Element {
  const barsRef = useRef<Array<HTMLSpanElement | null>>([])
  useEffect(() => {
    if (phase !== 'recording') return
    let frame = 0
    const paint = (): void => {
      const amplitude = dictationAmplitude.current
      barsRef.current.forEach((bar, index) => {
        if (!bar) return
        const height = 3 + Math.max(0, amplitude * 16 - index * 2.2)
        bar.style.height = `${Math.min(11, height)}px`
      })
      frame = requestAnimationFrame(paint)
    }
    frame = requestAnimationFrame(paint)
    return () => cancelAnimationFrame(frame)
  }, [phase])

  return (
    <span className={'dict-chip' + (phase === 'transcribing' ? ' busy' : '')} data-dictation-phase={phase}>
      {phase === 'recording' ? (
        <>
          <span className="dict-dot">●</span>
          REC
          <span className="dict-meter">
            {[0, 1, 2, 3, 4].map((index) => (
              <span
                key={index}
                ref={(element) => {
                  barsRef.current[index] = element
                }}
              />
            ))}
          </span>
        </>
      ) : (
        <>◌ transcribing…</>
      )}
    </span>
  )
}
