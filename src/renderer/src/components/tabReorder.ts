// Pure helpers for drag-to-reorder in strip UIs (tabs, rail cards). DOM-free so they run
// under vitest's node environment.

export interface SlotRect {
  readonly left: number
  readonly width: number
}

// Slot the dragged item should occupy = how many OTHER items' centers lie left of the
// pointer. `others` is every item except the dragged one (any order — it's a count).
// Result is in [0, others.length], an index into the array after the dragged item is
// removed; pointer past either end of the strip clamps naturally to 0 / others.length.
// Center-counting is jitter-proof for unequal sizes: a swap moves the neighbor's
// center *away* from the pointer, never back across it (slot spans would flip-flop).
export function slotForX(others: SlotRect[], x: number): number {
  let slot = 0
  for (const r of others) if (r.left + r.width / 2 < x) slot++
  return slot
}

// Move arr[from] to index `to`, returning a new array — or `arr` itself when the move
// is a no-op, so the caller can bail out of re-rendering. Out-of-range `from` or `to` is a no-op
// guard for "item vanished mid-drag" races.
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= arr.length || to < 0 || to >= arr.length) return arr
  const next = arr.slice()
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item)
  return next
}
