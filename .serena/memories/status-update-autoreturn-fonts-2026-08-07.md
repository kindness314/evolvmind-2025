# 首页字号 + 状态即时更新 + 自动回数据页 + JSON 引号修复（2026-08-07 已实施）

## 背景
用户在本地验收后追加三项需求：
1. 首页字号再放大一档（适中，不能过大）。
2. 捕获处理完后状态仍显示"处理中"需尽快改状态（且不做整页刷新——增量刷新已在上一轮落地，此轮补状态即时翻转）。
3. 捕获内容处理完后自动切回数据页（用户 1630 修订：原为首页，验收时改为数据页——处理后看最新记录）。

## 根因（处理状态不更新的深层 bug）
浏览器复现时遇到**确定性**服务端 JSON 解析失败：MiniMax 在中文短语上输出未转义的 ASCII 引号（如 `由"处理中"切换为"已完成"`），导致 `normalizeContentToJson` 解析失败 → API 返回 `502 Invalid AI response format` → `process.ts` 把三状态全部置 failed → 面板显示处理失败（失败路径的自动回首页被正确抑制，反而验证了 gating）。这不是 API 抖动，是必现 bug。

## 改动（working tree 未 commit）
### HomePage.tsx — 字号放大一档
- 「为你推荐」header `text-base`→`text-lg`；推荐行 `px-3 py-2`→`px-3 py-2.5`；类型 chip →`text-[11px]`；推荐标题 `text-base`；推荐理由 `text-sm`。
- 「近期总结」header `text-lg`；统计条 `text-base`；各 section h4 `text-base`；内容行 `text-base`；次级文本 `text-sm`。
- Tab 栏、周期按钮、FAB、X 按钮、小字一律不动（上一轮验收的移动端约束保持）。

### DataPage.tsx — 状态即时翻转
- 新增 `watchRef`（观察集）：全量快照/增量查询中任一状态为非空且非 completed 的行记入观察（与增量查询 `or(...neq.completed)` 语义一致——PostgREST `neq` 排除 NULL，存量 NULL 行静态无需观察）。
- `syncData`：增量查询返回的 changedIds `add` 进 watchRef；**从观察集中消失的 id = 刚完成/失败**，走第三次查询 `.in('id', resolved)` 补拉最终状态后合并入列表并移出观察集。
- 状态翻转后 UI 立即更新，无需等 30s 轮询或全量对账。

### CapturePage.tsx — settle 追踪 + 自动回数据页
- refs：`graphSettledRef / embedSettledRef / graphFailedRef / embedFailedRef / activeRef`。
- 图谱 IIFE：早期返回置 `graphFailedRef`；成功置 settled；`finally` 里 dispatch `evolvmind:data-changed` + `tryAutoReturnData()`。
- embedding `.then/.catch` 同样置 refs + dispatch + `tryAutoReturnData()`。
- `tryAutoReturnData()`：仅当图谱与嵌入**双双 settled 且均未失败**、且 `activeRef.current` 为真（用户未离开捕获页）才触发；800ms 延迟后 `onNavigate('data')` + 全量状态重置（回到"选择捕获方式"）。
- 失败路径（任一失败）不导航——已两次实测确认抑制正确。

### App.tsx
- `<CapturePage active={page === currentPage} onNavigate={...} />` 传入 active 门控。

### 5 个 JSON 解析器 — `repairUnescapedQuotes`
- 项目模式为每个文件独立复制 `safeJsonParse`/`extractJsonObjects`，本次沿用（不改共享结构，降重构风险）：`api/extract.ts`、`api/graph/extract.ts`、`api/summarize.ts`、`src/lib/ai.ts`、`src/lib/graph.ts` 各加 `repairUnescapedQuotes` + 修复后重试解析。
- 启发式：字符串内 `"` 后跟（忽略空白）`,`、`}`、`]`、`:` 或 EOF → 真终止符；否则转义为 `\"`。字符串外 `"` 前是 `:`、`,`、`[`、`{` 或起始 → 真开头；否则转义。对合法 JSON 与既有 `\"` 转义逐字节保持。
- 单测：04:35 实际失败 raw → 修复后可 `JSON.parse`，摘要内容逐字还原；合法 JSON 不变；既有 `\"hi\"` 不双重转义；图谱风格 raw 同样修复。全过。

## 验证
- `npm run typecheck` ✓、`npm run build` ✓（3.61s；dist 不变：index-BpwtmnWP.js 882.25 kB / gzip 263.16 kB，CSS 104.27 kB / gzip 17.05 kB；chunk 警告非致命）。
- 浏览器实测（demo 模式，真实 API）：
  - **成功路径端到端**：捕获→文字→输入含"处理中/已完成"短语的内容→保存 → `/api/extract` 200（摘要干净，引号修复生效）→ embed + graph/extract + graph/embed 全链 settle → 面板到达"处理完成"→ DataPage 增量查询（`gt(created_at)` + `or(neq.completed)`）+ watch-set `.in('id', resolved)` 补拉，无全量重载 → DB 三状态 `completed` → 数据页行徽标"已完成" → ~800ms 后**自动切到数据页**（tab 高亮确认，oklch 色值），捕获页已重置（再点 FAB 显...
  - **失败路径**：04:31/04:35 两次触发解析失败 → 面板显示"处理失败/构建未完成" + 不自动跳转（gating 有效）。
- 首页字号浏览器实测：recHeader 18px、推荐标题 16px、理由 14px，零报错。
- 测试行已 REST 清理（3 行 204），用户行 `2abc6f04…`/`295d5969…` 完好。

## 运维要点
- `/api/health` **不存在**（`api/` 无该路由），命中 SPA rewrite 返回 200 HTML——不能作为 API 存活探针。真实探针：`GET /api/graph/extract` 或 `POST /api/extract`（200 JSON）。
- Dev server 重启正确姿势：`hub stop evolvmind-dev` → `netstat -ano | findstr ":3000 :5173"` 确认端口释放 → `hub start`（cmd.exe 包装，ready log `Ready! Available at` + port 3000）。`hub restart` 曾破坏端口布局（vercel dev 落入 dev-command 模式，Vite 占 3000 且 /api 自代理 → ECONNREFUSED）。
- 本地 API 改动后需重启 `evolvmind-dev` 让 vercel dev 重编译。

## 未做/取舍
- working tree 改动未 commit；已 commit 代码（`a2b4864` 及之前）已推送 origin + vercel（2026-08-07）。
- 服务端 AI 摘要/推荐聚合不在增量刷新范围（上轮已定）。
- 失败重试按钮保留全量 `fetchData()`（增量查询感知不到删除/置顶/修复后的状态）。
