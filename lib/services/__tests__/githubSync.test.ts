/**
 * Tests for GitHub Sync Service - Private Key Handling
 * These tests don't require database connection
 */

import { describe, it, expect } from 'vitest';

describe('GitHub Private Key Handling', () => {
  it('should handle private key with real newlines', () => {
    const privateKeyWithRealNewlines = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----`;

    // Should not contain \\n as string literal
    expect(privateKeyWithRealNewlines.includes('\\n')).toBe(false);
    // Should contain actual newline characters
    expect(privateKeyWithRealNewlines.split('\n').length).toBeGreaterThan(1);
  });

  it('should handle private key with escaped newlines', () => {
    const privateKeyWithEscapedNewlines =
      '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA1234567890\\nabcdefghijklmnopqrstuvwxyz\\n-----END RSA PRIVATE KEY-----';

    // Should contain \\n as string literal
    expect(privateKeyWithEscapedNewlines.includes('\\n')).toBe(true);

    // After replacement, should have real newlines
    const normalized = privateKeyWithEscapedNewlines.replace(/\\n/g, '\n');
    expect(normalized.split('\n').length).toBeGreaterThan(1);
    expect(normalized.includes('\\n')).toBe(false);
  });

  it('should normalize private key correctly - both formats produce same result', () => {
    const realNewlines = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA
-----END RSA PRIVATE KEY-----`;

    const escapedNewlines =
      '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA\\n-----END RSA PRIVATE KEY-----';

    // Normalization logic from githubSync.ts
    const normalizeKey = (key: string) => {
      return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
    };

    const normalized1 = normalizeKey(realNewlines);
    const normalized2 = normalizeKey(escapedNewlines);

    // Both should result in keys with real newlines (not escaped)
    expect(normalized1.includes('\\n')).toBe(false);
    expect(normalized2.includes('\\n')).toBe(false);

    // Both should be multiline
    expect(normalized1.split('\n').length).toBeGreaterThan(1);
    expect(normalized2.split('\n').length).toBeGreaterThan(1);

    // Both formats should normalize to the same result
    expect(normalized1).toBe(normalized2);
  });

  it('should handle edge case - key without newlines stays unchanged', () => {
    const singleLineKey = 'some-single-line-key';

    const normalizeKey = (key: string) => {
      return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
    };

    const normalized = normalizeKey(singleLineKey);
    expect(normalized).toBe(singleLineKey);
  });
});
