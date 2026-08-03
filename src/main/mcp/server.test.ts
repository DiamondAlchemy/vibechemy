import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { request as httpRequest } from 'node:http'
import { connect as netConnect } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PingRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { Preset } from '@shared/types'
import { ControlPlane } from '../control/ControlPlane'
import { openDatabase, type DB } from '../db/database'
import { MergeService } from '../git/MergeService'
import { MemoryStore } from '../memory/MemoryStore'
import { PresetRegistry } from '../presets/PresetRegistry'
import { ProjectStore } from '../projects/ProjectStore'
import { PtyBridge } from '../sessions/PtyBridge'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SessionManager } from '../sessions/SessionManager'
import { newDetachedSession, killSession, hasSession } from '../sessions/tmux'
import { SettingsStore } from '../settings/SettingsStore'
import { MAX_BODY_BYTES, MAX_READ_OUTPUT_LINES, startMcpServer, type McpHandle } from './server'

const presets: Preset[] = [{ id: 'sleeper', name: 'Sleeper', command: 'sleep', args: ['120'], env: {} }]
const INSERT =
  'INSERT INTO sessions (id,project_id,preset_id,tmux_name,cwd,title,status,created_at,last_seen_at,branch,origin_root) VALUES (?,?,?,?,?,?,?,?,?,?,?)'

const roots: string[] = []
const databases: DB[] = []
let handle: McpHandle | null = null

function fixture(): ControlPlane {
  const root = mkdtempSync(join(tmpdir(), 'mc-mcp-'))
  roots.push(root)
  const db = openDatabase(join(root, 'server.sqlite'))
  databases.push(db)
  const sessions = new SessionManager(db, PresetRegistry.from(presets))
  const merge = new MergeService(
    sessions,
    new PtyBridge(
      () => {},
      () => {}
    )
  )
  const projects = new ProjectStore(db)
  const projectRoot = mkdtempSync(join(tmpdir(), 'mc-mcp-project-'))
  roots.push(projectRoot)
  projects.createProject('Project One', projectRoot)
  db.prepare(INSERT).run('w1', null, 'sleeper', 'mc_w1', '/tmp', 'Sleeper', 'running', 1, 1, null, null)
  return new ControlPlane(
    sessions,
    merge,
    projects,
    () => {},
    () => {},
    new MemoryStore(join(root, 'global')),
    undefined,
    undefined,
    undefined,
    new SettingsStore(db)
  )
}

async function connect(url: string, token = 'sekret'): Promise<Client> {
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { authorization: `Bearer ${token}` } }
    })
  )
  return client
}

function toolText(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as { type: string; text: string }[])[0].text
}

