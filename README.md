# EvolvMind

EvolvMind 是一个"捕获碎片信息 → AI 抽取结构 → 构建个人知识图谱 → 语义检索与回看"的个人知识系统。

使用方式：把随手记录的文本、网页片段、文件丢进来，系统自动生成标题与摘要、抽取实体与关系、构建个人知识图谱，并支持语义搜索、近期回顾与智能推荐。

## 核心链路

```text
用户捕获文本/文件
  → 写入 Supabase captured_info / Storage
  → 调用 /api/extract 生成标题、摘要、关键词
  → 调用 /api/graph/extract 抽取实体与关系
  → 合并写入 knowledge_nodes / knowledge_links
  → 为内容和节点生成 embedding
  → 通过 pgvector RPC 进行语义搜索
  → 跳转到原始内容或知识图谱节点
```

## 技术栈

- **前端**：React 18、TypeScript 5.8（strict）、Vite 6、Tailwind CSS 4、Radix UI、Motion
- **后端 / BaaS**：Supabase PostgreSQL、Auth、Storage、Realtime
- **API**：Vercel Serverless Functions（`api/*`）
- **AI / Embedding**：MiniMax-compatible API；embedding 默认 `BAAI/bge-m3`（1024 维）

## 本地开发

安装依赖：

```bash
npm i
```

仅启动前端 Vite：

```bash
npm run dev
```

启动前端 + Vercel API 路由（推荐，可调试 `/api/*`、AI 提取、embedding、语义搜索与图谱抽取）：

```bash
npm run dev:full
```

本地开发固定端口：

```text
Frontend: http://127.0.0.1:5173/
API:      http://127.0.0.1:3000/api/*
```

浏览器统一打开 `http://127.0.0.1:5173/`，不要直接使用 Vercel dev 打印的前端地址；Vercel dev 在本项目中只用于提供 `/api/*` serverless functions。端口被占用时先停止旧进程再重新运行。

## 常用命令

```bash
npm run dev       # 启动 Vite 前端开发服务器，固定 http://127.0.0.1:5173/
npm run dev:api   # 仅启动 Vercel API，本地固定 http://127.0.0.1:3000/api/*
npm run dev:full  # 同时启动前端和 API；浏览器打开 http://127.0.0.1:5173/
npm run typecheck # TypeScript 类型检查（tsc --noEmit）
npm run build     # 生产构建检查
npm run preview   # 预览生产构建产物
```

## 环境变量

前端构建变量（`VITE_` 前缀）：

```text
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_ANON_KEY=
```

服务端运行变量（仅存在于服务端环境，不可 `VITE_` 化）：

```text
MINIMAX_API_KEY=
MINIMAX_CHAT_API_KEY=        # 可选，chat 接口优先使用，缺省退回 MINIMAX_API_KEY
MINIMAX_MODEL=
MINIMAX_BASE_URL=https://api.edgefn.net/v1
MINIMAX_EMBEDDING_MODEL=BAAI/bge-m3
```

安全规则：

- `MINIMAX_API_KEY`、`MINIMAX_CHAT_API_KEY` 只能配置在服务端环境变量中。
- 禁止新增 `VITE_MINIMAX_API_KEY`、`VITE_MINIMAX_MODEL`、`VITE_MINIMAX_BASE_URL` 等前端密钥变量。
- 前端只能调用本项目的 `/api/*`，不要直接请求 LLM provider。
- 服务端从 Bearer token 解析用户 scope，不信任请求体中的 `user_id` / `scope_id`。

完整部署环境变量清单见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 数据库迁移

迁移文件位于 `supabase/migrations/`，通过 Supabase CLI 应用：

```bash
supabase link --project-ref <project-ref>
supabase db push
```

禁止通过 Supabase Dashboard 手工修改数据库结构；RLS、Storage 与 RPC 变更保留可审计的 Demo 例外与真实用户隔离。

## 部署

项目部署目标为 Vercel + Supabase：

1. 在 Supabase 应用 migrations。
2. 在 Vercel 配置前端与服务端环境变量。
3. 触发 Vercel 构建部署。
4. 使用 `/api/graph/extract`、首页语义搜索和知识图谱语义搜索验证链路。

生产环境：https://evolvmind-2025.vercel.app（详见 [DEPLOYMENT.md](./DEPLOYMENT.md)）。

## 目录概览

```text
api/                # Vercel Serverless Functions
  _lib/             # 服务端共享认证、scope 解析、向量等逻辑
  graph/            # 图谱抽取、搜索、回填端点
src/                # React 前端源码
  app/              # 应用入口、页面组件和 UI 基础组件
  lib/              # Supabase、AI、图谱、搜索等共享逻辑
  styles/           # 全局样式
supabase/           # Supabase migrations 与历史函数目录
  migrations/       # 数据库及 RLS 迁移历史
utils/              # 项目工具与 Supabase 配置
scripts/            # 本地开发脚本
```

## 相关文档

- [DEPLOYMENT.md](./DEPLOYMENT.md) — 部署与环境变量
- [IMPROVEMENT.md](./IMPROVEMENT.md) — 已知问题、优化方向与发布待办
- [AGENTS.md](./AGENTS.md) — 项目开发规范（AI 助手与协作者必读）
