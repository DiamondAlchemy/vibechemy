import http from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { clampAwaitTimeoutMs, isControlEventKind } from '../control/ControlEventHub'
import type { ControlPlane } from '../control/ControlPlane'
import { PRODUCT_IDENTITY } from '@shared/product'

export function loadOrCreateToken(file: string): string {
  if (existsSync(file)) {
    const token = readFileSync(file, 'utf8').trim()
    if (token) {
      try {
        chmodSync(file, 0o600)
      } catch {
        // Best effort on platforms without Unix permissions.
      }
      return token
    }
  }
  const token = randomBytes(32).toString('hex')
  writeFileSync(file, token, { mode: 0o600 })
  return token
}

function jsonText(value: unknown): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** Upper bound for read_output — matches the pane History capture, well under tmux's history-limit. */
export const MAX_READ_OUTPUT_LINES = 5000

export function buildMcpServer(control: ControlPlane): McpServer {
  const server = new McpServer({ name: PRODUCT_IDENTITY.mcpServerName, version: '0.1.0' })

  server.registerTool(
    'list_projects',
    { title: 'List projects', description: 'List registered projects.', inputSchema: {} },
    async () => jsonText(control.listProjects())
  )
  server.registerTool(
    'list_presets',
    { title: 'List presets', description: 'List spawnable worker presets.', inputSchema: {} },
    async () => jsonText(control.listPresets())
  )
  server.registerTool(
    'get_memory',
    {
      title: 'Get project memory',
      description: 'Read shared global, project, and learning memory for a project.',
      inputSchema: { projectId: z.string() }
    },
    async ({ projectId }) => jsonText(control.getMemory(projectId))
  )
  server.registerTool(
    'note_learning',
    {
      title: 'Record a learning',
      description: 'Append a durable learning to a project.',
      inputSchema: { projectId: z.string(), text: z.string() }
    },
    async ({ projectId, text }) => jsonText(control.noteLearning(projectId, text))
  )
  server.registerTool(
    'list_workers',
    {
      title: 'List workers',
      // `null` reached ControlPlane as "only workers with NO project" — the opposite of the
      // "no filter" a caller reaching for null intends, so it silently returned a subset. Null is
      // still accepted (agents already in the wild send it; rejecting would break them mid-run)
      // but now means the same as omitting it.
      description: 'List running or detached worker sessions. Omit projectId, or pass null, for all projects.',
      inputSchema: { projectId: z.string().nullable().optional() }
    },
    async ({ projectId }) => jsonText(control.listWorkers(projectId ?? undefined))
  )
  server.registerTool(
    'list_leftovers',
    {
      title: 'List leftover worktrees',
      description:
        'List closed isolated workers whose worktrees remain on disk. Omit projectId, or pass null, for all projects.',
      // See list_workers: `null` meant "unscoped workers only", never "no filter".
      inputSchema: { projectId: z.string().nullable().optional() }
    },
    async ({ projectId }) => jsonText(await control.listLeftovers(projectId ?? undefined))
  )
  server.registerTool(
    'get_agent_config',
    {
      title: 'Get agent config',
      description: 'Read the editable agent model and preset configuration.',
      inputSchema: {}
    },
    async () => jsonText(control.getAgentConfig())
  )
  server.registerTool(
    'configure_agents',
    {
      title: 'Configure agents',
      description: 'Update the editable model, OpenCode, custom-agent, or account roster.',
      inputSchema: {
        action: z.enum([
          'set_model',
          'add_opencode_model',
          'remove_opencode_model',
          'add_custom_agent',
          'remove_custom_agent',
          'add_account',
          'rename_account',
          'set_account_role',
          'remove_account'
        ]),
        family: z.enum(['claude', 'codex']).optional(),
        role: z.enum(['lead', 'worker']).optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        label: z.string().optional(),
        slug: z.string().optional(),
        command: z.string().optional(),
        ref: z.string().optional(),
        accountRole: z.enum(['orchestrator', 'both']).optional()
      }
    },
    async (input) =>
      jsonText(control.configureAgents(input as unknown as Parameters<typeof control.configureAgents>[0]))
  )
  server.registerTool(
    'spawn_worker',
    {
      title: 'Spawn worker',
      description: 'Spawn a preset in a terminal, optionally in an isolated git worktree.',
      inputSchema: {
        presetId: z.string(),
        cwd: z.string().optional(),
        projectId: z.string().nullable().optional(),
        isolate: z.boolean().optional(),
        task: z.string().optional(),
        owner: z.string().optional(),
        callsign: z.string().optional(),
        model: z.string().optional(),
        effort: z.string().optional()
      }
    },
    async ({ presetId, cwd, projectId, isolate, task, owner, callsign, model, effort }) =>
      jsonText(await control.spawnWorker({ presetId, cwd, projectId, isolate, task, owner, callsign, model, effort }))
  )
  server.registerTool(
    'send_to_worker',
    {
      title: 'Send to worker',
      description: 'Type a message into a running worker and submit it.',
      inputSchema: { workerId: z.string(), text: z.string() }
    },
    async ({ workerId, text }) => jsonText(await control.sendToWorker(workerId, text))
  )
  server.registerTool(
    'set_task',
    {
      title: 'Set worker task',
      description: 'Update a worker task and self-reported state.',
      inputSchema: {
        workerId: z.string(),
        task: z.string().optional(),
        state: z.enum(['working', 'needs_review', 'blocked', 'done']).optional()
      }
    },
    async ({ workerId, task, state }) => jsonText(control.setTask(workerId, { task, state }))
  )
  server.registerTool(
    'get_diff',
    {
      title: 'Get worker diff',
      description: 'Show an isolated worker diff against its origin branch.',
      inputSchema: { workerId: z.string() }
    },
    async ({ workerId }) => jsonText(await control.getDiff(workerId))
  )
  server.registerTool(
    'read_output',
    {
      title: 'Read worker output',
      description: 'Read recent terminal output from a worker.',
      // `lines` is interpolated into tmux's `capture-pane -S -<lines>`; a float, a negative or a
      // NaN produces an argument tmux rejects, surfacing as an opaque spawn failure rather than a
      // usable error. Bound it to what a pane can actually hold.
      inputSchema: { workerId: z.string(), lines: z.number().int().min(1).max(MAX_READ_OUTPUT_LINES).optional() }
    },
    async ({ workerId, lines }) => jsonText(await control.readOutput(workerId, lines))
  )
  server.registerTool(
    'merge_worker',
    {
      title: 'Merge worker',
      description: 'Merge an isolated worker locally and clean up its worktree.',
      inputSchema: { workerId: z.string() }
    },
    async ({ workerId }) => jsonText(await control.mergeWorker(workerId))
  )
  server.registerTool(
    'discard_worker',
    {
      title: 'Discard worker',
      description: 'Close a worker and remove its clean isolated worktree.',
      inputSchema: { workerId: z.string() }
    },
    async ({ workerId }) => jsonText(await control.discardWorker(workerId))
  )
  server.registerTool(
    'get_day_digest',
    {
      title: 'Get day digest',
      description: 'Summarize activity and knowledge since a timestamp or local midnight.',
      inputSchema: { projectId: z.string().nullable().optional(), sinceMs: z.number().optional() }
    },
    async ({ projectId, sinceMs }) => jsonText(control.dayDigest({ projectId, sinceMs }))
  )
  server.registerTool(
    'log_outcome',
    {
      title: 'Log outcome',
      description: 'Record a feature or bug in project knowledge.',
      inputSchema: {
        projectId: z.string().nullable().optional(),
        type: z.enum(['feature', 'bug']),
        title: z.string(),
        detail: z.string().optional(),
        status: z.string().optional(),
        branch: z.string().nullable().optional()
      }
    },
    async ({ projectId, type, title, detail, status, branch }) =>
      jsonText(control.logOutcome({ projectId, type, title, detail, status, branch }))
  )
  server.registerTool(
    'update_outcome',
    {
      title: 'Update outcome',
      description: 'Update a feature or bug record.',
      inputSchema: {
        id: z.string(),
        status: z.string().optional(),
        detail: z.string().optional(),
        title: z.string().optional()
      }
    },
    async ({ id, status, detail, title }) => jsonText(control.updateOutcome(id, { status, detail, title }))
  )
  server.registerTool(
    'search_knowledge',
    {
      title: 'Search knowledge',
      description: 'Search feature and bug records.',
      inputSchema: { query: z.string(), projectId: z.string().nullable().optional() }
    },
    async ({ query, projectId }) => jsonText(control.searchKnowledge(query, projectId))
  )
  server.registerTool(
    'list_knowledge',
    {
      title: 'List knowledge',
      description: 'List feature and bug records with optional filters.',
      inputSchema: {
        projectId: z.string().nullable().optional(),
        type: z.enum(['feature', 'bug']).optional(),
        status: z.string().optional()
      }
    },
    async ({ projectId, type, status }) => jsonText(control.listKnowledge({ projectId, type, status }))
  )
  server.registerTool(
    'get_standards',
    {
      title: 'Get standards',
      description: 'Read active global and project coding standards.',
      inputSchema: { projectId: z.string().nullable().optional() }
    },
    async ({ projectId }) => jsonText(control.getStandards(projectId))
  )
  server.registerTool(
    'log_standard',
    {
      title: 'Log standard',
      description: 'Record a coding standard.',
      inputSchema: {
        projectId: z.string().nullable().optional(),
        category: z.enum(['style', 'naming', 'testing', 'git', 'arch', 'deps', 'models', 'general']),
        rule: z.string(),
        detail: z.string().optional(),
        // npm/npx/pnpm/yarn/node/make/pytest/go/cargo/vitest/jest/tsc/eslint/prettier/ruff/git/echo
        sort: z.number().optional()
      }
    },
    async ({ projectId, category, rule, detail, sort }) =>
      jsonText(control.logStandard({ projectId, category, rule, detail, sort }))
  )
  server.registerTool(
    'update_standard',
    {
      title: 'Update standard',
      description: 'Edit or retire a coding standard.',
      inputSchema: {
        id: z.string(),
        rule: z.string().optional(),
        detail: z.string().optional(),
        category: z.enum(['style', 'naming', 'testing', 'git', 'arch', 'deps', 'models', 'general']).optional(),
        status: z.enum(['active', 'retired']).optional(),
        sort: z.number().optional()
      }
    },
    async ({ id, rule, detail, category, status, sort }) =>
      jsonText(control.updateStandard(id, { rule, detail, category, status, sort }))
  )
  server.registerTool(
    'await_event',
    {
      title: 'Await control event',
      description: 'Wait for a worker lifecycle event or a timeout.',
      inputSchema: {
        sinceSeq: z.number().int().min(0).optional(),
        kinds: z.array(z.string()).optional(),
        timeoutMs: z.number().int().optional()
      }
    },
    async ({ sinceSeq, kinds, timeoutMs }) => {
      const filtered = kinds === undefined ? undefined : kinds.filter(isControlEventKind)
      return jsonText(
        await control.awaitEvent({ sinceSeq, kinds: filtered, timeoutMs: clampAwaitTimeoutMs(timeoutMs) })
      )
    }
  )

  return server
}

