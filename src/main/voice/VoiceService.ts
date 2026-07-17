import type { AsrProvider, AsrStatus } from './AsrProvider'

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function downloadCommandFor(scriptPath: string): string {
  return `bash ${quoteForShell(scriptPath)}`
}

/** Owns the selected local recognizer and exposes its lifecycle to app boot and IPC. */
export class VoiceService implements AsrProvider {
  private disposed = false

  constructor(
    private readonly provider: AsrProvider,
    private readonly installScriptPath?: string
  ) {}

  status(): AsrStatus {
    if (this.disposed) return { available: false, reason: 'voice service disposed' }
    const status = this.provider.status()
    return this.installScriptPath ? { ...status, downloadCommand: downloadCommandFor(this.installScriptPath) } : status
  }

  transcribe(wav: Buffer): Promise<string> {
    if (this.disposed) return Promise.reject(new Error('voice service disposed'))
    return this.provider.transcribe(wav)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.provider.dispose()
  }
}
