import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDatabase, type DB } from '../db/database'
import { SettingsStore } from '../settings/SettingsStore'
import { ArtifactsService, ARTIFACTS_DIR_KEY } from './ArtifactsService'

const rejectAfter = (ms: number): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error('onChange never fired')), ms))

let db: DB
let settings: SettingsStore
let svc: ArtifactsService
beforeEach(() => {
  db = openDatabase(':memory:')
  settings = new SettingsStore(db)
  svc = new ArtifactsService(settings)
})

describe('ArtifactsService', () => {
  it('returns {dir:null, files:[]} when no dir is configured', () => {
    expect(svc.list()).toEqual({ dir: null, files: [] })
  })
  it('scans the configured dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-service-'))
    writeFileSync(join(dir, 'a.pdf'), '%PDF')
    settings.set(ARTIFACTS_DIR_KEY, dir)
    const r = svc.list()
    expect(r.dir).toBe(dir)
    expect(r.files.map((f) => f.name)).toContain('a.pdf')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('ArtifactsService.watch', () => {
  it('fires onChange (debounced) when a file appears in the watched dir', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'artifact-watch-'))
    settings.set(ARTIFACTS_DIR_KEY, dir)
    const fired = new Promise<void>((resolve) => svc.startWatching(resolve, 30))
    await new Promise((r) => setTimeout(r, 60)) // let the watcher arm before touching the dir
    writeFileSync(join(dir, 'report.pdf'), 'x')
    await expect(Promise.race([fired, rejectAfter(3000)])).resolves.toBeUndefined()
    svc.stopWatching()
    rmSync(dir, { recursive: true, force: true })
  })

  it('does nothing (no crash, no fire) when no artifacts dir is configured', async () => {
    let fired = false
    svc.startWatching(() => {
      fired = true
    }, 10)
    await new Promise((r) => setTimeout(r, 100))
    expect(fired).toBe(false)
    svc.stopWatching()
  })
})
