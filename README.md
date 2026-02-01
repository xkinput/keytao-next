# KeyTao Next

KeyTao(键道) 输入方案词库更新管理系统

## 技术栈

Node.js v20.19+, v22.12+, or v24.0+

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

> **NixOS 用户提示：** 项目已配置 `flake.nix` 和 `.envrc`。请先运行 `direnv allow` 或 `nix develop` 进入开发环境，这会自动设置 Prisma 引擎路径。

### 2. 配置数据库

本项目使用 Postgresql 数据库，需要本地已安装 Postgresql 数据库

复制 `.env.example` 为 `.env` 并编辑它，配置数据库连接：

请先创建一个keytao的数据库，并修改user和password为你的数据库用户名和密码

> 创建数据库命令
>
> ```
> createdb -U user -h localhost keytao
> ```

```env
DATABASE_URL="postgresql://user:password@localhost:5432/keytao?schema=public"
```

### 3. 运行数据库迁移和生成客户端

执行迁移（会自动生成 Prisma Client）：

```bash
pnpm run db:migrate
```

如果遇到问题，手动生成 Prisma Client：

```bash
pnpm run db:generate
```

### 4. 初始化权限、角色和用户

```bash
# 一次性初始化全部
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

### 6. 查看数据库数据（可选）

使用 Prisma Studio 可视化查看和编辑数据库：

```bash
pnpm run db:studio
```

访问 [http://localhost:5555](http://localhost:5555) 即可查看数据库中的所有表和数据。

## 常见问题

### NixOS 上 Prisma 报错

如果遇到 `404 Not Found` 或找不到引擎文件：

1. 确保已运行 `direnv allow` 或 `nix develop`
2. 检查环境变量是否正确设置：`echo $PRISMA_QUERY_ENGINE_BINARY`

### 找不到 `.prisma/client/default` 模块

运行生成命令：

```bash
pnpm run db:generate
```

## 数据库模型

见 prisma/schema.prisma

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
