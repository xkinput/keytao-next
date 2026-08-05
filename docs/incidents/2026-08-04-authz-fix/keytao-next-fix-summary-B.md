# Workstream B 改动摘要（keytao-next 草稿批次指针修复）

仓库：`/Users/rea/code/keytao-org/keytao-next`
状态：改动全部落在工作区，**未 commit / 未 push / 未部署 / 未连任何数据库**。
基线：起始工作区干净（`git diff --stat` 空）。

---

## 1. 文件 → 改动点 → 规格编号

| 文件 | 改动点 | 规格 |
|---|---|---|
| `lib/services/botDraftBatch.ts`（**新增**） | 「当前 bot 草稿批次」的唯一定义：`BOT_BATCH_DESCRIPTION_PREFIX` / `BOT_DRAFT_BATCH_DESCRIPTION` 常量、`botDraftBatchWhere(userId)`、`findCurrentBotDraftBatch(client, userId)`、`findCurrentBotDraftBatchId()`。选择规则：**有内容的草稿优先，全为空时取最新的空草稿**；函数本身永不创建任何东西 | B1 / B2 |
| `app/api/bot/batches/latest-draft/route.ts` | GET 由 get-or-create 改为**纯读**：删掉 `prisma.$transaction` + `lockBotDraftUser` + `tx.batch.create`，改调共享选择器；无草稿时返回 200 `{success:true, batchId:null, exists:false, pullRequestCount:0, contentVersion:0, isNew:false, message:'当前没有草稿批次'}`（`contentVersion:0` 见 §6.2） | B1 |
| `app/api/bot/batches/latest-draft/items/route.ts` | 无 `batchId` 时不再自己 `orderBy createAt desc`，改用 `findCurrentBotDraftBatchId` 解析出 id 再按 id 取详情；`description` 前缀改用共享常量；查询 select 提取为 `DRAFT_BATCH_SELECT satisfies Prisma.BatchSelect`，并由 `Prisma.BatchGetPayload` 派生 `DraftBatchSnapshot` / `DraftBatchItem`，两个 `pullRequests.map` 回调的 `pr` 显式标注类型（消除 IDE 语言服务器报的 TS7006 隐式 any；`tsc --noEmit` 全量与增量均无此报错） | B2 |
| `app/api/bot/pull-requests/batch-draft/route.ts` | 无 `batchId` 分支的隐式解析改用同一个共享选择器（否则读路径改了、写路径仍按 createAt desc，二者会指向不同批次）；创建仍只发生在**确认写入**时（`batchIsVirtual` → 事务内 `tx.batch.create`）；描述文案改用共享常量 | B1 / B2 |
| `app/api/bot/batches/recall/route.ts` | `description` 前缀改用共享常量；补注释说明「只有含内容的草稿才阻塞撤回」在新选择规则下的正确性 | B2（一致性） |
| `lib/services/batchContentGuard.ts` | `assertNoOtherBotDraftWithContent` 的前缀改用共享常量（行为不变） | B2（一致性） |
| `app/api/security-guards.test.ts` | 改写 `allows bot token privileged draft access…`：删掉「GET 会 `prisma.batch.create`」断言，改为断言**读不建**（`batch.create` 未被调用 + 响应 `batchId:null, exists:false`），并保留「查询仍绑定到平台用户 `creatorId:2`」这一权限断言 | B3 |
| `app/api/bot/batches/latest-draft/route.test.ts`（**新增**，4 例） | ① 无草稿时报「无草稿」且不创建；② 有内容的旧批次不被更新的空批次遮蔽；③ 全空时回退到最新草稿；④ 未授权时不碰数据库 | B3 ① |
| `app/api/bot/batches/latest-draft/draft-pointer.test.ts`（**新增**，3 例） | 用内存假 prisma 跑真实路由，复现事故序列：A 有词条并已提审 → 只读预览（mock 里任何读路径 `batch.create` 直接抛错）→ 撤回 A → `latest-draft` 与 `items` 都必须回到 A 且含「吃席」；另含「空批次 ec511ac6 存在时同样不遮蔽」与「另一个含内容草稿仍然阻塞撤回」 | B3 ② |
| `app/api/bot/pull-requests/batch-draft-creation.test.ts`（**新增**，3 例） | 首个写操作按需建批次：预览只发放临时 batchId 且不写库 → 确认写入时才 `tx.batch.create` 出**同一个 id**，并写入词条；另断言隐式写入落到「有内容的草稿」而非更新的空草稿 | B3 ③ |
| `app/api/bot/batches/latest-draft/items/route.test.ts` | 新增 2 例：无 batchId 时走共享选择器（断言第 1 次查询带 `pullRequests:{some:{}}`、第 2 次按解析出的 id）；无草稿时返回空快照而不虚构批次 | B3 |
| `lib/services/botDraftBatch.test.ts`（**新增**，4 例） | 选择器契约单测：where 作用域、有内容优先（且不发第二次查询）、回退最新、无草稿返回 null | B3 |

