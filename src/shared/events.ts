// 'sessions'  — session list changed
// 'activity'  — activity ledger updated
// 'projects'  — project registry changed
// 'presets'   — editable agent roster changed
// 'artifacts' — a file changed in the configured artifacts dir (fs-watch)
export type McEventKind = 'sessions' | 'activity' | 'projects' | 'presets' | 'artifacts'
export interface McEvent {
  kind: McEventKind
}
