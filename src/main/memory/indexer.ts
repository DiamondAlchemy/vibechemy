import { join } from 'node:path'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { stripManagedBlock } from './projection'

/** Build an initial project brief from the repo. Prefers an existing CLAUDE.md/AGENTS.md
 *  (so knowledge an agent already had propagates to every agent), else README + package.json
 *  + a top-level structure listing. */
export function indexProject(root: string): string {
  // 1) Reuse existing agent context if it's substantial.
  for (const f of ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']) {
    const p = join(root, f)
    if (existsSync(p)) {
      const body = stripManagedBlock(readFileSync(p, 'utf8')).trim()
      if (body.length > 60) return finalize([`(Seeded from your existing ${f}.)`, body])
    }
  }
  // 2) Otherwise assemble from common signals.
  const lines: string[] = []
  for (const f of ['README.md', 'readme.md', 'README']) {
    const p = join(root, f)
    if (existsSync(p)) {
      lines.push('## README (excerpt)', readFileSync(p, 'utf8').split('\n').slice(0, 40).join('\n'))
      break
    }
  }
  const pkgP = join(root, 'package.json')
  if (existsSync(pkgP)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgP, 'utf8'))
      const bits = [
        pkg.name && `name: ${pkg.name}`,
        pkg.description && `description: ${pkg.description}`,
        pkg.scripts && `scripts: ${Object.keys(pkg.scripts).join(', ')}`,
        pkg.dependencies && `deps: ${Object.keys(pkg.dependencies).slice(0, 20).join(', ')}`
      ].filter(Boolean)
      if (bits.length) lines.push('## package.json', bits.join('\n'))
    } catch {
      /* ignore malformed package.json */
    }
  }
  try {
    const entries = readdirSync(root)
      .filter((e) => !e.startsWith('.'))
      .slice(0, 40)
      .map((e) => {
        try {
          return statSync(join(root, e)).isDirectory() ? `${e}/` : e
        } catch {
          return e
        }
      })
    if (entries.length) lines.push('## Top-level structure', entries.join('  '))
  } catch {
    /* ignore */
  }
  return finalize(lines)
}

function finalize(lines: string[]): string {
  return [...lines, '> Edit this file to tell every agent what matters about this project.'].join('\n\n')
}
