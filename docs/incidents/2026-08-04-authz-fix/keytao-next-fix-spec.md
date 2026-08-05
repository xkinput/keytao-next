# keytao-next 草稿批次指针修复规格（Workstream B）

## 必读背景（先完整读完再动手）

1. 调查报告第 5 论断部分：`scratchpad/keytao-bot-authz-findings-claude.md`
2. 交叉核验报告（第 5 条 + P1-1 测试影响，**以此为准**）：`scratchpad/keytao-bot-authz-verify-claude.md`
3. 事故简报（批次 785e0368 / ec511ac6 漂移经过）：`scratchpad/keytao-bot-authz-investigation-brief.md`

（scratchpad = /private/tmp/claude-501/-Users-rea-code-keytao-org/b793e2c6-2741-4246-a713-f813b130754a/scratchpad）

目标仓库：/Users/rea/code/keytao-org/keytao-next（干净工作区，改动落在工作区，**不要 commit、不要部署**）。
不要动 keytao-bot（另一个并行工作流的范围）。

## 事故机理（已核验属实）

`GET /api/bot/batches/latest-draft` 是 get-or-create——**纯读操作会创建空草稿批次**。
bot 的只读预览触发创建了空批次 ec511ac6；用户撤回提审使旧批次 785e0368 恢复为 Draft 后，
latest-draft 按 `createAt desc` 返回更新的空批次 ec511ac6，785e0368 里的词条「吃席」
从此对所有「当前草稿」读路径不可见。recall 路径的 `existingDraft` 查询带
`pullRequests:{some:{}}` 条件，所以空批次既不阻塞撤回、也不更新时间戳。

## 改动清单

### B1. 读路径不创建批次（P0 级语义修复）
- `GET /api/bot/batches/latest-draft` 改为纯读：无草稿时返回明确的「无草稿」响应（如 404 或 `{draft: null}`，
  与现有客户端约定兼容者优先；检查 keytao-bot 侧对该接口的调用方如何消费，选不破坏协议的形态）。
- 批次创建移到明确的写入口：首个写操作（添加词条等）时按需创建。找出所有依赖
  get-or-create 隐式创建的调用点并逐一适配。

### B2. 指针语义明确化
- latest-draft 的排序/选择语义修正，保证「恢复为 Draft 的批次不被后创建的空批次遮蔽」。
  推荐方向（自行评估选定并在报告中记录理由）：
  a) recall 恢复批次时 touch 其排序时间戳；或
  b) latest-draft 选择「最新**非空**草稿，全部为空则最新草稿」；或
  c) 排序改按 updatedAt。
  注意与 B1 组合后的行为一致性，避免出现两个「都算最新」的歧义。
- items 路由（无 batchId 时取最新）与 latest-draft 必须用同一选择逻辑，抽成共享函数。

### B3. 测试
- **同批改写** `app/api/security-guards.test.ts` 中 `allows bot token privileged draft access
  for bound platform users`（~253 行，272-274 断言 GET 会 prisma.batch.create）——该测试固化了
  旧的 get-or-create 语义，必须改为断言新语义（读不建）。
- 新增测试：① GET latest-draft 在无草稿时不创建批次；② 撤回恢复的批次不被空批次遮蔽
  （模拟本次事故序列：建批次 A 加词条 → 提审 → 只读触发（不应建批次）→ 撤回 A →
  latest-draft 必须返回 A 且含词条）；③ 首个写操作按需建批次。
- 跑仓库现有测试套件相关部分（至少 app/api 下与 batch/draft 相关的全部测试），报告通过数。

### B4. 存量数据修复方案（只设计，不执行）
- 针对线上已存在的影子空批次（如 ec511ac6 遮蔽 785e0368）给出安全清理方案：
  识别条件（Draft 状态、0 词条、无 PR 关联）、清理方式（删除或归档）、SQL/脚本草案。
  **不要连接生产库执行**，方案写进报告由负责人决定。

## 禁区

- 不 commit、不 push、不部署、不连生产数据库。
- 不改与 batch/draft 无关的接口语义。
- bot token 的权限边界（security-guards 其余测试）必须保持绿。

## 验收

1. 相关测试全绿 + 新增测试全绿，报告逐套通过数。
2. 改动摘要（文件 → 改动点 → 对应规格编号）写到 scratchpad/keytao-next-fix-summary-B.md，
   最终回复给要点。
3. 中途若因 API 中断被续跑，先 `git -C /Users/rea/code/keytao-org/keytao-next diff --stat` 审查半成品再继续，禁止盲目重写。
