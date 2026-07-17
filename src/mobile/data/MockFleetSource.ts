import type { FleetSource, MobileWorker, SendResult } from './FleetSource'

const SEED: MobileWorker[] = [
  { workerId: 'w-alpha', preset: 'codex', status: 'running', cwd: '~/projects/web-app', branch: 'feature/parser-rewrite', isolated: true },
  { workerId: 'w-bravo', preset: 'claude-opus', status: 'running', cwd: '~/projects/app', branch: null, isolated: false },
  { workerId: 'w-charlie', preset: 'opencode-glm', status: 'detached', cwd: '~/projects/api', branch: 'feature/api-cleanup', isolated: true }
]

/** In-memory fleet for building/testing the UI with zero network. */
export class MockFleetSource implements FleetSource {
  private snapshots = new Map<string, string>(
    SEED.map((w) => [w.workerId, `${w.preset} on ${w.cwd}\n$ (idle)\n`])
  )

  async listWorkers(): Promise<MobileWorker[]> {
    return SEED.map((w) => ({ ...w }))
  }

  async readOutput(workerId: string): Promise<string> {
    return this.snapshots.get(workerId) ?? ''
  }

  async sendToWorker(workerId: string, text: string): Promise<SendResult> {
    if (!this.snapshots.has(workerId)) return { ok: false, message: `unknown worker: ${workerId}` }
    this.snapshots.set(workerId, (this.snapshots.get(workerId) ?? '') + `> ${text}\n`)
    return { ok: true, delivery: 'enter-sent' }
  }
}
