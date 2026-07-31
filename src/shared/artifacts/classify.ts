// Pure file-type classification for the Artifacts viewer. No node/DB imports — tier-1 testable.
import type { ArtifactType } from '../types'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'])

/** Classify a filename by its extension into a viewer bucket. */
export function classifyArtifact(name: string): ArtifactType {
  const dot = name.lastIndexOf('.')
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (ext === 'pdf') return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'html' || ext === 'htm') return 'html'
  return 'other'
}
