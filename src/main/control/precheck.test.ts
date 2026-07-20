import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runWorkspacePrecheck, workspaceCheckCommand } from './precheck'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vibechemy-precheck-'))
  roots.push(root)
  return root
}

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('workspace precheck', () => {
  it('uses a configured package check script and respects its package manager', () => {
    const root = tempRoot()
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ packageManager: 'pnpm@10.0.0', scripts: { check: 'vitest run' } })
    )
    expect(workspaceCheckCommand(root)).toBe('pnpm run check')
  })

  it('falls back to a Makefile check target and reports an unconfigured workspace', () => {
    const configured = tempRoot()
    const unconfigured = tempRoot()
    writeFileSync(join(configured, 'Makefile'), 'check:\n\t@echo checked\n')
    expect(workspaceCheckCommand(configured)).toBe('make check')
    expect(workspaceCheckCommand(unconfigured)).toBeNull()
  })

  it('runs the configured command inside the worker worktree', async () => {
    const workspace = tempRoot()
    const worktree = tempRoot()
    writeFileSync(join(workspace, 'Makefile'), 'check:\n\t@echo configured\n')
    writeFileSync(join(worktree, 'Makefile'), 'check:\n\t@pwd\n\t@echo 14 passed\n')
    const result = await runWorkspacePrecheck(worktree, workspace)
    expect(result).toMatchObject({ configured: true, command: 'make check', exitCode: 0 })
    expect(result.output).toContain(worktree)
    expect(result.output).toContain('14 passed')
  })
})
