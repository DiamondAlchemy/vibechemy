import { readdirSync, statSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyArtifact } from '@shared/artifacts/classify'
import type { ArtifactFile } from '@shared/types'

const MAX_ARTIFACTS = 500
const SKIP_DIRS = new Set(['node_modules', '.git'])

/** Recursively list files under `dir` as classified artifacts, newest first. Missing dir → []. */
export function scanArtifacts(dir: string): ArtifactFile[] {
  const out: ArtifactFile[] = []
  const walk = (d: string): void => {
    if (out.length >= MAX_ARTIFACTS) return
    let entries: string[]
    try {
      entries = readdirSync(d)
    } catch {
      return // unreadable dir → skip
    }
    for (const e of entries) {
      if (out.length >= MAX_ARTIFACTS) return
      if (e.startsWith('.') || SKIP_DIRS.has(e)) continue
      const full = join(d, e)
      let st: ReturnType<typeof statSync>
      try {
        st = statSync(full)
      } catch {
        continue
      }
      if (st.isDirectory()) walk(full)
      else
        out.push({
          name: basename(full),
          path: full,
          url: pathToFileURL(full).href,
          type: classifyArtifact(e),
          size: st.size,
          mtime: st.mtimeMs
        })
    }
  }
  walk(dir)
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}
