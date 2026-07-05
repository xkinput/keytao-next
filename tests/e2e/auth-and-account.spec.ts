import { expect, test } from '@playwright/test'
import {
  authenticatePage,
  cleanupE2EData,
  createE2EUser,
  ensureE2ERoles,
  E2E_PREFIX,
  getE2EPrisma,
  suppressIntroModal,
} from './helpers/e2e-data'

test.describe('认证与账号功能 e2e 覆盖', () => {
  test.beforeEach(async () => {
    await cleanupE2EData()
    await ensureE2ERoles()
  })

  test.afterAll(async () => {
    await cleanupE2EData()
  })

  test('认证功能: 用户可以注册、退出并重新登录', async ({ page }) => {
    await suppressIntroModal(page)
    const suffix = Date.now()
    const username = `${E2E_PREFIX}_signup_${suffix}`
    const nickname = `E2E Signup ${suffix}`
    const email = `${E2E_PREFIX}_signup_${suffix}@example.com`
    const password = `Password_${suffix}!`

    await page.goto('/register')
    await page.getByLabel(/用户名/).fill(username)
    await page.getByLabel(/^密码/).fill(password)
    await page.getByLabel(/确认密码/).fill(password)
    await page.getByLabel(/昵称/).fill(nickname)
    await page.getByLabel(/邮箱/).fill(email)
    await page.getByRole('button', { name: '注册' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: nickname })).toBeVisible()

    await page.getByRole('button', { name: '退出登录' }).click()
    await expect(page.getByRole('button', { name: '登录' })).toBeVisible()

    await page.getByRole('button', { name: '登录' }).click()
    await page.getByLabel(/用户名/).fill(username)
    await page.getByLabel(/密码/).fill(password)
    await page.locator('form').getByRole('button', { name: '登录' }).click()

    await expect(page).toHaveURL(/\/$/)
    await expect(page.getByRole('button', { name: nickname })).toBeVisible()
  })

  test('账号功能: 登录用户可以查看资料、统计和改密入口', async ({ page }) => {
    const user = await createE2EUser({ role: 'normal' })
    await authenticatePage(page, user)

    await page.goto('/profile')
    await expect(page.getByRole('heading', { name: '我的资料' })).toBeVisible()
    await expect(page.getByText(user.name, { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: '账户信息' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '数据统计' })).toBeVisible()
    await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible()
  })

  test('个人词库功能: 登录用户可以新增、编辑、删除用户词条', async ({ page }) => {
    const user = await createE2EUser({ role: 'normal' })
    await authenticatePage(page, user)

    await page.goto('/user-dictionary')
    await expect(page.getByRole('heading', { name: '我的词库' })).toBeVisible()

    await page.getByRole('textbox', { name: /^词/ }).fill('端到端词')
    await page.getByRole('textbox', { name: /编码/ }).fill('edcd')
    await page.getByRole('textbox', { name: /备注/ }).fill('created by e2e')
    await page.getByRole('button', { name: '加入我的词库' }).click()
    const createdRow = page.getByRole('row').filter({ hasText: '端到端词' })
    await expect(createdRow).toBeVisible()
    await expect(createdRow.getByText('edcd')).toBeVisible()

    await createdRow.getByRole('button', { name: '编辑' }).click()
    await page.getByRole('textbox', { name: /编码/ }).fill('edce')
    await page.getByRole('button', { name: '保存修改' }).click()
    const updatedRow = page.getByRole('row').filter({ hasText: '端到端词' })
    await expect(updatedRow.getByText('edce')).toBeVisible()

    await updatedRow.getByRole('button', { name: '删除' }).click()
    await expect(page.getByRole('row').filter({ hasText: '端到端词' })).toHaveCount(0)
    await expect(page.getByText('暂无用户词条')).toBeVisible()
  })

  test('开发者功能: 登录用户可以创建并删除 API Key', async ({ page }) => {
    const user = await createE2EUser({ role: 'normal' })
    await authenticatePage(page, user)

    const keyName = `E2E Key ${Date.now()}`

    await page.goto('/developer')
    await expect(page.getByRole('heading', { name: '开发者 API' })).toBeVisible()
    await page.getByRole('button', { name: '新建' }).click()
    await expect(page.getByText('新建 API Key')).toBeVisible()
    await page.getByLabel(/名称/).fill(keyName)
    await page.getByRole('button', { name: '创建' }).click()

    await expect(page.getByText(keyName)).toBeVisible()
    await expect(page.getByText(/^kt_/)).toBeVisible()

    await page.getByRole('button', { name: `删除 ${keyName}` }).click()
    await expect(page.getByText(keyName)).toHaveCount(0)
    await expect(page.getByText('暂无 API Key，点击新建开始使用')).toBeVisible()
  })

  test('批次功能: 登录用户可以从首页新建批次并进入详情页', async ({ page }) => {
    const user = await createE2EUser({ role: 'normal' })
    await authenticatePage(page, user)

    await page.goto('/')
    await page.getByRole('button', { name: '新建' }).click()

    await expect(page).toHaveURL(/\/batch\/[0-9a-f-]+/)
    await expect(page.getByText(/修改批次|批次/).first()).toBeVisible()
  })

  test('批次功能: 编辑草稿修改提议时词条输入保持可见', async ({ page }) => {
    const user = await createE2EUser({ role: 'normal' })
    const prisma = await getE2EPrisma()
    const suffix = Date.now().toString(36)
    const batch = await prisma.batch.create({
      data: {
        description: `${E2E_PREFIX} draft modal layout ${suffix}`,
        status: 'Draft',
        creatorId: user.id,
      },
    })
    await prisma.pullRequest.create({
      data: {
        action: 'Change',
        word: '端测新词',
        oldWord: '端测旧词',
        code: `e${suffix.slice(-5)}`,
        type: 'Phrase',
        weight: 100,
        userId: user.id,
        batchId: batch.id,
      },
    })
    await authenticatePage(page, user)
    await page.setViewportSize({ width: 1280, height: 720 })

    await page.goto(`/batch/${batch.id}`)
    await page.getByRole('button', { name: '编辑修改' }).click()

    const dialog = page.getByRole('dialog').filter({ hasText: '编辑修改提议' })
    await expect(dialog).toBeVisible()

    const expectFieldInViewport = async (label: RegExp, minWidth = 80) => {
      const field = dialog.getByLabel(label)
      await expect(field).toBeVisible()
      const box = await field.boundingBox()
      const viewport = page.viewportSize()
      expect(box, `${label} should have layout bounds`).not.toBeNull()
      expect(viewport, 'viewport should be available').not.toBeNull()
      expect(box!.width, `${label} should not be squeezed closed`).toBeGreaterThan(minWidth)
      expect(box!.x, `${label} should stay inside the viewport`).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width, `${label} should stay inside the viewport`).toBeLessThanOrEqual(viewport!.width)
    }

    await expectFieldInViewport(/旧词/)
    await expectFieldInViewport(/新词/)
    await expectFieldInViewport(/编码/)
    await expectFieldInViewport(/权重/, 48)
  })
})
