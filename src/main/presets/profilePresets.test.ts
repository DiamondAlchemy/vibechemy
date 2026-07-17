import { describe, it, expect } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { presetsFromProfiles } from './profilePresets'

const base = mkdtempSync(`${tmpdir()}/mc-prof-`)
const opts = { mcpConfigPath: '/tmp/mcp.json', baseDir: base }

describe('presetsFromProfiles', () => {
  it('orchestrator-only profile → one orch preset with isolated CLAUDE creds env', () => {
    const ps = presetsFromProfiles([{ id: 'p1', agentId: 'claude', label: 'Work Claude', role: 'orchestrator' }], opts)
    expect(ps).toHaveLength(1)
    const orch = ps[0]
    expect(orch.id).toBe('profile-p1-orch')
    expect(orch.name).toBe('Work Claude')
    expect(orch.isOrchestrator).toBe(true)
    expect(orch.args).toContain('--mcp-config')
    // Creds-only: securestorage is isolated to the profile; CLAUDE_CONFIG_DIR (projects) is NOT set
    // so it stays default/shared — that's what makes a session resumable across subs.
    expect(orch.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toContain('profiles/p1')
    expect(orch.env.CLAUDE_CONFIG_DIR).toBeUndefined()
  })
  it('role "both" → orch + worker sharing the same isolated creds dir', () => {
    const ps = presetsFromProfiles([{ id: 'p2', agentId: 'claude', label: 'Work 2', role: 'both' }], opts)
    expect(ps.map((p) => p.id)).toEqual(['profile-p2-orch', 'profile-p2'])
    const worker = ps.find((p) => p.id === 'profile-p2')!
    expect(worker.isOrchestrator).toBeFalsy()
    expect(worker.env.CLAUDE_SECURESTORAGE_CONFIG_DIR).toBe(ps[0].env.CLAUDE_SECURESTORAGE_CONFIG_DIR)
  })
  it('role decides the model: lead=Fable, worker=Opus by default (one chip per account)', () => {
    const ps = presetsFromProfiles([{ id: 'p4', agentId: 'claude', label: 'X', role: 'both' }], opts)
    const orch = ps.find((p) => p.id === 'profile-p4-orch')!
    expect(orch.args.slice(0, 2)).toEqual(['--model', 'claude-fable-5'])
    expect(orch.args).toContain('--mcp-config')
    expect(ps.find((p) => p.id === 'profile-p4')!.args).toEqual(['--model', 'opus'])
  })
  it('the Settings role→model mapping overrides the defaults (survives model renames)', () => {
    const ps = presetsFromProfiles([{ id: 'p5', agentId: 'claude', label: 'X', role: 'both' }], {
      ...opts,
      leadModel: 'claude-successor-6',
      workerModel: 'sonnet'
    })
    expect(ps.find((p) => p.id === 'profile-p5-orch')!.args.slice(0, 2)).toEqual(['--model', 'claude-successor-6'])
    expect(ps.find((p) => p.id === 'profile-p5')!.args).toEqual(['--model', 'sonnet'])
  })
  it('a legacy stored per-profile model is IGNORED — role decides (lead=Fable / worker=Opus)', () => {
    // Simulates an orphaned stored model: it must NOT force Fable on the worker.
    const ps = presetsFromProfiles(
      [{ id: 'p3', agentId: 'claude', label: 'Test Account', role: 'both', model: 'claude-fable-5' } as never],
      opts
    )
    expect(ps.find((p) => p.id === 'profile-p3-orch')!.args.slice(0, 2)).toEqual(['--model', 'claude-fable-5']) // lead default
    expect(ps.find((p) => p.id === 'profile-p3')!.args).toEqual(['--model', 'opus']) // worker default, NOT fable
  })
  it('skips unknown agentIds (reserved for later verticals)', () => {
    expect(presetsFromProfiles([{ id: 'g1', agentId: 'grok', label: 'G', role: 'orchestrator' }], opts)).toEqual([])
  })
})
