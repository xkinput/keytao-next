# Github 词库同步功能

## 概述

该功能实现了将 KeyTao Next 数据库中已审核通过的词条自动同步到 Github 仓库 (xkinput/KeyTao)，按照 Rime 输入法的规范生成 YAML 格式的词库文件。

## 功能特性

✅ **自动转换**: 将数据库词条转换为 Rime YAML 格式  
✅ **按类型分文件**: 根据词条类型（单字、词组、短句等）生成不同的文件  
✅ **自动创建 PR**: 自动在 Github 创建 Pull Request  
✅ **进度追踪**: 实时查看同步进度和状态  
✅ **定时同步**: 每3天自动执行一次同步  
✅ **手动触发**: 管理员可随时手动触发同步

## 架构设计

```
数据库 (Batches + PullRequests)
    ↓
同步服务 (检测已审核批次)
    ↓
Rime转换器 (转换为YAML格式)
    ↓
Github API (创建分支、提交文件、创建PR)
    ↓
更新同步状态
```

## 文件命名规范

生成的文件按词条类型分类，命名格式为: `keytao.[类型].dict.yaml`

| 词条类型 | 文件名 | 说明 |
|---------|--------|------|
| Single | keytao.single.dict.yaml | 单字 |
| Phrase | keytao.phrase.dict.yaml | 词组 |
| Sentence | keytao.sentence.dict.yaml | 短句 |
| Symbol | keytao.symbol.dict.yaml | 符号 |
| Link | keytao.link.dict.yaml | 链接 |
| Poem | keytao.poem.dict.yaml | 诗句 |
| Supplement | keytao.supplement.dict.yaml | 补充 |
| Other | keytao.other.dict.yaml | 其他 |

所有文件都会放在目标仓库的 `rime/` 目录下。

## YAML 文件格式

```yaml
# Rime dictionary
# encoding: utf-8
---
name: keytao.phrase
version: "2026.02.13"
sort: by_weight
columns:
  - text
  - code
  - weight
...

词条1	code1	100
词条2	code2	90
词条3	code3	85
```

## 环境配置

### 1. Github 认证配置（推荐使用 GitHub App）

系统支持两种 Github 认证方式：

#### 方式一：GitHub App（**推荐**，适合组织使用）

**优势**:
- ✅ 独立于个人账号，人员变动不影响
- ✅ 细粒度权限控制，更安全
- ✅ API 速率限制更高
- ✅ 审计日志清晰

**配置步骤**:

1. **创建 GitHub App**
   - 访问: `https://github.com/organizations/xkinput/settings/apps`
   - 点击 "New GitHub App"
   - 填写基本信息:
     - App name: `KeyTao Bot`
     - Homepage URL: `https://github.com/xkinput/KeyTao`
     - Webhook: 取消勾选 "Active"

2. **设置权限**
   - Repository permissions:
     - **Contents**: `Read and write` (读写文件)
     - **Pull requests**: `Read and write` (创建PR)
     - **Metadata**: `Read-only` (自动勾选)

3. **生成私钥**
   - 在 App 页面底部点击 "Generate a private key"
   - 下载 `.pem` 文件并妥善保存

4. **安装 App**
   - 在 App 页面点击 "Install App"
   - 选择 xkinput 组织
   - 选择 `KeyTao` 仓库

5. **获取 Installation ID**
   - 安装后访问: `https://github.com/organizations/xkinput/settings/installations`
   - 点击你的 App，URL 中的数字就是 Installation ID
   - 或者访问: `https://api.github.com/orgs/xkinput/installation`

#### 方式二：Personal Access Token（传统方式）

**适合**: 个人开发、快速测试

**权限要求**:
- ✅ `repo` - 完整仓库访问权限
- ✅ `workflow` - 更新 Github Actions

**创建步骤**:
1. 访问 https://github.com/settings/tokens
2. 点击 "Generate new token (classic)"
3. 选择上述权限
4. 生成并复制 token

### 2. 环境变量设置

在 `.env` 文件中添加（选择一种认证方式）:

```bash
# ==== 方式一: GitHub App (推荐) ====
GITHUB_APP_ID="123456"
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz...
... (paste your complete .pem file content here) ...
-----END RSA PRIVATE KEY-----"
GITHUB_APP_INSTALLATION_ID="12345678"

# ==== 方式二: Personal Access Token (传统) ====
# GITHUB_TOKEN="ghp_xxxxxxxxxxxx"

# ==== 通用配置 ====
GITHUB_OWNER="xkinput"           # Github 组织/用户名
GITHUB_REPO="KeyTao"             # 仓库名
GITHUB_BASE_BRANCH="master"      # 基础分支

# Cron Secret (可选，用于保护定时任务端点)
CRON_SECRET="random-secret-string"
```

**私钥配置说明**:
- ✅ **推荐方式**: 直接使用真实换行符（如上所示）
- ✅ **也支持**: 使用 `\n` 转义符（如 `"-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----"`）
- 📝 **本地开发**: `.env` 文件中直接粘贴 `.pem` 文件完整内容
- ☁️ **Vercel/云平台**: 环境变量中直接粘贴完整私钥（平台会自动处理换行）
- 🔒 **安全提示**: 永远不要将 `.env` 文件提交到 Git

### 3. 数据库迁移

```bash
# 运行迁移创建 sync_tasks 表
pnpm run db:migrate
```

## 使用方法

### 手动触发同步

