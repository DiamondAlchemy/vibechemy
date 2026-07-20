export const DEFAULT_CONFIRM_TIMEOUT_MS = 3000

type TimerHandle = ReturnType<typeof setTimeout>

export interface GuardedButtonTimer {
  setTimeout: (callback: () => void, timeoutMs: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

export interface GuardedButtonController {
  readonly armed: boolean
  click: (onConfirm: () => void) => void
  blur: () => void
  dispose: () => void
}

export function createGuardedButtonController({
  onArmedChange,
  timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
  timer = globalThis
}: {
  onArmedChange: (armed: boolean) => void
  timeoutMs?: number
  timer?: GuardedButtonTimer
}): GuardedButtonController {
  let armed = false
  let timeout: TimerHandle | undefined

  const clearTimer = (): void => {
    if (timeout === undefined) return
    timer.clearTimeout(timeout)
    timeout = undefined
  }

  const disarm = (notify: boolean): void => {
    clearTimer()
    if (!armed) return
    armed = false
    if (notify) onArmedChange(false)
  }

  return {
    get armed() {
      return armed
    },
    click(onConfirm) {
      if (armed) {
        disarm(true)
        onConfirm()
        return
      }

      armed = true
      onArmedChange(true)
      timeout = timer.setTimeout(() => disarm(true), timeoutMs)
    },
    blur() {
      disarm(true)
    },
    dispose() {
      disarm(false)
    }
  }
}