export interface McpHandle {
  port: number
  url: string
  stop: () => Promise<void>
}

/**
 * Constant-time bearer comparison. `!==` on a secret returns as soon as two bytes differ, so the
 * response time leaks how long a shared prefix is — enough to recover the token byte-by-byte from
 * a process that can time requests (every agent pane can). The token's LENGTH is not a secret (it
 * is always 64 hex characters), so an early length check before timingSafeEqual is safe; the
 * function throws on mismatched lengths otherwise.
 */
export function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

/** Authorities that mean "this machine" — the only ones the control plane will answer to. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]'])

/**
 * DNS-rebinding guard. The server binds loopback, but that only controls which interface accepts
 * the connection — a browser on this machine can be handed a hostname that resolves to 127.0.0.1
 * and will happily connect. The Host header is what separates "a client that meant to reach us"
 * from "a page that was pointed at us", so require a loopback authority.
 */
export function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false
  const host = hostHeader.trim().toLowerCase()
  // Strip the port. IPv6 literals are bracketed, so a colon only separates the port when it
  // comes after the closing bracket.
  const colon = host.lastIndexOf(':')
  const bare = colon !== -1 && colon > host.lastIndexOf(']') ? host.slice(0, colon) : host
  return LOOPBACK_HOSTS.has(bare)
}