---

## 2. B2 方案选择与理由

规格给了三个候选，选定 **(b) 「最新非空草稿，全部为空则最新草稿」**，理由：

1. **与已有不变量重合**：`assertNoOtherBotDraftWithContent`（`lib/services/batchContentGuard.ts`）已经强制「每用户至多一个含内容的 bot 草稿」。因此「含内容的草稿」在合法状态下**唯一**，不存在规格担心的「两个都算最新」的歧义；`createAt desc` 只作为历史脏数据下的确定性 tie-break。
2. **不依赖时间戳语义**：(a) recall 时 touch 时间戳只修复撤回这一条路径，任何其它「空批次后创建」的场景仍会遮蔽；(c) 改 `updateAt` 排序会让无关更新（reviewNote、syncTaskId 释放等）也改变指针，语义更脆弱。
3. **与 B1 组合后自洽**：B1 之后空批次只可能来自「确认写入创建后被删空」或历史脏数据，(b) 让这类批次永远排在含内容批次之后，事故不可能复现。
4. 撤回路径无需改动：`recall` 只有在**另一个含内容草稿**存在时才拒绝，与 (b) 的优先级完全一致。

---

## 3. 协议兼容性（为什么不是 404）

`keytao-bot` 的 `get_latest_draft_batch`（`keytao_bot/skills/keytao-draft/tools.py:802-852`）把 **404 映射成 `UserNotFoundError`**，会让用户看到「账号未绑定」这种完全错误的提示。因此选 **200 + `batchId: null`**，字段形状与原响应保持一致（另加 `exists` 布尔），bot 侧 `data.get("batchId")` 自然得到 `None`，和 `items` 路由既有的空响应约定一致。

### 需要 workstream A（keytao-bot）配套的改动 —— 本工作流未动 bot 一个字节

`get_latest_draft_batch` 返回 `None` 现在有了新含义「用户尚无草稿」（而不只是「调用失败」）。5 个调用点：

| 位置 | 现状 | 需要做什么 |
|---|---|---|
| `tools.py:1115`（`keytao_create_phrase` 添加词条） | `if not batch_id: return {"success": False, "message": "无法获取草稿批次，请稍后重试"}` | **必须改**：把 `batch_id=None` 透传下去。`/api/bot/pull-requests/batch` 在无 batchId 时会自行发放临时 id（`targetBatchId = … ?? randomUUID()`）并在确认时创建，无需先有批次 |
| `tools.py:3136`（批量添加） | 同上 | **必须改**，同理（`/api/bot/pull-requests/batch-draft` 也支持无 batchId 的 preview→confirm） |
| `tools.py:3500`（顺延 shift） | 同上 | **必须改**，同理 |
| `tools.py:1717`（`keytao_submit_batch`） | `"没有找到待提交的草稿批次"` | **不用改**，且是修复：旧行为会先 get-or-create 出一个空批次再去提交它（核验报告「次要补充」列过这条） |
| `tools.py:2022`（`keytao_get_batch_preview`） | `"没有找到草稿批次"` | **不用改**，这正是事故触发点，现在纯读不再建批次 |

