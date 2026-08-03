import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { startMcpServer, type McpHandle } from './server'
import { ShareService } from '../artifacts/ShareService'
import type { ControlPlane } from '../control/ControlPlane'

// Real HTTP end-to-end for the share route: a live server, a real file on disk, real fetches.
const dir = mkdtempSync(join(tmpdir(), 'artifact-share-'))
const artifacts = join(dir, 'artifacts')
mkdirSync(artifacts)
const filePath = join(artifacts, 'report card.pdf')
writeFileSync(filePath, 'PDF-BYTES-HERE')
const secret = join(dir, 'secret.txt')
writeFileSync(secret, 'TOP SECRET')
symlinkSync(secret, join(artifacts, 'escape.txt')) // a symlink that points OUT of the artifacts dir

const shares = new ShareService({
  artifactsDir: () => artifacts,
  publicOrigin: () => 'http://127.0.0.1:0'
})

let handle: McpHandle
let base: string

let port = 0

async function boot(): Promise<void> {
  // Ephemeral port (the pattern the rest of server.test.ts uses) so this can never collide
  // with a real instance or a parallel test run.
  handle = await startMcpServer({
    cp: {} as ControlPlane,
    token: 'test-token',
    port: 0,
    resolveShare: (t) => shares.resolveToken(t)
  })
  base = new URL(handle.url).origin
  port = Number(new URL(handle.url).port)
}

afterAll(async () => {
  await handle?.stop()
})

describe('GET /share/:token (real HTTP)', () => {
  beforeAll(boot)

  it('serves the shared file as an attachment, then 404s after revoke', async () => {
    const minted = shares.mint(filePath)
    expect(minted.ok).toBe(true)

    const res = await fetch(`${base}/share/${minted.token}`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-disposition')).toContain('attachment')
    expect(res.headers.get('cache-control')).toContain('no-store')
    expect(await res.text()).toBe('PDF-BYTES-HERE')

    shares.revoke(minted.token!)
    expect((await fetch(`${base}/share/${minted.token}`)).status).toBe(404)
  })

  it('refuses unknown tokens and a bare /share/, and leaves the auth wall intact', async () => {
    expect((await fetch(`${base}/share/${'f'.repeat(64)}`)).status).toBe(404)
    expect((await fetch(`${base}/share/`)).status).toBe(404)
    // fetch() normalizes `/share/../x` to `/x` before it ever leaves the client, so that form
    // lands on the auth wall instead — which must still say 401 (the pre-auth routes are exact).
    expect((await fetch(`${base}/mcp`)).status).toBe(401)
  })

  it('refuses a RAW, un-normalized traversal path (what fetch() cannot send)', async () => {
    // A hostile client speaks HTTP directly, so the literal `..` reaches our router. The token
    // grammar (exactly 64 hex) is what makes this unrepresentable, not any path sanitizing.
    const raw = await new Promise<string>((resolve, reject) => {
      const sock = connect(port, '127.0.0.1', () => {
        sock.write('GET /share/../../../etc/passwd HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n')
      })
      let buf = ''
      sock.on('data', (d) => (buf += d.toString()))
      sock.on('end', () => resolve(buf))
      sock.on('error', reject)
    })
    expect(raw).toMatch(/^HTTP\/1\.1 (401|404)/) // never 200
    expect(raw).not.toContain('root:')
    expect(raw).not.toContain('TOP SECRET')
  })

  it('never mints a link for a symlink that escapes the artifacts dir', () => {
    const m = shares.mint(join(artifacts, 'escape.txt'))
    expect(m.ok).toBe(false)
    expect(m.message).toContain('inside the artifacts directory')
  })
})
