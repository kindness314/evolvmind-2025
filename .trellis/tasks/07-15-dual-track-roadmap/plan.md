# EvolvMind 双方向后续计划

> 建立日期：2026-07-15
> 目的：将后续工作固定为“优化方向”和“账户 A/B 验收方向”两条可选择流程。
> 当前基线：Stage 1 P1-P5 Demo 界面验收已归档；`07-13-user-scope-upload-security` 仍因 Twilio Verify 中国短信审核阻断而保持 `in_progress`。

## 下次选择协议

下次用户选择以下任一项时，先读取本文件对应章节，再输出该方向的当前前置条件、执行步骤、验收标准和下一步动作；不要把两个方向混在同一轮，也不要用 Demo 结果替代真实账户验收。

- **优化方向**：执行第 1 节，从处理状态和数据可信度开始。
- **验收方向**：执行第 2 节，从真实认证前置检查开始。

如果用户只说“继续”而未指定方向，必须先让用户在“优化方向 / 验收方向”中选择，不应自行切换赛道。

---

## 1. 优化方向：把 Demo 功能提升为可信产品体验

### O0. 建立基线

1. 确认当前分支、工作区和本地服务状态。
2. 运行已有 `npm run typecheck`、`npm run build`，记录基线结果。
3. 只为当前优化阶段创建独立 Trellis 子任务；不要直接修改用户范围验收任务的结论。
4. 每个阶段先完成聚焦烟测，再运行类型检查和构建。

### O1. 实现捕获处理状态（第一优先级）

涉及范围：

- `supabase/migrations/`：新增处理状态 migration；
- `api/embed.ts`、`api/graph/embed.ts`；
- `api/backfill.ts`、`api/graph/backfill.ts`；
- `src/app/components/CapturePage.tsx`；
- `src/app/components/HomePage.tsx`；
- `src/app/components/ItemDetailPage.tsx`。

建议字段：

- `processing_status`：`pending | processing | completed | failed`；
- `embedding_status`：`pending | processing | completed | failed`；
- `graph_status`：`pending | processing | completed | failed`；
- `processing_error`：可空文本；
- `processed_at`：可空时间戳。

要求：

1. 原始内容先保存，AI 失败不能删除或覆盖原文。
2. 处理开始、成功、失败都持久化状态。
3. 首页和详情页显示“处理中 / 已完成 / 处理失败”。
4. 失败显示用户可理解的原因，不只写 Console。
5. 支持只重试失败的步骤，不能重复创建 `captured_info` 或重复上传文件。
6. 刷新页面后状态仍然正确。

验收：成功保存、失败显示、刷新恢复、单步重试、原文保留。

### O2. 修复搜索结果补查

涉及范围：

- `api/search.ts`；
- `api/graph/search.ts`；
- 新 migration（如决定保留批量 RPC）。

执行顺序：

1. 先确认远程数据库是否存在 `batch_get_captured_summaries`。
2. 最保守方案是用当前请求的 Bearer token 做带 RLS 的 REST 查询，先恢复 `sourcePreviews`。
3. 如保留 RPC，新增 `SECURITY INVOKER` migration，只返回必要字段，并确保真实请求沿用用户 token。
4. 统一 `requestSupabaseKey` 和 `Authorization` 处理，禁止普通请求无条件 fallback 到 service role。

验收：Demo 和真实用户搜索均能返回标题/摘要补充；A/B 验收中不能读取对方摘要；补查失败必须可观测。

### O3. 修复文件生命周期

涉及范围：

- `CapturePage.tsx`；
- `ItemDetailPage.tsx`；
- `supabase/migrations/`。

数据设计：

- 为 `captured_info` 增加 `storage_path`、`file_name`、`mime_type`、`file_size` 等元数据字段。
- 图片、音频和文件不再把临时 signed URL 作为永久 `content`。
- 页面打开时根据 `storage_path` 重新生成 signed URL。

要求：

1. signed URL 过期后重新进入详情仍能预览或播放。
2. 删除使用已保存的 `storage_path`，不再通过 URL 字符串分割推导路径。
3. 仍保持 Private bucket、用户 UUID 首段路径和 10 MiB 限制。
4. 文件错误必须说明“原始文件仍存在 / 重新加载失败”等实际状态。

验收：上传、刷新、过期后重载、删除清理、越权路径拒绝。

### O4. 真实化 Settings

涉及范围：`src/app/components/SettingsPage.tsx` 及必要的共享查询函数。

要求：

1. 读取真实 Supabase 用户信息；Demo 明确显示“演示账户”和共享 Demo 数据说明。
2. 统计数据查询真实的 `captured_info`、`knowledge_nodes`、`knowledge_links` 数量，失败时不显示假数字。
3. 删除与实际服务不一致的 GPT/Claude/Whisper 假模型下拉选项，改为显示服务端实际模型和“未启用”能力。
4. 只保留真正有效的开关；无真实行为的开关删除或标记为未启用。
5. 回填显示批次、成功、失败、取消和重试信息。

验收：刷新后身份和统计一致；设置不会伪装成已生效功能；回填错误可见且可重试。

### O5. 处理 ProcessPage

推荐方案：删除独立的静态 ProcessPage，把处理状态整合到首页和详情页。

备选方案：只有在产品明确需要“处理中心”时，才将其改为读取当前 scope 下 pending/processing/failed 的真实记录，并实现真实重试、编辑和保存。禁止继续扩展硬编码示例页面。

验收：决定删除时清理死代码和导航引用；决定保留时所有项目、按钮、标题、摘要、关键词和关联数据都来自当前用户真实记录。

### O6. 图谱聚焦和性能

