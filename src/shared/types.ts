export type SessionStatus = 'starting' | 'running' | 'exited' | 'failed' | 'detached'

// Activity ledger — milestones recorded as they happen, surfaced live in the title-bar strip
// and available for daily summaries.
export type ActivityKind = 'spawn' | 'merge' | 'discard'
export interface ActivityEvent {
  id: string
  ts: number
  projectId: string | null
  kind: ActivityKind
  presetId: string | null
  branch: string | null
  summary: string
  meta: Record<string, unknown> | null
}

// Curated project knowledge base — the institutional memory the personal agent and leads maintain:
// features (status: building → shipped), bugs (open → fixing → fixed), and ideas. Answers
// "have we already built/fixed X?" and tracks the lifecycle. Distinct from the activity log.
export type KnowledgeType = 'feature' | 'bug' | 'idea'
export interface KnowledgeEntry {
  id: string
  projectId: string | null
  type: KnowledgeType
  title: string
  detail: string | null
  status: string // feature: 'building' | 'shipped'  ·  bug: 'open' | 'fixing' | 'fixed'
  branch: string | null
  createdAt: number
  updatedAt: number
  resolvedAt: number | null // shipped-at (feature) / fixed-at (bug)
}

// Curated, rule-first coding standards injected into EVERY worker's brief before it writes code, so
// a multi-model fleet (Claude/Codex/GLM/MiniMax/MiMo) stays consistent. Global rows (projectId null)
// apply everywhere; project rows scope to one project. The personal agent curates them
// (ask→draft→confirm); kept
// token-tight because they ride into every pane on every spawn. Distinct from the knowledge base
// (features/bugs) and the activity log — this is "how we write code here".
export type StandardCategory = 'style' | 'naming' | 'testing' | 'git' | 'arch' | 'deps' | 'models' | 'general'
export interface StandardEntry {
  id: string
  projectId: string | null // null = global (applies to every project)
  category: StandardCategory
  rule: string // the imperative rule — leads the entry
  detail: string | null // optional WHY + a tiny code example (token-conscious)
  status: 'active' | 'retired' // 'retired' drops it from injection
  sort: number // curator ordering within scope (lower = earlier)
  createdAt: number
  updatedAt: number
}

export interface Preset {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  defaultCwd?: string
  icon?: string
  color?: string
  isSeed?: boolean
  isOrchestrator?: boolean // a "lead" preset: wired with product MCP tools; lives in the rail dock, hidden from the spawn bar
  comingSoon?: boolean // shown disabled in the orchestrator picker; not yet wired to spawn
  free?: boolean // runs on a no-cost model — badged in the orchestrator picker (the $0 failover lead)
  // A one-line prompt typed into the pane once it's ready (used for orchestrators whose CLI has
  // no system-prompt/instructions flag, so the briefing rides in as the first turn).
  openingPrompt?: string
}

export interface Project {
  id: string
  name: string
  rootPath: string
  createdAt: number
  updatedAt: number
}

export interface SessionRecord {
  id: string
  projectId: string | null
  presetId: string
  tmuxName: string
  cwd: string
  title: string
  /** Operator-given callsign, separate from the descriptive title. */
  callsign?: string | null
  status: SessionStatus
  createdAt: number
  lastSeenAt: number
  branch?: string | null // the product-prefixed worktree branch (null/absent for non-isolated sessions)
  originRoot?: string | null // the repo the worktree was cut from (for merge/cleanup)
  task?: string | null // current task ("what am I doing") — seeded from spawn, updatable via set_task
  owner?: string | null // orchestrator preset id that owns this worker (for owner grouping)
  taskState?: TaskState | null // self-reported work state, distinct from the process `status`
  lastOutput?: string | null // bounded final terminal tail from an unexpected exit
  lastExitCode?: number | null // pty attach-client exit code accompanying that tail
}

export interface WorktreeEntry {
  path: string
  branch: string
  projectId: string
  projectName: string
  dirty: boolean
  inUse: boolean
  sessionTitle?: string
}

// A self-reported work state (distinct from the OS-level SessionStatus): a process can be
// 'running' AND 'needs_review'. Set via the set_task MCP tool; absent until a worker reports.
export type TaskState = 'working' | 'needs_review' | 'blocked' | 'done'

// --- Remaining plan usage: per-agent quota left on the sub/plan ----------------------------------
// Honesty contract: available:false = no source at all (NO SOURCE YET); error != null = a real
// source that failed (surfaced verbatim); never invented numbers, never silent zeros.

/** One rolling quota window (5h session, weekly, or per-model weekly). Providers return a
 *  rolling-window PERCENT, not an absolute count — remainingPct is the one field they all yield. */
export interface UsageWindow {
  id: string // 'session' | 'weekly' | 'weekly-opus' | 'weekly-sonnet'
  label: string // '5h' | 'Weekly' | 'Weekly (Opus)'
  remainingPct: number // 0..100 REMAINING (already normalized: 100 - used, or provider's own remaining)
  resetAt: number | null // epoch ms when the window rolls over
  severity: 'normal' | 'warning' | 'critical' | null // provider hint if present; else derive from pct
}

export interface UsageRemaining {
  plan: string | null // display tier: 'Claude Max' | 'prolite' | 'pro' | 'standard-tier'
  windows: UsageWindow[] // 0+ windows; [] is valid when only a health light exists (Grok)
  health: 'live' | 'expired' | 'blocked' | null // validity light for providers with no gauge
  note: string | null // one-line honest caveat ("no proactive counter — status light only")
}

export interface UsageRow {
  id: string // usage-scoped: 'claude-code' | 'codex' | 'kimi' | 'grok' | 'opencode-glm' | 'opencode-minimax'
  label: string
  burnId: string | null // reserved cross-report join key (null = none); the remaining-only panel ignores it
  available: boolean // false = no remaining source → NO SOURCE YET
  needsOptIn?: boolean // true = a source exists but is gated behind an explicit user opt-in (Keychain)
  optInKey?: string // the setting the Enable button flips (present when needsOptIn)
  error: string | null // source exists but failed this poll — verbatim (never silent zeros)
  remaining: UsageRemaining | null
}

export interface UsageReport {
  generatedAt: number
  agents: UsageRow[]
}
