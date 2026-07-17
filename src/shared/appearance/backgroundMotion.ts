/** Settings-store key for the app-root canvas background animation speed. */
export const BACKGROUND_MOTION_KEY = 'appearance.bgMotion'

export const BACKGROUND_MOTIONS = ['off', 'calm', 'lively'] as const
export type BackgroundMotion = (typeof BACKGROUND_MOTIONS)[number]

export const DEFAULT_BACKGROUND_MOTION: BackgroundMotion = 'lively'

/** A malformed or absent stored value must never disable motion unexpectedly. */
export function parseBackgroundMotion(raw: string | null | undefined): BackgroundMotion {
  return BACKGROUND_MOTIONS.includes(raw as BackgroundMotion) ? (raw as BackgroundMotion) : DEFAULT_BACKGROUND_MOTION
}
