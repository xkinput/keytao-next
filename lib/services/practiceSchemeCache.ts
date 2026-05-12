export type PracticeSchemeKey = 'keytao' | 'xmjd' | 'txjx' | 'keydo'

export interface CachedPracticeSchemeVersion {
  schemeKey: PracticeSchemeKey
  label: string
  version: string
  assetName: string
  downloadedAt: string
  size: number
}

export interface CachedPracticeSchemeZip extends CachedPracticeSchemeVersion {
  id: string
  blob: Blob
}

const DB_NAME = 'keytao-practice-schemes'
const DB_VERSION = 1
const STORE_NAME = 'scheme-zips'

export function getPracticeSchemeCacheId(schemeKey: PracticeSchemeKey, version: string): string {
  return `${schemeKey}:${version}`
}

function openPracticeSchemeDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('schemeKey', 'schemeKey', { unique: false })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Failed to open practice scheme cache'))
  })
}

function withStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openPracticeSchemeDb().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const request = callback(transaction.objectStore(STORE_NAME))

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Practice scheme cache operation failed'))
    transaction.oncomplete = () => db.close()
    transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? new Error('Practice scheme cache transaction failed'))
    }
    transaction.onabort = () => {
      db.close()
      reject(transaction.error ?? new Error('Practice scheme cache transaction aborted'))
    }
  }))
}

export async function getCachedPracticeSchemeZip(
  schemeKey: PracticeSchemeKey,
  version: string
): Promise<CachedPracticeSchemeZip | null> {
  const id = getPracticeSchemeCacheId(schemeKey, version)
  const cached = await withStore<CachedPracticeSchemeZip | undefined>('readonly', (store) => store.get(id))
  return cached ?? null
}

export function putCachedPracticeSchemeZip(entry: CachedPracticeSchemeZip): Promise<IDBValidKey> {
  return withStore<IDBValidKey>('readwrite', (store) => store.put(entry))
}

export function deleteCachedPracticeSchemeZip(schemeKey: PracticeSchemeKey, version: string): Promise<undefined> {
  const id = getPracticeSchemeCacheId(schemeKey, version)
  return withStore<undefined>('readwrite', (store) => store.delete(id))
}
