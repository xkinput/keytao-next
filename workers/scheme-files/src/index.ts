import { verifyToken, type FileToken } from './token'

export interface ObjectMetadata {
  size: number
  checksums: { sha256?: ArrayBuffer }
}

export interface Env {
  FILES_SIGNING_SECRET: string
  BUCKET: {
    head(key: string): Promise<ObjectMetadata | null>
    get(key: string): Promise<(ObjectMetadata & { body: ReadableStream<Uint8Array> }) | null>
    put(key: string, body: ReadableStream<Uint8Array>, options: {
      sha256: string
      httpMetadata: { contentType: string }
      onlyIf?: { etagDoesNotMatch: string }
    }): Promise<ObjectMetadata | null>
    delete(key: string): Promise<void>
  }
}

const routes: Record<string, { method: string; op: FileToken['op'] }> = {
  '/u': { method: 'PUT', op: 'put' },
  '/d': { method: 'GET', op: 'get' },
  '/internal/head': { method: 'POST', op: 'head' },
  '/internal/delete': { method: 'POST', op: 'delete' },
}

function contentDisposition(filename: string) {
  const safe = filename.replace(/[\u0000-\u001f\u007f]/g, '')
  const fallback = safe.replace(/[^\x20-\x7e]|["\\]/g, '_')
  const encoded = encodeURIComponent(safe).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const match = /^(\/u|\/d|\/internal\/head|\/internal\/delete)\/([^/]+)$/.exec(new URL(request.url).pathname)
  if (!match || request.method !== routes[match[1]].method) return new Response('Not found', { status: 404 })
  if (!env.FILES_SIGNING_SECRET?.trim()) return new Response('Storage is not configured', { status: 503 })
  const token = await verifyToken(match[2], env.FILES_SIGNING_SECRET, routes[match[1]].op)
  if (!token) return new Response('Forbidden', { status: 403 })

  switch (token.op) {
    case 'put': {
      const length = request.headers.get('Content-Length')
      if (!length || !/^\d+$/.test(length) || Number(length) !== token.size || request.headers.has('Transfer-Encoding')) {
        return new Response('Invalid Content-Length', { status: 400 })
      }
      if (!request.body) return new Response('Missing body', { status: 400 })
      if (await env.BUCKET.head(token.key)) return new Response('Object already exists', { status: 409 })
      const object = await env.BUCKET.put(token.key, request.body, {
        sha256: token.sha256, httpMetadata: { contentType: 'application/zip' },
        onlyIf: { etagDoesNotMatch: '*' },
      })
      if (!object) return new Response('Object already exists', { status: 409 })
      return new Response(null, { status: 201 })
    }
    case 'get': {
      const object = await env.BUCKET.get(token.key)
      if (!object) return new Response('Not found', { status: 404 })
      return new Response(object.body, { headers: {
        'Content-Type': 'application/zip',
        'Content-Length': String(object.size),
        'Content-Disposition': contentDisposition(token.filename),
      } })
    }
    case 'head': {
      const object = await env.BUCKET.head(token.key)
      if (!object) return new Response('Not found', { status: 404 })
      if (!object.checksums.sha256) return new Response('Missing object checksum', { status: 502 })
      const sha256 = Array.from(new Uint8Array(object.checksums.sha256), byte => byte.toString(16).padStart(2, '0')).join('')
      return Response.json({ size: object.size, sha256 })
    }
    case 'delete':
      await env.BUCKET.delete(token.key)
      return new Response(null, { status: 204 })
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    let response: Response
    try {
      response = await handleRequest(request, env)
    } catch {
      response = new Response('Storage request failed', { status: 502 })
    }
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  },
}

export default worker

