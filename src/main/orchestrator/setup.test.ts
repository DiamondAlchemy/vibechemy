import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  writeOrchestratorConfig,
  orchestratorPreset,
  codexOrchestratorPreset,
  CODEX_ORCHESTRATOR_PROMPT,
  writeOpencodeOrchestratorConfig,
  opencodeOrchestratorPresets,
  ORCHESTRATOR_BRIEFING
} from './setup'

describe('orchestrator setup', () => {
  it('writes an mcp.json carrying the live token + url', () => {
    const base = mkdtempSync(join(tmpdir(), 'mc-orch-'))
    const { dir, mcpConfig } = writeOrchestratorConfig(base, 'TOK123', 'http://127.0.0.1:4880/mcp')
    expect(mcpConfig).toBe(join(base, 'orchestrator', 'mcp.json'))
    expect(dir).toBe(join(base, 'orchestrator'))
    const cfg = JSON.parse(readFileSync(mcpConfig, 'utf8'))
    const srv = cfg.mcpServers.vibechemy
    expect(srv.type).toBe('http')
    expect(srv.url).toBe('http://127.0.0.1:4880/mcp')
    expect(srv.headers.Authorization).toBe('Bearer TOK123')
  })

  it('orchestrator config carries vibechemy and playwright; a minimal config carries vibechemy only', () => {
    const base = mkdtempSync(join(tmpdir(), 'mc-orch-'))
    const { mcpConfig: orchConfigPath } = writeOrchestratorConfig(base, 'TOK123', 'http://127.0.0.1:4880/mcp')
    const orchCfg = JSON.parse(readFileSync(orchConfigPath, 'utf8'))
    expect(Object.keys(orchCfg.mcpServers).sort()).toEqual(['playwright', 'vibechemy'])
    expect(orchCfg.mcpServers.playwright).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      env: {}
    })

    const { mcpConfig: minimalConfigPath } = writeOrchestratorConfig(
      base,
      'TOK123',
      'http://127.0.0.1:4880/mcp',
      'minimal-agent',
      { includePlaywright: false }
    )
    const minimalCfg = JSON.parse(readFileSync(minimalConfigPath, 'utf8'))
    expect(Object.keys(minimalCfg.mcpServers)).toEqual(['vibechemy'])
    expect(minimalCfg.mcpServers.playwright).toBeUndefined()
  })

  it('builds an Orchestrator preset that wires the mcp config + briefing into claude', () => {
    const p = orchestratorPreset('/abs/orchestrator/mcp.json')
    expect(p.id).toBe('orchestrator')
    expect(p.command).toBe('claude')
    expect(p.args).toEqual([
      '--mcp-config',
      '/abs/orchestrator/mcp.json',
      '--append-system-prompt',
      ORCHESTRATOR_BRIEFING
    ])
  })

  it('builds a Codex orchestrator preset: inline vibechemy config + env token + briefing prompt', () => {
    const p = codexOrchestratorPreset('TOK123', 'http://127.0.0.1:4880/mcp')
    expect(p.id).toBe('orchestrator-codex')
    expect(p.command).toBe('codex')
    expect(p.isOrchestrator).toBe(true)
    expect(p.color).toBe('#10a37f')
    // -c flags must precede the positional prompt (verified: codex parses options-then-prompt).
    expect(p.args).toEqual([
      '-c',
      'mcp_servers.vibechemy.url="http://127.0.0.1:4880/mcp"',
      '-c',
      'mcp_servers.vibechemy.bearer_token_env_var="MCP_VIBECHEMY_API_KEY"',
      CODEX_ORCHESTRATOR_PROMPT
    ])
    // Codex reads the bearer token from this env var (named in the -c config).
    expect(p.env.MCP_VIBECHEMY_API_KEY).toBe('TOK123')
    // The prompt carries the shared briefing so behavior matches the Claude orchestrator.
    expect(CODEX_ORCHESTRATOR_PROMPT).toContain(ORCHESTRATOR_BRIEFING)
  })

  it('writes a dedicated opencode config (vibechemy + briefing instructions), token NOT on disk', () => {
    const base = mkdtempSync(join(tmpdir(), 'mc-oc-'))
    const { config, briefing } = writeOpencodeOrchestratorConfig(base, 'http://127.0.0.1:4880/mcp')
    expect(config).toBe(join(base, 'orchestrator', 'opencode.json'))
    const cfg = JSON.parse(readFileSync(config, 'utf8'))
    const srv = cfg.mcp.vibechemy
    expect(srv.type).toBe('remote')
    expect(srv.url).toBe('http://127.0.0.1:4880/mcp')
    // token resolved from env at launch — never written to disk
    expect(srv.headers.Authorization).toBe('Bearer {env:MCP_VIBECHEMY_API_KEY}')
    expect(JSON.stringify(cfg)).not.toContain('TOK')
    expect(cfg.instructions).toEqual([briefing])
    expect(readFileSync(briefing, 'utf8')).toBe(ORCHESTRATOR_BRIEFING)
  })

  it('builds OpenCode orchestrator presets (scoped via OPENCODE_CONFIG + env token), incl. free models', () => {
    const presets = opencodeOrchestratorPresets('TOK123', '/abs/orchestrator/opencode.json')
    expect(presets.length).toBeGreaterThanOrEqual(3)
    for (const p of presets) {
      expect(p.command).toBe('opencode')
      expect(p.args[0]).toBe('-m')
      expect(p.isOrchestrator).toBe(true)
      expect(p.env.OPENCODE_CONFIG).toBe('/abs/orchestrator/opencode.json')
      expect(p.env.MCP_VIBECHEMY_API_KEY).toBe('TOK123')
    }
    // MiMo is the remaining $0 lead; MiniMax is now the paid regular M3; Nemotron is gone
    expect(presets.some((p) => p.free && p.args.includes('opencode/mimo-v2.5-free'))).toBe(true)
    expect(presets.some((p) => !p.free && p.args.includes('minimax/MiniMax-M3'))).toBe(true)
    expect(presets.some((p) => p.args.some((a) => a.includes('nemotron')))).toBe(false)
  })

  it('briefing references only real vibechemy tools and enforces honest reporting', () => {
    // These tools do not exist in this build — the briefing must not sell them.
    expect(ORCHESTRATOR_BRIEFING).not.toMatch(/run_check/)
    expect(ORCHESTRATOR_BRIEFING).not.toMatch(/deploy\(/)
    expect(ORCHESTRATOR_BRIEFING).toMatch(/NO deploy tool/i)
    expect(ORCHESTRATOR_BRIEFING).toMatch(/arbitrary ssh\/remote/i)
    expect(ORCHESTRATOR_BRIEFING).toMatch(/never claim something passed if it failed/i)
  })
})

