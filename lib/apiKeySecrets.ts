import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const NONCE_BYTES = 12
const TAG_BYTES = 16

function getEncryptionKey() {
  const value = process.env.API_KEY_ENCRYPTION_KEY
  return value && /^[a-f0-9]{64}$/i.test(value) ? Buffer.from(value, 'hex') : null
}

export function encryptApiKey(plaintext: string, userId: number, keyHash: string) {
  const key = getEncryptionKey()
  if (!key) return null

  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(`${userId}:${keyHash}`))
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext])
}

export function decryptApiKey(encrypted: Uint8Array, userId: number, keyHash: string) {
  const key = getEncryptionKey()
  const bodyOffset = NONCE_BYTES + TAG_BYTES
  if (!key || encrypted.length <= bodyOffset) return null

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, encrypted.subarray(0, NONCE_BYTES), { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(`${userId}:${keyHash}`))
    decipher.setAuthTag(encrypted.subarray(NONCE_BYTES, bodyOffset))
    return Buffer.concat([decipher.update(encrypted.subarray(bodyOffset)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
