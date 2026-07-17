import type { UsageAdapter, UsageDeps } from '../types'
import { parseZaiQuota, parseMinimaxRemains } from '../parsers'

/** GLM on the Z.AI Coding Plan. Key from the same auth.json OpenCode uses; z.ai returns a
 *  5h + weekly quota. Header is the raw key (Bearer also works — z.ai accepts both). */
export function opencodeGlmAdapter(): UsageAdapter {
  return {
    id: 'opencode-glm',
    label: 'OpenCode · GLM',
    burnId: 'opencode',
    available: true,
    async fetchRemaining(d: UsageDeps) {
      const key = d.readOpencodeAuth()['zai-coding-plan']?.key
      if (!key) throw new Error('GLM (Z.AI) key not found in opencode auth.json')
      const res = await d.fetch('https://api.z.ai/api/monitor/usage/quota/limit', {
        headers: { Authorization: key }
      })
      if (!res.ok) throw new Error(`Z.AI HTTP ${res.status}`)
      const body = (await res.json()) as { data?: { level?: string } }
      return { plan: body?.data?.level ?? 'Z.AI Coding Plan', windows: parseZaiQuota(body), health: null, note: null }
    }
  }
}

/** MiniMax (direct provider). Best-effort: the coding-plan remains endpoint returns per-model
 *  interval + weekly remaining percents. A non-zero status envelope surfaces as a SOURCE ERROR. */
export function opencodeMinimaxAdapter(): UsageAdapter {
  return {
    id: 'opencode-minimax',
    label: 'OpenCode · MiniMax',
    burnId: 'opencode',
    available: true,
    async fetchRemaining(d: UsageDeps) {
      const key = d.readOpencodeAuth()['minimax']?.key
      if (!key) throw new Error('MiniMax key not found in opencode auth.json')
      const res = await d.fetch('https://api.minimax.io/v1/api/openplatform/coding_plan/remains', {
        headers: { Authorization: `Bearer ${key}` }
      })
      if (!res.ok) throw new Error(`MiniMax HTTP ${res.status}`)
      const body = await res.json()
      return { plan: 'MiniMax Coding Plan', windows: parseMinimaxRemains(body), health: null, note: null }
    }
  }
}
