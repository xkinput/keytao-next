import { prisma } from '@/lib/prisma'
import {
  convertPhrasesToRimeDicts,
  generateSyncSummary,
  generateSyncSummaryData,
  getAffectedPhraseTypesFromPullRequests,
} from '@/lib/services/rimeConverter'
import type { SyncSummaryData } from '@/lib/services/rimeConverter'
import { createGithubSyncService } from '@/lib/services/githubSync'
import { PhraseStatus, SyncTaskStatus } from '@prisma/client'

export const DEFAULT_GITHUB_AUTO_SYNC_THRESHOLD = 10

export interface GithubAutoSyncOptions {
  threshold?: number
}

export interface GithubAutoSyncResult {
  success: boolean
  triggered: boolean
  pendingSyncBatches: number
  taskId?: string
  prUrl?: string | null
  prNumber?: number | null
  branch?: string | null
  merged?: boolean
  mergeCommitSha?: string | null
  releaseTag?: string | null
  previousReleaseTag?: string | null
  releaseUrl?: string | null
  syncSummary?: SyncSummaryData
  noChanges?: boolean
  releasedFailedBatches?: number
  skippedReason?: string
  message: string
}

async function releaseFailedGithubSyncBatches(): Promise<number> {
  const failedTasks = await prisma.syncTask.findMany({
    where: {
      status: SyncTaskStatus.Failed,
      githubPrUrl: null,
      batches: {
        some: {
          status: 'Approved',
        },
      },
    },
    select: {
      id: true,
    },
  })
  const failedTaskIds = failedTasks.map((task) => task.id)
  if (failedTaskIds.length === 0) return 0

  const result = await prisma.batch.updateMany({
    where: {
      status: 'Approved',
      syncTaskId: {
        in: failedTaskIds,
      },
    },
    data: {
      syncTaskId: null,
    },
  })
  return result.count
}

export async function countPendingGithubSyncBatches(): Promise<number> {
  return prisma.batch.count({
    where: {
      status: 'Approved',
      syncTaskId: null,
    },
  })
}

