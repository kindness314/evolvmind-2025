# EvolvMind

EvolvMind 是一个用于“捕获碎片信息 → AI 抽取结构 → 构建个人知识图谱 → 语义检索与回看”的个人知识系统。

当前项目使用 Vite + React 18 + TypeScript + Tailwind CSS 4 构建前端，使用 Supabase 作为认证、数据库、存储与 Realtime 后端，使用 Vercel Serverless Functions 承载 AI 提取、embedding、语义搜索与图谱抽取接口。

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

- Frontend：React 18、TypeScript、Vite 6、Tailwind CSS 4、Radix UI、Motion
- Backend / BaaS：Supabase PostgreSQL、Auth、Storage、Realtime
- API：Vercel Serverless Functions（`api/*`）
- AI / Embedding：MiniMax-compatible API，当前 embedding 默认使用 BGE-M3

## 本地开发

安装依赖：

```bash
npm i
```

仅启动前端 Vite：

```bash
npm run dev
```

启动前端 + Vercel API 路由：

```bash
npm run dev:full
```

本地完整开发采用双服务固定端口：

```text
Frontend: http://127.0.0.1:5173/
API:      http://127.0.0.1:3000/api/*
```

打开浏览器时请使用前端地址 `http://127.0.0.1:5173/`。不要直接使用 Vercel dev 打印的前端地址；Vercel dev 在本项目中只用于提供 `/api/*` serverless functions。

> 需要调试 `/api/*`、AI 提取、embedding、语义搜索或图谱抽取时，优先使用 `npm run dev:full`。如果端口被占用，先停止旧的本地开发进程再重新运行。

## 常用命令

```bash
npm run dev       # 启动 Vite 前端开发服务器，固定 http://127.0.0.1:5173/
npm run dev:api   # 仅启动 Vercel API，本地固定 http://127.0.0.1:3000/api/*
npm run dev:full  # 同时启动前端和 API；浏览器打开 http://127.0.0.1:5173/
npm run build     # 生产构建检查
npm run preview   # 预览生产构建产物
```

## 环境变量

前端构建变量：

```text
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_ANON_KEY=
```

服务端运行变量：

```text
MINIMAX_API_KEY=
MINIMAX_MODEL=
MINIMAX_BASE_URL=https://api.edgefn.net/v1
MINIMAX_EMBEDDING_MODEL=BAAI/bge-m3
```

安全规则：

- `MINIMAX_API_KEY` 只能配置在服务端环境变量中。
- 不要新增 `VITE_MINIMAX_API_KEY`、`VITE_MINIMAX_MODEL` 或 `VITE_MINIMAX_BASE_URL`。
- 前端只能调用本项目的 `/api/*`，不要直接请求 LLM provider。

## 数据库迁移

迁移文件位于：

```text
supabase/migrations/
```

常规流程请使用 Supabase CLI：

```bash
supabase link --project-ref <project-ref>
supabase db push
```

不要通过 Supabase Dashboard 手动修改数据库 schema。详见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 部署

项目部署目标是 Vercel + Supabase：

1. 在 Supabase 应用 migrations。
2. 在 Vercel 配置前端与服务端环境变量。
3. 触发 Vercel 构建部署。
4. 使用 `/api/graph/extract`、首页语义搜索和知识图谱语义搜索验证链路。

详细部署说明见 [DEPLOYMENT.md](./DEPLOYMENT.md)。

## 目录概览

```text
api/                # Vercel Serverless Functions
src/                # React 前端源码
  app/              # 应用入口、页面组件和 UI 基础组件
  lib/              # Supabase、AI、图谱、搜索等共享逻辑
  styles/           # 全局样式
supabase/           # Supabase migrations 与历史函数目录
utils/              # 项目工具与 Supabase 配置
```

后续重构会逐步引入 `src/features/*`，把页面中的业务逻辑、服务调用和 UI 子组件拆分到更清晰的功能模块中。

## 高风险待确认项

以下事项可能影响运行行为、部署链路、数据安全或历史兼容性，后续需要单独确认后再处理，不应混入低风险工程整理中。

### 1. Supabase Edge Function 遗留目录

```text
supabase/functions/server/
```

当前主后端是 Vercel `api/*`，该目录看起来像 Figma Make / Supabase Edge Function 遗留代码。但删除前需要确认：

- 是否仍被某个部署环境引用；
- 是否还有历史脚本或文档依赖；
- 是否需要先标注为 legacy 再归档。

### 2. 未使用依赖清理

以下依赖目前看似不是主业务链路必需，但删除会影响 lockfile 和构建结果，需要逐组验证：

```text
@mui/material
@mui/icons-material
@emotion/react
@emotion/styled
react-slick
react-dnd
react-dnd-html5-backend
react-responsive-masonry
react-popper
```

建议后续作为“依赖瘦身”专项处理：每删除一组依赖后运行 `npm run build`，确认无回归再继续。

### 3. Vite `/api/llm` dev proxy

`vite.config.ts` 中仍保留早期原型使用的 `/api/llm` 代理。当前架构要求前端只调用本项目的 Vercel `/api/*` 服务端函数，不应直接代理 LLM provider。

本次仅标注为 legacy，暂不删除。删除前需要确认没有本地调试流程仍依赖它。

### 4. 大规模目录迁移

页面组件、业务逻辑和服务层需要逐步模块化，但不建议一次性大规模移动文件。推荐顺序是：

```text
先抽 src/features/* 下的 services / lib / types
再拆页面 UI 子组件
最后清理旧路径和重复逻辑
```

这样可以降低 import 路径调整和行为回归风险。

### 5. TypeScript strict / typecheck 引入

项目规范要求 TypeScript Strict Mode，但当前工程尚未补齐完整 `tsconfig.json` 与 `typecheck` 脚本。直接启用 strict 可能暴露大量历史类型问题。

建议单独作为工程质量任务处理：

```text
新增 tsconfig.json
新增 npm run typecheck
分批修复类型错误
```

### 6. Supabase RLS 与 demo mode 策略

demo mode、共享 fallback UUID、RLS policy 都是产品行为和安全策略，不是单纯代码整理。任何调整都需要先确认：

- demo 数据是否继续共享；
- 生产用户数据隔离策略；
- storage policy 是否要和表级 RLS 一起收紧；
- 是否需要新增 migration 而不是手动改 Dashboard。
