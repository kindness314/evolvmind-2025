# 部署说明

本项目部署目标是 Vercel + Supabase。前端由 Vite 构建，`api/*` 由 Vercel Serverless Functions 承载，数据、认证、文件和 Realtime 由 Supabase 提供。

## 1. Supabase：应用数据库迁移

数据库迁移位于：

```text
supabase/migrations/
```

常规迁移必须使用 Supabase CLI：

```bash
supabase link --project-ref <你的 project ref>
supabase db push
```

不要通过 Supabase Dashboard 手动修改数据库 schema。Dashboard SQL Editor 只应作为紧急排障或人工恢复手段，并且需要把最终变更补成 migration 文件。

需要重点确认的表与能力：

- `captured_info`：原始捕获内容、摘要、关键词、置顶、备注、embedding
- `knowledge_nodes`：图谱节点、`normalized_name`、`kind`、`aliases`、`source_captured_ids`、embedding
- `knowledge_links`：图谱关系、`relation_type`、`evidence_captured_ids`
- `pgvector`、HNSW index 与匹配 RPC

当前 embedding 使用 BGE-M3，最终向量维度为 1024。应用或重放迁移后，如果已有数据的 embedding 被清空，需要通过设置页或后续后台任务回填。

## 2. Vercel：配置环境变量

本项目的 AI 信息提取、知识图谱抽取、embedding 与语义搜索都通过服务端 API 运行。请在 Vercel Project Settings → Environment Variables 配置以下变量。

### 前端构建变量

```text
VITE_SUPABASE_PROJECT_ID=<Supabase project ref>
VITE_SUPABASE_ANON_KEY=<Supabase anon public key>
```

这些变量会被打包进前端，只能放公开的 Supabase anon key，不要放服务端密钥。

### 服务端运行变量

```text
MINIMAX_API_KEY=<服务端 API key>
MINIMAX_MODEL=<可选，chat/extract 模型>
MINIMAX_BASE_URL=https://api.edgefn.net/v1
MINIMAX_EMBEDDING_MODEL=BAAI/bge-m3
```

安全注意：

- 不要配置 `VITE_MINIMAX_API_KEY`、`VITE_MINIMAX_MODEL` 或 `VITE_MINIMAX_BASE_URL`。
- `VITE_` 开头的变量会进入前端构建产物。
- 前端只能调用本项目的 `/api/*`，不能直接请求 MiniMax 或兼容 provider。

## 3. 本地开发

复制 `.env.example` 并按需创建本地 `.env`：

```text
VITE_SUPABASE_PROJECT_ID=
VITE_SUPABASE_ANON_KEY=
MINIMAX_API_KEY=
MINIMAX_MODEL=
MINIMAX_BASE_URL=https://api.edgefn.net/v1
MINIMAX_EMBEDDING_MODEL=BAAI/bge-m3
```

仅启动 Vite 前端：

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

浏览器请打开 `http://127.0.0.1:5173/`。Vercel dev 在本项目中只用于提供 `/api/*` serverless functions，不要直接使用 Vercel dev 打印的前端地址。

需要验证 `/api/extract`、`/api/graph/extract`、embedding、backfill 或语义搜索时，请使用 `npm run dev:full`。如果端口被占用，先停止旧的本地开发进程再重新运行。

## 4. 部署后验证

建议按以下顺序验证：

1. 打开首页，确认 Supabase Auth / demo mode 可用。
2. 新增一条文本捕获，确认原始内容保存成功。
3. 检查 `/api/extract` 是否能生成标题、摘要、关键词。
4. 检查 `/api/graph/extract` 是否能抽取并写入知识节点与关系。
5. 在设置页执行 embedding 回填，或确认新内容的 embedding fire-and-forget 成功。
6. 验证首页语义搜索能返回 captured_info。
7. 验证知识图谱语义搜索能聚焦 knowledge_nodes。

`GET /api/graph/extract` 可作为轻量健康检查，应返回 `ok: true` 和 `hasKey` 等状态字段。

## 5. 常见问题

### Supabase Dashboard 里的项目和前端连接项目不一致

如果 Dashboard URL 中的 project ref 和 `VITE_SUPABASE_PROJECT_ID` 不一致，会出现迁移已执行但前端仍提示 schema 缺失的问题。请检查 Vercel 环境变量并重新部署。

### 语义搜索无结果

优先检查：

- `MINIMAX_API_KEY` 是否存在；
- `MINIMAX_BASE_URL` 是否为当前 provider 地址；
- `MINIMAX_EMBEDDING_MODEL` 是否为 `BAAI/bge-m3`；
- 数据表 embedding 是否已回填；
- 数据库 RPC 和向量维度是否为 1024。

### API 正常但前端本地调用失败

如果只运行 `npm run dev`，Vite 不会自动提供 Vercel Serverless Functions。请改用：

```bash
npm run dev:full
```

如果页面空白或端口漂移，通常是直接打开了 Vercel dev 打印的地址，或旧 dev 进程占用了端口。停止旧进程后重新运行 `npm run dev:full`，并打开固定前端地址：

```text
http://127.0.0.1:5173/
```