另外两处（供 workstream A 参考，均在 bot 侧）：
- `keytao_bot/utils/word_discovery.py:1657`：依赖 latest-draft 隐式建批次，现在会得到空 batchId 并以「未获得合法的草稿批次编号」失败。**注意它本来就是坏的**——紧接着的 `POST /batch-draft` 带 `confirmed: True` 但不带 `expectedContentVersion`/`expectedWarningDigest`，服务端一定回 400「确认写入必须包含版本和 warning digest」。这条链路需要按 preview→confirm 重写，与本次改动无关但同批暴露。
- `_fetch_draft_snapshot`（`tools.py:855`）与 `openai_chat.py:5916` 仍然不带 `batch_id` 地读「当前草稿」；服务端现在的选择规则已经能给出正确批次，但显式传 batch_id 仍是 P1-2 的正解。

---

## 4. 测试结果

命令：`npx vitest run --config vitest.unit.config.ts`（纯单测配置：不连数据库、不加载 dotenv）

- **全量单测：51 个文件 / 521 个用例，全部通过**（新增 21 个用例已计入；含第 6 节评审跟进的 8 个）
- 与 batch/draft 相关的子集 `app/api/bot`：**10 个文件 / 38 个用例通过**
  - `latest-draft/route.test.ts` 4、`latest-draft/draft-pointer.test.ts` 3、`latest-draft/items/route.test.ts` 4、`pull-requests/batch-draft-creation.test.ts` 7、`pull-requests/unconfirmed-preview.test.ts` 4、`batches/recall/route.test.ts`、`batches/auto-approve*.test.ts`、`batches/submit-content-version.test.ts`、`bot/chat/route.test.ts` 其余全绿
- `app/api/security-guards.test.ts`：**32 个用例全绿**，bot token 权限边界的其余断言（未授权不查库、平台身份必须配 bot token、越权批次 403 等）保持原样通过
- `npx tsc --noEmit` 无错误；`npx eslint`（改动涉及的全部文件）无告警

### ⚠️ 未跑、且**不建议在本机跑**的部分

`pnpm test`（`vitest.config.ts`）会加载 `.env.test` → 回退 `.env`，而本仓库**没有 `.env.test`**，`.env` 的 `DATABASE_URL` 指向本机开发库 `postgresql://…@localhost:5432/keytao`。`lib/test/setup.ts` 会在 `afterEach` 对 `batches / pull_requests / phrases / issues …` 执行 `TRUNCATE … CASCADE`。**在没有 `.env.test` 的情况下跑 `pnpm test` 会清空开发库**，因此本次一律使用 `pnpm test:unit` 路径。被排除的 4 个 DB 依赖测试（`submit-and-approve`、`check-conflicts-batch` ×2、`batchApprovalTransaction`）均不触碰 bot 草稿指针逻辑。

---

## 5. B4：存量影子空批次清理方案（**仅设计，未执行，未连库**）

### 5.1 识别条件

一个批次属于「影子空草稿」当且仅当：

1. `status = 'Draft'`
2. `description LIKE '键道助手%'`（bot 命名空间；web 端批次不在此列）
3. **无任何 PR**：`NOT EXISTS (SELECT 1 FROM pull_requests pr WHERE pr."batchId" = b.id)`
4. `contentVersion = 0`（从未被写入认领过；`> 0` 的空草稿说明曾有内容后被删空，单独人工确认）
5. `"createAt" < now() - interval '1 day'` 且 `"updateAt" < now() - interval '1 day'`（避开任何在途的 preview→confirm 流程）

外键安全：`pull_requests.batchId` 是 `ON DELETE CASCADE`，且条件 3 保证没有子行；`issueId` / `syncTaskId` / `reviewerId` 都是 batch **指向别人**的可空外键，删除批次不产生孤儿。

### 5.2 步骤（两阶段，先可逆后不可逆）

**Step 0 — 盘点（只读）**

```sql
SELECT b.id, b."creatorId", b."createAt", b."contentVersion", b.description
FROM batches b
WHERE b.status = 'Draft'
  AND b.description LIKE '键道助手%'
  AND NOT EXISTS (SELECT 1 FROM pull_requests pr WHERE pr."batchId" = b.id)
ORDER BY b."creatorId", b."createAt";
```

**Step 0.1 — 每用户不变量体检（只读）**：确认清理后每个受影响用户至多剩一个含内容草稿。

