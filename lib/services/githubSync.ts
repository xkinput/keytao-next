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
  generateBranchName(): string {
    const date = format(new Date(), 'yyyy-MM-dd');
    return `update-dict-${date}`;
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
    } catch (error: any) {
      if (error.status === 404) {
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
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get file content from repository
   */
  async getFileContent(branch: string, path: string): Promise<string | null> {
    try {
      const { data } = await this.octokit.repos.getContent({
        owner: this.owner,
        repo: this.repo,
        path,
        ref: branch,
      });

      if ('content' in data && data.content) {
        // GitHub API returns base64 encoded content
        return Buffer.from(data.content, 'base64').toString('utf-8');
      }
      return null;
    } catch (error: any) {
      if (error.status === 404) {
        return null;
      }
      throw error;
    }
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
    const total = files.length
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const existingSha = await this.getFileSha(branch, file.path);
      const content = Buffer.from(file.content, 'utf-8').toString('base64');

      if (existingSha) {
        // Update existing file
        await this.octokit.repos.createOrUpdateFileContents({
          owner: this.owner,
          repo: this.repo,
          path: file.path,
          message,
          content,
          branch,
          sha: existingSha,
        });
      } else {
        // Create new file
        await this.octokit.repos.createOrUpdateFileContents({
          owner: this.owner,
          repo: this.repo,
          path: file.path,
          message,
          content,
          branch,
        });
      }

      // Report progress after each file
      if (onProgress) {
        await onProgress(i + 1, total)
      }
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
