import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { decodeWavPcm16 } from '@shared/voice/wav'
import type { AsrProvider, AsrStatus } from './AsrProvider'

export const PARAKEET_MODEL_NAME = 'Parakeet TDT 0.6B v3'
export const PARAKEET_MODEL_DIR = join(homedir(), '.vibechemy', 'models', 'parakeet-tdt-0.6b-v3')
const MODEL_FILES = ['encoder.int8.onnx', 'decoder.int8.onnx', 'joiner.int8.onnx', 'tokens.txt'] as const

interface SherpaStream {
  acceptWaveform(input: { samples: Float32Array; sampleRate: number }): void
}

interface SherpaRecognizer {
  createStream(): SherpaStream
  decodeAsync(stream: SherpaStream): Promise<void>
  getResult(stream: SherpaStream): { text: string }
}

interface SherpaModule {
  OfflineRecognizer: { createAsync(config: unknown): Promise<SherpaRecognizer> }
}

/** In-process, on-device Parakeet recognition through the sherpa-onnx native addon. */
export class ParakeetAsr implements AsrProvider {
  private recognizer: SherpaRecognizer | null = null
  private loading: Promise<SherpaRecognizer> | null = null
  private moduleCache: SherpaModule | null | undefined

  constructor(private readonly modelDir: string = PARAKEET_MODEL_DIR) {}

  available(): boolean {
    return this.hasModel() && this.loadModule() !== null
  }

  status(): AsrStatus {
    const modelInstalled = this.hasModel()
    const common = { engine: 'parakeet', model: PARAKEET_MODEL_NAME, modelPath: this.modelDir, modelInstalled }
    if (!modelInstalled) {
      return {
        ...common,
        available: false,
        reason: `Parakeet model not found at ${this.modelDir}. Download it in Settings → Voice or run scripts/fetch-parakeet.sh.`
      }
    }
    if (this.loadModule() === null) {
      return { ...common, available: false, reason: 'sherpa-onnx-node native addon failed to load' }
    }
    return { ...common, available: true }
  }

  async transcribe(wav: Buffer): Promise<string> {
    const recognizer = await this.ensureRecognizer()
    const { samples, sampleRate } = decodeWavPcm16(wav)
    const stream = recognizer.createStream()
    stream.acceptWaveform({ samples, sampleRate })
    await recognizer.decodeAsync(stream)
    return recognizer.getResult(stream).text.trim()
  }

  dispose(): void {
    this.recognizer = null
    this.loading = null
  }

  private hasModel(): boolean {
    return MODEL_FILES.every((file) => existsSync(join(this.modelDir, file)))
  }

  private loadModule(): SherpaModule | null {
    if (this.moduleCache !== undefined) return this.moduleCache
    try {
      // The native dependency is externalized by the main-process bundler.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.moduleCache = require('sherpa-onnx-node') as SherpaModule
    } catch {
      this.moduleCache = null
    }
    return this.moduleCache
  }

  private ensureRecognizer(): Promise<SherpaRecognizer> {
    if (this.recognizer) return Promise.resolve(this.recognizer)
    if (this.loading) return this.loading
    if (!this.hasModel()) return Promise.reject(new Error(`Parakeet model not found at ${this.modelDir}`))

    const sherpa = this.loadModule()
    if (!sherpa) return Promise.reject(new Error('sherpa-onnx-node is unavailable'))
    const config = {
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        transducer: {
          encoder: join(this.modelDir, 'encoder.int8.onnx'),
          decoder: join(this.modelDir, 'decoder.int8.onnx'),
          joiner: join(this.modelDir, 'joiner.int8.onnx')
        },
        tokens: join(this.modelDir, 'tokens.txt'),
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
        modelType: 'nemo_transducer'
      },
      decodingMethod: 'greedy_search'
    }
    this.loading = sherpa.OfflineRecognizer.createAsync(config).then(
      (recognizer) => {
        this.recognizer = recognizer
        this.loading = null
        return recognizer
      },
      (error: unknown) => {
        this.loading = null
        throw error
      }
    )
    return this.loading
  }
}