/**
 * The agent CLIs are not browsers and send no Origin, so an absent Origin is the normal case.
 * A PRESENT Origin means a browser sent this, and it may only be one of our own.
 */
export function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname.toLowerCase())
  } catch {
    return false // 'null' and other opaque origins are not loopback
  }
}

/**
 * Hard cap on a control-plane request body. The largest legitimate payload is a task prompt or a
 * recorded learning — kilobytes. Without a cap, any holder of the token (including a wedged
 * orchestrator) can stream until the main process dies, taking every live terminal with it.
 */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

class BodyTooLarge extends Error {}

/**
 * Read a request body with a size cap, decoding ONCE over the joined buffer. Accumulating
 * `raw += chunk` decodes each chunk independently, so any multi-byte character that straddles a
 * chunk boundary (~64 KB) is destroyed — a non-ASCII task prompt or learning silently arrives
 * corrupted, or fails to parse at all.
 */
async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = chunk as Buffer
    total += buffer.length
    if (total > MAX_BODY_BYTES) throw new BodyTooLarge()
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

export function startMcpServer(options: {
  cp: ControlPlane
  token: string
  port: number
  host?: string
  keepaliveMs?: number
  listenRetryDelaysMs?: number[]
}): Promise<McpHandle> {
  const host = options.host ?? '127.0.0.1'
  const transports: Record<string, StreamableHTTPServerTransport> = {}
  const servers: Record<string, McpServer> = {}
  const httpServer = http.createServer(async (request, response) => {
    try {
      const authorization = (request.headers['authorization'] as string | undefined) ?? ''
      const apiKey = (request.headers['x-api-key'] as string | undefined) ?? ''
      const presented = authorization.replace(/^Bearer\s+/i, '').trim() || apiKey.trim()
      if (!tokenMatches(presented, options.token)) {
        response.writeHead(401).end('unauthorized')
        return
      }
      // Checked AFTER the bearer so an unauthenticated prober learns nothing about which
      // authorities we accept, and BEFORE any handler so a rebound browser reaches no tool.
      if (!hostAllowed(request.headers.host) || !originAllowed(request.headers.origin)) {
        response.writeHead(403).end('forbidden')
        return
      }
      if ((request.url ?? '').split('?')[0] !== '/mcp') {
        response.writeHead(404).end('not found')
        return
      }

      if (request.method === 'POST') {
        let raw: string
        try {
          raw = await readBody(request)
        } catch (error) {
          if (error instanceof BodyTooLarge) {
            // Connection: close is load-bearing. Aborting the `for await` destroys a
            // PARTIALLY-CONSUMED IncomingMessage, which corrupts HTTP/1.1 framing on that socket
            // and Node does not heal it. Left keep-alive, the next request on the same connection
            // hangs forever — and the MCP client reuses one connection for a session's whole life,
            // so a single oversized tool argument would silently wedge that orchestrator's control
            // plane with no error surfaced. Forcing a close makes the client reconnect cleanly.
            response.writeHead(413, { connection: 'close' }).end('payload too large')
            return
          }
          throw error
        }
        const body = raw ? JSON.parse(raw) : undefined
        const sessionId = request.headers['mcp-session-id'] as string | undefined
        let transport = sessionId ? transports[sessionId] : undefined

        if (!transport && isInitializeRequest(body)) {
          const server = buildMcpServer(options.cp)
          let newSessionId: string | undefined
          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableDnsRebindingProtection: false,
            onsessioninitialized: (id) => {
              newSessionId = id
              transports[id] = transport!
              servers[id] = server
            }
          })
          transport.onclose = () => {
            if (!newSessionId) return
            delete transports[newSessionId]
            delete servers[newSessionId]
          }
          await server.connect(transport)
        }
        if (!transport) {
          response.writeHead(404, { 'content-type': 'application/json' })
          response.end(
            JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null })
          )
          return
        }
        await transport.handleRequest(request, response, body)
        return
      }

      if (request.method === 'GET' || request.method === 'DELETE') {
        const sessionId = request.headers['mcp-session-id'] as string | undefined
        const transport = sessionId ? transports[sessionId] : undefined
        if (!transport) {
          response.writeHead(404).end('Session not found')
          return
        }
        await transport.handleRequest(request, response)
        return
      }

      response.writeHead(405).end('method not allowed')
    } catch {
      if (!response.headersSent) response.writeHead(500).end('error')
    }
  })

  httpServer.keepAliveTimeout = 65_000
  httpServer.headersTimeout = 70_000

  const keepalive = setInterval(() => {
    for (const server of Object.values(servers)) server.server.ping().catch(() => {})
  }, options.keepaliveMs ?? 45_000)
  keepalive.unref()

  const retryDelays = options.listenRetryDelaysMs ?? [500, 1000, 2000, 4000, 5000, 5000, 5000, 5000]
  return new Promise<McpHandle>((resolvePromise, reject) => {
    let attempt = 0
    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE' && attempt < retryDelays.length) {
        const delay = retryDelays[attempt++]
        console.warn(`[mcp] port ${options.port} busy — retrying in ${delay}ms`)
        setTimeout(() => httpServer.listen(options.port, host), delay).unref()
        return
      }
      clearInterval(keepalive)
      reject(error)
    })
    httpServer.once('listening', () => {
      const address = httpServer.address()
      const port = typeof address === 'object' && address ? address.port : options.port
      resolvePromise({
        port,
        url: `http://${host}:${port}/mcp`,
        stop: () =>
          new Promise<void>((done) => {
            clearInterval(keepalive)
            for (const transport of Object.values(transports)) {
              try {
                void transport.close()
              } catch {
                // Ignore already-closed transports.
              }
            }
            httpServer.closeAllConnections?.()
            httpServer.close(() => done())
          })
      })
    })
    httpServer.listen(options.port, host)
  })
}
