export type KeyToken =
  | 'esc'
  | 'ctrl-c'
  | 'tab'
  | 'enter'
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'pipe'
  | 'tilde'

const BYTES: Record<KeyToken, string> = {
  esc: '\x1b',
  'ctrl-c': '\x03',
  tab: '\t',
  enter: '\r',
  up: '\x1b[A',
  down: '\x1b[B',
  right: '\x1b[C',
  left: '\x1b[D',
  pipe: '|',
  tilde: '~'
}

/** Raw byte sequence a key token sends to a PTY. Single source of truth. */
export function keyTokenToBytes(token: KeyToken): string {
  return BYTES[token]
}

/** Left-to-right order of the accessory bar (Blink/Termius style). */
export const KEY_BAR_LAYOUT: KeyToken[] = ['esc', 'ctrl-c', 'tab', 'up', 'down', 'left', 'right', 'pipe', 'tilde']
