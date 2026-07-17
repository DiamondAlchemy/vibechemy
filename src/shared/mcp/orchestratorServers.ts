// Pure builder for the mcpServers map written into the orchestrator's generated MCP config
// (see main/orchestrator/setup.ts writeOrchestratorConfig). No Node/Electron imports — the
// server list is plain data, so it's constructed and unit-tested here directly.
import { PRODUCT_IDENTITY } from '../product'

export interface McDesktopServerConfig {
  type: 'http'
  url: string
  headers: { Authorization: string }
}

export interface StdioServerConfig {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
}

export type OrchestratorMcpServer = McDesktopServerConfig | StdioServerConfig

export interface OrchestratorMcpConfig {
  mcpServers: Record<string, OrchestratorMcpServer>
}

/**
 * The Playwright MCP server: real browser control over CDP via `npx @playwright/mcp@latest`.
 * Its standard stdio MCP config needs no macOS TCC/Accessibility access, so every fleet agent
 * (Claude, Codex, GLM, Grok, OpenCode) can drive a browser to test web apps once this server rides
 * in a pane's --mcp-config.
 */
export const PLAYWRIGHT_MCP_SERVER: StdioServerConfig = {
  type: 'stdio',
  command: 'npx',
  args: ['@playwright/mcp@latest'],
  env: {}
}

/**
 * Builds the mcpServers map for a generated orchestrator/worker MCP config: the product control
 * plane (bearer-token gated) plus playwright (browser control) by default. Callers can
 * pass includePlaywright:false when they need the minimal control-plane-only configuration.
 */
export function buildOrchestratorMcpServers(
  token: string,
  url: string,
  opts?: { includePlaywright?: boolean }
): OrchestratorMcpConfig {
  const includePlaywright = opts?.includePlaywright ?? true
  const mcpServers: Record<string, OrchestratorMcpServer> = {
    [PRODUCT_IDENTITY.mcpServerName]: { type: 'http', url, headers: { Authorization: `Bearer ${token}` } }
  }
  if (includePlaywright) mcpServers.playwright = PLAYWRIGHT_MCP_SERVER
  return { mcpServers }
}
