import type { UsageAdapter, UsageDeps } from '../types'
import { parseGrokBilling } from '../parsers'

// The grok CLI's own /usage source — NOT the public api.x.ai. Bearer is the SuperGrok sub token
// grokSubToken() already reads+refreshes. `format=credits` gives the weekly cap percent (matches
// the TUI creditUsagePercent); the plain call gives the monthly limit/used.
const BILLING = 'https://cli-chat-proxy.grok.com/v1/billing'

/** Grok (SuperGrok sub) — weekly cap % + monthly credits from the grok CLI's billing proxy. */
export function grokAdapter(): UsageAdapter {
  return {
    id: 'grok',
    label: 'Grok',
    burnId: null,
    available: true,
    async fetchRemaining(d: UsageDeps) {
      const token = await d.grokSubToken()
      if (!token) throw new Error('Grok not signed in (run: grok)')
      const auth = { authorization: `Bearer ${token}` }
      const [creditsRes, monthlyRes] = await Promise.all([
        d.fetch(`${BILLING}?format=credits`, { headers: auth }),
        d.fetch(BILLING, { headers: auth })
      ])
      // A stale token that grokSubToken didn't catch → surface a re-auth health light, not an error.
      if (creditsRes.status === 401)
        return { plan: 'SuperGrok', windows: [], health: 'expired', note: 'Grok token expired — run grok' }
      if (!creditsRes.ok) throw new Error(`Grok billing HTTP ${creditsRes.status}`)
      const credits = await creditsRes.json()
      const monthly = monthlyRes.ok ? await monthlyRes.json() : undefined
      const windows = parseGrokBilling(credits, monthly)
      // Billing returned but no parseable window → keep it honest with a health light.
      if (windows.length === 0)
        return { plan: 'SuperGrok', windows: [], health: 'live', note: 'signed in — no quota figures returned' }
      return { plan: 'SuperGrok', windows, health: null, note: null }
    }
  }
}
