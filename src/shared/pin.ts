export const PIN_SETTING_PREFIX = 'pin.'
export const PIN_MAX_LENGTH = 240

/** Settings key for the one operator pin owned by a project workspace. */
export function pinSettingKey(projectId: string): string {
  return `${PIN_SETTING_PREFIX}${projectId}`
}

/** Return the project targeted by a pin setting key, or null for an unrelated/invalid key. */
export function pinProjectId(key: string): string | null {
  if (!key.startsWith(PIN_SETTING_PREFIX)) return null
  const projectId = key.slice(PIN_SETTING_PREFIX.length)
  return projectId || null
}

/** Pins ride through terminals and context files, so always keep them to one bounded line. */
export function normalizePin(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, PIN_MAX_LENGTH)
}

export function pinContextLine(value: string | null | undefined): string {
  const pin = normalizePin(value)
  return pin ? `PINNED: ${pin}` : ''
}

export function pinUpdateLine(value: string | null | undefined): string {
  const pin = normalizePin(value)
  return `[PIN UPDATED] ${pin || '(cleared)'}`
}
