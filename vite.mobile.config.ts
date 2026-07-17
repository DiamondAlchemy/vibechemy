import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Standalone mobile web app — fully separate from the Electron build.
// base './' so the bundle works when Capacitor serves it from a file:// or capacitor:// origin.
export default defineConfig({
  root: resolve(__dirname, 'src/mobile'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@shared': resolve(__dirname, 'src/shared') }
  },
  server: { port: 5199, host: true }, // host:true so the iOS Simulator / a phone on the LAN can reach it
  build: {
    outDir: resolve(__dirname, 'out/mobile'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'src/mobile/index.html'),
        sw: resolve(__dirname, 'src/mobile/sw.ts')
      },
      output: {
        // The service worker needs a stable root-level URL (its path is also its scope).
        entryFileNames: (chunk) => (chunk.name === 'sw' ? 'sw.js' : 'assets/[name]-[hash].js')
      }
    }
  }
})
