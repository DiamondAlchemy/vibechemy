import type { AsrProvider, AsrStatus } from './AsrProvider'

export interface AsrRoute {
  engine: string
  provider: AsrProvider
}

/**
 * Selects the first available on-device engine and keeps the IPC-facing service independent
 * from any one recognizer. Vibechemy ships one route today; additional local engines can be
 * added without changing the renderer or IPC contract.
 */
export class AsrRouter implements AsrProvider {
  constructor(private readonly routes: readonly AsrRoute[]) {}

  private routeStatuses(): Array<{ route: AsrRoute; status: AsrStatus }> {
    return this.routes.map((route) => {
      try {
        return { route, status: { ...route.provider.status(), engine: route.engine } }
      } catch (error) {
        return {
          route,
          status: { available: false, engine: route.engine, reason: `${route.engine} status failed: ${String(error)}` }
        }
      }
    })
  }

  status(): AsrStatus {
    const statuses = this.routeStatuses()
    const ready = statuses.find(({ status }) => status.available)
    if (ready) return ready.status
    if (statuses.length === 0) return { available: false, reason: 'no local speech recognition engine configured' }
    const first = statuses[0].status
    return {
      ...first,
      available: false,
      reason: first.reason ?? `${first.engine ?? 'speech recognition'} is unavailable`
    }
  }

  async transcribe(wav: Buffer): Promise<string> {
    const candidates = this.routeStatuses().filter(({ status }) => status.available)
    if (candidates.length === 0) throw new Error(this.status().reason ?? 'local speech recognition is unavailable')

    let firstError: unknown
    for (const { route } of candidates) {
      try {
        const text = await route.provider.transcribe(wav)
        console.log(`[asr] ${route.engine} served (${text.length} chars)`)
        return text
      } catch (error) {
        firstError ??= error
      }
    }
    throw firstError
  }

  dispose(): void {
    for (const { provider } of this.routes) provider.dispose()
  }
}
