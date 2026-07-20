export const BLOCK_BEGIN =
  '<!-- VIBECHEMY:BEGIN — auto-generated from .vibechemy/MEMORY.md; edit that file, not this block -->'
export const BLOCK_END = '<!-- VIBECHEMY:END -->'

/** The context filename a given CLI command reads, or null if it has none (e.g. a shell). */
export function nativeFileName(command: string): string | null {
  const c = command.toLowerCase()
  if (c.includes('claude')) return 'CLAUDE.md'
  if (c.includes('gemini')) return 'GEMINI.md'
  if (c.includes('codex') || c.includes('opencode') || c.includes('agy')) return 'AGENTS.md'
  return null
}

/** Insert or replace the managed block in `existing`, preserving everything outside it. */
export function mergeManagedBlock(existing: string, body: string): string {
  const block = `${BLOCK_BEGIN}\n${body.trim()}\n${BLOCK_END}`
  const begin = existing.indexOf(BLOCK_BEGIN)
  if (begin === -1) {
    const trimmed = existing.trimEnd()
    return trimmed.length ? `${trimmed}\n\n${block}\n` : `${block}\n`
  }
  const endIdx = existing.indexOf(BLOCK_END, begin)
  if (endIdx === -1) {
    // malformed (begin without end): replace from begin to EOF
    return `${existing.slice(0, begin)}${block}\n`
  }
  return `${existing.slice(0, begin)}${block}${existing.slice(endIdx + BLOCK_END.length)}`
}

/** Remove the managed block, returning the surrounding (user-authored) content, trimmed. */
export function stripManagedBlock(content: string): string {
  const begin = content.indexOf(BLOCK_BEGIN)
  if (begin === -1) return content
  const endIdx = content.indexOf(BLOCK_END, begin)
  if (endIdx === -1) return content.slice(0, begin).trim()
  return (content.slice(0, begin) + content.slice(endIdx + BLOCK_END.length)).trim()
}

/** Assemble the markdown brief that goes inside the managed block. `includeProject:false`
 *  omits the project body (used for the file the memory was seeded from). `learnings`, when
 *  present, is ALWAYS included so every agent inherits what others discovered. */
export function buildBrief(opts: {
  projectName: string
  pin?: string
  global: string
  project: string
  learnings?: string
  standards?: string
  includeProject?: boolean
}): string {
  const parts: string[] = []
  if (opts.pin && opts.pin.trim()) parts.push(opts.pin.trim())
  parts.push(`# Vibechemy — shared context for "${opts.projectName}"`)
  if (opts.global.trim()) parts.push(`## About me / my stack\n\n${opts.global.trim()}`)
  if (opts.includeProject !== false && opts.project.trim()) parts.push(`## This project\n\n${opts.project.trim()}`)
  // Coding standards are normative ("write code this way"), so they sit above the advisory learnings.
  if (opts.standards && opts.standards.trim())
    parts.push(`## Coding standards (follow these)\n\n${opts.standards.trim()}`)
  if (opts.learnings && opts.learnings.trim())
    parts.push(`## Shared learnings (from other agents)\n\n${opts.learnings.trim()}`)
  parts.push(
    '_Auto-projected by Vibechemy so every agent shares the same context. Edit `.vibechemy/MEMORY.md` (project) or `~/.vibechemy/GLOBAL.md` (global). **When you discover something durable about this project, append a short dated bullet to `.vibechemy/LEARNINGS.md` so every agent inherits it.**_'
  )
  return parts.join('\n\n')
}
