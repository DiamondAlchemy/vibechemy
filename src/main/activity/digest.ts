import type { ActivityEvent, KnowledgeEntry } from '@shared/types'

/** Local start-of-day (midnight) in ms — the default digest window. */
export function startOfDay(now: number = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * The day digest, OUTCOME-oriented (not mechanics): per project — what features were added, what
 * bugs were fixed today, plus what's in progress and what bugs are still open. Reads the curated
 * knowledge base and uses the activity ledger to distinguish quiet windows from unlogged work.
 * Pure — all inputs passed in, so it's unit-testable without a database.
 */
export function buildDigest(
  events: ActivityEvent[],
  knowledge: KnowledgeEntry[],
  nameOf: (projectId: string | null) => string,
  since: number
): string {
  const header = `# Vibechemy — Day Digest (since ${new Date(since).toLocaleString()})`

  const pids = new Set<string | null>()
  for (const e of events) pids.add(e.projectId)
  for (const k of knowledge) pids.add(k.projectId)

  const titles = (xs: KnowledgeEntry[]): string => xs.map((k) => k.title).join('; ')

  const sections = [...pids]
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)))
    .map((pid) => {
      const kn = knowledge.filter((k) => k.projectId === pid)
      const featuresAdded = kn.filter(
        (k) => k.type === 'feature' && k.status === 'shipped' && k.resolvedAt != null && k.resolvedAt >= since
      )
      const bugsFixed = kn.filter(
        (k) => k.type === 'bug' && k.status === 'fixed' && k.resolvedAt != null && k.resolvedAt >= since
      )
      const inProgress = kn.filter(
        (k) => (k.type === 'feature' && k.status === 'building') || (k.type === 'bug' && k.status === 'fixing')
      )
      const openBugs = kn.filter((k) => k.type === 'bug' && k.status === 'open')

      const lines: string[] = []
      if (featuresAdded.length) lines.push(`- **Features added:** ${featuresAdded.length} — ${titles(featuresAdded)}`)
      if (bugsFixed.length) lines.push(`- **Bugs fixed:** ${bugsFixed.length} — ${titles(bugsFixed)}`)
      if (inProgress.length) lines.push(`- **In progress:** ${titles(inProgress)}`)
      if (openBugs.length) lines.push(`- **Open bugs:** ${openBugs.length} — ${titles(openBugs)}`)
      return lines.length ? [`## ${nameOf(pid)}`, ...lines].join('\n') : ''
    })
    .filter(Boolean)

  if (sections.length) return `${header}\n\n${sections.join('\n\n')}`
  // Nothing surfaced. Distinguish a genuinely quiet window from work-that-wasn't-logged using the
  // IN-WINDOW activity events — NOT the all-time KB (whose mere existence would defeat the check).
  return events.length > 0
    ? `${header}\n\n_Work happened today but nothing's in the knowledge base yet — leads should log_outcome what they ship so this fills in._`
    : `${header}\n\n_No activity recorded in this window._`
}
