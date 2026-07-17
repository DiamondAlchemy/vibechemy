import { createRoot } from 'react-dom/client'
import { App } from './App'
import './mobile.css'

createRoot(document.getElementById('root')!).render(<App />)

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  // sw.ts is built as its own entry chunk emitted at ./sw.js (see vite.mobile.config.ts) —
  // referencing it via new URL(..., import.meta.url) would inline it as an unusable data: URL.
  navigator.serviceWorker.register('./sw.js', { type: 'module' }).catch(() => {})
}
