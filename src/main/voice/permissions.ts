/** Only audio-only media requests are authorized; camera and every other permission stay denied. */
export function isMicrophonePermission(permission: string, mediaTypes?: readonly string[]): boolean {
  return permission === 'media' && mediaTypes?.length === 1 && mediaTypes[0] === 'audio'
}
