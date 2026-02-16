/**
 * POST /api/admin/sync-to-github/prepare
 * Prepare sync task and return file list for frontend processing
 */

import { checkAdminPermission } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import {
  convertToRimeDicts,
  generateSyncSummary,
  parseRimeYaml,
  mergeRimeEntries,
  generateRimeYaml,
  RimeDict
} from '@/lib/services/rimeConverter';
import { createGithubSyncService } from '@/lib/services/githubSync';
import { SyncTaskStatus } from '@prisma/client';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 10;

export async function POST() {
  try {
    // Verify admin permission
    const authResult = await checkAdminPermission();
    if (!authResult.authorized) {
      return authResult.response;
    }

    console.log('[Prepare] Creating sync task...');

    // Find approved batches
    const batches = await prisma.batch.findMany({
      where: {
        status: 'Approved',
        syncTaskId: null,
      },
      include: {
        creator: {
          select: {
            id: true,
            name: true,
            nickname: true,
          },
        },
        pullRequests: {
          where: {
            status: 'Approved',
          },
          orderBy: {
            createAt: 'asc',
          },
        },
      },
    });

    if (batches.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有需要同步的批次' },
        { status: 400 }
      );
    }

    const allPullRequests = batches.flatMap((batch) => batch.pullRequests);

    if (allPullRequests.length === 0) {
      return NextResponse.json(
        { success: false, error: '没有已批准的 Pull Request' },
        { status: 400 }
      );
    }

    // Convert new pull requests to Rime format (incremental changes)
    const newDictFiles = convertToRimeDicts(allPullRequests);

    // Fetch existing files from GitHub and merge
    console.log('[Prepare] Fetching existing files from GitHub...');
    const githubService = createGithubSyncService();
    const baseBranch = process.env.GITHUB_BASE_BRANCH || 'master';
    const mergedDictFiles = new Map<string, string>();

    for (const [fileName, newContent] of newDictFiles.entries()) {
      const filePath = `rime/${fileName}`;

      try {
        // Try to get existing file from GitHub
        const existingContent = await githubService.getFileContent(baseBranch, filePath);

        if (existingContent) {
          console.log(`[Prepare] Merging with existing file: ${fileName}`);

          // Parse existing and new entries
          const existingEntries = parseRimeYaml(existingContent);
          const newEntries = parseRimeYaml(newContent);

          // Merge entries
          const mergedEntries = mergeRimeEntries(existingEntries, newEntries);

          // Extract dict metadata from new content (version, name, etc.)
          const lines = newContent.split('\n');
          let dictName = fileName.replace('.dict.yaml', '');
          let dictVersion = new Date().toISOString().split('T')[0].replace(/-/g, '.');

          for (const line of lines) {
            if (line.startsWith('name:')) {
              dictName = line.split(':')[1].trim();
            } else if (line.startsWith('version:')) {
              dictVersion = line.split(':')[1].trim().replace(/"/g, '');
            }
          }

          // Generate merged YAML
          const mergedDict: RimeDict = {
            name: dictName,
            version: dictVersion,
            sort: 'by_weight',
            entries: mergedEntries,
          };

          const mergedContent = generateRimeYaml(mergedDict);
          mergedDictFiles.set(fileName, mergedContent);

          console.log(`[Prepare] Merged ${fileName}: ${existingEntries.length} existing + ${newEntries.length} new = ${mergedEntries.length} total entries`);
        } else {
          // File doesn't exist on GitHub, use new content as-is
          console.log(`[Prepare] New file: ${fileName}`);
          mergedDictFiles.set(fileName, newContent);
        }
      } catch (error) {
        console.error(`[Prepare] Error processing ${fileName}:`, error);
        // Fallback to new content if merge fails
        mergedDictFiles.set(fileName, newContent);
      }
    }

    const fileNames = Array.from(mergedDictFiles.keys());

    // Generate sync summary
    const summary = generateSyncSummary(allPullRequests, batches);

    // Create task
    const task = await prisma.syncTask.create({
      data: {
        status: SyncTaskStatus.Pending,
        totalItems: allPullRequests.length,
        batches: {
          connect: batches.map((batch) => ({ id: batch.id })),
        },
      },
    });

    console.log(`[Prepare] Task ${task.id} created with ${fileNames.length} files`);

    // Prepare file data for frontend
    const files = fileNames.map((fileName) => ({
      name: fileName,
      content: mergedDictFiles.get(fileName)!,
    }));

    return NextResponse.json({
      success: true,
      taskId: task.id,
      files,
      summary,
      totalFiles: files.length,
      batchSize: 5,
    });
  } catch (error) {
    console.error('[Prepare] Error:', error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : '准备同步任务失败',
      },
      { status: 500 }
    );
  }
}
