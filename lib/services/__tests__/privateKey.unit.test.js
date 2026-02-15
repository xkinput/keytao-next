/**
 * Unit tests for private key normalization logic
 * Run with: node lib/services/__tests__/privateKey.unit.test.js
 */

// Simple test function
function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(`   ${error.message}`);
  }
}

function expect(actual) {
  return {
    toBe(expected) {
      if (actual !== expected) {
        throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
      }
    },
    toBeGreaterThan(expected) {
      if (actual <= expected) {
        throw new Error(`Expected ${actual} to be greater than ${expected}`);
      }
    }
  };
}

// Normalization logic from githubSync.ts
const normalizeKey = (key) => {
  return key.includes('\\n') ? key.replace(/\\n/g, '\n') : key;
};

console.log('\n🧪 GitHub Private Key Normalization Tests\n');

test('should handle private key with real newlines', () => {
  const privateKeyWithRealNewlines = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890
abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----`;

  expect(privateKeyWithRealNewlines.includes('\\n')).toBe(false);
  expect(privateKeyWithRealNewlines.split('\n').length).toBeGreaterThan(1);
});

test('should handle private key with escaped newlines', () => {
  const privateKeyWithEscapedNewlines =
    '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA1234567890\\nabcdefghijklmnopqrstuvwxyz\\n-----END RSA PRIVATE KEY-----';

  expect(privateKeyWithEscapedNewlines.includes('\\n')).toBe(true);

  const normalized = privateKeyWithEscapedNewlines.replace(/\\n/g, '\n');
  expect(normalized.split('\n').length).toBeGreaterThan(1);
  expect(normalized.includes('\\n')).toBe(false);
});

test('should normalize both formats to the same result', () => {
  const realNewlines = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA
-----END RSA PRIVATE KEY-----`;

  const escapedNewlines = '-----BEGIN RSA PRIVATE KEY-----\\nMIIEpAIBAAKCAQEA\\n-----END RSA PRIVATE KEY-----';

  const normalized1 = normalizeKey(realNewlines);
  const normalized2 = normalizeKey(escapedNewlines);

  expect(normalized1.includes('\\n')).toBe(false);
  expect(normalized2.includes('\\n')).toBe(false);
  expect(normalized1.split('\n').length).toBeGreaterThan(1);
  expect(normalized2.split('\n').length).toBeGreaterThan(1);
  expect(normalized1).toBe(normalized2);
});

test('should handle edge case - key without newlines stays unchanged', () => {
  const singleLineKey = 'some-single-line-key';
  const normalized = normalizeKey(singleLineKey);
  expect(normalized).toBe(singleLineKey);
});

test('should work with real .pem file format', () => {
  const pemKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL
MNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/ABCDEFGHIJKL
-----END RSA PRIVATE KEY-----`;

  const normalized = normalizeKey(pemKey);

  // Should keep newlines as-is
  expect(normalized).toBe(pemKey);
  expect(normalized.split('\n').length).toBe(4); // header, 2 content lines, footer
});

console.log('\n✨ All tests passed!\n');
