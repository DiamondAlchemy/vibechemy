import type { Preset } from '@shared/types'

export const SEED_PRESETS: Preset[] = [
  {
    id: 'shell',
    name: 'Shell',
    command: process.env.SHELL || 'zsh',
    args: [],
    env: {},
    isSeed: true,
    color: '#8b8b8b'
  },
  {
    id: 'claude-opus',
    name: 'Claude · Opus',
    command: 'claude',
    args: ['--model', 'opus'],
    env: {},
    isSeed: true,
    color: '#d97757'
  },
  {
    id: 'claude-fable',
    name: 'Claude · Fable',
    command: 'claude',
    args: ['--model', 'claude-fable-5'],
    env: {},
    isSeed: true,
    color: '#f0b429'
  },
  { id: 'codex', name: 'Codex', command: 'codex', args: [], env: {}, isSeed: true, color: '#10a37f' },
  // Google's agent CLI: Antigravity (`agy`) superseded the retired gemini-cli.
  { id: 'antigravity', name: 'Antigravity', command: 'agy', args: [], env: {}, isSeed: true, color: '#4285f4' },
  // Cursor's terminal agent (`cursor-agent`) — auth rides the Cursor subscription login.
  { id: 'cursor', name: 'Cursor', command: 'cursor-agent', args: [], env: {}, isSeed: true, color: '#e4e4e7' },
  // xAI's Grok Build agent (`grok`) — auth rides the SuperGrok/X subscription login.
  { id: 'grok', name: 'Grok', command: 'grok', args: [], env: {}, isSeed: true, color: '#1d9bf0' },
  // Moonshot's Kimi Code agent (`kimi`) — auth rides the Kimi subscription device-code login.
  { id: 'kimi', name: 'Kimi', command: 'kimi', args: [], env: {}, isSeed: true, color: '#2dd4bf' },
  {
    id: 'opencode-glm',
    name: 'OpenCode · GLM',
    command: 'opencode',
    args: ['-m', 'zai-coding-plan/glm-5.2'],
    env: {},
    isSeed: true,
    color: '#7c5cff'
  },
  {
    id: 'opencode-minimax',
    name: 'OpenCode · MiniMax',
    command: 'opencode',
    args: ['-m', 'minimax/MiniMax-M3'],
    env: {},
    isSeed: true,
    color: '#ff5c8a'
  }
]
