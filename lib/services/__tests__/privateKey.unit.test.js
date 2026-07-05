import { describe, expect, it } from 'vitest'

const normalizeKey = (key) => {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key
}

describe('GitHub private key normalization', () => {
  it('handles private key with real newlines', () => {
    const privateKeyWithRealNewlines = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----`

    expect(privateKeyWithRealNewlines.includes('\\n')).toBe(false)
    expect(privateKeyWithRealNewlines.split('\n').length).toBeGreaterThan(1)
  })

  it('handles private key with escaped newlines', () => {
    const privateKeyWithEscapedNewlines =
      '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA1234567890\\nabcdefghijklmnopqrstuvwxyz\\n-----END RSA PRIVATE KEY-----'

    expect(privateKeyWithEscapedNewlines.includes('\\n')).toBe(true)

    const normalized = privateKeyWithEscapedNewlines.replace(/\\n/g, '\n')
    expect(normalized.split('\n').length).toBeGreaterThan(1)
    expect(normalized.includes('\\n')).toBe(false)
  })

  it('normalizes both formats to the same result', () => {
    const realNewlines = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA
-----END RSA PRIVATE KEY-----`

    const escapedNewlines = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA\\n-----END RSA PRIVATE KEY-----'

    const normalized1 = normalizeKey(realNewlines)
    const normalized2 = normalizeKey(escapedNewlines)

    expect(normalized1.includes('\\n')).toBe(false)
    expect(normalized2.includes('\\n')).toBe(false)
    expect(normalized1.split('\n').length).toBeGreaterThan(1)
    expect(normalized2.split('\n').length).toBeGreaterThan(1)
    expect(normalized1).toBe(normalized2)
  })

  it('keeps a key without newlines unchanged', () => {
    const singleLineKey = 'some-single-line-key'
    const normalized = normalizeKey(singleLineKey)
    expect(normalized).toBe(singleLineKey)
  })

  it('keeps real .pem file format unchanged', () => {
    const pemKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL
MNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/ABCDEFGHIJKL
-----END RSA PRIVATE KEY-----`

    const normalized = normalizeKey(pemKey)

    expect(normalized).toBe(pemKey)
    expect(normalized.split('\n').length).toBe(4)
  })
})
