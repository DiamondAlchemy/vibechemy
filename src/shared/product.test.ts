import { describe, expect, it } from 'vitest'
import { PRODUCT_IDENTITY, mcpTokenEnvNameFor } from './product'

describe('product identity', () => {
  it('keeps Vibechemy wire identity stable', () => {
    expect(PRODUCT_IDENTITY).toEqual({
      mcpServerName: 'vibechemy',
      mcpTokenEnvName: 'MCP_VIBECHEMY_API_KEY',
      worktreeBranchPrefix: 'vc/'
    })
  })

  it('derives the token environment name mechanically from the server name', () => {
    expect(mcpTokenEnvNameFor('vibechemy-desktop')).toBe('MCP_VIBECHEMY_DESKTOP_API_KEY')
  })
})
