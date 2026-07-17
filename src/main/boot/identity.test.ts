import { describe, it, expect } from 'vitest'
import { resolveIdentity } from './identity'

describe('resolveIdentity', () => {
  it('packaged owns the production identity', () => {
    const id = resolveIdentity(true, {})
    expect(id).toEqual({
      isDev: false,
      userDataDirName: 'vibechemy',
      mcpPort: 4880,
      tmuxSocket: 'vibechemy',
      orchestratorDirName: 'orchestrator'
    })
  })

  it('unpackaged (npm run dev / start) gets the -dev identity', () => {
    const id = resolveIdentity(false, {})
    expect(id).toEqual({
      isDev: true,
      userDataDirName: 'vibechemy-dev',
      mcpPort: 4881,
      tmuxSocket: 'vibechemy-dev',
      orchestratorDirName: 'orchestrator-dev'
    })
  })

  it('MCP_PORT env overrides the port for either identity', () => {
    expect(resolveIdentity(true, { MCP_PORT: '5900' }).mcpPort).toBe(5900)
    expect(resolveIdentity(false, { MCP_PORT: '5901' }).mcpPort).toBe(5901)
  })

  it('ignores a junk MCP_PORT', () => {
    expect(resolveIdentity(false, { MCP_PORT: 'abc' }).mcpPort).toBe(4881)
    expect(resolveIdentity(false, { MCP_PORT: '0' }).mcpPort).toBe(4881)
    expect(resolveIdentity(false, { MCP_PORT: '-4' }).mcpPort).toBe(4881)
    expect(resolveIdentity(false, { MCP_PORT: '99999' }).mcpPort).toBe(4881)
  })
})
