// Pure logic for the npx launcher — no I/O, unit-tested from the main repo suite
// (launcher/lib.test.mjs). The launcher trusts electron-builder's update feed
// (latest-mac.yml) as the source of artifact names and sha512 checksums, so there is no
// separate checksums pipeline to drift out of sync.

/**
 * Parse electron-builder's latest-mac.yml (a deliberately tiny YAML subset — flat keys plus
 * one `files:` list of `- url/sha512/size` entries). Returns null when the text doesn't look
 * like a feed rather than guessing.
 * @param {string} text
 * @returns {{ version: string, files: Array<{ url: string, sha512: string, size: number | null }> } | null}
 */
export function parseMacFeed(text) {
  if (typeof text !== 'string' || text.length === 0 || text.length > 1_000_000) return null
  const lines = text.split(/\r?\n/)
  let version = null
  const files = []
  let current = null
  let inFiles = false
  for (const line of lines) {
    const top = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line)
    if (top) {
      inFiles = top[1] === 'files'
      if (top[1] === 'version') version = top[2].trim()
      current = null
      continue
    }
    if (!inFiles) continue
    const entry = /^\s*-\s+url:\s*(.+)$/.exec(line)
    if (entry) {
      current = { url: entry[1].trim(), sha512: '', size: null }
      files.push(current)
      continue
    }
    const field = /^\s+(sha512|size):\s*(.+)$/.exec(line)
    if (field && current) {
      if (field[1] === 'sha512') current.sha512 = field[2].trim()
      else {
        const n = Number(field[2].trim())
        current.size = Number.isFinite(n) ? n : null
      }
    }
  }
  if (!version || files.length === 0) return null
  const valid = files.filter((f) => f.url && f.sha512)
  if (valid.length === 0) return null
  return { version, files: valid }
}

/**
 * Pick the zip artifact for an arch from a parsed feed (the zip is what we extract and
 * launch; the dmg is for humans). Arch match is REQUIRED — installing a wrong-arch zip on
 * the quiet would be worse than failing, so there is no any-zip fallback.
 * @param {{ files: Array<{ url: string, sha512: string }> } | null} feed
 * @param {string} arch e.g. 'arm64'
 */
export function pickZipAsset(feed, arch) {
  if (!feed) return null
  return feed.files.find((f) => f.url.endsWith(`-${arch}.zip`)) ?? null
}

/**
 * Find a named asset's download URL in a GitHub release API response.
 * @param {{ assets?: Array<{ name?: string, browser_download_url?: string }> } | null} release
 * @param {string} name exact asset filename
 * @returns {string | null}
 */
export function assetUrl(release, name) {
  if (!release || !Array.isArray(release.assets)) return null
  const asset = release.assets.find((a) => a && a.name === name)
  return asset && typeof asset.browser_download_url === 'string' ? asset.browser_download_url : null
}
