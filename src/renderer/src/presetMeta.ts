import { isPersonalAgentPresetId } from '@shared/agents/personalAgent'

export interface PanePresetMeta {
  color: string
  label: string
}

const PRESET_META: Record<string, PanePresetMeta> = {
  orchestrator: { color: 'amber', label: '★ Claude' },
  'orchestrator-codex': { color: 'green', label: '★ Codex' },
  'orchestrator-opencode-glm': { color: 'violet', label: '★ GLM' },
  'orchestrator-opencode-minimax': { color: 'pink', label: '★ MiniMax' },
  'orchestrator-opencode-mimo': { color: 'amber', label: '★ MiMo' },
  'claude-opus': { color: 'amber', label: 'claude · opus' },
  codex: { color: 'green', label: 'codex' },
  antigravity: { color: 'blue', label: 'antigravity' },
  cursor: { color: 'gray', label: 'cursor' },
  'opencode-glm': { color: 'violet', label: 'opencode · glm' },
  'opencode-minimax': { color: 'pink', label: 'opencode · minimax' },
  'opencode-mimo': { color: 'amber', label: 'opencode · mimo' },
  shell: { color: 'gray', label: 'shell' }
}

export function panePresetMeta(presetId: string, configuredLabel?: string): PanePresetMeta {
  if (isPersonalAgentPresetId(presetId)) {
    return { color: 'cyan', label: `★ ${configuredLabel?.trim() || 'Personal Agent'}` }
  }
  return PRESET_META[presetId] ?? { color: 'gray', label: configuredLabel?.trim() || presetId }
}
