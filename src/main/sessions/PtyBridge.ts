import * as pty from 'node-pty'
import { tmuxSocket, hasSession as tmuxHasSession } from './tmux'
import { shouldReattach, HEAL_MAX_ATTEMPTS, HEAL_BACKOFF_MS, HEAL_WINDOW_MS } from '@shared/sessions/reattach'

type DataCb = (sessionId: string, data: string) => void
type ExitCb = (sessionId: string) => void

export class PtyBridge {
  private clients = new Map<string, pty.IPty>()
  // Attach geometry kept per session so a self-heal re-attach (see handleClientExit) can reconnect
  // with the same size the renderer last asked for, without a round-trip to the renderer.
  private attachInfo = new Map<string, { tmuxName: string; cols: number; rows: number }>()
  // Sessions whose client we are killing ON PURPOSE (detach / disposeAll). Consumed by the client's
  // onExit so a deliberate teardown is never mistaken for an involuntary death → never re-attaches.
  private closing = new Set<string>()
  // Heal budget per session: how many re-attaches we've spent, and when the last one fired, so
  // fast flapping is capped (HEAL_MAX_ATTEMPTS per HEAL_WINDOW_MS) while a long-lived pane that
  // dies once, months later, still gets a fresh budget.
  private healAttempts = new Map<string, { count: number; at: number }>()
  // Set once on disposeAll (app quitting): blocks any in-flight scheduled heal from spawning a
  // brand-new attach client while the app is tearing down.
  private disposed = false

  constructor(
    private onData: DataCb,
    private onExit: ExitCb,
    private now: () => number = () => Date.now(),
    // Injected so the bridge can ask tmux "is the SESSION still alive?" when a client dies — the
    // signal that separates an involuntary client death (heal it) from a real session death (let
    // the normal exit path tombstone it). Defaults to the real tmux has-session; overridable in tests.
    private hasSessionFn: (tmuxName: string) => Promise<boolean> = tmuxHasSession,
    // Overridable scheduler so the self-heal backoff is unit-testable without real time. Unref'd so
    // a pending heal never holds the process open during quit (matches tmux.ts sendKeys).
    private schedule: (fn: () => void, ms: number) => void = (fn, ms) => {
      const h = setTimeout(fn, ms)
      if (typeof h.unref === 'function') h.unref()
    }
  ) {}

  attach(sessionId: string, tmuxName: string, cols: number, rows: number): void {
    if (this.clients.has(sessionId)) return // no double-attach: one client per session, always
    this.attachInfo.set(sessionId, { tmuxName, cols, rows })
    // Must attach on OUR socket, or it'll talk to the user's default tmux server.
    const client = pty.spawn('tmux', ['-L', tmuxSocket(), 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: process.env as Record<string, string>
    })
    client.onData((d) => {
      this.onData(sessionId, d)
    })
    client.onExit(() => {
      this.clients.delete(sessionId)
      void this.handleClientExit(sessionId)
    })
    this.clients.set(sessionId, client)
  }

  /**
   * A pty attach client just exited. Decide whether it was deliberate (a viewer detach / app quit —
   * leave it), a real session death (let the caller tombstone it), or an involuntary death of a
   * still-alive session (self-heal: re-attach once after a short backoff). See shouldReattach.
   */
  private async handleClientExit(sessionId: string): Promise<void> {
    // Deliberate teardown (detach / disposeAll set `closing` BEFORE killing): honor it and run the
    // normal exit callback so callers react exactly as before. Consume-once so the flag can't stick.
    if (this.closing.delete(sessionId)) {
      this.onExit(sessionId)
      return
    }
    const info = this.attachInfo.get(sessionId)
    const sessionAlive = info ? await this.hasSessionFn(info.tmuxName).catch(() => false) : false
    const prev = this.healAttempts.get(sessionId)
    // Deaths within the window share one budget; older attempts are stale → start fresh.
    const attempts = prev && this.now() - prev.at < HEAL_WINDOW_MS ? prev.count : 0
    if (info && shouldReattach({ deliberate: false, sessionAlive, attempts, max: HEAL_MAX_ATTEMPTS })) {
      this.healAttempts.set(sessionId, { count: attempts + 1, at: this.now() })
      this.schedule(() => {
        // Bail if, during the backoff: the app started quitting (disposed), a remount already
        // re-attached (clients.has), OR the pane was deliberately closed/hidden — detach()/
        // disposeAll() delete attachInfo, and because the client was already dead they couldn't
        // mark `closing`, so `attachInfo` absence is how we detect that teardown and avoid
        // re-attaching a ghost pane (leaked client with no viewer).
        if (this.disposed || this.clients.has(sessionId) || !this.attachInfo.has(sessionId)) return
        // Re-check right before spawning — the session may have died during the backoff.
        void this.hasSessionFn(info.tmuxName)
          .then((alive) => {
            if (this.disposed || this.clients.has(sessionId) || !this.attachInfo.has(sessionId)) return
            if (alive) this.attach(sessionId, info.tmuxName, info.cols, info.rows)
            else this.onExit(sessionId) // died during backoff → let the normal path tombstone it
          })
          .catch(() => {})
      }, HEAL_BACKOFF_MS)
      return
    }
    // Not healable (session gone, or heal budget exhausted): run the normal exit path. A gone
    // session gets tombstoned; an exhausted-but-alive session settles blank rather than looping.
    this.onExit(sessionId)
  }

  write(sessionId: string, data: string): void {
    this.clients.get(sessionId)?.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    // Keep the stored geometry current so a later self-heal re-attaches at the right size.
    const info = this.attachInfo.get(sessionId)
    if (info) {
      info.cols = cols
      info.rows = rows
    }
    try {
      this.clients.get(sessionId)?.resize(cols, rows)
    } catch {
      /* client may have just exited */
    }
  }

  /** Detach the viewer (kills the attach client; the tmux session keeps running). */
  detach(sessionId: string): void {
    const client = this.clients.get(sessionId)
    if (client) {
      this.closing.add(sessionId) // mark BEFORE kill: this death is deliberate → the onExit must not heal
      client.kill()
    }
    this.clients.delete(sessionId)
    this.attachInfo.delete(sessionId)
    this.healAttempts.delete(sessionId)
  }

  disposeAll(): void {
    this.disposed = true // block any in-flight heal from resurrecting a client during quit
    for (const id of this.clients.keys()) this.closing.add(id) // every death here is deliberate
    for (const c of this.clients.values()) c.kill()
    this.clients.clear()
    this.attachInfo.clear()
    this.healAttempts.clear()
  }
}
