import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PrecheckResult } from '@shared/ipc'
import { runInWorktree } from '../sessions/worktree'

interface PackageManifest {
  packageManager?: unknown
  scripts?: Record<string, unknown>
}

function packageRunner(root: string, packageManager: unknown): string {
  if (typeof packageManager === 'string') {
    if (packageManager.startsWith('pnpm@')) return 'pnpm run check'
    if (packageManager.startsWith('yarn@')) return 'yarn check'
    if (packageManager.startsWith('bun@')) return 'bun run check'
  }
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm run check'
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn check'
  if (existsSync(join(root, 'bun.lock')) || existsSync(join(root, 'bun.lockb'))) return 'bun run check'
  return 'npm run check'
}

/** Resolve the workspace-owned check target without trusting files changed in the worker branch. */
export function workspaceCheckCommand(root: string): string | null {
  const packagePath = join(root, 'package.json')
  if (existsSync(packagePath)) {
    try {
      const manifest = JSON.parse(readFileSync(packagePath, 'utf8')) as PackageManifest
      if (typeof manifest.scripts?.check === 'string' && manifest.scripts.check.trim()) {
        return packageRunner(root, manifest.packageManager)
      }
    } catch {
      // A malformed package manifest is not a configured check target.
    }
  }

  for (const name of ['GNUmakefile', 'Makefile', 'makefile']) {
    const makefile = join(root, name)
    if (!existsSync(makefile)) continue
    try {
      if (/^check\s*:/m.test(readFileSync(makefile, 'utf8'))) return 'make check'
    } catch {
      // Keep looking; unreadable configuration should not make opening Review fail.
    }
  }
  return null
}

export async function runWorkspacePrecheck(worktree: string, workspaceRoot: string): Promise<PrecheckResult> {
  const command = workspaceCheckCommand(workspaceRoot)
  if (!command) return { configured: false, exitCode: null, output: '' }
  const result = await runInWorktree(worktree, command)
  return { configured: true, command, ...result }
}