```bash
# API 调用
POST /api/admin/sync-to-github/trigger

# 返回
{
  "success": true,
  "taskId": "uuid-of-task",
  "message": "同步任务已创建并开始执行"
}
```

### 查询同步状态

```bash
# API 调用
GET /api/admin/sync-to-github/status/{taskId}

# 返回
{
  "success": true,
  "data": {
    "id": "task-uuid",
    "status": "Running",  // Pending | Running | Completed | Failed
    "progress": 70,       // 0-100
    "message": "创建分支和提交文件...",
    "totalItems": 150,
    "processedItems": 105,
    "githubPrUrl": "https://github.com/xkinput/KeyTao/pull/123",
    "batches": [...]
  }
}
```

### 列出所有同步任务

```bash
GET /api/admin/sync-to-github/tasks?page=1&pageSize=20
```

## 定时任务配置

系统已配置每3天自动同步一次，配置在 `vercel.json`:

```json
{
  "crons": [{
    "path": "/api/cron/sync-to-github",
    "schedule": "0 0 */3 * *"
  }]
}
```

**注意**: 
- Vercel 免费版不支持 Cron Jobs
- 需要 Pro 或 Enterprise 计划
- 可以使用外部定时任务服务（如 cron-job.org）调用 `/api/admin/sync-to-github/trigger`

## 工作流程

### 1. 系统自动流程

```
每3天自动触发
    ↓
查询 status=Approved 且未同步的批次
    ↓
创建 SyncTask (状态: Pending)
    ↓
异步执行同步逻辑
    ↓
状态更新: Running → Completed/Failed
```

### 2. 同步执行步骤

1. **加载数据** (进度 10%): 从数据库加载待同步的批次和 PR
2. **转换格式** (进度 30%): 将 PR 转换为 Rime YAML 格式
3. **生成说明** (进度 50%): 生成 PR 描述和统计信息
4. **连接 Github** (进度 60%): 初始化 Github API 客户端
5. **创建分支** (进度 70%): 创建新分支 `update-dict-YYYY-MM-DD`
6. **提交文件** (进度 80%): 提交所有词库文件到 `rime/` 目录
7. **创建 PR** (进度 90%): 在 Github 创建 Pull Request
8. **完成** (进度 100%): 更新任务状态为 Completed

### 3. Github PR 信息

**标题格式**: `[自动同步] 词库更新 - 2026年02月13日`

**描述内容**:
```markdown
## 词库同步更新

### 更新统计

- 总计: **150** 条词条

- **单字**: 新增 20, 修改 5
- **词组**: 新增 80, 修改 10, 删除 3
- **符号**: 新增 15
...

---

_此PR由KeyTao管理系统自动生成_
```

## 错误处理

### 常见错误及解决方案

| 错误信息 | 原因 | 解决方法 |
|---------|------|----------|
| `GITHUB_TOKEN environment variable is required` | 未配置 Github Token | 在 `.env` 中添加 `GITHUB_TOKEN` |
| `No batches to sync` | 没有已审核的批次 | 先审核批次使其状态为 Approved |
| `Failed to create branch` | 分支已存在或权限不足 | 检查 Token 权限，或手动删除同名分支 |
| `401 Unauthorized` | Token 无效或过期 | 重新生成 Github Token |

### 失败重试

如果同步任务失败:

1. 查看任务详情中的 `error` 字段了解原因
2. 修复问题后，可以重新触发同步
3. 系统会自动处理已存在的分支（更新而不是创建）

## 数据库模型

### SyncTask

```prisma
model SyncTask {
  id        String          @id @default(uuid())
  createAt  DateTime        @default(now())
  status    SyncTaskStatus  // Pending | Running | Completed | Failed
  progress  Int             // 0-100
  message   String?         // 当前步骤描述
  error     String?         // 错误信息
  
  githubPrUrl    String?    // PR URL
  githubPrNumber Int?       // PR 编号
  githubBranch   String?    // 分支名
  
  totalItems     Int        // 总词条数
  processedItems Int        // 已处理数
  
  batches Batch[]           // 关联的批次
}
```

## 监控和日志

- 所有同步操作都会记录在 `sync_tasks` 表中
- 可通过管理后台查看历史同步记录
- 每次同步都会生成详细的进度日志

## 安全考虑

1. **Github Token**: 
   - 使用 environment secret 存储
   - 不要提交到代码仓库
   - 定期轮换 Token

2. **Cron 端点保护**:
   - 使用 `CRON_SECRET` 保护定时任务端点
   - Vercel 会验证 Cron 请求来源

3. **权限控制**:
   - 只有管理员可以触发同步
   - 使用 `adminAuth` 中间件验证

## 未来扩展

- [ ] 支持增量同步（只同步变更部分）
- [ ] 添加同步预览功能
- [ ] 支持回滚同步
- [ ] 邮件通知同步结果
- [ ] 同步失败自动重试机制

## 相关文件

### 服务层
- `lib/services/rimeConverter.ts` - Rime 格式转换
- `lib/services/githubSync.ts` - Github API 封装
- `lib/services/syncService.ts` - 同步任务编排

### API 路由
- `app/api/admin/sync-to-github/trigger/route.ts` - 触发同步
- `app/api/admin/sync-to-github/status/[taskId]/route.ts` - 查询状态
- `app/api/admin/sync-to-github/tasks/route.ts` - 列出任务
- `app/api/cron/sync-to-github/route.ts` - 定时任务

### 配置文件
- `vercel.json` - Vercel Cron 配置
- `prisma/schema.prisma` - 数据库模型