export async function runGithubAutoSync(options: GithubAutoSyncOptions = {}): Promise<GithubAutoSyncResult> {
  const threshold = options.threshold ?? DEFAULT_GITHUB_AUTO_SYNC_THRESHOLD
  const releasedFailedBatches = await releaseFailedGithubSyncBatches()
  const pendingSyncBatches = await countPendingGithubSyncBatches()

  if (pendingSyncBatches <= threshold) {
    return {
      success: true,
      triggered: false,
      pendingSyncBatches,
      releasedFailedBatches,
      skippedReason: 'below_threshold',
      message: `待同步批次数量为 ${pendingSyncBatches}，未超过阈值 ${threshold}`,
    }
  }

  const runningTask = await prisma.syncTask.findFirst({
    where: {
      status: {
        in: [SyncTaskStatus.Pending, SyncTaskStatus.Running],
      },
    },
    select: {
      id: true,
      status: true,
      githubPrUrl: true,
    },
    orderBy: {
      createAt: 'desc',
    },
  })

  if (runningTask) {
    return {
      success: true,
      triggered: false,
      pendingSyncBatches,
      releasedFailedBatches,
      taskId: runningTask.id,
      prUrl: runningTask.githubPrUrl,
      skippedReason: 'sync_in_progress',
      message: `已有 GitHub 同步任务正在处理：${runningTask.id}`,
    }
  }

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
          email: true,
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
  })

  const allPullRequests = batches.flatMap((batch) => batch.pullRequests)
  const affectedTypes = getAffectedPhraseTypesFromPullRequests(allPullRequests)

  if (affectedTypes.length === 0) {
    return {
      success: false,
      triggered: false,
      pendingSyncBatches,
      releasedFailedBatches,
      skippedReason: 'no_affected_types',
      message: '没有识别到需要同步的词库类型',
    }
  }

  const phrases = await prisma.phrase.findMany({
    where: {
      status: PhraseStatus.Finish,
      type: { in: affectedTypes },
    },
    orderBy: [
      { type: 'asc' },
      { code: 'asc' },
      { weight: 'asc' },
    ],
  })

  if (phrases.length === 0) {
    return {
      success: false,
      triggered: false,
      pendingSyncBatches,
      releasedFailedBatches,
      skippedReason: 'no_finished_phrases',
      message: '词库中没有已完成的词条',
    }
  }

  const dictFiles = convertPhrasesToRimeDicts(phrases, undefined, {
    includeTypes: affectedTypes,
    includeEmptyTypes: true,
  })

  if (dictFiles.size === 0) {
    return {
      success: false,
      triggered: false,
      pendingSyncBatches,
      releasedFailedBatches,
      skippedReason: 'empty_dict_files',
      message: '生成词典文件失败',
    }
  }

  const githubService = createGithubSyncService()
  const candidateFiles = Array.from(dictFiles.entries()).map(([fileName, content]) => ({
    path: `rime/${fileName}`,
    content,
  }))
  const changedFiles = await githubService.filterChangedFiles(
    githubService.getBaseBranchName(),
    candidateFiles
  )

  if (changedFiles.length === 0) {
    return {
      success: true,
      triggered: false,
      pendingSyncBatches,
      releasedFailedBatches,
      noChanges: true,
      skippedReason: 'no_changed_files',
      message: '待同步批次没有生成新的词库文件变化',
    }
  }

  const fileNames = changedFiles.map((file) => file.path.replace(/^rime\//, ''))
  const summary = generateSyncSummary(allPullRequests, batches)
  const syncSummary = generateSyncSummaryData(allPullRequests, batches)

  const task = await prisma.syncTask.create({
    data: {
      status: SyncTaskStatus.Pending,
      totalItems: allPullRequests.length,
      pendingFiles: fileNames,
      processedFiles: [],
      batches: {
        connect: batches.map((batch) => ({ id: batch.id })),
      },
    },
    select: {
      id: true,
    },
  })

  let prUrl: string | null = null
  try {
    const branch = githubService.generateBranchName(task.id)
    await githubService.getOrCreateBranch(branch)

    await prisma.syncTask.update({
      where: { id: task.id },
      data: {
        status: SyncTaskStatus.Running,
        startedAt: new Date(),
        githubBranch: branch,
        progress: 10,
        message: '自动同步正在提交词库文件...',
      },
    })

    const coAuthors = new Map<string, string>()
    for (const batch of batches) {
      if (batch.creator.email) {
        const name = batch.creator.nickname || batch.creator.name || 'Anonymous'
        coAuthors.set(batch.creator.email, name)
      }
    }
    const trailers = Array.from(coAuthors.entries())
      .map(([email, name]) => `Co-authored-by: ${name} <${email}>`)
      .join('\n')
    const commitDate = new Date().toISOString().split('T')[0]
    const commitMessage = trailers
      ? `Update dictionaries - ${commitDate}\n\n${trailers}`
      : `Update dictionaries - ${commitDate}`

    await githubService.commitFiles(branch, changedFiles, commitMessage)

    await prisma.syncTask.update({
      where: { id: task.id },
      data: {
        progress: 90,
        message: `已提交 ${changedFiles.length}/${changedFiles.length} 个文件`,
        processedItems: allPullRequests.length,
        processedFiles: fileNames,
        pendingFiles: [],
      },
    })

    const pr = await githubService.createPullRequest(
      branch,
      `[自动同步] 词库更新 - ${new Date().toLocaleDateString('zh-CN')}`,
      summary
    )
    prUrl = pr.html_url

    await prisma.syncTask.update({
      where: { id: task.id },
      data: {
        progress: 95,
        message: `已创建 GitHub PR #${pr.number}，正在自动合并并发布 Release...`,
        githubPrUrl: pr.html_url,
        githubPrNumber: pr.number,
        processedItems: allPullRequests.length,
      },
    })

    const releaseDate = new Date().toISOString().split('T')[0]
    const mergeBody = `自动同步 KeyTao 词库。\n\nSync task: ${task.id}`
    const merge = await githubService.mergePullRequest(
      pr.number,
      `Update dictionaries - ${releaseDate}`,
      trailers ? `${mergeBody}\n\n${trailers}` : mergeBody
    )
    const { latestTag, nextTag } = await githubService.getNextReleaseTag('patch')
    const releaseBody = [
      `本次 Release 由喵喵自动同步词库后发布。`,
      '',
      `- 同步任务：${task.id}`,
      `- 合并 PR：${pr.html_url}`,
      `- 待同步批次：${pendingSyncBatches} 个`,
      `- 词条修改：${allPullRequests.length} 条`,
      `- 更新文件：${fileNames.join('、')}`,
      latestTag ? `- 上一个 Release：${latestTag}` : '- 上一个 Release：无',
      '',
      summary,
    ].join('\n')

    await githubService.createAndPushTag(
      nextTag,
      `Release ${nextTag}`,
      merge.mergeCommitSha
    )
    const release = await githubService.createReleaseForTag(
      nextTag,
      `KeyTao Dictionary ${nextTag}`,
      releaseBody
    )

    await prisma.syncTask.update({
      where: { id: task.id },
      data: {
        status: SyncTaskStatus.Completed,
        progress: 100,
        message: `自动同步完成，已发布 ${release.tagName}`,
        completedAt: new Date(),
        processedItems: allPullRequests.length,
      },
    })

    return {
      success: true,
      triggered: true,
      pendingSyncBatches,
      releasedFailedBatches,
      taskId: task.id,
      prUrl: pr.html_url,
      prNumber: pr.number,
      branch,
      merged: merge.merged,
      mergeCommitSha: merge.mergeCommitSha,
      previousReleaseTag: latestTag,
      releaseTag: release.tagName,
      releaseUrl: release.htmlUrl,
      syncSummary,
      message: `GitHub 词库自动同步完成，已发布 ${release.tagName}`,
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '自动同步失败'
    const shouldReleaseBatches = prUrl === null
    await prisma.$transaction([
      prisma.syncTask.update({
        where: { id: task.id },
        data: {
          status: SyncTaskStatus.Failed,
          message: shouldReleaseBatches
            ? '自动同步失败，已释放批次以便下次重试'
            : '自动同步失败，已创建 GitHub PR，请管理员检查后重试',
          error: errorMessage,
          completedAt: new Date(),
        },
      }),
      ...(shouldReleaseBatches
        ? [
            prisma.batch.updateMany({
              where: {
                syncTaskId: task.id,
              },
              data: {
                syncTaskId: null,
              },
            }),
          ]
        : []),
    ])
    throw error
  }
}
