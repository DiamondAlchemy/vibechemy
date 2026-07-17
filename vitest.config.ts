import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: { alias: { '@shared': resolve('src/shared') } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks' // native modules (better-sqlite3, node-pty) are happier in forked processes
  }
})
