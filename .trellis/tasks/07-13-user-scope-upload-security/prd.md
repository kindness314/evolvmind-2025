# 用户范围与上传安全闭环

## Goal
完成真实认证场景下的用户范围隔离，并修复上传与推荐 API 的已知安全/正确性缺口，使发布前核心数据链路具备可验证的安全边界。

## Scope
- 服务端请求范围：`api/_lib/requestScope.ts`、`api/search.ts`、`api/graph/search.ts`、相关 embedding/backfill 入口。
- 前端调用：`src/lib/search.ts`、`src/lib/graphSearch.ts`、`src/app/App.tsx`、`src/app/components/CapturePage.tsx`。
- 数据库策略：新增 `supabase/migrations/` migration，收紧业务表与 `captured-files` Storage policies。
- 推荐正确性：`api/recommend.ts` 使用真实 `knowledge_links` 字段并显式处理查询错误。
- 不包含：OCR/ASR 后端实现、Realtime、ProcessPage 重做、图谱缩放优化、生产域名配置。

## Observed Context
- `requestScope.ts` 已支持 Demo scope 与 Bearer token→Supabase user id，但搜索接口仍信任请求体过滤值。
- Demo RLS/Storage migrations 使用公开策略；生产复用会破坏用户隔离。
- `CapturePage.tsx` 没有 10MB/MIME 前置校验，文件内容只以公开 URL 保存。
- `api/recommend.ts` 查询 `node_id/linked_node_id`，而迁移中的链接字段是 `source/target`，失败后静默当作空链接。

## Acceptance Criteria
- [ ] 非 Demo 请求的 scope 只能由有效 Bearer token 对应的 Supabase user id 决定；客户端传入的 `user_id/scope_id` 不得覆盖它。
- [ ] Demo 请求只能明确使用固定 Demo scope；未认证、非 Demo 请求返回 401/等价错误。
- [ ] 搜索及其补查请求沿用同一用户 Authorization，不使用 service-role 作为用户身份替代。
- [ ] 新 migration 将 `captured_info`、`knowledge_nodes`、`knowledge_links` 与 `captured-files` Storage 限制到对应用户 scope，并保留可审计的 Demo 例外。
- [ ] 登出调用 Supabase `signOut` 并清理 Demo 标记/本地状态。
- [ ] Capture 文件在 Storage 上传前拒绝超过 10MB 或不支持的 MIME/扩展名。
- [ ] 推荐 API 查询 `source/target`，查询失败返回可识别错误而非静默空链接。
- [ ] `npm run typecheck` 与 `npm run build` 通过。
- [ ] 关键认证、越权参数、上传边界和推荐字段场景有可复现验证记录。