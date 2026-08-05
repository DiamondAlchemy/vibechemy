/**
 * Collapse a home directory prefix to `~` for display.
 *
 * Shared rather than duplicated: the pane header and the sidebar both show project paths, and when
 * the rule lived in two files they drifted — one learned about `/home/<user>` and the other kept
 * matching only `/Users/<user>`, so the same path rendered differently in two places on Linux.
 */
export function shortHome(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+/, '~')
}
