## Supabase：应用数据库迁移

本项目的数据库迁移位于 [migrations](file:///d:/evolvmind-2025/EvolvMind/supabase/migrations)。

必须确保以下表已应用扩展字段与索引：
- `knowledge_nodes`（含 `normalized_name/kind/aliases/source_captured_ids` 等）
- `knowledge_links`（含 `relation_type/evidence_captured_ids` 等）
- 最新扩展 migration：[20240401000006_extend_knowledge_graph.sql](file:///d:/evolvmind-2025/EvolvMind/supabase/migrations/20240401000006_extend_knowledge_graph.sql)

方式 A：Supabase CLI（推荐）
- 安装并登录 Supabase CLI
- 在项目根目录执行
  - `supabase link --project-ref <你的 project ref>`
  - `supabase db push`

方式 B：Supabase Dashboard（不装 CLI）
- 打开 Supabase Dashboard → SQL Editor
- 依次执行 [migrations](file:///d:/evolvmind-2025/EvolvMind/supabase/migrations) 中未应用的 SQL（按文件名时间顺序）

## Vercel：配置服务端环境变量

本项目的知识图谱抽取走服务端 API：[/api/graph/extract](file:///d:/evolvmind-2025/EvolvMind/api/graph/extract.ts)，需要在 Vercel 项目里配置环境变量：
- `MINIMAX_API_KEY`（必填）
- `MINIMAX_MODEL`（可选）
- `MINIMAX_BASE_URL`（可选）

配置位置：
- Vercel Dashboard → Project → Settings → Environment Variables

验证：
- 访问 `https://<你的域名>/api/graph/extract`（GET）应返回 `ok: true` 与 `hasKey`

## 前端：确保连接到正确的 Supabase 项目

如果你在 Supabase Dashboard 操作的项目（URL 中的 `/project/<ref>`）和前端实际连接的项目不一致，会出现“数据库未应用图谱迁移”的提示。

前端默认使用仓库内置的 Supabase 配置，但也支持通过环境变量覆盖（推荐）：
- `VITE_SUPABASE_PROJECT_ID`
- `VITE_SUPABASE_ANON_KEY`

取值位置：
- Supabase Dashboard → Project Settings → API → Project URL / anon public key

注意：
- 这些变量属于前端构建时环境变量，需要在 Vercel 里同时配置（Preview/Production 与你的访问域名一致），并触发一次新部署后生效。

## 本地开发（可选）

如果你需要在本地同时跑 Vite + /api 路由：
- 使用 Vercel CLI：`vercel dev`

如果你想让前端直接调用 LLM（不经过 /api），可以在本地添加 `.env`（参考 [.env.example](file:///d:/evolvmind-2025/EvolvMind/.env.example)）。
