/** Strip an optional product-name prefix from a transcript. Push-to-talk does not require it. */
const WAKE_PREFIX = /^\s*vibechemy[,.:?!]?\s*/i

export function stripWake(text: string): string {
  return text.replace(WAKE_PREFIX, '').trim()
}
