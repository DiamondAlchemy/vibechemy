import React, { useEffect, useState } from 'react'
import { api } from '../api'
import { normalizePin, PIN_MAX_LENGTH, pinSettingKey } from '@shared/pin'

export function PinLine({ projectId }: { projectId: string }): React.JSX.Element {
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState('')
  const [state, setState] = useState<'idle' | 'saving' | 'error'>('idle')

  useEffect(() => {
    let current = true
    void api
      .getSetting(pinSettingKey(projectId))
      .then((stored) => {
        if (!current) return
        const pin = normalizePin(stored)
        setValue(pin)
        setSaved(pin)
      })
      .catch(() => {
        if (current) setState('error')
      })
    return () => {
      current = false
    }
  }, [projectId])

  const save = (): void => {
    const next = normalizePin(value)
    setValue(next)
    if (next === saved || state === 'saving') return
    setState('saving')
    void api
      .setSetting(pinSettingKey(projectId), next)
      .then(() => {
        setSaved(next)
        setState('idle')
      })
      .catch(() => setState('error'))
  }

  return (
    <label className="pin-line" data-state={state} title="One line shared with every live agent in this workspace">
      <span>PIN</span>
      <input
        aria-label="Pinned fleet instruction"
        maxLength={PIN_MAX_LENGTH}
        placeholder="Set one line for the fleet…"
        value={value}
        onChange={(event) => {
          setValue(event.target.value)
          if (state === 'error') setState('idle')
        }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            setValue(saved)
            setState('idle')
          }
        }}
      />
    </label>
  )
}
