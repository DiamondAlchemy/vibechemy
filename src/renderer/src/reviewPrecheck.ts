import type { PrecheckResult } from '@shared/ipc'

export type PrecheckState = { phase: 'running' } | { phase: 'complete'; result: PrecheckResult }
export type PrecheckCache = Record<string, PrecheckState>

export function beginPrecheck(cache: PrecheckCache, sessionId: string): PrecheckCache {
  if (cache[sessionId]) return cache
  return { ...cache, [sessionId]: { phase: 'running' } }
}

export function completePrecheck(cache: PrecheckCache, sessionId: string, result: PrecheckResult): PrecheckCache {
  return { ...cache, [sessionId]: { phase: 'complete', result } }
}

function passedCount(output: string): { passed: number; total: number } | null {
  const ansiColor = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g')
  const plain = output.replace(ansiColor, '')
  const vitest = plain.match(/^\s*Tests\s+(\d+)\s+passed\s+\((\d+)\)/m)
  if (vitest) return { passed: Number(vitest[1]), total: Number(vitest[2]) }
  const jest = plain.match(/^Tests:\s+(\d+)\s+passed,\s+(\d+)\s+total/m)
  if (jest) return { passed: Number(jest[1]), total: Number(jest[2]) }
  const nodeTotal = plain.match(/^# tests\s+(\d+)$/m)
  const nodePassed = plain.match(/^# pass\s+(\d+)$/m)
  if (nodeTotal && nodePassed) return { passed: Number(nodePassed[1]), total: Number(nodeTotal[1]) }
  const generic = plain.match(/\b(\d+)\s+passed\b/)
  if (generic) {
    const passed = Number(generic[1])
    return { passed, total: passed }
  }
  return null
}

export function formatPrecheck(state: PrecheckState): string {
  if (state.phase === 'running') return 'checks …'
  const { result } = state
  if (!result.configured) return 'no check configured'
  if (result.exitCode !== 0) return 'checks ✗'
  const count = passedCount(result.output)
  return count ? `checks ✓ ${count.passed}/${count.total}` : 'checks ✓'
}

export function precheckTone(state: PrecheckState): 'running' | 'pass' | 'fail' | 'none' {
  if (state.phase === 'running') return 'running'
  if (!state.result.configured) return 'none'
  return state.result.exitCode === 0 ? 'pass' : 'fail'
}
