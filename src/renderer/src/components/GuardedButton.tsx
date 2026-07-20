import React, { useEffect, useState } from 'react'
import { createGuardedButtonController, DEFAULT_CONFIRM_TIMEOUT_MS } from './guardedButtonController'

type GuardedButtonProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'> & {
  label: React.ReactNode
  confirmLabel: React.ReactNode
  onConfirm: () => void
  requiresConfirmation?: boolean
  timeoutMs?: number
}

export function GuardedButton({
  label,
  confirmLabel,
  onConfirm,
  requiresConfirmation = true,
  timeoutMs = DEFAULT_CONFIRM_TIMEOUT_MS,
  disabled,
  onBlur,
  ...buttonProps
}: GuardedButtonProps): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  const [controller] = useState(() =>
    createGuardedButtonController({
      onArmedChange: setArmed,
      timeoutMs
    })
  )

  useEffect(() => () => controller.dispose(), [controller])

  return (
    <button
      {...buttonProps}
      disabled={disabled}
      onClick={() => {
        if (requiresConfirmation) controller.click(onConfirm)
        else onConfirm()
      }}
      onBlur={(event) => {
        controller.blur()
        onBlur?.(event)
      }}
    >
      {armed ? confirmLabel : label}
    </button>
  )
}
