import type { StandardsStore } from './StandardsStore'
import type { StandardCategory } from '@shared/types'

/**
 * A small starter set of GLOBAL standards — the user's established non-negotiables — seeded ONCE
 * (only when the standards table is empty) so a fresh Vibechemy injects sensible defaults into
 * every worker. Edit/retire any via update_standard; add project-specific rules via log_standard with
 * a projectId. Kept short and rule-first: every word rides into every pane on every spawn.
 */
export const STARTER_STANDARDS: Array<{ category: StandardCategory; rule: string; detail?: string }> = [
  {
    category: 'arch',
    rule: 'Foundation-first: build and verify one layer at a time — never big-bang.',
    detail: 'Land a small, working, verified slice before adding the next; no speculative scaffolding.'
  },
  {
    category: 'testing',
    rule: 'Verify before you merge: typecheck, lint, and tests must pass — and report failures honestly.',
    detail: 'Never claim something works if a check failed; show the failing output.'
  },
  {
    category: 'git',
    rule: 'Never push or deploy unprompted. Go live ONLY on an explicit "ship it" from the user.',
    detail: 'No arbitrary ssh/remote commands. Merges are local.'
  },
  {
    category: 'git',
    rule: 'Keep backticks, "!" and "$" out of commit messages — the zsh shell expands them and breaks the commit.'
  },
  {
    category: 'general',
    rule: 'Match the surrounding code: mirror the existing patterns, naming, and style of the file you are editing.'
  },
  {
    category: 'general',
    rule: 'Bias to action: once the task is done, STOP and report a short concrete status — do not keep re-planning, re-verifying, or polishing.',
    detail:
      'Make the change, verify it once, then summarize what you changed and how you checked it. If blocked, say so and ask — do not loop.'
  }
]

/**
 * Insert any starter globals not already present (matched by exact rule text), so new defaults land
 * on a later launch without duplicating existing ones — and a rule the user RETIRED stays retired
 * (its row still exists, so it is not re-added). Returns how many it added.
 */
export function seedStandards(store: StandardsStore): number {
  const present = new Set(store.list().map((s) => s.rule.trim()))
  let added = 0
  for (const s of STARTER_STANDARDS) {
    if (present.has(s.rule.trim())) continue
    store.log({ projectId: null, category: s.category, rule: s.rule, detail: s.detail ?? null })
    added++
  }
  return added
}
