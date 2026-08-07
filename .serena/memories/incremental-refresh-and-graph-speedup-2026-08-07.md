# 增量刷新 + 知识图谱加载提速（2026-08-07 已实施）

## 背景
用户在本地验收三个 UI 改动后提出两点新需求：
1. 增加新数据后应该在原有的基础上进行刷新，提高效率（不要整页/全量重载）。
2. 知识网络加载太慢了，想办法加快加载。

## 根因
- **DataPage 慢**：30s 轮询与重试收敛每次都 `captured_info.select('*')` 全量拉取。
- **KnowledgePage 慢**：`select('*')` 拉 `knowledge_nodes` 时把 1536 维 `embedding` 向量列也序列化进 JSON（每节点十几 KB，30 节点即数百 KB）。`graph.ts` 等其他调用均只选具体列，`match_knowledge_nodes` RPC 输出也刻意排除 embedding，唯独 KnowledgePage 用 `*`。

## 改动（已随 210e785 提交）
### DataPage.tsx — 增量同步（方案 B，免 DB migration）
- 模块级 helper：`reconcileStatuses`（状态修复，全量/增量共用）、`formatInfoRow`（行→卡片映射共用）、`maxCreatedAt`、`mergeByKey`（按 id 合并 + 置顶优先/时间倒序）。
- `InfoCard` 新增 `created_at_raw?: string`（原始 ISO，供增量合并排序；`toLocaleString` 的 `timestamp` 字典序对多位数日期不可靠）。
- `lastSyncRef` 水位线 + `pollCountRef`：轮询多数轮次只做增量——`created_at > 水位线-1.5s` 的新增行 + `or(processing_status.neq.completed, graph_status.neq.completed, embedding_status.neq.completed)` 的状态行，按 id 合并；每 6 次轮询（~3min）全量对账兜底删除/置顶。
- `handleRetry` / `handleRetryAll` 的收敛由 `fetchData()` 改为 `syncData()`；批量置顶/删除、错误重试按钮保留全量（增量查询感知不到删除/置顶）。
- `syncData` 失败静默（下轮兜底），15s abort 保护，不打断页面。
- 注意：`neq.completed` 在 PostgREST 中排除 NULL 状态行——存量 NULL 状态行是静态的（只有重试点击才会被乐观置为显式状态），不需要轮询，安全。

### CapturePage.tsx
- 保存成功后 `window.dispatchEvent(new CustomEvent('evolvmind:data-changed'))`，DataPage 监听后立即 `syncData()`，新数据秒级出现，不等 30s 轮询。

### KnowledgePage.tsx — 列裁剪
- 节点：`select('id,name,val,color,kind,aliases,source_captured_ids,metadata,created_at')`（不含 embedding）。
- 边：`select('id,source,target,relation_type,evidence_captured_ids,confidence,created_at')`。
- 已确认页面渲染只用这些列（grep normalized_name/embedding 无依赖）。

## 验证
- `npm run typecheck` ✓、`npm run build` ✓、`git diff --check` ✓（仅既有 CRLF 警告）。
- 浏览器实测（demo 模式）：
  - 捕获保存后网络日志只出现两条小查询（`created_at=gt.水位线` + `or=(...neq.completed)`），无全量 `select=*&order=` 重载；新条目秒级出现在数据页。
  - `knowledge_nodes` 请求 select 精确到 11 列、无 embedding；图谱 canvas 正常渲染。
  - 首页→知识网络→数据→首页 全走查零 console error。
  - 测试行已通过 REST 删除。
- Dev server：`hub` 进程 `evolvmind-dev`（pid 可查 hub ps），停止用 `hub stop evolvmind-dev`。

## 未做/取舍
- 未加 `updated_at` 列 migration（方案 A）：需 `supabase db push`，且捕获删除/置顶当前由 3min 全量对账兜底，够用；后续如需秒级删除感知再上 migration。
- 首页 AI 摘要/推荐为服务端聚合，不在增量刷新范围。
- 上述改动已随提交 `210e785`（feat: O1 处理状态系统 + 增量刷新 + UI 改进 + storage 删除路径修复）入库，并推送 vercel（`ab42547`）+ origin（`d93437b`），Vercel Production 已部署。
