/**
 * Agent setup catalog: everything Vibechemy knows about installing and signing in to each
 * agent CLI family. Pure data — probing lives in main (AgentSetupService), rendering in Settings.
 *
 * BYOK principle: Vibechemy NEVER touches credentials. `login` is the vendor's own interactive
 * sign-in, run in a visible terminal pane; `authFile`/`authCmd` only DETECT the result.
 * Probes reflect each CLI's actual on-disk auth artifact / status command.
 */

export interface AgentFamily {
  /** Stable id for the family (one card per family; a family can back several presets). */
  id: string
  title: string
  /** Binary probed via a LOGIN shell (`zsh -lc`) — GUI apps don't see ~/.local/bin otherwise. */
  bin: string
  /** Preset ids this family powers (spawn chips, tombstone mapping). */
  presets: string[]
  /** Shell one-liner that installs the CLI; absent = point at vendor docs. */
  install?: string
  /** The vendor's own interactive sign-in, run in a visible pane. */
  login?: string
  /** File that exists iff signed in (~ expanded main-side). */
  authFile?: string
  /** Fallback auth probe: run cmd, match output (case-insensitive regex source). */
  authCmd?: { cmd: string; ok: string }
  /** One-line operator hint shown on the card. */
  note?: string
}

export const AGENT_CATALOG: AgentFamily[] = [
  {
    id: 'claude',
    title: 'Claude Code',
    bin: 'claude',
    presets: ['claude-opus', 'claude-fable'],
    install: 'npm i -g @anthropic-ai/claude-code',
    login: 'claude',
    authFile: '~/.claude/.credentials.json',
    note: 'type /login inside if it asks'
  },
  {
    id: 'codex',
    title: 'Codex',
    bin: 'codex',
    presets: ['codex'],
    install: 'npm i -g @openai/codex',
    login: 'codex login',
    authFile: '~/.codex/auth.json'
  },
  {
    id: 'cursor',
    title: 'Cursor',
    bin: 'cursor-agent',
    presets: ['cursor'],
    install: 'curl https://cursor.com/install -fsS | bash',
    login: 'cursor-agent login',
    authCmd: { cmd: 'cursor-agent status', ok: 'logged in' }
  },
  {
    id: 'antigravity',
    title: 'Antigravity',
    bin: 'agy',
    presets: ['antigravity'],
    // Official installer. Auth lives in the system keyring — no on-disk artifact to probe, so
    // the signed-in chip stays neutral; first run of `agy` triggers Google Sign-In.
    install: 'curl -fsSL https://antigravity.google/cli/install.sh | bash',
    login: 'agy',
    note: 'first run signs in via Google; auth sits in the system keyring'
  },
  {
    id: 'grok',
    title: 'Grok Build (xAI)',
    bin: 'grok',
    presets: ['grok'],
    // Official installer (x.ai/cli). Auth = X-account sign-in on first run; no confirmed
    // on-disk artifact yet, so the signed-in chip stays neutral.
    install: 'curl -fsSL https://x.ai/cli/install.sh | bash',
    login: 'grok',
    note: 'first run signs in via your X account; SuperGrok sub covers Grok image/video'
  },
  {
    id: 'opencode',
    title: 'OpenCode (GLM + MiniMax)',
    bin: 'opencode',
    presets: ['opencode-glm', 'opencode-minimax'],
    install: 'npm i -g opencode-ai',
    login: 'opencode auth login',
    authFile: '~/.local/share/opencode/auth.json'
  }
]

/** Live status of one family, as probed on THIS machine. */
export interface AgentStatus {
  id: string
  title: string
  bin: string
  presets: string[]
  installed: boolean
  version: string | null
  /** true/false when probeable; null = no probe known (card shows —). */
  authed: boolean | null
  install?: string
  login?: string
  note?: string
}

export function familyForPreset(presetId: string): AgentFamily | undefined {
  return AGENT_CATALOG.find((f) => f.presets.includes(presetId))
}
