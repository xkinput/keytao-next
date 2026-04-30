/**
 * Github Sync Service
 * Handles synchronization of Rime dictionaries to Github repository
 */

import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import { format } from 'date-fns';

export interface GithubConfig {
  owner: string;
  repo: string;
  baseBranch?: string;
  // Personal Access Token (legacy)
  token?: string;
  // GitHub App (recommended)
  appId?: number;
  privateKey?: string;
  installationId?: number;
}

export interface FileCommit {
  path: string;
  content: string;
}

export interface CreatePRResult {
  number: number;
  html_url: string;
  branch: string;
}

function isGitHubStatusError(error: unknown, status: number): boolean {
  return typeof error === 'object'
    && error !== null
    && 'status' in error
    && error.status === status;
}

/**
 * Github Sync Service Class
 */
export class GithubSyncService {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private baseBranch: string;

  constructor(config: GithubConfig) {
    // GitHub App authentication (recommended)
    if (config.appId && config.privateKey && config.installationId) {
      this.octokit = new Octokit({
        authStrategy: createAppAuth,
        auth: {
          appId: config.appId,
          privateKey: config.privateKey,
          installationId: config.installationId,
        },
      });
    }
    // Personal Access Token authentication (legacy)
    else if (config.token) {
      this.octokit = new Octokit({
        auth: config.token,
      });
    } else {
      throw new Error(
        'Either GitHub App credentials (appId, privateKey, installationId) or token must be provided'
      );
    }

    this.owner = config.owner;
    this.repo = config.repo;
    this.baseBranch = config.baseBranch || 'master';
  }

  /**
   * Generate branch name with date
   */
  generateBranchName(suffix?: string): string {
    const date = format(new Date(), 'yyyy-MM-dd');
    if (!suffix) {
      return `update-dict-${date}`;
    }

    const normalizedSuffix = suffix
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 24);

