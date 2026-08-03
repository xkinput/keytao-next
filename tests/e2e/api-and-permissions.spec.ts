import { expect, test } from '@playwright/test'
import { apiKeyPrefix, hashApiKey } from '@/lib/apiKeyAuth'
import {
  apiKeyValue,
  authHeaders,
  cleanupE2EData,
  getE2EPrisma,
  seedE2EFeatureData,
  type E2ESeedData,
} from './helpers/e2e-data'

test.describe('API 与权限功能 e2e 覆盖', () => {
  let seed: E2ESeedData

  test.beforeEach(async () => {
    seed = await seedE2EFeatureData()
  })

  test.afterEach(async () => {
    await cleanupE2EData()
  })

  test.afterAll(async () => {
    const prisma = await getE2EPrisma()
    await prisma.$disconnect()
  })

  test('公开 API: 词库、批次、提议、讨论、同步、赞助接口返回可用数据', async ({ request }) => {
    const phrasesResponse = await request.get(`/api/phrases?search=${encodeURIComponent(seed.phraseWord)}`)
    expect(phrasesResponse.status()).toBe(200)
    const phrases = await phrasesResponse.json()
    expect(phrases.phrases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: seed.phraseWord, code: seed.phraseCode }),
      ]),
    )

    const batchesResponse = await request.get('/api/batches?page=1&pageSize=10')
    expect(batchesResponse.status()).toBe(200)
    const batches = await batchesResponse.json()
    expect(batches.batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ description: seed.batchDescription }),
      ]),
    )

    const pullRequestsResponse = await request.get('/api/pull-requests?page=1&pageSize=10')
    expect(pullRequestsResponse.status()).toBe(200)
    const pullRequests = await pullRequestsResponse.json()
    expect(pullRequests.pullRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: seed.pullRequestWord }),
      ]),
    )

    const issuesResponse = await request.get('/api/issues?page=1&pageSize=10')
    expect(issuesResponse.status()).toBe(200)
    const issues = await issuesResponse.json()
    expect(issues.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: seed.issueTitle }),
      ]),
    )

    const syncResponse = await request.get('/api/sync-to-github/tasks?page=1&pageSize=10')
    expect(syncResponse.status()).toBe(200)
    const sync = await syncResponse.json()
    expect(sync.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ message: seed.syncMessage, status: 'Completed' }),
      ]),
    )

    const sponsorsResponse = await request.get('/api/sponsors')
    expect(sponsorsResponse.status()).toBe(200)
    const sponsors = await sponsorsResponse.json()
    expect(sponsors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ displayName: seed.sponsorName, amount: 66 }),
      ]),
    )
  })

  test('权限边界: 未登录访问个人和管理接口会被拒绝', async ({ request }) => {
    const protectedEndpoints = [
      '/api/auth/me',
      '/api/developer/keys',
      '/api/user/dictionary',
      '/api/admin/stats',
    ]

    for (const endpoint of protectedEndpoints) {
      const response = await request.get(endpoint)
      expect(response.status(), endpoint).toBe(401)
      await expect(response.json()).resolves.toEqual(expect.objectContaining({ error: expect.any(String) }))
    }
  })

  test('管理权限: ROOT 管理员可以访问统计，普通用户会被 403 拒绝', async ({ request }) => {
    const normalResponse = await request.get('/api/admin/stats', {
      headers: authHeaders(seed.normalUser),
    })
    expect(normalResponse.status()).toBe(403)

    const rootResponse = await request.get('/api/admin/stats', {
      headers: authHeaders(seed.rootAdmin),
    })
    expect(rootResponse.status()).toBe(200)
    const stats = await rootResponse.json()
    expect(stats).toEqual(expect.objectContaining({
      totalPhrases: expect.any(Number),
      totalIssues: expect.any(Number),
      totalUsers: expect.any(Number),
      isRootAdmin: true,
    }))
  })

  test('开发者 API: 有效 API Key 可以调用 v1 词库查询接口', async ({ request }) => {
    const prisma = await getE2EPrisma()
    const key = apiKeyValue()
    await prisma.apiKey.create({
      data: {
        keyHash: hashApiKey(key),
        keyPrefix: apiKeyPrefix(key),
        name: 'E2E direct API key',
        userId: seed.owner.id,
      },
    })

    const response = await request.get(`/api/v1/phrases?search=${encodeURIComponent(seed.phraseWord)}`, {
      headers: { 'X-API-Key': key },
    })
    expect(response.status()).toBe(200)
    const body = await response.json()
    expect(body.phrases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ word: seed.phraseWord, code: seed.phraseCode }),
      ]),
    )
  })

  test('批次与提议 API: 登录用户可以创建批次并添加修改提议', async ({ request }) => {
    const batchResponse = await request.post('/api/batches', {
      headers: authHeaders(seed.normalUser),
      data: { description: 'E2E user-created batch' },
    })
    expect(batchResponse.status()).toBe(200)
    const batchBody = await batchResponse.json()
    expect(batchBody.batch).toEqual(expect.objectContaining({
      id: expect.any(String),
      description: 'E2E user-created batch',
      status: 'Draft',
    }))

    const pullRequestResponse = await request.post('/api/pull-requests', {
      headers: authHeaders(seed.normalUser),
      data: {
        batchId: batchBody.batch.id,
        action: 'Create',
        word: '端测 API 提议',
        code: `api${Date.now().toString(36).slice(-4)}`,
        type: 'Phrase',
        remark: 'created by e2e',
      },
    })
    expect(pullRequestResponse.status()).toBe(200)
    const pullRequestBody = await pullRequestResponse.json()
    expect(pullRequestBody.pullRequest).toEqual(expect.objectContaining({
      word: '端测 API 提议',
      action: 'Create',
      batchId: batchBody.batch.id,
    }))
  })

  test('讨论 API: 登录用户可以创建讨论并在公开列表查询到', async ({ request }) => {
    const title = `E2E created issue ${Date.now()}`
    const createResponse = await request.post('/api/issues', {
      headers: authHeaders(seed.normalUser),
      data: {
        title,
        content: 'This issue is created by Playwright e2e.',
      },
    })
    expect(createResponse.status()).toBe(200)

    const listResponse = await request.get('/api/issues?page=1&pageSize=20')
    expect(listResponse.status()).toBe(200)
    const listBody = await listResponse.json()
    expect(listBody.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title }),
      ]),
    )
  })
})
