// 'sessions'  — session list changed
// 'activity'  — activity ledger updated
// 'projects'  — project registry changed
// 'presets'   — editable agent roster changed
export type McEventKind = 'sessions' | 'activity' | 'projects' | 'presets'
export interface McEvent {
  kind: McEventKind
}
