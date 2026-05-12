import type {
  LibrimeWasmManifest,
  LibrimeWasmWorkerMessage,
  LibrimeWasmWorkerRequest,
  LibrimeWasmWorkerRequestType,
  LibrimeWasmWorkerStatusUpdate,
  RimeDeployFile,
  RimeProcessResult,
  RimeSchema,
} from './types'

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
}

interface CreateLibrimeWasmEngineOptions {
  basePath?: string
  manifestFile?: string
  onStatus?: (status: LibrimeWasmWorkerStatusUpdate) => void
}

export class LibrimeWasmEngine {
  private readonly basePath: string
  private readonly manifestFile: string
  private worker: Worker | null = null
  private manifest: LibrimeWasmManifest | null = null
  private readonly onStatus?: (status: LibrimeWasmWorkerStatusUpdate) => void
  private requestId = 0
  private pendingRequests = new Map<number, PendingRequest>()

  constructor(options: CreateLibrimeWasmEngineOptions = {}) {
    this.basePath = options.basePath ?? '/librime-wasm'
    this.manifestFile = options.manifestFile ?? 'manifest.json'
    this.onStatus = options.onStatus
  }

  async loadManifest(): Promise<LibrimeWasmManifest> {
    if (this.manifest) return this.manifest

    const response = await fetch(`${this.basePath}/${this.manifestFile}`, { cache: 'no-store' })
    if (!response.ok) {
      throw new Error(`无法加载 librime wasm manifest: ${response.status}`)
    }

    const manifest = await response.json() as LibrimeWasmManifest
    this.manifest = manifest
    return manifest
  }

  async isAvailable(): Promise<boolean> {
    try {
      const manifest = await this.loadManifest()
      return manifest.available && Boolean(manifest.worker && manifest.rimeJs && manifest.rimeWasm)
    } catch {
      return false
    }
  }

  async init(): Promise<void> {
    const manifest = await this.loadManifest()
    if (!manifest.available || !manifest.worker) {
      throw new Error(manifest.reason ?? 'librime wasm assets are not available')
    }

    if (!this.worker) {
      this.worker = new Worker(`${manifest.basePath}/${manifest.worker}`, {
        name: 'librime-wasm',
        type: manifest.workerType ?? 'classic',
      })
      this.worker.onmessage = (event: MessageEvent<LibrimeWasmWorkerMessage>) => this.handleWorkerMessage(event.data)
      this.worker.onerror = (event) => {
        const message = event.message || 'librime wasm worker failed'
        this.rejectAll(new Error(message))
      }
    }

    await this.request<void>('init', { manifest })
  }

  async deploy(files: RimeDeployFile[]): Promise<void> {
    await this.request<void>('deploy', { files })
  }

  async listSchemas(): Promise<RimeSchema[]> {
    const schemas = await this.request<unknown>('listSchemas')
    return Array.isArray(schemas) ? schemas as RimeSchema[] : this.manifest?.schemas ?? []
  }

  async selectSchema(schemaId: string): Promise<RimeProcessResult> {
    return this.request<RimeProcessResult>('selectSchema', { schemaId })
  }

  async processKey(key: string): Promise<RimeProcessResult> {
    return this.request<RimeProcessResult>('processKey', { key })
  }

  async selectCandidate(index: number): Promise<RimeProcessResult> {
    return this.request<RimeProcessResult>('selectCandidate', { index })
  }

  async changePage(backward: boolean): Promise<RimeProcessResult> {
    return this.request<RimeProcessResult>('changePage', { backward })
  }

  async reset(): Promise<void> {
    await this.request<void>('reset')
  }

  dispose(): void {
    this.rejectAll(new Error('librime wasm worker disposed'))
    this.worker?.terminate()
    this.worker = null
  }

  private request<T>(type: LibrimeWasmWorkerRequestType, payload?: unknown): Promise<T> {
    if (!this.worker) return Promise.reject(new Error('librime wasm worker is not initialized'))

    const id = ++this.requestId
    const request: LibrimeWasmWorkerRequest = { id, type, payload }

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      })
      this.worker?.postMessage(request)
    })
  }

  private handleWorkerMessage(message: LibrimeWasmWorkerMessage): void {
    if ('type' in message && message.type === 'status') {
      this.onStatus?.(message.status)
      return
    }
    if (!('id' in message)) return

    const pending = this.pendingRequests.get(message.id)
    if (!pending) return

    this.pendingRequests.delete(message.id)
    if (message.ok) {
      pending.resolve(message.result)
      return
    }

    pending.reject(new Error(message.error ?? 'librime wasm request failed'))
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pendingRequests.values()) pending.reject(error)
    this.pendingRequests.clear()
  }
}

export function createLibrimeWasmEngine(options?: CreateLibrimeWasmEngineOptions): LibrimeWasmEngine {
  return new LibrimeWasmEngine(options)
}
