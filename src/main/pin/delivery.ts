import type { SessionRecord } from '@shared/types'
import { normalizePin, pinUpdateLine } from '@shared/pin'

export interface PinDelivery {
  sessionId: string
  tmuxName: string
  text: string
}

/**
 * Pure change-to-delivery plan. Only live agent panes in the pin's workspace receive it.
 * A shell is intentionally excluded: submitting an agent-facing sentence there would execute it.
 */
export function planPinDeliveries(
  sessions: SessionRecord[],
  projectId: string,
  previousPin: string | null | undefined,
  nextPin: string | null | undefined
): PinDelivery[] {
  const previous = normalizePin(previousPin)
  const next = normalizePin(nextPin)
  if (previous === next) return []

  const text = pinUpdateLine(next)
  return sessions
    .filter(
      (session) =>
        session.projectId === projectId &&
        session.presetId !== 'shell' &&
        (session.status === 'running' || session.status === 'detached')
    )
    .map((session) => ({ sessionId: session.id, tmuxName: session.tmuxName, text }))
}
