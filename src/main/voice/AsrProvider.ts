import type { VoiceStatus } from '@shared/ipc'

/** Availability plus the engine selected to answer the request. */
export interface AsrStatus extends VoiceStatus {
  engine?: string
}

/** Replaceable local speech-to-text engine seam. */
export interface AsrProvider {
  status(): AsrStatus
  transcribe(wav: Buffer): Promise<string>
  dispose(): void
}