afterEach(async () => {
  if (handle) await handle.stop()
  handle = null
  while (databases.length) databases.pop()!.close()
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

describe('MCP control-plane server', () => {
  it('rejects requests without the correct bearer token', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer WRONG' },
      body: '{}'
    })
    expect(response.status).toBe(401)
  })

  it('accepts bare Authorization and X-API-Key token forms', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    for (const headers of [{ authorization: 'sekret' }, { 'x-api-key': 'sekret' }] as Array<Record<string, string>>) {
      const response = await fetch(handle.url, { method: 'POST', headers, body: '{}' })
      expect(response.status).not.toBe(401)
    }
  })

  it('returns the spec-compliant response for an unknown session id', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: 'Bearer sekret',
        'mcp-session-id': 'stale'
      },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'tools/list', id: 1 })
    })
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({
      jsonrpc: '2.0',
      error: { code: -32001, message: 'Session not found' },
      id: null
    })
  })

  it('pings live sessions on the keepalive interval', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0, keepaliveMs: 50 })
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    let pings = 0
    client.setRequestHandler(PingRequestSchema, () => {
      pings++
      return {}
    })
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: { authorization: 'Bearer sekret' } }
      })
    )
    const deadline = Date.now() + 5000
    while (pings === 0 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25))
    expect(pings).toBeGreaterThanOrEqual(1)
    await client.close()
  })

  it('exposes only the retained core tools and serves list_workers', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const client = await connect(handle.url)
    const tools = await client.listTools()
    expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
      'await_event',
      'configure_agents',
      'discard_worker',
      'get_agent_config',
      'get_day_digest',
      'get_diff',
      'get_memory',
      'get_standards',
      'list_knowledge',
      'list_leftovers',
      'list_presets',
      'list_projects',
      'list_workers',
      'log_outcome',
      'log_standard',
      'merge_worker',
      'note_learning',
      'read_output',
      'search_knowledge',
      'send_to_worker',
      'set_task',
      'spawn_worker',
      'update_outcome',
      'update_standard'
    ])
    expect(toolText(await client.callTool({ name: 'list_workers', arguments: {} }))).toContain('w1')
    await client.close()
  })

  it('retries EADDRINUSE and binds after the predecessor exits', async () => {
    const blocker = createNetServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const address = blocker.address()
    const port = typeof address === 'object' && address ? address.port : 0
    setTimeout(() => blocker.close(), 75)
    handle = await startMcpServer({
      cp: fixture(),
      token: 'sekret',
      port,
      listenRetryDelaysMs: [50, 50, 200, 200]
    })
    expect((await fetch(handle.url, { method: 'POST', body: '{}' })).status).toBe(401)
  })

  it('rejects EADDRINUSE after the retry schedule is exhausted', async () => {
    const blocker = createNetServer()
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve))
    const address = blocker.address()
    const port = typeof address === 'object' && address ? address.port : 0
    try {
      await expect(
        startMcpServer({ cp: fixture(), token: 'sekret', port, listenRetryDelaysMs: [10] })
      ).rejects.toMatchObject({ code: 'EADDRINUSE' })
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()))
    }
  })

  it('delivers worker events through await_event', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const client = await connect(handle.url)
    await client.callTool({ name: 'set_task', arguments: { workerId: 'w1', state: 'needs_review' } })
    const result = JSON.parse(toolText(await client.callTool({ name: 'await_event', arguments: { timeoutMs: 1000 } })))
    expect(result.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: 'worker_state', workerId: 'w1' })])
    )
    await client.close()
  })

  // NB: this asserts rejection, NOT constant-time-ness — it passes against a plain `===` too.
  // Timing safety is not practically assertable in a unit test; it is a property of the
  // implementation (timingSafeEqual), reviewed rather than tested.
  it('rejects a wrong token of the same length as the real one', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: { authorization: 'Bearer sekreT' },
      body: '{}'
    })
    expect(response.status).toBe(401)
  })

  it('refuses a non-loopback Host header (DNS rebinding)', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    // Raw http.request, not fetch: undici rewrites Host from the URL, so fetch cannot express
    // the rebinding case at all (the header never reaches the server).
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          host: '127.0.0.1',
          port: handle!.port,
          path: '/mcp',
          method: 'POST',
          headers: { authorization: 'Bearer sekret', host: 'evil.example.com', 'content-length': 2 }
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      req.end('{}')
    })
    expect(status).toBe(403)
  })

  it('refuses a cross-origin browser request but allows the CLIs, which send no Origin', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const rebound = await fetch(handle.url, {
      method: 'POST',
      headers: { authorization: 'Bearer sekret', origin: 'https://evil.example.com' },
      body: '{}'
    })
    expect(rebound.status).toBe(403)
    // No Origin at all is the normal agent-CLI case and must still authenticate.
    const cli = await fetch(handle.url, { method: 'POST', headers: { authorization: 'Bearer sekret' }, body: '{}' })
    expect(cli.status).not.toBe(403)
  })

  it('caps the request body instead of buffering it into the main process', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const response = await fetch(handle.url, {
      method: 'POST',
      headers: { authorization: 'Bearer sekret', 'content-type': 'application/json' },
      body: 'x'.repeat(MAX_BODY_BYTES + 1)
    })
    expect(response.status).toBe(413)
  })

  it('does not leave the connection wedged after a 413', async () => {
    // Aborting the body read destroys a partially-consumed IncomingMessage, which corrupts
    // HTTP/1.1 framing on that socket. Left keep-alive, the NEXT request on the same connection
    // hangs forever — and the MCP client holds one connection for a whole session, so a single
    // oversized tool argument would silently kill that orchestrator's control plane.
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const socket = netConnect(handle.port, '127.0.0.1')
    await new Promise((resolve) => socket.once('connect', resolve))
    let received = ''
    socket.on('data', (d) => {
      received += d.toString()
    })
    const oversized = 'x'.repeat(MAX_BODY_BYTES + 1)
    socket.write(
      `POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nAuthorization: Bearer sekret\r\n` +
        `Content-Length: ${oversized.length}\r\n\r\n${oversized}`
    )
    // Wait for the 413 and for the server to hang up.
    await new Promise<void>((resolve) => {
      const done = (): void => resolve()
      socket.once('close', done)
      setTimeout(done, 3000)
    })
    expect(received).toContain('413')
    // The server must have closed it rather than inviting reuse of a corrupted connection.
    expect(received.toLowerCase()).toContain('connection: close')
    socket.destroy()
  })

  it('preserves multi-byte characters split across chunk boundaries', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const client = await connect(handle.url)
    const projectId = JSON.parse(toolText(await client.callTool({ name: 'list_projects', arguments: {} })))[0].id
    // Far larger than one 64 KB socket chunk, so multi-byte characters land on the boundaries a
    // naive `raw += chunk` decodes independently. note_learning round-trips through the memory
    // store, so get_memory can assert the text survived rather than merely that a call succeeded.
    const text = 'é中🚀'.repeat(40_000)
    await client.callTool({ name: 'note_learning', arguments: { projectId, text } })
    const memory = JSON.parse(toolText(await client.callTool({ name: 'get_memory', arguments: { projectId } })))
    expect(memory.learnings).toContain(text)
    expect(memory.learnings).not.toContain('�')
    await client.close()
  })

  it('rejects an out-of-range read_output line count but accepts a valid one', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const client = await connect(handle.url)
    // A REAL tmux pane behind the fixture's worker row. Without one, capture-pane fails for
    // EVERY value of `lines`, so the test would pass just as happily with the bound removed.
    await newDetachedSession('mc_w1', tmpdir(), 'cat')
    try {
      const ok = await client.callTool({ name: 'read_output', arguments: { workerId: 'w1', lines: 10 } })
      expect(ok.isError).toBeFalsy()
      for (const lines of [0, -50, 1.5, MAX_READ_OUTPUT_LINES + 1]) {
        const result = await client.callTool({ name: 'read_output', arguments: { workerId: 'w1', lines } })
        expect(result.isError).toBe(true)
      }
    } finally {
      if (await hasSession('mc_w1')) await killSession('mc_w1')
      await client.close()
    }
  })

  it('does not turn an all-unknown event filter into a firehose', async () => {
    handle = await startMcpServer({ cp: fixture(), token: 'sekret', port: 0 })
    const client = await connect(handle.url)
    await client.callTool({ name: 'set_task', arguments: { workerId: 'w1', state: 'needs_review' } })
    const result = JSON.parse(
      toolText(
        await client.callTool({
          name: 'await_event',
          arguments: { kinds: ['worker_stat'], timeoutMs: 10 }
        })
      )
    )
    expect(result.events).toEqual([])
    await client.close()
  })
})
