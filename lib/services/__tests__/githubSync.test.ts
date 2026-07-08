/**
 * Tests for GitHub Sync Service - Private Key Handling
 * These tests don't require database connection
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { GithubSyncService, incrementVersionTag } from '../githubSync';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

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

describe('GitHub release version tags', () => {
  it('increments release tags by patch by default', () => {
    expect(incrementVersionTag('v1.2.3')).toBe('v1.2.4');
    expect(incrementVersionTag(null)).toBe('v0.0.1');
  });

  it('supports minor and major bumps', () => {
    expect(incrementVersionTag('v1.2.3', 'minor')).toBe('v1.3.0');
    expect(incrementVersionTag('v1.2.3', 'major')).toBe('v2.0.0');
  });
});

describe('GitHub sync branch handling', () => {
  it('trims generated branch names after truncating uuid suffixes', () => {
    const service = new GithubSyncService({ owner: 'xkinput', repo: 'KeyTao', token: 'token' });

    const branch = service.generateBranchName('0becd0d5-f61b-4975-9341-34faf4db61b6');

    expect(branch).toMatch(/^update-dict-\d{4}-\d{2}-\d{2}-0becd0d5-f61b-4975-9341$/);
    expect(branch.endsWith('-')).toBe(false);
  });

  it('retries transient branch 404s before committing files', async () => {
    vi.useFakeTimers();
    const service = new GithubSyncService({ owner: 'xkinput', repo: 'KeyTao', token: 'token' });
    const transientNotFound = Object.assign(new Error('Branch not found'), { status: 404 });
    const octokit = {
      repos: {
        getBranch: vi.fn()
          .mockRejectedValueOnce(transientNotFound)
          .mockResolvedValueOnce({ data: { commit: { sha: 'base-sha' } } }),
      },
      git: {
        getCommit: vi.fn().mockResolvedValue({ data: { tree: { sha: 'tree-sha' } } }),
        createTree: vi.fn().mockResolvedValue({ data: { sha: 'new-tree-sha' } }),
        createCommit: vi.fn().mockResolvedValue({ data: { sha: 'new-commit-sha' } }),
        updateRef: vi.fn().mockResolvedValue({ data: {} }),
      },
    };
    Object.assign(service, { octokit });

    const commitPromise = service.commitFiles(
      'update-dict-branch',
      [{ path: 'rime/keytao.dict.yaml', content: 'content' }],
      'Update dictionaries'
    );

    await vi.advanceTimersByTimeAsync(500);
    await commitPromise;

    expect(octokit.repos.getBranch).toHaveBeenCalledTimes(2);
    expect(octokit.git.updateRef).toHaveBeenCalledWith(expect.objectContaining({
      ref: 'heads/update-dict-branch',
      sha: 'new-commit-sha',
    }));
  });
});
