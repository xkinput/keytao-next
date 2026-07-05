import { expect, test } from '@playwright/test'
import { cleanupE2EData, seedE2EFeatureData, suppressIntroModal, type E2ESeedData } from './helpers/e2e-data'

test.describe('公开功能 e2e 覆盖', () => {
  let seed: E2ESeedData

  test.beforeAll(async () => {
    seed = await seedE2EFeatureData()
  })

  test.afterAll(async () => {
    await cleanupE2EData()
  })

  test.beforeEach(async ({ page }) => {
    await suppressIntroModal(page)
  })

  test('公开页面: 首页改词列表可以渲染并显示批次数据', async ({ page }) => {
    const response = await page.goto('/')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '改词' })).toBeVisible()
    await expect(page.getByText(seed.batchDescription)).toBeVisible()
  })

  test('公开页面: 讨论列表可以渲染并显示公开讨论', async ({ page }) => {
    const response = await page.goto('/issues')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '讨论' })).toBeVisible()
    await expect(page.getByText(seed.issueTitle)).toBeVisible()
  })

  test('公开页面: 修改提议列表可以渲染并显示提议词', async ({ page }) => {
    const response = await page.goto('/pull-requests')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '修改提议' })).toBeVisible()
    await expect(page.getByText(seed.pullRequestWord)).toBeVisible()
  })

  test('公开页面: 词库管理可以渲染并搜索公开词条', async ({ page }) => {
    const response = await page.goto('/phrases')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '词库管理' })).toBeVisible()
    await page.getByPlaceholder('搜索词条或编码...').fill(seed.phraseWord)
    await expect(page.getByText(seed.phraseWord)).toBeVisible()
    await expect(page.getByText(seed.phraseCode)).toBeVisible()
  })

  test('公开页面: GitHub 同步历史可以匿名访问', async ({ page }) => {
    const response = await page.goto('/sync')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'GitHub 同步管理' })).toBeVisible()
    await expect(page.getByText('同步历史')).toBeVisible()
    await expect(page.getByText('已完成').first()).toBeVisible()
  })

  test('公开页面: 赞助页可以渲染并显示公开赞助者', async ({ page }) => {
    const response = await page.goto('/sponsor')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '赞助键道项目开发' })).toBeVisible()
    await expect(page.getByText(seed.sponsorName)).toBeVisible()
  })

  test('公开页面: 安装页可以渲染关键安装入口', async ({ page }) => {
    const response = await page.goto('/install')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'KeyTao 输入法方案安装' })).toBeVisible()
    await expect(page.getByText('下载安装程序')).toBeVisible()
  })

  test('公开页面: 练习页可以渲染输入练习工作台', async ({ page }) => {
    const response = await page.goto('/practice')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: '键道练习' })).toBeVisible()
    await expect(page.getByLabel('键道练习输入区')).toBeVisible()
  })

  test('公开页面: 关于页可以渲染项目信息', async ({ page }) => {
    const response = await page.goto('/about')
    expect(response?.status()).toBeLessThan(400)
    await expect(page.getByRole('heading', { name: 'KeyTao 键道词库管理系统' })).toBeVisible()
    await expect(page.getByText('本站功能')).toBeVisible()
  })

  test('公开页面: 登录与注册页可以渲染表单', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByText('登录到你的账号')).toBeVisible()
    await expect(page.getByLabel('用户名 *')).toBeVisible()
    await expect(page.getByLabel('密码 *')).toBeVisible()

    await page.goto('/register')
    await expect(page.getByText('创建新账号')).toBeVisible()
    await expect(page.getByLabel('确认密码 *')).toBeVisible()
    await expect(page.getByLabel('邮箱 *')).toBeVisible()
  })

  test('公开页面: 未登录访问用户功能会提示登录', async ({ page }) => {
    await page.goto('/user-dictionary')
    await expect(page.getByText(/请先登录|登录到你的账号/)).toBeVisible()

    await page.goto('/developer')
    await expect(page.getByText('请先登录')).toBeVisible()
    await expect(page.getByRole('button', { name: '前往登录' })).toBeVisible()
  })

  test('响应式导航: 移动端菜单可以打开核心入口', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await page.getByLabel('Toggle menu').click()
    const drawer = page.getByRole('dialog')
    await expect(drawer).toBeVisible()
    await expect(drawer.getByText('改词').first()).toBeVisible()
    await expect(drawer.getByRole('button', { name: '词库管理' })).toBeVisible()
    await expect(drawer.getByRole('button', { name: '键道练习' })).toBeVisible()
  })
})
