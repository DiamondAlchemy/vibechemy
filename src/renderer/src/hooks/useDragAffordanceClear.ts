import { useEffect } from 'react'
import { clearsDragAffordance } from '@shared/ui/dragAffordance'

/**
 * While a drag-drop affordance (dashed drop outline) is showing, clear it on ANY drag ending we
 * can observe. `dragend` alone is not enough: it fires on the drag SOURCE, which for
 * Finder/screenshot drags lives in another app — this window never receives it and the outline
 * sticks. So, in addition: window `drop` in CAPTURE phase (a consumer's stopPropagation can't
 * hide the ending), and the buttons-glue-guard — the first mousemove with no button held
 * (mousemove is suppressed during a live drag, so seeing one means the drag already ended).
 * Pass a stable `clear` (useCallback / setState) so the listeners aren't re-bound every render.
 */
export function useDragAffordanceClear(active: boolean, clear: () => void): void {
  useEffect(() => {
    if (!active) return
    const onDragEnd = (): void => {
      if (clearsDragAffordance({ type: 'dragend' })) clear()
    }
    const onDrop = (): void => {
      if (clearsDragAffordance({ type: 'drop' })) clear()
    }
    const onMove = (ev: MouseEvent): void => {
      if (clearsDragAffordance({ type: 'mousemove', buttons: ev.buttons })) clear()
    }
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('mousemove', onMove)
    return () => {
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('mousemove', onMove)
    }
  }, [active, clear])
}
