type Scalar = string | number | null

/**
 * One WHERE clause + its bound argument(s). `arg` is an array when the clause holds several
 * placeholders (e.g. `(title LIKE ? OR detail LIKE ?)`); args are flattened in part order.
 */
export interface WherePart {
  clause: string
  arg: Scalar | Scalar[]
}

/**
 * Pure SELECT builder shared by row stores such as Knowledge and Standards — replaces
 * hand-rolled where/args array builders. Callers express optional filters as inline conditionals
 * producing `null`/`false` parts, which are skipped; the `project_id IS ?` null-scoping convention
 * lives in the callers' clauses, not here.
 */
export function buildSelect(
  table: string,
  parts: (WherePart | null | false)[],
  orderBy: string
): { sql: string; args: Scalar[] } {
  const kept = parts.filter((p): p is WherePart => Boolean(p))
  const sql = kept.length
    ? `SELECT * FROM ${table} WHERE ${kept.map((p) => p.clause).join(' AND ')} ORDER BY ${orderBy}`
    : `SELECT * FROM ${table} ORDER BY ${orderBy}`
  const args = kept.flatMap((p) => (Array.isArray(p.arg) ? p.arg : [p.arg]))
  return { sql, args }
}
