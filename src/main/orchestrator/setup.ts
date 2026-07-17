import { mkdirSync, writeFileSync, existsSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import type { Preset } from '@shared/types'
import { codexModelArgs } from '@shared/agents/models'
import { buildOrchestratorMcpServers } from '@shared/mcp/orchestratorServers'
import { PRODUCT_IDENTITY } from '@shared/product'

export const ORCHESTRATOR_BRIEFING = `You are the Vibechemy Orchestrator, running inside the Vibechemy desktop app. You command a fleet of REAL CLI coding agents through the "${PRODUCT_IDENTITY.mcpServerName}" MCP tools. This is the live desktop app.

Your tools (MCP server "${PRODUCT_IDENTITY.mcpServerName}"):
- list_projects — the user's registered projects (id, name, path). Start here to find where to work.
- list_presets — the spawnable worker presets (id, name) for spawn_worker. Use it if a presetId is rejected or you're unsure of the exact id.
- configure_agents / get_agent_config — read + edit the agent roster itself. add_opencode_model({label, slug}) makes ANY provider/model opencode supports a spawnable chip instantly (slug is "provider/model"; the provider must be signed in via opencode auth login or opencode silently falls back to its default model); also remove_opencode_model, add/remove custom agent chips, account labels/roles, and the role-to-model table. Sign-in itself stays human.
- get_memory({ projectId }) — the project's shared memory and durable learnings. Read it before planning so you're as project-aware as your workers.
- note_learning({ projectId, text }) — append a durable discovery to the project's shared learning log (reaches every agent). Record what you learn.
- list_workers — current worker sessions (panes): id, preset, branch, status.
- spawn_worker({ presetId, projectId | cwd, isolate, task, model?, effort? }) — launch a NEW agent. presetId is any id from list_presets — the roster is LIVE, not a fixed set: seed chips (claude-opus, claude-fable, codex, cursor, grok, kimi, antigravity, shell), one opencode-<model> chip per entry in the editable OpenCode roster (GLM + MiniMax by default; ANY provider/model opencode supports can be added — see configure_agents), plus account/custom chips the user configures. A bare name also resolves when it matches uniquely ("opus" -> claude-opus, "glm" -> opencode-glm; an ambiguous name like "claude" errors and lists the candidates). For any code work pass isolate:true (gives the worker its own git worktree + branch). Put a clear instruction in "task". YOU CHOOSE THE MODEL when it helps: optional model (+ effort on codex) runs the worker on a specific model — e.g. model "sonnet" on claude-opus for a quick/small task, model "gpt-5.6-terra" effort "xhigh" on codex for a heavy one, "haiku" for trivial chores. The model policy recorded in get_standards is the authority when it exists — follow it; otherwise match the model to the task's difficulty, or omit for the default.
- send_to_worker({ workerId, text }) — type a prompt into an ALREADY-RUNNING worker and submit it (Enter). This is how you CONTINUE or STEER a worker mid-task — give it a follow-up, a fix list, a correction. ALWAYS prefer this over spawning a second agent when one with the right context is already running: two agents in the same worktree will collide. Empty text just presses Enter (e.g. to submit a prompt a worker typed but didn't send).
- get_diff({ workerId }) — see what a worker changed (the code).
- read_output({ workerId, lines? }) — read a worker's recent terminal output: its own narrative — what it did, what it's unsure about, what's left. Use this (alongside get_diff) to review reasoning, understand a half-finished or stuck worker, and decide the next step.
- merge_worker({ workerId }) — fold a worker's branch into its project (LOCAL only) and tear it down. Only after you've reviewed the diff and read_output confirms the worker's checks passed.
- discard_worker({ workerId }) — throw away a worker without merging.
- log_outcome({ projectId, type, title, detail?, status? }) — record what you ship in the project knowledge base (the institutional memory). When you merge a feature, log type:"feature" (title = the feature). When you land a fix, log type:"bug" status:"fixed". This is what stops us re-building or re-fixing things.
- search_knowledge({ query, projectId? }) — BEFORE starting work, check whether we've already built or fixed it.
- list_knowledge({ projectId?, type?, status? }) — the features + bugs on record; e.g. type:"bug" status:"open" is the open-bug board.
- get_standards({ projectId? }) — the curated, rule-first coding conventions every worker in this project is auto-injected with before it writes code (global + project). Know what your workers are held to.
- log_standard({ projectId?, category, rule, detail? }) — add ONE convention to that injected set: lead with the imperative rule, put WHY/a tiny example in detail. One concept, skip the obvious, keep it token-tight (it rides into every pane). projectId omitted = a GLOBAL rule for every project.
- update_standard({ id, ..., status? }) — edit a standard, or status:"retired" to drop it from injection. Prefer retiring stale rules over letting the block grow.

How you work: when the user gives a goal — (1) list_projects to pick the target repo; (2) search_knowledge so you don't rebuild/refix something we already have; (3) break it into scoped, non-overlapping tasks; (4) spawn one isolated worker per task with a precise "task" prompt; (5) track them with list_workers; (6) before merging, review the code with get_diff and confirm via read_output that the worker's checks passed — if it hasn't run them, send_to_worker to have it run the build/tests and report; (7) merge_worker only the good ones; (8) log_outcome each feature added / bug fixed so the knowledge base stays current; (9) report a crisp summary and ask before anything risky or ambiguous.

Cleaning up old work (when the user asks you to review leftover/closed worktrees): list_leftovers({ projectId }) shows isolated worktrees from workers the user already closed — their agents are gone, but the branches sit on disk. Review one with get_diff, tell the user what each did, and recommend keep vs toss. merge_worker the keepers — it captures even uncommitted work. Only discard_worker the ones the user explicitly approves; a leftover with dirty:true has uncommitted work (get_diff won't show it), so prefer merge_worker and never discard a dirty one without explicit confirmation.

HARD RULES — never violate:
- Merges are LOCAL. You have NO deploy tool: never push, ship, or run arbitrary ssh/remote commands — going live is the user's own step, outside these tools. Report check results HONESTLY — never claim something passed if it failed.
- You are the single writer to each project's branch; workers never merge themselves.
- Do not put multiple workers on the same files at once — they will conflict. Use separate tasks/files, or run them sequentially.
- Keep the human in the loop: confirm before spawning a large fleet or merging high-stakes changes. Be concise.`

// Codex has no system-prompt flag, so the briefing is delivered as the opening prompt.
// The trailing line keeps Codex from charging off before the user gives a goal.
export const CODEX_ORCHESTRATOR_PROMPT = `${ORCHESTRATOR_BRIEFING}

This is your operating briefing — your role for this whole session, not a task to act on yet. Reply with a one-line readiness check, then wait for my first instruction.`

export interface OrchestratorPaths {
  dir: string
  mcpConfig: string
}

/**
 * Write the orchestrator's MCP config (carrying the live bearer token) so the
 * Orchestrator preset can hand Claude the control-plane tools via --mcp-config —
 * scoped to that one pane, so worker panes don't get spawn/merge powers. Also wires in the
 * Playwright MCP (browser control over CDP, zero TCC/Accessibility involvement) so fleet
 * agents can drive a browser to test web apps. Callers that need a minimal configuration pass
 * opts.includePlaywright:false.
 */
export function writeOrchestratorConfig(
  baseDir: string,
  token: string,
  url: string,
  dirName = 'orchestrator',
  opts?: { includePlaywright?: boolean }
): OrchestratorPaths {
  const dir = join(baseDir, dirName)
  mkdirSync(dir, { recursive: true })
  const mcpConfig = join(dir, 'mcp.json')
  writeFileSync(mcpConfig, JSON.stringify(buildOrchestratorMcpServers(token, url, opts), null, 2), { mode: 0o600 })
  return { dir, mcpConfig }
}

/**
 * The Claude orchestrator: a Claude pane pre-wired with the control-plane tools
 * (via --mcp-config, scoped to this pane) and the orchestrator briefing (a real
 * system prompt via --append-system-prompt).
 */
export function orchestratorPreset(mcpConfigPath: string): Preset {
  return {
    id: 'orchestrator',
    name: 'Claude',
    command: 'claude',
    args: ['--mcp-config', mcpConfigPath, '--append-system-prompt', ORCHESTRATOR_BRIEFING],
    env: {},
    isSeed: true,
    isOrchestrator: true,
    color: '#d97757'
  }
}

/** The Claude Fable lead: same product MCP wiring as the Claude orchestrator, pinned to Fable. */
export function fableOrchestratorPreset(mcpConfigPath: string): Preset {
  return {
    id: 'orchestrator-fable',
    name: 'Claude · Fable',
    command: 'claude',
    args: ['--model', 'claude-fable-5', '--mcp-config', mcpConfigPath, '--append-system-prompt', ORCHESTRATOR_BRIEFING],
    env: {},
    isSeed: true,
    isOrchestrator: true,
    color: '#f0b429'
  }
}

/**
 * The Codex orchestrator: a Codex pane wired to the product MCP via inline `-c` config
 * overrides (verified to register the server for THIS invocation only, so plain
 * `codex` worker panes don't inherit spawn/merge powers). Codex reads the bearer
 * token from the env var named in the config; we set it via the preset env. Codex
 * has no system-prompt flag, so the briefing rides in as the opening prompt.
 */
export function codexOrchestratorPreset(token: string, url: string, o?: { model?: string; effort?: string }): Preset {
  return {
    id: 'orchestrator-codex',
    name: 'Codex',
    command: 'codex',
    args: [
      '-c',
      `mcp_servers.${PRODUCT_IDENTITY.mcpServerName}.url="${url}"`,
      '-c',
      `mcp_servers.${PRODUCT_IDENTITY.mcpServerName}.bearer_token_env_var="${PRODUCT_IDENTITY.mcpTokenEnvName}"`,
      // Lead model + reasoning effort come from Settings (agent.model/effort codex.lead) — flags
      // must precede the positional briefing prompt.
      ...codexModelArgs(o?.model, o?.effort),
      CODEX_ORCHESTRATOR_PROMPT
    ],
    env: { [PRODUCT_IDENTITY.mcpTokenEnvName]: token },
    isSeed: true,
    isOrchestrator: true,
    color: '#10a37f'
  }
}

export interface OpencodeOrchestratorPaths {
  dir: string
  config: string
  briefing: string
}

/**
 * Write a DEDICATED opencode config (+ briefing file) for the orchestrator pane.
 * Scoping works exactly like Claude's --mcp-config: the orchestrator pane launches with
 * OPENCODE_CONFIG pointed here (product MCP defined), while worker `opencode` panes use
 * the user's global config (without it) — so workers never inherit the control plane.
 * The bearer token is NOT written to disk; opencode resolves the product token environment variable
 * at launch from the preset env.
 */
export function writeOpencodeOrchestratorConfig(
  baseDir: string,
  url: string,
  dirName = 'orchestrator'
): OpencodeOrchestratorPaths {
  const dir = join(baseDir, dirName)
  mkdirSync(dir, { recursive: true })
  const briefing = join(dir, 'opencode-briefing.md')
  writeFileSync(briefing, ORCHESTRATOR_BRIEFING, { mode: 0o600 })
  const config = join(dir, 'opencode.json')
  writeFileSync(
    config,
    JSON.stringify(
      {
        $schema: 'https://opencode.ai/config.json',
        mcp: {
          [PRODUCT_IDENTITY.mcpServerName]: {
            type: 'remote',
            url,
            enabled: true,
            headers: { Authorization: `Bearer {env:${PRODUCT_IDENTITY.mcpTokenEnvName}}` }
          }
        },
        instructions: [briefing]
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  return { dir, config, briefing }
}

// OpenCode orchestrator flavors — the failover roster. The model is just `-m`, so adding more is
// one line. MiMo is the remaining $0 option (ship at $0 even with paid providers exhausted); GLM
// runs on the Z.ai coding plan and MiniMax M3 on the MiniMax plan. (Verified via `opencode models`.)
export const OPENCODE_ORCHESTRATOR_MODELS: Array<{
  id: string
  name: string
  model: string
  color: string
  free?: boolean
}> = [
  { id: 'orchestrator-opencode-glm', name: 'OpenCode · GLM', model: 'zai-coding-plan/glm-5.2', color: '#7c5cff' },
  { id: 'orchestrator-opencode-minimax', name: 'OpenCode · MiniMax', model: 'minimax/MiniMax-M3', color: '#ff5c8a' },
  {
    id: 'orchestrator-opencode-mimo',
    name: 'OpenCode · MiMo',
    model: 'opencode/mimo-v2.5-free',
    color: '#f59e0b',
    free: true
  }
]

/**
 * The OpenCode orchestrators: one preset per model, all sharing the dedicated config
 * (product MCP + briefing) via OPENCODE_CONFIG, with the bearer token in the preset env.
 */
export function opencodeOrchestratorPresets(token: string, configPath: string): Preset[] {
  return OPENCODE_ORCHESTRATOR_MODELS.map((m) => ({
    id: m.id,
    name: m.name,
    command: 'opencode',
    args: ['-m', m.model],
    env: { OPENCODE_CONFIG: configPath, [PRODUCT_IDENTITY.mcpTokenEnvName]: token },
    isSeed: true,
    isOrchestrator: true,
    free: m.free,
    color: m.color
  }))
}

export interface GrokOrchestratorPaths {
  grokHome: string
}

/**
 * Write a DEDICATED grok config home for the orchestrator pane. GROK_HOME relocates grok's config
 * dir (so worker `grok` panes on the default ~/.grok never inherit the product control plane),
 * while GROK_AUTH_PATH + an auth.json symlink keep the pane signed in via the real ~/.grok/auth.json.
 * The product MCP bearer is written literally into config.toml (mode 0600) — grok config headers are
 * literal strings (no env interpolation), the same on-disk pattern as the Claude orchestrator's
 * mcp.json. Rewritten each boot with the current token, so it never goes stale.
 */
export function writeGrokOrchestratorHome(
  baseDir: string,
  token: string,
  url: string,
  dirName = 'orchestrator'
): GrokOrchestratorPaths {
  const grokHome = join(baseDir, dirName, 'grok-home')
  mkdirSync(grokHome, { recursive: true })
  const toml = [
    `[mcp_servers.${PRODUCT_IDENTITY.mcpServerName}]`,
    `url = "${url}"`,
    'enabled = true',
    '',
    `[mcp_servers.${PRODUCT_IDENTITY.mcpServerName}.headers]`,
    `Authorization = "Bearer ${token}"`,
    ''
  ].join('\n')
  writeFileSync(join(grokHome, 'config.toml'), toml, { mode: 0o600 })
  // Keep the pane signed in: symlink the real auth into the dedicated home (belt-and-suspenders with
  // GROK_AUTH_PATH). Best-effort — a login prompt on first summon is the fallback, not a crash.
  const authLink = join(grokHome, 'auth.json')
  const realAuth = join(homedir(), '.grok', 'auth.json')
  try {
    if (!existsSync(authLink) && existsSync(realAuth)) symlinkSync(realAuth, authLink)
  } catch {
    /* symlink best-effort */
  }
  return { grokHome }
}

/**
 * The Grok orchestrator: a `grok` pane wired to the product MCP via a dedicated GROK_HOME config, with
 * the orchestrator briefing appended through `--rules` (grok's append-system-prompt equivalent).
 * Auth rides the real ~/.grok/auth.json (GROK_AUTH_PATH + symlink) so the pane is already signed in.
 */
export function grokOrchestratorPreset(grokHome: string): Preset {
  return {
    id: 'orchestrator-grok',
    name: 'Grok',
    command: 'grok',
    args: ['--rules', ORCHESTRATOR_BRIEFING],
    env: { GROK_HOME: grokHome, GROK_AUTH_PATH: join(homedir(), '.grok', 'auth.json') },
    isSeed: true,
    isOrchestrator: true,
    color: '#1d9bf0'
  }
}