```sql
SELECT "creatorId",
       count(*) FILTER (WHERE pr_count = 0) AS empty_drafts,
       count(*) FILTER (WHERE pr_count > 0) AS drafts_with_content
FROM (
  SELECT b.*, (SELECT count(*) FROM pull_requests pr WHERE pr."batchId" = b.id) AS pr_count
  FROM batches b
  WHERE b.status = 'Draft' AND b.description LIKE '键道助手%'
) b
GROUP BY "creatorId"
HAVING count(*) FILTER (WHERE pr_count = 0) > 0;
```

**Step 0.2 — 本次事故当事批次单独核对（只读）**（简报里的 id 是前 8 位，用前缀匹配）

```sql
SELECT b.id, b.status, b."createAt", b."contentVersion",
       (SELECT count(*) FROM pull_requests pr WHERE pr."batchId" = b.id) AS items
FROM batches b
WHERE b.id LIKE '785e0368%' OR b.id LIKE 'ec511ac6%';
```
期望：`785e0368…` = Draft 且 items ≥ 1（「吃席」在里面），`ec511ac6…` = Draft 且 items = 0。
**注意**：B2 上线后 `785e0368` 已经重新赢得指针，用户能看到「吃席」，所以本清理是卫生工作而非救火；若核对结果与期望不符，先停手报告。

**Step 1 — 归档（可逆，推荐先做并观察 3~7 天）**
把 description 前缀改掉即可让它从**所有** bot 指针查询里消失（每一处查询都带 `description LIKE '键道助手%'`），而 web 端批次列表本就用 `pullRequests: { some: {} }` 过滤空批次，不会因此多出可见条目。

```sql
BEGIN;
LOCK TABLE batches IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE pull_requests IN SHARE ROW EXCLUSIVE MODE;

UPDATE batches b
SET description = '已归档空草稿（原：' || COALESCE(b.description, '') || '）'
WHERE b.status = 'Draft'
  AND b.description LIKE '键道助手%'
  AND b."contentVersion" = 0
  AND b."createAt" < now() - interval '1 day'
  AND b."updateAt" < now() - interval '1 day'
  AND NOT EXISTS (SELECT 1 FROM pull_requests pr WHERE pr."batchId" = b.id);

-- 核对影响行数与 Step 0 盘点一致后再 COMMIT，否则 ROLLBACK
COMMIT;
```

**Step 2 — 删除（不可逆，观察期无异常后执行）**

```sql
BEGIN;
LOCK TABLE batches IN SHARE ROW EXCLUSIVE MODE;

DELETE FROM batches b
WHERE b.status = 'Draft'
  AND b.description LIKE '已归档空草稿（原：键道助手%'
  AND NOT EXISTS (SELECT 1 FROM pull_requests pr WHERE pr."batchId" = b.id);

COMMIT;
```

### 5.3 脚本形态（若走 tsx 而非裸 SQL）

建议落成 `scripts/cleanupEmptyBotDrafts.ts`（本次**未创建**），要点：

- 默认 `--dry-run`，只有显式 `--apply` 才写；`--user <id>` 可限定单用户。
- 每个用户一个事务，事务内先取与写路径同一把锁：`SELECT pg_advisory_xact_lock(0x4b54, $userId)`（对齐 `lockBotDraftUser`），再 `LOCK TABLE batches IN SHARE ROW EXCLUSIVE MODE`——这样不会和正在把临时批次落库的确认写入抢跑。
- **锁内复查**空批次条件后再改，避免 TOCTOU。
- 输出逐条 `batchId / creatorId / createAt / 动作`，便于留档。

### 5.4 残余风险

唯一的理论竞态：某客户端已经用批次 X 做过 preview（拿到 `contentVersion=0` 的票据），我们在它 confirm 之前归档了 X，则 confirm 会写进「已归档」命名的批次，从而对 bot 不可见。`> 1 天` 的时间窗 + 通告锁已使其实际不可能；若要零风险，可在 Step 1 前把 bot 写接口短暂置为只读，或干脆只做 Step 0 盘点、把删除推迟到下一个维护窗口。