    return normalizedSuffix
      ? `update-dict-${date}-${normalizedSuffix}`
      : `update-dict-${date}`;
  }

  getBaseBranchName(): string {
    return this.baseBranch;
  }

  /**
   * Get latest commit SHA from base branch
   */
  async getLatestCommitSha(): Promise<string> {
    const { data } = await this.octokit.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch: this.baseBranch,
    });
    return data.commit.sha;
  }

  /**
   * Create a new branch
   */
  async createBranch(branchName: string): Promise<void> {
    const sha = await this.getLatestCommitSha();

    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/heads/${branchName}`,
      sha,
    });
  }

  /**
   * Check if branch exists
   */
  async branchExists(branchName: string): Promise<boolean> {
    try {
      await this.octokit.repos.getBranch({
        owner: this.owner,
        repo: this.repo,
        branch: branchName,
      });
      return true;
    } catch (error: unknown) {
      if (isGitHubStatusError(error, 404)) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get or create branch (if exists, use existing, otherwise create new)
   */
  async getOrCreateBranch(branchName: string): Promise<string> {
    const exists = await this.branchExists(branchName);

    if (!exists) {
      await this.createBranch(branchName);
    }

    return branchName;
  }

  /**
   * Get file SHA if exists (for updating files)
   */
  async getFileSha(branch: string, path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: branch,
      });

      if ('sha' in data) {
        return data.sha;
      }
      return null;
    } catch (error: unknown) {
      if (isGitHubStatusError(error, 404)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get file content from repository
   * Handles both small and large files (> 1MB)
   */
  async getFileContent(branch: string, path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: branch,
      });

      // Handle directory response
      if (Array.isArray(data)) {
        return null;
      }

      // For small files (< 1MB), content is returned directly
      if ('content' in data && data.content) {
        // GitHub API returns base64 encoded content
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }

      // For large files (> 1MB), content is null, use Git Blob API
      if ('sha' in data && data.sha) {
        console.log(`[getFileContent] Large file detected: ${path}, using Blob API`);

        const blobResponse = await this.octokit.git.getBlob({
          owner: this.owner,
          repo: this.repo,
          file_sha: data.sha,
        });

        if (blobResponse.data.content) {
          // Blob API also returns base64 encoded content
          return Buffer.from(blobResponse.data.content, 'base64').toString('utf-8');
        }
      }

      return null;
    } catch (error: unknown) {
      if (isGitHubStatusError(error, 404)) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Filter out files whose content is unchanged against the given ref
   */
  async filterChangedFiles(ref: string, files: FileCommit[]): Promise<FileCommit[]> {
    const changedFiles: FileCommit[] = [];

    for (const file of files) {
      const existingContent = await this.getFileContent(ref, file.path);

      if (existingContent !== file.content) {
        changedFiles.push(file);
      }
    }

    return changedFiles;
  }

  /**
   * Commit files to branch
   */
  async commitFiles(
    branch: string,
    files: FileCommit[],
    message: string,
    onProgress?: (current: number, total: number) => void | Promise<void>
  ): Promise<void> {
    if (files.length === 0) {
      return;
    }

    const { data: branchData } = await this.octokit.repos.getBranch({
      owner: this.owner,
      repo: this.repo,
      branch,
    });

    const baseCommitSha = branchData.commit.sha;
    const { data: baseCommit } = await this.octokit.git.getCommit({
      owner: this.owner,
      repo: this.repo,
      commit_sha: baseCommitSha,
    });

    const { data: newTree } = await this.octokit.git.createTree({
      owner: this.owner,
      repo: this.repo,
      base_tree: baseCommit.tree.sha,
      tree: files.map((file) => ({
        path: file.path,
        mode: '100644' as const,
        type: 'blob' as const,
        content: file.content,
      })),
    });

    const { data: newCommit } = await this.octokit.git.createCommit({
      owner: this.owner,
      repo: this.repo,
      message,
      tree: newTree.sha,
      parents: [baseCommitSha],
    });

    await this.octokit.git.updateRef({
      owner: this.owner,
      repo: this.repo,
      ref: `heads/${branch}`,
      sha: newCommit.sha,
    });

    if (onProgress) {
      await onProgress(files.length, files.length);
    }
  }

  /**
   * Create pull request
   */
  async createPullRequest(
    branch: string,
    title: string,
    body: string
  ): Promise<CreatePRResult> {
    console.log(`[GitHub] Creating PR with title: ${title}`);
    console.log(`[GitHub] PR body length: ${body?.length || 0}`);
    console.log(`[GitHub] PR body preview: ${body?.slice(0, 200) || '(empty)'}`);

    const { data } = await this.octokit.pulls.create({
      owner: this.owner,
      repo: this.repo,
      title,
      body,
      head: branch,
      base: this.baseBranch,
    });

    return {
      number: data.number,
      html_url: data.html_url,
      branch,
    };
  }

  /**
   * Get the latest semver tag (v[x.x.x]) from the repo
   */
  async getLatestVersionTag(): Promise<string | null> {
    const { data } = await this.octokit.repos.listTags({
      owner: this.owner,
      repo: this.repo,
      per_page: 100,
    });

    const versionTags = data
      .map((t) => t.name)
      .filter((name) => /^v\d+\.\d+\.\d+$/.test(name))
      .sort((a, b) => {
        const pa = a.slice(1).split('.').map(Number);
        const pb = b.slice(1).split('.').map(Number);
        for (let i = 0; i < 3; i++) {
          if (pa[i] !== pb[i]) return pb[i] - pa[i];
        }
        return 0;
      });

    return versionTags[0] ?? null;
  }

  /**
   * Create an annotated tag on the latest commit of baseBranch and push it
   */
  async createAndPushTag(tagName: string, message: string): Promise<void> {
    const sha = await this.getLatestCommitSha();

    const { data: tagObj } = await this.octokit.git.createTag({
      owner: this.owner,
      repo: this.repo,
      tag: tagName,
      message,
      object: sha,
      type: 'commit',
    });

    await this.octokit.git.createRef({
      owner: this.owner,
      repo: this.repo,
      ref: `refs/tags/${tagName}`,
      sha: tagObj.sha,
    });
  }

  /**
   * Full sync workflow: create branch, commit files, create PR
   */
  async syncDictionaries(
    dictFiles: Map<string, string>,
    summary: string,
    onProgress?: (current: number, total: number) => void | Promise<void>
  ): Promise<CreatePRResult> {
    const branchName = this.generateBranchName();

    // Step 1: Create or get branch
    await this.getOrCreateBranch(branchName);

    // Step 2: Prepare files for commit
    const files: FileCommit[] = [];
    for (const [fileName, content] of dictFiles.entries()) {
      files.push({
        path: `rime/${fileName}`,
        content,
      });
    }

    // Step 3: Commit files
    const commitMessage = `Update dictionaries - ${format(new Date(), 'yyyy-MM-dd')}`;
    await this.commitFiles(branchName, files, commitMessage, onProgress);

    // Step 4: Create PR
    const prTitle = `[自动同步] 词库更新 - ${format(new Date(), 'yyyy年MM月dd日')}`;
    const pr = await this.createPullRequest(branchName, prTitle, summary);

    return pr;
  }
}

/**
 * Create Github sync service instance from environment variables
 * Supports both GitHub App and Personal Access Token authentication
 */
export function createGithubSyncService(): GithubSyncService {
  const owner = process.env.GITHUB_OWNER || 'xkinput';
  const repo = process.env.GITHUB_REPO || 'KeyTao';
  const baseBranch = process.env.GITHUB_BASE_BRANCH || 'master';

  // Try GitHub App authentication first (recommended)
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  const installationId = process.env.GITHUB_APP_INSTALLATION_ID;

  if (appId && privateKey && installationId) {
    // Smart private key handling: works with both real newlines and \n escapes
    const normalizedKey = privateKey.includes('\\n')
      ? privateKey.replace(/\\n/g, '\n')  // Convert \n to real newlines
      : privateKey;                        // Already has real newlines

    return new GithubSyncService({
      owner,
      repo,
      baseBranch,
      appId: parseInt(appId, 10),
      privateKey: normalizedKey,
      installationId: parseInt(installationId, 10),
    });
  }

  // Fall back to Personal Access Token
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    return new GithubSyncService({
      owner,
      repo,
      baseBranch,
      token,
    });
  }

  throw new Error(
    'GitHub authentication required. Set either:\n' +
    '1. GitHub App: GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_INSTALLATION_ID\n' +
    '2. Personal Token: GITHUB_TOKEN'
  );
}
