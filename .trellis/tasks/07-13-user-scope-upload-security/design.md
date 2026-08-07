# 技术设计

## 1. 请求范围合同

`resolveRequestScope` 是所有用户范围 API 的唯一入口：

- `demo: true` → 固定 Demo scope；不读取客户端 `user_id/scope_id`。
- 非 Demo → 必须携带 Bearer token；通过 Supabase `/auth/v1/user` 解析真实 user id。
- RPC 与 PostgREST 补查使用该请求的 access token，避免 service-role 绕过 RLS。

搜索端点只从解析结果设置 `filter_user_id` / `filter_scope_id`，删除请求体覆盖路径。客户端从 `supabase.auth.getSession()` 获取 access token；Demo 发送 `demo: true`。

## 2. 数据库隔离

新增 migration，不改历史 migration：

- 启用目标表 RLS。
- 用户策略按 `auth.uid()` 与表内 `user_id` 或 `scope_id` 匹配。
- Demo 策略仅允许固定 Demo scope，并限制为明确的匿名/客户端 Demo 访问方式；不得恢复全表 `USING(true)`。
- Storage policy 根据 `storage.objects.name` 的 scope 前缀和认证身份约束读写。由于现有上传路径为 `uploads/<random>`, 同步调整前端路径为 `<scope>/<random>` 或在策略中采用可验证的用户归属字段。

迁移应用与真实 Supabase 项目联调属于部署前置；本地代码验证不假设远程 schema 已自动更新。

## 3. 上传边界

在 `handleFileChange` 和 `handleSave` 双重校验：

- `MAX_FILE_SIZE = 10 * 1024 * 1024`。
- allowed MIME 与当前 capture mode 对齐，文档扩展名白名单作为 MIME 缺失时的补充。
- 校验失败时清理 input/file/preview，并展示可理解错误；不得调用 Storage upload。

OCR/ASR 不在本任务实现；非文本仍保留现有元数据处理，但必须明确这是后续能力，不伪称内容已解析。

## 4. 推荐字段

将 `knowledge_links` 查询字段改为实际 `source,target`，转换为内部 `LinkRow`。HTTP 查询失败直接抛出/返回错误，并附带上下文，避免推荐规则静默降级为空链接。

## 5. 登出

`handleLogout` 调用 `supabase.auth.signOut()`，无论网络错误都清理 Demo 标记并回到登录页；调用方使用 async 状态处理，不保留旧 session 假象。

## 6. 回滚

代码变更可独立回滚；数据库 migration 需准备对应反向 migration 或在应用前于 staging 验证 policy。若现有 Demo 客户端依赖旧 `uploads/` 路径，先兼容读取，再切换新写入路径。