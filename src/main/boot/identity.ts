/**
 * One resolver decides every per-instance name so the packaged production app
 * and `npm run dev` can run side by side without fighting over the DB, the MCP
 * port, the tmux server, or the orchestrator client configs.
 * Pure on purpose: no Electron imports, fully unit-testable.
 */
export interface InstanceIdentity {
  isDev: boolean
  /** userData dir name under app.getPath('appData') — pins the DB + mcp-token location. */
  userDataDirName: string
  mcpPort: number
  tmuxSocket: string
  /** Subdir of ~/.vibechemy holding client-facing orchestrator configs. */
  orchestratorDirName: string
}

export function resolveIdentity(packaged: boolean, env: NodeJS.ProcessEnv): InstanceIdentity {
  const isDev = !packaged
  const envPort = Number(env.MCP_PORT)
  const mcpPort = Number.isInteger(envPort) && envPort > 0 && envPort <= 65535 ? envPort : isDev ? 4881 : 4880
  return {
    isDev,
    userDataDirName: isDev ? 'vibechemy-dev' : 'vibechemy',
    mcpPort,
    tmuxSocket: isDev ? 'vibechemy-dev' : 'vibechemy',
    orchestratorDirName: isDev ? 'orchestrator-dev' : 'orchestrator'
  }
}
