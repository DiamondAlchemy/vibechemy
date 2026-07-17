/**
 * Stuck drop-outline guard: while a dashed drop affordance is showing, decide which window-level
 * event proves the drag is over. `dragend` fires on the drag SOURCE — for Finder/screenshot drags
 * that source lives in another app, so our window never sees it and the outline strands. The
 * endings we CAN observe locally:
 *   - window `dragend` (internal drags),
 *   - window `drop` in CAPTURE phase (a consumer's stopPropagation can't hide it),
 *   - the buttons-glue-guard: the first mousemove with no button held — the browser suppresses
 *     mousemove during any live drag, so seeing one with `buttons === 0` means whatever drag lit
 *     the affordance has already ended somewhere we couldn't observe.
 */
export type DragClearEvent = { type: 'dragend' } | { type: 'drop' } | { type: 'mousemove'; buttons: number }

export function clearsDragAffordance(e: DragClearEvent): boolean {
  if (e.type === 'dragend' || e.type === 'drop') return true
  return e.buttons === 0
}
