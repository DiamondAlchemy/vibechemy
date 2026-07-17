import { downsampleTo16k, encodeWavPcm16 } from '@shared/voice/wav'

export interface Recorder {
  start: () => Promise<void>
  stop: () => Promise<ArrayBuffer | null>
  dispose: () => void
}

const MIN_DURATION_SECONDS = 0.25
const BUFFER_SIZE = 4096
const AMPLITUDE_SMOOTHING = 0.4

/** Capture microphone PCM in the renderer and return a 16 kHz mono PCM16 WAV. */
export function createRecorder(onAmplitude: (rms: number) => void): Recorder {
  let stream: MediaStream | null = null
  let context: AudioContext | null = null
  let source: MediaStreamAudioSourceNode | null = null
  let processor: ScriptProcessorNode | null = null
  let chunks: Float32Array[] = []
  let sampleRate = 16000
  let smoothedAmplitude = 0
  let capturing = false
  let stopRequested = false

  const teardown = (): void => {
    capturing = false
    if (processor) {
      processor.onaudioprocess = null
      try {
        processor.disconnect()
      } catch {
        // Already disconnected.
      }
      processor = null
    }
    if (source) {
      try {
        source.disconnect()
      } catch {
        // Already disconnected.
      }
      source = null
    }
    if (context) {
      void context.close().catch(() => {})
      context = null
    }
    if (stream) {
      for (const track of stream.getTracks()) track.stop()
      stream = null
    }
    smoothedAmplitude = 0
  }

  const start = async (): Promise<void> => {
    chunks = []
    smoothedAmplitude = 0
    stopRequested = false

    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    })
    if (stopRequested) {
      acquired.getTracks().forEach((track) => track.stop())
      return
    }
    stream = acquired

    const AudioContextConstructor =
      window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextConstructor) throw new Error('Web Audio is unavailable')
    context = new AudioContextConstructor()
    sampleRate = context.sampleRate
    source = context.createMediaStreamSource(stream)
    processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1)
    capturing = true

    processor.onaudioprocess = (event: AudioProcessingEvent): void => {
      if (!capturing) return
      const input = event.inputBuffer.getChannelData(0)
      chunks.push(new Float32Array(input))
      let squareSum = 0
      for (const sample of input) squareSum += sample * sample
      const rms = Math.sqrt(squareSum / input.length)
      smoothedAmplitude += (rms - smoothedAmplitude) * AMPLITUDE_SMOOTHING
      onAmplitude(Math.max(0, Math.min(1, smoothedAmplitude)))
    }

    source.connect(processor)
    processor.connect(context.destination)
  }

  const stop = async (): Promise<ArrayBuffer | null> => {
    stopRequested = true
    const rate = sampleRate
    const captured = chunks
    teardown()
    onAmplitude(0)

    const sampleCount = captured.reduce((total, chunk) => total + chunk.length, 0)
    if (sampleCount / rate < MIN_DURATION_SECONDS) return null
    const merged = new Float32Array(sampleCount)
    let offset = 0
    for (const chunk of captured) {
      merged.set(chunk, offset)
      offset += chunk.length
    }
    return encodeWavPcm16(downsampleTo16k(merged, rate))
  }

  const dispose = (): void => {
    stopRequested = true
    teardown()
    onAmplitude(0)
  }

  return { start, stop, dispose }
}