---

## 6. 评审跟进（round 2：note-13 + minor-8 前置）

### 6.1 note-13：`/api/bot/pull-requests/batch` 接入共享选择器

`app/api/bot/pull-requests/batch/route.ts`：无 `batchId` 时不再直接 `randomUUID()` 建新批次，先走
`findCurrentBotDraftBatch` 解析「当前草稿」并构造 `existingBatchSnapshot`（`creatorId` / `status:'Draft'`
由选择器保证）。连带效果：重复条目检测从「只在显式传 batchId 时执行」扩展到隐式解析出的批次
（`where.batchId` 用解析结果而不是请求参数），与 `batch-draft` 路由行为一致。至此三条读写路径
（`latest-draft`、`latest-draft/items`、两个写接口）全部共用同一个选择器。

### 6.2 minor-8 前置：「完全无草稿」时的 CAS 语义（设计 + 实现）

**问题**：顺延在 plan 阶段需要一个 `(batchId, contentVersion)` 作为 CAS 基线并算进 `planDigest`，
B1 之后无草稿时读接口返回 `batchId: null` → bot 硬失败。影响面是「草稿全部提审之后」的常态。

**为什么不能简单地让读接口发一个临时 batchId**（两个被否掉的方案）：

- **随机临时 id**：preview 与 confirm 是两次独立读，每次随机 id 都不同 → bot 的 `planDigest`
  在确认时必然对不上（`batch_id != current_batch_id` → 永远 stale）。而且服务端的 `warningDigest`
  把 `warningState.targetBatchId` 算进哈希（`lib/services/botWarningSnapshot.ts:76`），随机 id
  同样让 digest 不可复现。
- **按用户确定性派生的 id（uuid5(userId)）**：稳定，但一旦该批次被提审变成 `Submitted`，
  此后该用户永远拿到同一个 id → 写接口一直回「只能写入草稿状态的批次」，**永久卡死**。

**采用的语义（CAS on absence）**：把「这个用户当前没有草稿」本身作为可比较的基线。

1. **读接口给出基线**：`GET /latest-draft` 与 `GET /latest-draft/items` 在无草稿时返回
   `batchId: null` + **`contentVersion: 0`**（原先是 `null`）+ `exists: false`。
   `0` 正是新批次创建时的初始版本，也是首次写入必须提交的版本。
2. **写接口接受该基线**：`POST /api/bot/pull-requests/batch-draft` 原先「给了
   `expectedContentVersion` 就必须同时给 `batchId`」放宽为 **`expectedContentVersion: 0` 可以不带
   `batchId`**，含义是「我预期此用户没有任何草稿，请创建第一个」。其它版本号仍然必须配 `batchId`。
   `/pull-requests/batch` 本来就允许 `confirmed + 无 batchId + expectedContentVersion: 0`。
3. **哈希身份稳定**：新增常量 `NEW_BOT_DRAFT_BATCH_IDENTITY = 'new-bot-draft-batch'`
   （`lib/services/botDraftBatch.ts`）。两个写接口在「目标批次尚不存在」时一律用它当
   `warningState.targetBatchId`，于是 preview 与 confirm 算出同一个 `warningDigest`——
   客户端**回传临时 id 或干脆不带 batchId 都可以**，票据都能对上。批次一旦真实存在，仍用真实 id。
