import type { UsageAdapter, UsageDeps } from '../types'
import { parseCodexRateLimits, type CodexRateLimitsResult } from '../parsers'

const RPC_TIMEOUT_MS = 12_000

/**
 * Ask the local Codex install for the ChatGPT-sub rate limits WITHOUT spending model quota and
 * WITHOUT the app ever touching the token: spawn `codex app-server --stdio`, do the JSON-RPC
 * handshake (initialize → initialized → account/rateLimits/read), read the id:2 response, kill.
 * The app-server reads ~/.codex/auth.json and authenticates itself.
 */
function codexRateLimits(spawn: UsageDeps['spawn']): Promise<CodexRateLimitsResult & { planType?: string }> {
  return new Promise((resolve, reject) => {
    let cp: ReturnType<UsageDeps['spawn']>
    try {
      cp = spawn('codex', ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'ignore'] })
    } catch (e) {
      return reject(new Error(`codex not runnable: ${e instanceof Error ? e.message : String(e)}`))
    }
    let buf = ''
    let done = false
    const finish = (fn: () => void): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        cp.kill()
      } catch {
        /* already gone */
      }
      fn()
    }
    const timer = setTimeout(() => finish(() => reject(new Error('codex app-server timed out'))), RPC_TIMEOUT_MS)
    cp.on('error', (e: Error) => finish(() => reject(new Error(`codex not runnable: ${e.message}`))))
    cp.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString()
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (!line.trim()) continue
        let msg: { id?: number; result?: unknown; error?: { message?: string } }
        try {
          msg = JSON.parse(line)
        } catch {
          continue
        }
        if (msg.id === 2) {
          if (msg.error) return finish(() => reject(new Error(msg.error?.message ?? 'codex rateLimits RPC error')))
          return finish(() => resolve((msg.result ?? {}) as CodexRateLimitsResult & { planType?: string }))
        }
      }
    })
    const send = (o: unknown): void => {
      cp.stdin?.write(JSON.stringify(o) + '\n')
    }
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        clientInfo: { name: 'vibechemy', version: '1' },
        capabilities: { experimentalApi: true, requestAttestation: false }
      }
    })
    send({ jsonrpc: '2.0', method: 'initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'account/rateLimits/read', params: null })
  })
}

/** Codex (ChatGPT sub) — weekly + 5h window from the app-server rate-limits RPC. */
export function codexAdapter(): UsageAdapter {
  return {
    id: 'codex',
    label: 'Codex',
    burnId: 'codex',
    available: true,
    async fetchRemaining(d: UsageDeps) {
      const result = await codexRateLimits(d.spawn)
      const plan =
        result?.rateLimits && typeof (result.rateLimits as { planType?: string }).planType === 'string'
          ? (result.rateLimits as { planType?: string }).planType!
          : (result.planType ?? null)
      return { plan, windows: parseCodexRateLimits(result), health: null, note: null }
    }
  }
}