涉及范围：

- `src/app/components/KnowledgePage.tsx`；
- `src/app/App.tsx`；
- 必要时新增纯函数工具和测试。

执行顺序：

1. 抽取 viewport 计算纯函数。
2. 用非线性缩放替换固定线性 floor/cap，参数基于真实节点分布调节。
3. 计算详情面板打开后的真实可用图谱区域。
4. 为长中文标签增加边界安全距离。
5. 覆盖孤立、小簇、中等、高连接和宽邻域五类节点。
6. 懒加载 `KnowledgePage`/Force Graph，降低首页首屏包体。

验收：390×844 与桌面视口下，节点不被裁切、标签可读、详情面板不遮挡、分类视图仍居中、重复聚焦不漂移。

### O7. 自动化测试与优化收口

优先增加：

- 上传大小、MIME、扩展名边界；
- 处理状态成功/失败/重试；
- 搜索摘要补查和 scope；
- signed URL 路径生命周期；
- 图谱 viewport 计算五类节点矩阵；
- Settings 真实身份与统计。

完成 O1-O6 后再处理 PWA、原生壳、推送、OCR/ASR 等扩展功能。

---

## 2. 验收方向：真实账户 A/B 隔离验收

### A0. 前置条件

1. Twilio 工单 `#28192140` 获得中国大陆 Verify 发送许可，或准备可接收验证码且服务商允许的测试号码。
2. 如果改用非中国号码，必须先调整登录页国家码输入合同，并单独验证手机号格式；不要偷偷用 Demo 代替。
3. 准备两个不含生产数据的独立测试账户 A、B。
4. 使用两个相互隔离的浏览器环境，清除旧的 `demo_auth` 和 Supabase session。
5. 记录日期、浏览器、设备、项目 ref 和每一步证据。

如果 Twilio 仍返回 `60220`：

- A/B 真实验收保持 `BLOCKED`；
- 不重复标记 PASS；
- 继续执行优化方向或等待 provider 回复；
- Auth Token 不得写入代码、文件、记忆或截图。

### A1. 账户 A 建立数据

1. 清理 Demo 状态并用手机号 A 完成真实 OTP 登录。
2. 保存唯一文本：`账户 A 私有测试内容 <日期>`。
3. 上传小于 10 MiB 的 `.txt` 或图片。
4. 确认首页、条目详情、搜索、推荐和图谱能看到 A 数据。
5. 确认文件路径第一段为 A 的 Supabase user UUID。
6. 退出登录，确认回到登录页且 session 被清理。

### A2. 账户 B 建立数据

1. 在独立浏览器用手机号 B 登录。
2. 确认看不到 A 的文本、文件、搜索结果、推荐和图谱节点。
3. 保存唯一文本：`账户 B 私有测试内容 <日期>`。
4. 上传小于 10 MiB 的文件。
5. 确认 B 只能看到 B 数据，文件路径首段为 B UUID。

### A3. 交叉隔离

1. 切回 A：A 可见，B 不可见。
2. 切回 B：B 可见，A 不可见。
3. 对首页搜索和图谱搜索执行跨关键词检查。
4. 检查推荐和摘要不会混入对方内容。
5. 检查图谱节点、关系、来源记录不会跨 scope。
6. 重新生成 signed URL，确认只允许当前用户路径。

### A4. 防篡改与未认证请求

1. A 的 Bearer 请求 body 伪造 B 的 `user_id`、`scope_id`，结果仍只能返回 A。
2. 未带 Bearer 的受保护 API 返回 401；不能靠 body 的任意 scope 字段访问真实数据。
3. 明确记录 Demo body/header 例外，不把 Demo 例外误写成真实用户认证通过。
4. 检查 `/api/extract`、`/api/graph/extract`、`/api/models` 的发布策略：若仍公开，必须先完成认证/限流审查，不能把安全验收标为完成。

### A5. 上传边界

1. 上传恰好不超过 10 MiB 的允许文件，确认成功。
2. 上传超过 10 MiB 文件，确认前端拦截且没有 Storage 对象。
3. 上传不支持扩展名，确认前端拦截且没有 Storage 对象。
4. 尝试伪造 MIME/路径，确认 Storage policy 和服务端边界仍拒绝越权对象。
5. 记录对象路径、HTTP 状态、可见错误和浏览器环境。

### A6. 结论规则

只有以下条件全部满足，才可以将真实账户任务从 `in_progress` 关闭：

- A/B 均成功完成真实认证；
- A/B 数据、搜索、推荐、摘要、图谱和 Storage 互不可见；
- signed URL 访问范围正确；
- 伪造 `user_id/scope_id` 无效；
- 未认证 API 行为符合发布策略；
- 上传边界通过；
- 所有项目均有 PASS/FAIL/BLOCKED 证据。

任何一步因 Twilio、环境或缺少凭据无法执行，必须记录为 `BLOCKED`，不能用 Demo 结果补齐。

---

## 3. 两条方向的共同发布门禁

无论选择哪条方向，正式发布前都必须单独完成：

1. `npm run typecheck`；
2. `npm run build`；
3. Vercel Production 环境变量和 Supabase project ref 一致；
4. 未认证 LLM 端点的认证、限流或配额策略；
5. 不让普通请求无条件使用 `SUPABASE_SERVICE_ROLE_KEY`；
6. 真实 A/B 隔离验收；
7. 生产域名、HTTPS、Storage、Auth、搜索和图谱的公网烟测。

P1-P5 Demo 界面验收已归档，但其中 P4.3 空推荐状态在 Demo 数据下仍为 `NOT VERIFIED`；归档不等于把该项改写为 PASS。
