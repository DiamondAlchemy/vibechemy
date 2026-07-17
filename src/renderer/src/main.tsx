import './global.css'
import '@xterm/xterm/css/xterm.css'
import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/700.css'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import '@fontsource/chakra-petch/400.css'
import '@fontsource/chakra-petch/500.css'
import '@fontsource/chakra-petch/600.css'
import '@fontsource/chakra-petch/700.css'
import '@fontsource/rajdhani/400.css'
import '@fontsource/rajdhani/500.css'
import '@fontsource/rajdhani/600.css'
import '@fontsource/rajdhani/700.css'
import { createRoot } from 'react-dom/client'
import App from './App'

// Guard against Electron's default drag-navigation: any file/image/URL drop that MISSES an explicit
// dropzone must do nothing. Without this, Chromium performs its default action and navigates the top
// frame to the dropped file:// URL, blanking the whole app (the packaged build loads from a file://
// origin, so the navigation succeeds). Explicit dropzones (terminals, canvas surface, sidebar) still
// handle their own drops and call preventDefault themselves — this only cancels the browser default
// for misses, which would otherwise let a staged image card blank the app.
const preventDrop = (e: DragEvent): void => {
  // Let native text drag-and-drop into editable fields work; only cancel the browser default
  // file navigation for drops onto non-editable areas.
  const t = e.target as HTMLElement | null
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
  e.preventDefault()
}
window.addEventListener('dragover', preventDrop)
window.addEventListener('drop', preventDrop)

createRoot(document.getElementById('root')!).render(<App />)
