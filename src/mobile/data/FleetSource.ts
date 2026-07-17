// The single seam between the mobile UI and the fleet. MockFleetSource backs the demo;
// a live implementation can back this seam.
export interface MobileWorker {
  workerId: string
  preset: string
  status: string // 'running' | 'detached' | 'exited' | ...
  cwd: string
  branch: string | null
  isolated: boolean
}

export interface SendResult {
  ok: boolean
  delivery?: string // 'enter-sent' | 'pane-gone' | 'send-failed'
  message?: string
}

export interface FleetEvent {
  kind: string // 'worker_added' | 'worker_status' | ...
  workerId?: string
}

export interface FleetSource {
  listWorkers(): Promise<MobileWorker[]>
  /** Current-screen snapshot of the pane (capture-pane style). */
  readOutput(workerId: string, lines?: number): Promise<string>
  /** Type text into the pane and press one Enter (send_to_worker semantics). */
  sendToWorker(workerId: string, text: string): Promise<SendResult>
  /** Optional long-poll for live events; absent implementations degrade to polling only. */
  awaitEvent?(timeoutMs: number): Promise<{ events: FleetEvent[] }>
}
