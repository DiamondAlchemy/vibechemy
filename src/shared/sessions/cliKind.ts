/** True iff a preset command launches the claude CLI (revive can then restore the
 *  conversation via /resume instead of replaying the preset opening prompt). */
export function isClaudeCli(command: string): boolean {
  const first = command.trim().split(/\s+/)[0] ?? ''
  return first === 'claude' || first.endsWith('/claude')
}