describe('per-identity orchestrator config dir', () => {
  it('defaults to orchestrator/ and honors a dev dir name', () => {
    const base = mkdtempSync(join(tmpdir(), 'mc-orch-'))
    const prod = writeOrchestratorConfig(base, 'tok', 'http://127.0.0.1:4880/mcp')
    expect(prod.mcpConfig).toBe(join(base, 'orchestrator', 'mcp.json'))
    const dev = writeOrchestratorConfig(base, 'devtok', 'http://127.0.0.1:4881/mcp', 'orchestrator-dev')
    expect(dev.mcpConfig).toBe(join(base, 'orchestrator-dev', 'mcp.json'))
    // dev write must not have touched the prod file
    const prodJson = JSON.parse(readFileSync(prod.mcpConfig, 'utf8'))
    expect(prodJson.mcpServers.vibechemy.url).toBe('http://127.0.0.1:4880/mcp')
    expect(prodJson.mcpServers.vibechemy.headers.Authorization).toBe('Bearer tok')
  })

  it('opencode config honors the dir name too', () => {
    const base = mkdtempSync(join(tmpdir(), 'mc-orch-'))
    const oc = writeOpencodeOrchestratorConfig(base, 'http://127.0.0.1:4881/mcp', 'orchestrator-dev')
    expect(oc.config).toBe(join(base, 'orchestrator-dev', 'opencode.json'))
    expect(existsSync(join(base, 'orchestrator-dev', 'opencode-briefing.md'))).toBe(true)
  })
})