4. **CAS 校验**：新增 `assertNoBotDraftBatch(tx, userId)`（`lib/services/batchContentGuard.ts`），
   在写事务内、`pg_advisory_xact_lock` 之后复查「仍然没有任何 bot 草稿」，否则抛
   `BatchContentLockedError('草稿批次已变化，请刷新后重试')`（409）。两个写接口的建批次分支都接上了。
   它比 `assertNoOtherBotDraftWithContent` 更严：**空草稿也算数**。

   **严格度按「解析时看到了什么」分档（两种请求形态不等价，实测确认）：**

   | 确认写的形态 | 解析阶段看到 | 结果 |
   |---|---|---|
   | **省略 `batchId`** + `expectedContentVersion: 0` | 没有任何草稿 | 走建批次分支；事务内 `assertNoBotDraftBatch` 复查，若期间有人建了草稿 → **409** |
   | **省略 `batchId`** + `expectedContentVersion: 0` | 已有一个 `contentVersion = 0` 的空草稿 | **不 409**，直接采纳并写进这个空草稿（版本号比对通过，不建新批次） |
   | **省略 `batchId`** + `expectedContentVersion: 0` | 已有草稿但 `contentVersion ≠ 0` | **409** `批次内容已被修改，请刷新后重试` |
   | **回传预览发放的临时 uuid** + `expectedContentVersion: 0` | 任何已存在的草稿（含空草稿） | **409** `草稿批次已变化，请刷新后重试`（该 uuid 查无此批次 → 必走建批次分支 → 撞 `assertNoBotDraftBatch`） |

   即：`assertNoBotDraftBatch` 只在**建批次分支**上生效；解析阶段已经看得见草稿时，比较的是
   **版本号**，而 `0` 恰好是空草稿的版本，所以省略 batchId 的形态会「顺手采纳空草稿」而不是报错。
   这是有意的宽松：bot 实际发的就是省略形态（`tools.py:3573` `**({"batchId": batch_id} if batch_id else {})`），
   顺手采纳空草稿避免了无谓失败，而并发首写仍然被事务内复查兜住，危害为零。
   另有一层兜底：`warningDigest` 把批次身份算进哈希，预览时是「尚不存在」（常量）而确认时变成真实
   批次 id 的话，digest 不匹配 → 409 `警告快照已变化，请重新确认`。所以「预览后才冒出草稿」
   这种真竞态在任何形态下都会被拦下，只是报错文案来自 digest 层。

**净效果**：无草稿时 bot 只需 preview + confirm 两步（确认后一次调用直接落库），
不必先造批次，也不会出现「读操作建批次」的老问题。

### 6.3 bot 侧适配所需的接口契约（转交并行工作流）

**读（`GET /api/bot/batches/latest-draft` 与 `/latest-draft/items`）**

```jsonc
// 有草稿
{ "success": true, "batchId": "<uuid>", "exists": true, "contentVersion": 7, "pullRequestCount": 3 }
// 无草稿  ← 新语义，不是错误
{ "success": true, "batchId": null,     "exists": false, "contentVersion": 0, "pullRequestCount": 0,
  "message": "当前没有草稿批次" }
```

- 无草稿是**合法状态**，不是失败，也不会再返回 404（404 仍然只表示「平台账号未绑定」）。
- 顺延的 plan 基线在无草稿时取 **`batchId = ""`、`contentVersion = 0`**，照常算进 `planDigest`；
  确认时重新读，只要仍然是 `("", 0)` 就判定未过期。

**写（顺延走 `POST /api/bot/pull-requests/batch`，即 strict 批量端点；
`POST /api/bot/pull-requests/batch-draft` 的宽松批量路径同样支持该契约）**

```jsonc
// 第 1 步 预览：不带 batchId、不带 expectedContentVersion、confirmed 省略/false
{ "platform": "qq", "platformId": "...", "items": [...] }
// → /batch 返回 HTTP 200: { success: false, requiresConfirmation: true, batchId: "<临时 uuid>",
//                          contentVersion: 0, warningDigest: "<64 hex>", warnings: [...] }
//   （/batch-draft 的同一步返回 HTTP 400，字段相同——两条端点状态码不同，是既有约定）

// 第 2 步 确认：一次调用完成，batchId 省略（推荐，bot 现在就是这么发的）
{ "platform": "qq", "platformId": "...", "items": [...],
  "confirmed": true, "expectedContentVersion": 0, "expectedWarningDigest": "<上一步的 digest>" }
// → 200: { success: true, batchId: "<真实落库的批次 id>", contentVersion: 1, pullRequestCount: n }
```

- `expectedContentVersion: 0` + 无 `batchId` = 「我的计划基于『没有草稿』」。严格度见 §6.2 的分档表：
  期间冒出草稿 → 409（建批次分支被 `assertNoBotDraftBatch` 拦下，或 digest 层的
  `警告快照已变化，请重新确认`）；而**解析时就已经存在的 `contentVersion = 0` 空草稿会被直接采纳**，
  写进它而不是报错。收到 409 一律重读基线、重出计划，**不要重试原请求**。
