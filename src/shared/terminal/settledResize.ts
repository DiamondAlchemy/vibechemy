export interface TerminalGridSize {
  cols: number
  rows: number
}

function sameSize(a: TerminalGridSize | null, b: TerminalGridSize): boolean {
  return a?.cols === b.cols && a.rows === b.rows
}

/**
 * Serializes settled terminal resize transactions while retaining only the newest trailing size.
 * The ResizeObserver owns the settle debounce; this class owns the async boundary after it, where
 * a detach/attach may still be running when another settled size arrives.
 */
export class SettledResizeCoordinator {
  private latest: TerminalGridSize | null = null
  private running = false
  private stopped = false

  constructor(
    private readonly transact: (size: TerminalGridSize) => Promise<void>,
    private readonly onError: (error: unknown) => void = () => {}
  ) {}

  request(size: TerminalGridSize): void {
    if (this.stopped || sameSize(this.latest, size)) return
    this.latest = size
    if (!this.running) void this.drain()
  }

  stop(): void {
    this.stopped = true
    this.latest = null
  }

  private async drain(): Promise<void> {
    this.running = true
    try {
      while (!this.stopped && this.latest) {
        const target = this.latest
        try {
          await this.transact(target)
        } catch (error) {
          this.onError(error)
        }
        // A matching latest value is complete (or failed and may be requested again later). If a
        // newer size arrived in flight, retain it and immediately run that one trailing transaction.
        if (sameSize(this.latest, target)) this.latest = null
      }
    } finally {
      this.running = false
      // No await exists between the loop's final comparison and this assignment, but keep this
      // guard explicit so future refactors cannot strand a trailing request.
      if (!this.stopped && this.latest) void this.drain()
    }
  }
}
