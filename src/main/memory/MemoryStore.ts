import { homedir } from 'node:os'
import { join } from 'node:path'
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs'
import { indexProject } from './indexer'

const LEARNINGS_TEMPLATE = `# Shared learnings

_Agents append durable discoveries about this project here as short dated bullets. Every agent reads these on launch._
`

const GLOBAL_TEMPLATE = `# Global context (shared with every agent, in every project)

Edit this file to tell all your AI agents who you are and how you work.

## Who I am
<!-- role, what you build -->

## My stack & tools
<!-- languages, frameworks, key services/agents, conventions -->

## How I like agents to work
<!-- coding style, do/don't, commit conventions -->
`

/** Reads/creates the global brief (~/.vibechemy/GLOBAL.md) and per-project briefs
 *  (<root>/.vibechemy/MEMORY.md, auto-seeded from the repo on first use). The global
 *  dir is injectable for testing. */
export class MemoryStore {
  constructor(private globalDir: string = join(homedir(), '.vibechemy')) {}

  private get globalFile(): string {
    return join(this.globalDir, 'GLOBAL.md')
  }

  readGlobal(): string {
    if (!existsSync(this.globalFile)) {
      mkdirSync(this.globalDir, { recursive: true })
      writeFileSync(this.globalFile, GLOBAL_TEMPLATE)
    }
    return readFileSync(this.globalFile, 'utf8')
  }

  projectMemoryPath(projectRoot: string): string {
    return join(projectRoot, '.vibechemy', 'MEMORY.md')
  }

  readProject(projectRoot: string): string {
    const p = this.projectMemoryPath(projectRoot)
    if (!existsSync(p)) {
      mkdirSync(join(projectRoot, '.vibechemy'), { recursive: true })
      writeFileSync(p, indexProject(projectRoot))
    }
    const learnings = join(projectRoot, '.vibechemy', 'LEARNINGS.md')
    if (!existsSync(learnings)) writeFileSync(learnings, LEARNINGS_TEMPLATE)
    return readFileSync(p, 'utf8')
  }

  readLearnings(projectRoot: string): string {
    const p = join(projectRoot, '.vibechemy', 'LEARNINGS.md')
    return existsSync(p) ? readFileSync(p, 'utf8') : ''
  }

  /** Append a durable learning as a dated bullet (projected into every agent's brief). */
  appendLearning(projectRoot: string, text: string): void {
    const dir = join(projectRoot, '.vibechemy')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'LEARNINGS.md')
    if (!existsSync(p)) writeFileSync(p, LEARNINGS_TEMPLATE)
    const day = new Date().toISOString().slice(0, 10)
    appendFileSync(p, `- ${day}: ${text.trim().replace(/\s+/g, ' ')}\n`)
  }
}
