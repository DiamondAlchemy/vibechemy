import { describe, it, expect } from 'vitest'
import { buildOrchestratorMcpServers, PLAYWRIGHT_MCP_SERVER } from './orchestratorServers'

describe('buildOrchestratorMcpServers', () => {
  it('defaults to vibechemy + playwright', () => {
    const cfg = buildOrchestratorMcpServers('TOK123', 'http://127.0.0.1:4880/mcp')
    expect(Object.keys(cfg.mcpServers).sort()).toEqual(['playwright', 'vibechemy'])
    expect(cfg.mcpServers.vibechemy).toEqual({
      type: 'http',
      url: 'http://127.0.0.1:4880/mcp',
      headers: { Authorization: 'Bearer TOK123' }
    })
    expect(cfg.mcpServers.playwright).toEqual(PLAYWRIGHT_MCP_SERVER)
  })

  it('drops playwright when includePlaywright is false', () => {
    const cfg = buildOrchestratorMcpServers('TOK123', 'http://127.0.0.1:4880/mcp', { includePlaywright: false })
    expect(Object.keys(cfg.mcpServers)).toEqual(['vibechemy'])
  })

  it('playwright server launches via npx @playwright/mcp@latest, matching the CDP-driven shape', () => {
    expect(PLAYWRIGHT_MCP_SERVER).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['@playwright/mcp@latest'],
      env: {}
    })
  })
})