- 回传预览发放的临时 uuid 也能对上票据（digest 身份相同），但语义更严：任何已存在的草稿都会 409。
  推荐省略 `batchId`。
- `expectedContentVersion` 为非 0 时仍然必须带 `batchId`（未放宽）。
- 已有草稿的场景协议完全不变。

**bot 侧需要改的判断（keytao-draft/tools.py）**

（复核时 bot 工作区已按此适配，逐字段与服务端一致：`_keytao_strict_batch_add_to_draft`
在 `batch_id` 为空时整个省略 `batchId` 键、只发 `expectedContentVersion`，且在已持有基线时
不再重新解析批次。以下留作契约备忘。）

| 位置 | 要点 |
|---|---|
| `keytao_shift_phrase_code` 的基线判定 | 允许 `batchId` 为空 + `contentVersion == 0`；digest payload 用 `{"batchId": "", "contentVersion": 0, ...}` |
| `keytao_shift_phrase_code` 的写调用 | 无草稿时 `batch_id=None`（JSON 省略该键）+ `expected_content_version=0` |
| `_keytao_strict_batch_add_to_draft` | 已有基线（`expected_content_version is not None`）时**不得**再调 `get_latest_draft_batch` 重新解析，否则会悄悄采纳计划之后才出现的批次，架空服务端 CAS |
| `tools.py:1115 / 3136 / 3500` | 拿到 `None` 就早退 → 改为透传 `None`（第 3 节已列） |

### 6.4 本轮新增/修改的测试（共 8 例，全绿）

- `app/api/bot/pull-requests/batch-draft-creation.test.ts` +4：无 batchId 的确认写入按 CAS 落库并调用
  `assertNoBotDraftBatch`；preview 与 confirm 的 `warningState.targetBatchId` 同为
  `new-bot-draft-batch`；期间冒出草稿 → 409 且不建批次；非 0 版本号无 batchId 仍 400
- `app/api/bot/pull-requests/unconfirmed-preview.test.ts` +2：无 batchId 时走共享选择器（断言查询带
  `pullRequests:{some:{}}`、返回该批次的 id 与版本、不按 id 查）；无草稿时哈希身份为常量
- `lib/services/batchContentGuard.test.ts` +2：`assertNoBotDraftBatch` 通过 / 遇到空草稿也失败
- `app/api/bot/batches/latest-draft/route.test.ts` 改 1 处断言：无草稿时 `contentVersion` 由 `null` 改 `0`

复跑结果：`vitest --config vitest.unit.config.ts` **51 文件 / 521 用例全绿**；
`tsc --noEmit --incremental false` 0 错误；`eslint`（lib/services + app/api/bot + security-guards）0 告警。
仍未 commit / push / 部署 / 连库。

### 6.5 遗留（P2，未实现）

**双侧握手没有 HTTP 层集成测试覆盖**：keytao-next 侧用 mock 的 prisma 跑真实路由，
keytao-bot 侧用 stub 的 HTTP 客户端跑真实工具函数，**两侧各自 mock 对方**。
因此「预览 → 用户确认 → 一次落库」这条跨仓握手（尤其是 §6.2 的分档严格度、
digest 身份在两次调用间的稳定性、409 后的重规划）目前只靠两边的契约文档对齐，
没有任何一条测试真的把 bot 的请求体发给真实的 Next 路由。
建议下一批补一个最小集成测试：起 Next 测试实例 + 临时 Postgres（`docker-compose.test.yml`），
让 bot 的 `_keytao_strict_batch_add_to_draft` / `keytao_shift_phrase_code` 打真实端点，
至少覆盖「无草稿顺延一次落库」「期间冒出草稿 → 409 → 重规划」两条路径。

---

## 7. 禁区遵守情况

- 未 commit、未 push、未部署、未连接任何数据库（含生产库与本机开发库）。
- 未改动 `keytao-bot` 仓库任何文件（只读取用于协议兼容分析）。
- 未改动与 batch/draft 无关的接口语义；bot token 权限边界相关测试全部保持绿。
