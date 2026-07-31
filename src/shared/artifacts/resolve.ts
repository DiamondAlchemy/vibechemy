import type { ArtifactFile } from '../types'

/**
 * Find the artifact an orchestrator means by `nameOrPath`: an exact full-path match first, then an
 * exact basename, then a case-insensitive basename. Returns undefined when nothing matches. Pure —
 * the caller (ControlPlane.openArtifact) supplies the current scanned file list.
 */
export function resolveArtifact(files: ArtifactFile[], nameOrPath: string): ArtifactFile | undefined {
  const byPath = files.find((file) => file.path === nameOrPath)
  if (byPath) return byPath
  const byName = files.find((file) => file.name === nameOrPath)
  if (byName) return byName
  const lower = nameOrPath.toLowerCase()
  return files.find((file) => file.name.toLowerCase() === lower)
}
