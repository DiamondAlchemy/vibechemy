let context: AudioContext | null = null

/** Short decorative cues; speech capture still works when audio output is unavailable. */
export function dictationChime(kind: 'start' | 'stop' | 'soft' | 'error'): void {
  try {
    context ??= new AudioContext()
    const audioContext = context
    const frequencies = {
      start: [660, 880],
      stop: [880, 660],
      soft: [520],
      error: [220, 175]
    }[kind]
    frequencies.forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator()
      const gain = audioContext.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      oscillator.connect(gain)
      gain.connect(audioContext.destination)
      const startAt = audioContext.currentTime + index * 0.09
      gain.gain.setValueAtTime(0.06, startAt)
      gain.gain.exponentialRampToValueAtTime(0.001, startAt + 0.08)
      oscillator.start(startAt)
      oscillator.stop(startAt + 0.09)
    })
  } catch {
    // Decorative audio is best-effort.
  }
}
