// Named per-pane terminal THEMES — Terminal.app-style profiles, not just an accent tint. Each theme
// is a full xterm color set plus the pane's frame accent. The GLASS variant carries its own alpha,
// tuned so the theme still READS over the canvas instead of disappearing under color; light themes
// need more opacity to keep dark text legible over the starfield.
//
// xterm gotcha locked in the tests: theme colors MUST be hex or rgb()/rgba() strings — an hsl()
// string fails xterm's parser and the terminal silently renders BLACK.

export interface PaneTheme {
  id: string
  label: string
  /** Frame strip + swatch + picker chip outline. */
  accent: string
  /** Opaque terminal colors. */
  bg: string
  fg: string
  cursor: string
  cursorAccent: string
  selection: string
  /** Translucent background used while Glass panes are on. */
  glassBg: string
}

export const PANE_THEMES: PaneTheme[] = [
  {
    id: 'navy',
    label: 'Navy (default)',
    accent: '#7fe3ff',
    bg: '#0c1e34',
    fg: '#cde7f7',
    cursor: '#7fe3ff',
    cursorAccent: '#0c1e34',
    selection: 'rgba(127,227,255,0.28)',
    // The settled subtle default — the ONE theme that stays whisper-glass.
    glassBg: 'rgba(10,24,42,0.38)'
  },
  {
    id: 'ocean',
    label: 'Ocean',
    accent: '#4da3ff',
    bg: '#0b2a4d',
    fg: '#d2e7ff',
    cursor: '#4da3ff',
    cursorAccent: '#0b2a4d',
    selection: 'rgba(77,163,255,0.30)',
    glassBg: 'rgba(11,42,77,0.58)'
  },
  {
    id: 'grass',
    label: 'Grass',
    accent: '#5dffb0',
    bg: '#0d2b14',
    fg: '#c2f5cf',
    cursor: '#5dffb0',
    cursorAccent: '#0d2b14',
    selection: 'rgba(93,255,176,0.28)',
    glassBg: 'rgba(13,43,20,0.58)'
  },
  {
    id: 'homebrew',
    label: 'Homebrew',
    accent: '#2eff5f',
    bg: '#060d06',
    fg: '#2eff5f',
    cursor: '#2eff5f',
    cursorAccent: '#060d06',
    selection: 'rgba(46,255,95,0.25)',
    glassBg: 'rgba(6,13,6,0.62)'
  },
  {
    id: 'ember',
    label: 'Ember',
    accent: '#ffc24b',
    bg: '#2b1806',
    fg: '#ffdf9e',
    cursor: '#ffc24b',
    cursorAccent: '#2b1806',
    selection: 'rgba(255,194,75,0.28)',
    glassBg: 'rgba(43,24,6,0.58)'
  },
  {
    id: 'redsands',
    label: 'Red Sands',
    accent: '#ff7a52',
    bg: '#3a1712',
    fg: '#ffd9c2',
    cursor: '#ff7a52',
    cursorAccent: '#3a1712',
    selection: 'rgba(255,122,82,0.28)',
    glassBg: 'rgba(58,23,18,0.58)'
  },
  {
    id: 'violet',
    label: 'Violet',
    accent: '#c79bff',
    bg: '#241040',
    fg: '#e8d9ff',
    cursor: '#c79bff',
    cursorAccent: '#241040',
    selection: 'rgba(199,155,255,0.28)',
    glassBg: 'rgba(36,16,64,0.58)'
  },
  {
    id: 'slate',
    label: 'Slate',
    accent: '#9fb2c8',
    bg: '#191d23',
    fg: '#d9dee6',
    cursor: '#9fb2c8',
    cursorAccent: '#191d23',
    selection: 'rgba(159,178,200,0.28)',
    glassBg: 'rgba(25,29,35,0.55)'
  },
  {
    id: 'manpage',
    label: 'Man Page',
    accent: '#e8c66a',
    bg: '#f7edc2',
    fg: '#211d10',
    cursor: '#6b5b1e',
    cursorAccent: '#f7edc2',
    selection: 'rgba(107,91,30,0.25)',
    // Light themes need real opacity or dark text loses to the starfield behind.
    glassBg: 'rgba(247,237,194,0.78)'
  },
  {
    id: 'daylight',
    label: 'Daylight',
    accent: '#cfd8e3',
    bg: '#f2f5f8',
    fg: '#17202b',
    cursor: '#33465c',
    cursorAccent: '#f2f5f8',
    selection: 'rgba(51,70,92,0.22)',
    glassBg: 'rgba(242,245,248,0.78)'
  }
]

/** Auto-assignment pool: dark themes only — a surprise WHITE terminal would jar; the light
 *  profiles (Man Page, Daylight) are deliberate picks from the palette. */
export const ASSIGNABLE_PANE_THEMES = ['navy', 'ocean', 'grass', 'ember', 'violet', 'slate', 'redsands', 'homebrew']

/** Pre-theme installs stored bare accent hexes (the old PANE_PALETTE) in mc.paneColors — map each
 *  to the nearest-feeling DARK theme so no pane flips light on upgrade. */
const LEGACY_ACCENT_THEMES: Record<string, string> = {
  '#7fe3ff': 'navy',
  '#ffc24b': 'ember',
  '#5dffb0': 'grass',
  '#c79bff': 'violet',
  '#ff7a85': 'redsands',
  '#8fd0ff': 'ocean',
  '#ffd98a': 'ember',
  '#76b900': 'homebrew'
}

const byId = new Map(PANE_THEMES.map((t) => [t.id, t]))

/** Resolve a stored pane-color token — a PaneTheme id, or a legacy accent hex — to its theme.
 *  Unknown/absent tokens land on navy, never crash and never render a wrong color. */
export function resolvePaneTheme(token: string | undefined): PaneTheme {
  if (token) {
    const theme = byId.get(token) ?? byId.get(LEGACY_ACCENT_THEMES[token] ?? '')
    if (theme) return theme
  }
  return byId.get('navy')!
}

/** The full xterm theme object for a pane (glass swaps only the background). */
export function xtermThemeFor(
  token: string | undefined,
  glass: boolean
): { background: string; foreground: string; cursor: string; cursorAccent: string; selectionBackground: string } {
  const t = resolvePaneTheme(token)
  return {
    background: glass ? t.glassBg : t.bg,
    foreground: t.fg,
    cursor: t.cursor,
    cursorAccent: t.cursorAccent,
    selectionBackground: t.selection
  }
}
