/** Per-distribution product values (set per app identity). */
export function mcpTokenEnvNameFor(mcpServerName: string): string {
  return `MCP_${mcpServerName.replace(/-/g, '_').toUpperCase()}_API_KEY`
}

const mcpServerName = 'vibechemy'

export const PRODUCT_IDENTITY = {
  mcpServerName,
  mcpTokenEnvName: mcpTokenEnvNameFor(mcpServerName),
  worktreeBranchPrefix: 'vc/'
} as const
