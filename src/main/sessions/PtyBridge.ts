import * as pty from 'node-pty'
import { tmuxSocket, hasSession as tmuxHasSession } from './tmux'
import { shouldReattach, HEAL_MAX_ATTEMPTS, HEAL_BACKOFF_MS, HEAL_WINDOW_MS } from '@shared/sessions/reattach'

type DataCb = (sessionId: string, data: string, viewerId: string) => void
type ExitCb = (sessionId: string) => void

interface ClientRecord {
  client: pty.IPty
  generation: number
  exited: Promise<void>
  resolveExited: () => void
}

export class PtyBridge {
  private clients = new Map<string, ClientRecord>()
  // Monotonic physical-client generation. Late data/exit events from a killed client must never
  // affect a replacement that occupies the same session id.
  private nextGeneration = 0
  // Attach geometry kept per session so a self-heal re-attach (see handleClientExit) can reconnect
  // with the same size the renderer last asked for, without a round-trip to the renderer.
  private attachInfo = new Map<string, { tmuxName: string; cols: number; rows: number; viewerId: string }>()
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

  attach(sessionId: string, tmuxName: string, cols: number, rows: number, viewerId?: string): void {
    if (this.clients.has(sessionId)) return // no double-attach: one client per session, always
    const generation = ++this.nextGeneration
    const effectiveViewerId = viewerId ?? `pty-${generation}`
    this.attachInfo.set(sessionId, { tmuxName, cols, rows, viewerId: effectiveViewerId })
    // Must attach on OUR socket, or it'll talk to the user's default tmux server.
    const client = pty.spawn('tmux', ['-L', tmuxSocket(), 'attach-session', '-t', tmuxName], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME,
      env: process.env as Record<string, string>
    })
    let resolveExited!: () => void
    const exited = new Promise<void>((resolve) => {
      resolveExited = resolve
    })
    const record: ClientRecord = { client, generation, exited, resolveExited }
    client.onData((d) => {
      if (this.clients.get(sessionId)?.generation !== generation) return
      this.onData(sessionId, d, effectiveViewerId)
    })
    client.onExit(() => {
      resolveExited()
      if (this.clients.get(sessionId)?.generation !== generation) return
      this.clients.delete(sessionId)
      void this.handleClientExit(sessionId)
    })
    this.clients.set(sessionId, record)
  }

  /**
   * A current pty attach client just exited involuntarily. Deliberate detach/app-quit invalidates
   * the physical generation before kill and never enters here. Decide between a real session death
   * (let the caller tombstone it) and a still-alive session (self-heal after a short backoff).
   */
  private async handleClientExit(sessionId: string): Promise<void> {
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
        // disposeAll() delete attachInfo, whose absence revokes this scheduled heal and avoids
        // re-attaching a ghost pane (leaked client with no viewer).
        if (this.disposed || this.clients.has(sessionId) || !this.attachInfo.has(sessionId)) return
        // Re-check right before spawning — the session may have died during the backoff.
        void this.hasSessionFn(info.tmuxName)
          .then((alive) => {
            if (this.disposed || this.clients.has(sessionId) || !this.attachInfo.has(sessionId)) return
            if (alive) this.attach(sessionId, info.tmuxName, info.cols, info.rows, info.viewerId)
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
    this.clients.get(sessionId)?.client.write(data)
  }

  resize(sessionId: string, cols: number, rows: number): void {
    // Keep the stored geometry current so a later self-heal re-attaches at the right size.
    const info = this.attachInfo.get(sessionId)
    if (info) {
      info.cols = cols
      info.rows = rows
    }
    try {
      this.clients.get(sessionId)?.client.resize(cols, rows)
    } catch {
      /* client may have just exited */
    }
  }

  /** Detach the viewer and acknowledge its physical exit; the tmux session keeps running. */
  detach(sessionId: string): Promise<void> {
    const record = this.clients.get(sessionId)
    // Invalidate the generation BEFORE kill. Any synchronous/late data or exit callback from this
    // client is now stale, cannot reach the renderer, cannot delete a replacement, and cannot heal.
    this.clients.delete(sessionId)
    this.attachInfo.delete(sessionId)
    this.healAttempts.delete(sessionId)
    if (!record) return Promise.resolve()
    try {
      record.client.kill()
    } catch {
      record.resolveExited()
    }
    return record.exited
  }

  disposeAll(): void {
    this.disposed = true // block any in-flight heal from resurrecting a client during quit
    const records = [...this.clients.values()]
    this.clients.clear()
    this.attachInfo.clear()
    this.healAttempts.clear()
    for (const record of records) {
      try {
        record.client.kill()
      } catch {
        record.resolveExited()
      }
    }
  }
}
