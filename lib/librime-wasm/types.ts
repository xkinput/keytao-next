export type LibrimeWasmWorkerType = 'classic' | 'module'

export interface LibrimeWasmManifest {
  available: boolean
  version?: string
  generatedAt: string
  basePath: string
  worker?: string
  workerType?: LibrimeWasmWorkerType
  rimeJs?: string
  rimeWasm?: string
  rimeData?: string
  schemas?: RimeSchema[]
  reason?: string
}

export interface RimeSchema {
  id: string
  name: string
}

export interface RimeCandidate {
  text: string
  comment?: string
  label?: string
}

export interface RimeComposition {
  preedit: string
  candidates: RimeCandidate[]
  highlightedIndex: number
  page: number
  isLastPage: boolean
}

export interface RimeProcessResult {
  accepted: boolean
  committedText?: string
  composition?: RimeComposition | null
}

export interface RimeDeployFile {
  path: string
  content: ArrayBuffer
}

export interface LibrimeWasmWorkerStatusUpdate {
  message: string
  detail?: string
  progress?: number
}

export type LibrimeWasmStatus = 'checking' | 'ready' | 'unavailable' | 'error'

export type LibrimeWasmWorkerRequestType =
  | 'init'
  | 'deploy'
  | 'listSchemas'
  | 'selectSchema'
  | 'processKey'
  | 'selectCandidate'
  | 'changePage'
  | 'reset'

export interface LibrimeWasmWorkerRequest {
  id: number
  type: LibrimeWasmWorkerRequestType
  payload?: unknown
}

export interface LibrimeWasmWorkerResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: string
}

export interface LibrimeWasmWorkerStatusMessage {
  type: 'status'
  status: LibrimeWasmWorkerStatusUpdate
}

export type LibrimeWasmWorkerMessage = LibrimeWasmWorkerResponse | LibrimeWasmWorkerStatusMessage
