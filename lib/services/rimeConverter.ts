/**
 * Rime Dictionary Converter
 * Convert database phrases to Rime YAML format
 */

import { PhraseType, PullRequest, PullRequestType } from '@prisma/client';
import { format } from 'date-fns';

export interface RimeEntry {
  word: string;
  code: string;
  weight?: number;
}

export interface RimeDict {
  name: string;
  version: string;
  sort: string;
  entries: RimeEntry[];
}

/**
 * Convert PhraseType enum to file suffix
 * Aligned with KeyTao rime dictionary naming convention
 */
function phraseTypeToSuffix(type: PhraseType): string {
  const typeMap: Record<PhraseType, string> = {
    Single: 'single',          // 单字
    Phrase: 'phrase',          // 词组
    Supplement: 'supplement',  // 补充
    Symbol: 'symbol',          // 符号
    Link: 'link',              // 链接
    CSS: 'css',                // 声笔笔两字词
    CSSSingle: 'css-single',   // 声笔笔单字
    English: 'english',        // 英文
  };
  return typeMap[type];
}

/**
 * Convert PhraseType enum to display name
 */
function phraseTypeToDisplayName(type: PhraseType): string {
  const typeMap: Record<PhraseType, string> = {
    Single: '单字',
    Phrase: '词组',
    Supplement: '补充',
    Symbol: '符号',
    Link: '链接',
    CSS: '声笔笔',
    CSSSingle: '声笔笔单字',
    English: '英文',
  };
  return typeMap[type];
}

/**
 * Group pull requests by phrase type
 */
export function groupPullRequestsByType(
  pullRequests: PullRequest[]
): Map<PhraseType, PullRequest[]> {
  const grouped = new Map<PhraseType, PullRequest[]>();

  for (const pr of pullRequests) {
    if (!pr.type) continue;

    if (!grouped.has(pr.type)) {
      grouped.set(pr.type, []);
    }
    grouped.get(pr.type)!.push(pr);
  }

  return grouped;
}

/**
 * Convert pull request to Rime entry
 */
export function pullRequestToRimeEntry(pr: PullRequest): RimeEntry | null {
  // Skip delete operations
  if (pr.action === PullRequestType.Delete) {
    return null;
  }

  if (!pr.word || !pr.code) {
    return null;
  }

  return {
    word: pr.word,
    code: pr.code,
    weight: pr.weight || undefined,
  };
}

/**
 * Generate Rime YAML content
 */
export function generateRimeYaml(dict: RimeDict): string {
  const lines: string[] = [];

  // Header
  lines.push('# Rime dictionary');
  lines.push('# encoding: utf-8');
  lines.push('---');
  lines.push(`name: ${dict.name}`);
  lines.push(`version: "${dict.version}"`);
  lines.push(`sort: ${dict.sort}`);
  lines.push('columns:');
  lines.push('  - text');
  lines.push('  - code');
  if (dict.entries.some(e => e.weight !== undefined)) {
    lines.push('  - weight');
  }
  lines.push('...');
  lines.push('');

  // Entries (sort by code, then by weight descending)
  const sortedEntries = [...dict.entries].sort((a, b) => {
    if (a.code !== b.code) {
      return a.code.localeCompare(b.code);
    }
    return (b.weight || 0) - (a.weight || 0);
  });

  for (const entry of sortedEntries) {
    const parts = [entry.word, entry.code];
    if (entry.weight !== undefined) {
      parts.push(entry.weight.toString());
    }
    lines.push(parts.join('\t'));
  }

  return lines.join('\n');
}

/**
 * Convert pull requests to Rime dictionary files
 */
export function convertToRimeDicts(
  pullRequests: PullRequest[],
  version?: string
): Map<string, string> {
  const result = new Map<string, string>();
  const grouped = groupPullRequestsByType(pullRequests);
  const dateVersion = version || format(new Date(), 'yyyy.MM.dd');

  for (const [type, prs] of grouped.entries()) {
    const entries: RimeEntry[] = [];

    for (const pr of prs) {
      const entry = pullRequestToRimeEntry(pr);
      if (entry) {
        entries.push(entry);
      }
    }

    if (entries.length === 0) {
      continue;
    }

    const suffix = phraseTypeToSuffix(type);
    const dictName = `keytao.${suffix}`;
    const fileName = `${dictName}.dict.yaml`;

    const dict: RimeDict = {
      name: dictName,
      version: dateVersion,
      sort: 'by_weight',
      entries,
    };

    const content = generateRimeYaml(dict);
    result.set(fileName, content);

    // Special handling for Single type: also generate keytao-dz and keytao-cx
    // These three files have the same content but different yaml headers
    if (type === PhraseType.Single) {
      // keytao-dz.dict.yaml (used by keytao-dz schema)
      const dzDict: RimeDict = {
        name: 'keytao-dz',
        version: 'Q1',
        sort: 'by_weight',
        entries,
      };
      result.set('keytao-dz.dict.yaml', generateRimeYaml(dzDict));

      // keytao-cx.dict.yaml (used by keytao-cx schema)
      const cxDict: RimeDict = {
        name: 'keytao-cx',
        version: 'Q1',
        sort: 'by_weight',
        entries,
      };
      result.set('keytao-cx.dict.yaml', generateRimeYaml(cxDict));
    }
  }

  return result;
}

/**
 * Generate sync summary for PR description
 */
export function generateSyncSummary(
  pullRequests: PullRequest[],
  batches?: Array<{ creator: { name: string | null; nickname: string | null } }>
): string {
  const grouped = groupPullRequestsByType(pullRequests);
  const lines: string[] = [];

  lines.push('## 词库同步更新');
  lines.push('');

  // Add contributors section
  if (batches && batches.length > 0) {
    const contributors = new Set<string>();
    for (const batch of batches) {
      const displayName = batch.creator.nickname || batch.creator.name || '匿名用户';
      contributors.add(displayName);
    }

    if (contributors.size > 0) {
      lines.push('### 本次词库贡献者');
      lines.push('');
      lines.push(Array.from(contributors).join('、'));
      lines.push('');
    }
  }

  lines.push('### 更新统计');
  lines.push('');

  let totalEntries = 0;
  const stats: Record<string, { create: number; change: number; delete: number }> = {};

  for (const [type, prs] of grouped.entries()) {
    const displayName = phraseTypeToDisplayName(type);
    stats[displayName] = { create: 0, change: 0, delete: 0 };

    for (const pr of prs) {
      if (pr.action === PullRequestType.Create) {
        stats[displayName].create++;
        totalEntries++;
      } else if (pr.action === PullRequestType.Change) {
        stats[displayName].change++;
        totalEntries++;
      } else if (pr.action === PullRequestType.Delete) {
        stats[displayName].delete++;
      }
    }
  }

  lines.push(`- 总计: **${totalEntries}** 条词条`);
  lines.push('');

  for (const [typeName, stat] of Object.entries(stats)) {
    const total = stat.create + stat.change + stat.delete;
    if (total === 0) continue;

    const parts: string[] = [];
    if (stat.create > 0) parts.push(`新增 ${stat.create}`);
    if (stat.change > 0) parts.push(`修改 ${stat.change}`);
    if (stat.delete > 0) parts.push(`删除 ${stat.delete}`);

    lines.push(`- **${typeName}**: ${parts.join(', ')}`);
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('_此PR由KeyTao管理系统自动生成_');

  return lines.join('\n');
}
