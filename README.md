# KeyTao Next

KeyTao(键道) 输入方案词库更新管理系统

## 技术栈

- **Next.js 16** - React 框架
- **Prisma 7** - 数据库 ORM
- **PostgreSQL** - 数据库
- **Casbin** - 权限管理
- **TypeScript**
- HeroUI
- TailwindCSS

## 快速开始

### 1. 安装依赖

```bash
pnpm install
```

### 2. 配置数据库

编辑 `.env` 文件，配置数据库连接：

```env
DATABASE_URL="postgresql://user:password@localhost:5432/database_name"
```

或使用 Prisma 本地开发数据库：

```bash
pnpm exec prisma dev
```

### 3. 推送数据库 Schema

```bash
pnpm run db:push
```

或创建迁移：

```bash
pnpm run db:migrate
```

### 4. 初始化权限、角色和用户

```bash
# 初始化权限
pnpm run init:permission

# 初始化角色
pnpm run init:role

# 初始化默认管理员用户
pnpm run init:user

# 或一次性初始化全部
pnpm run init:all
```

**默认管理员账号：**

- 用户名：`admin`
- 密码：`admin123`
- 角色：初始管理员 (R:ROOT)

### 5. 启动开发服务器

```bash
pnpm run dev
```

访问 [http://localhost:3000](http://localhost:3000)

## 数据库模型

### User (用户)

- 基本信息：name, nickname, phone, email, password
- 状态：ENABLE, DISABLE, BANNED
- 注册类型：USERNAME, WECHAT, EMAIL
- 关联角色：多对多关系

### Role (角色)

- 预设角色：
  - `R:ROOT` - 初始管理员
  - `R:MANAGER` - 管理员
  - `R:NORMAL` - 普通用户

### Permission (权限)

- 权限资源定义
- 关联权限操作

### PermissionAction (权限操作)

- 预设操作：create, read, update, delete, query

### CasbinRule (Casbin 规则)

- RBAC 权限规则存储

## 可用脚本

```bash
# 开发
pnpm run dev

# 构建
pnpm run build

# 启动生产
pnpm run start

# 代码检查
pnpm run lint

# 数据库相关
pnpm run db:generate   # 生成 Prisma Client
pnpm run db:push       # 推送 schema 到数据库
pnpm run db:migrate    # 创建迁移
pnpm run db:studio     # 打开 Prisma Studio

# 初始化脚本
pnpm run init:permission   # 初始化权限
pnpm run init:role         # 初始化角色
pnpm run init:user         # 初始化默认管理员用户
pnpm run init:all          # 初始化全部
```

## 权限管理

本项目使用 Casbin 进行基于角色的访问控制 (RBAC)。

### 权限模型

配置文件：`config/rbac_model.conf`

```conf
[request_definition]
r = sub, obj, act

[policy_definition]
p = sub, obj, act

[role_definition]
g = _, _

[policy_effect]
e = some(where (p.eft == allow))

[matchers]
m = g(r.sub, p.sub) && r.obj == p.obj && r.act == p.act
```

### 预设权限

- `user:page` - 用户列表页
- `user` - 用户管理（CRUD）
- `permission:page` - 权限页
- `permission` - 权限管理（CRUD）
- `permissionAction:page` - 权限操作页
- `permissionAction` - 权限操作管理（CRUD）
- `role` - 角色管理（CRUD）

## 项目结构

```
keytao-next/
├── app/                 # Next.js App Router
├── lib/                 # 工具库
│   └── prisma.ts       # Prisma Client 单例
├── scripts/            # 初始化脚本
│   ├── initPermission.ts
│   └── initRole.ts
├── prisma/             # Prisma 配置
│   └── schema.prisma   # 数据库 Schema
├── config/             # 配置文件
│   └── rbac_model.conf # Casbin RBAC 模型
├── prisma.config.ts    # Prisma 配置
└── package.json
```

## 参考项目

本项目的数据库结构和初始化脚本参考了 [xkinput/jd-dict-server](https://github.com/xkinput/jd-dict-server)

## License

MIT
