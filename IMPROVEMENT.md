# EvolvMind 改进方向

> 本文档是项目已知问题、优化方向与发布待办的唯一事实来源（2026-08-06 建立）。
> 更新基线：Stage 1 已归档；Email OTP 真实 A/B 隔离验收 13/13 PASS（2026-07-25）；生产已部署。
> README.md 只保留项目介绍；此处只保留"还需要做什么"。

## 一、状态基线

```text
Stage 1 P1-P5 Demo 界面验收     ✅ 已归档
07-13-user-scope-upload-security ✅ 已关闭 (Email OTP A/B 13/13 PASS, 2026-07-25)
生产部署                          ✅ https://evolvmind-2025.vercel.app (2026-07-25)
Embedding (BGE-M3)               ✅ 可用
O1 捕获处理状态                  ✅ 已完成 (2026-08-06, migration 20260806000000, 2026-08-07 部署)
O2 搜索结果补查                  ✅ 已实现 (sourcePreviews)
O3 signed URL 生命周期           ⬜ 待执行
O4 Settings 真实化               ⬜ 待执行
O5 ProcessPage                   ⬜ 待执行
O6 图谱聚焦缩放 + 懒加载         ⬜ 待执行
O7 自动化测试                    ⬜ 待执行
```

手机号 OTP（Twilio）仍 BLOCKED（Trial + 中国短信），与 Email 验收分开记录，见 `.serena/memories/acceptance/`。

## 二、已知问题与缺陷

| 问题 | 位置 | 严重度 | 关联项 |
|------|------|--------|--------|
| 图谱线性 fitScale 不感知邻域大小（小簇太大/大邻域太小） | `KnowledgePage.tsx` ~555-556 | 中 | O6 |
| 详情面板打开后节点被裁切 | `KnowledgePage.tsx` | 中 | O6 |
| 分类视图长标签溢出 | `KnowledgePage.tsx` zoomToFit | 低 | O6 |
| 移动端缩放感不一致 | `KnowledgePage.tsx` | 低 | O6 |
| Settings 显示 GPT-4/Claude/Whisper 假模型下拉 | `SettingsPage.tsx` | 低 | O4 |
| 聊天模型候选列表含被拒绝的旧模型名 | `api/extract.ts`, `api/summarize.ts` | 低 | O4 |
| 部分页面用 `alert()` 而非 Sonner toast | 多处 | 低 | — |
| 多模态文件仅存元数据，不解析正文 | CapturePage 上传链路 | 中 | 发布待办 #1 |
| 生产构建 ~840KB JS chunk | force-graph 未动态 import | 中 | O6 |
| 无自动化测试，依赖人工验收 | — | 中 | O7 |

## 三、优化方向 O1-O7

### O1. 捕获处理状态 ✅ 已完成 (2026-08-06)

- `processing_status` / `embedding_status` / `graph_status` 三状态字段，`processing_error` / `processed_at`
- migration `20260806000000_add_processing_status.sql`，已应用正式库
- 2026-08-07 已部署至 Vercel Production + origin
- 存量行默认 `pending`，经回填/重试转 completed
- 详情见 `mem:core` + `mem:fix-processing-chain-2026-08-06` + `mem:incremental-refresh-and-graph-speedup-2026-08-07`

### O2. 搜索结果补查 ✅ 已完成

- `sourcePreviews` 已恢复（`api/search.ts`、`api/graph/search.ts`），HomePage 展示匹配片段；scope 经 Bearer 解析，不 fallback service role（提交 `a2b4864`）。

### O3. 文件生命周期（signed URL）

- **痛点**：文件 content 若存临时 signed URL，过期后不可访问。
- **范围**：`CapturePage.tsx`、`ItemDetailPage.tsx`、新 migration。
- **要求**：`captured_info` 保存 `storage_path`/`file_name`/`mime_type`/`file_size` 元数据；页面打开时按 `storage_path` 重新生成 signed URL；删除用存储路径而非 URL 字符串推导；保持 Private bucket、用户 UUID 首段、10 MiB 限制。
- **验收**：上传、刷新、过期后重载、删除清理、越权路径拒绝。

### O4. Settings 真实化

- **范围**：`SettingsPage.tsx`。
- **要求**：读取真实 Supabase 用户信息；Demo 明确标注"演示账户 + 共享数据"；统计查询真实 `captured_info`/`knowledge_nodes`/`knowledge_links` 数量，失败不显示假数字；删除 GPT/Claude/Whisper 假模型下拉，改为显示服务端实际模型与"未启用"能力；回填显示批次/成功/失败/取消/重试。
- **验收**：刷新后身份与统计一致；设置不伪装已生效功能。

### O5. ProcessPage

- **推荐**：删除独立静态 ProcessPage，处理状态整合到首页与详情页（依赖 O1）。
- **备选**：改为读取当前 scope 真实 pending/processing/failed 记录并实现真实重试。禁止继续扩展硬编码示例页。
- **验收**：删除则清理死代码与导航引用；保留则所有数据来自真实记录。

### O6. 图谱聚焦缩放 + 性能

- **范围**：`KnowledgePage.tsx`、`App.tsx`，必要时抽取纯函数工具与测试。
- **执行顺序**：
  1. 抽取 viewport 计算纯函数；
  2. 非线性缩放替代线性 floor/cap（如 `log2(fitScale+1)*base`），参数基于真实节点分布调参；
  3. 按详情面板是否打开计算真实可用图谱区域；
  4. 长中文标签增加边界安全距离；
  5. 覆盖孤立/小簇/中等/高连接/宽邻域五类节点；
  6. `React.lazy` 懒加载 KnowledgePage / Force Graph，降首屏包体。
- **验收**：390×844 与桌面视口下节点不裁切、标签可读、详情面板不遮挡、分类视图仍居中、重复聚焦不漂移；`npm run build` 通过。
- **参考**：`.trellis/tasks/07-13-focus-zoom-pending/PENDING.md` 四缺陷详情。

### O7. 自动化测试

- 优先覆盖：上传大小/MIME/扩展名边界；处理状态成功/失败/重试；搜索摘要补查与 scope；signed URL 路径生命周期；图谱 viewport 五类节点矩阵；Settings 真实身份与统计。

## 四、发布待办（发布后扩展）

| # | 事项 | 状态 | 说明 |
|---|------|------|------|
| 1 | 多模态解析 | ⬜ | 图片/音频/PDF/DOC 仅存元数据。方案：MiniMax ASR/文档解析或开源 Tesseract/Whisper。未实现时明确提示"暂未解析原文"，不伪造结果 |
| 2 | PWA 化 | ⬜ | `vite-plugin-pwa`：添加到主屏幕、离线缓存 |
| 3 | 原生壳打包 | ⬜ | Capacitor → iOS App Store / Android 商店（需开发者账号） |
| 4 | 推送通知 | ⬜ | 复习提醒/知识更新；FCM + Supabase Edge Functions；第一版先做首页"智能建议卡片"，不做系统通知 |
| 5 | 监控 & 崩溃收集 | ⬜ | Sentry（Vercel + React），覆盖前端/API/Supabase 错误 |
| 6 | 移动端适配增强 | ⬜ | Web Share API、原生文件选择、手势 |
| 7 | 冷启动方案 | ⬜ | Demo 样例空间、批量导入、少量内容即时洞察 |

## 五、高风险待确认项（工程整理专项）

以下事项影响运行行为、部署链路或历史兼容性，需单独确认后处理，不混入日常改动：

1. **Supabase Edge Function 遗留目录** `supabase/functions/server/`：主后端是 Vercel `api/*`，疑似遗留代码。删除前确认是否被某部署环境引用。
2. **未使用依赖清理**：`@mui/material`、`@mui/icons-material`、`@emotion/*`、`react-slick`、`react-dnd`、`react-dnd-html5-backend`、`react-responsive-masonry`、`react-popper`——逐组验证删除后 `npm run build` 无回归。
3. **Vite `/api/llm` dev proxy**：`vite.config.ts` 早期原型遗留，当前架构禁止前端直连 LLM provider；删除前确认无本地调试依赖。
4. **大规模目录迁移**：页面组件/业务逻辑逐步模块化（`src/features/*`），先抽 services/lib/types，再拆 UI 子组件，最后清理旧路径；不一次性大移动。
5. **RLS 与 demo mode 策略**：demo 共享 UUID、生产用户隔离、storage policy 是否进一步收紧——调整需 migration，先确认产品决策。

## 六、里程碑

| 阶段 | 内容 | 前置 |
|------|------|------|
| M1: 可部署 | ✅ 已完成（Embedding、生产部署、真实认证） | — |
| M2: 可分发 | PWA + 原生壳 | O1-O7 完成 |
| M3: 可运营 | 推送 + 监控 | M2 |
| M4: 体验优化 | 性能 + 移动端 + 多模态解析 | 持续 |

## 七、发布门禁

正式发布前必须单独完成：

1. `npm run typecheck`
2. `npm run build`
3. Vercel Production 环境变量与 Supabase project ref 一致
4. 未认证 LLM 端点的认证、限流或配额策略
5. 普通请求不得无条件使用 `SUPABASE_SERVICE_ROLE_KEY`
6. 真实 A/B 隔离验收（Email 路径已 13/13 PASS；手机号路径 BLOCKED）
7. 生产域名 HTTPS / Auth / Storage / 搜索 / 图谱公网烟测

## 八、相关文件索引

| 文件 | 内容 |
|------|------|
| `.serena/memories/ux-pain-points.md` | 十二大体验痛点 → 技术方案映射 |
| `.serena/memories/roadmap/dual-track-next-steps.md` | 后续路线与优先级（2026-08 已刷新） |
| `.trellis/tasks/07-13-focus-zoom-pending/PENDING.md` | 图谱缩放四缺陷详情 |
| `.trellis/tasks/07-13-app-deployment/TODO.md` | 发布待办历史记录（已并入本文档） |
| `.trellis/tasks/07-15-dual-track-roadmap/plan.md` | 历史执行计划（O 项字段/步骤细节参考） |
| `.trellis/tasks/07-13-user-scope-upload-security/` | 安全隔离执行记录 |
| `.serena/memories/acceptance/` | A/B 验收脚本与 Twilio 阻断记录 |
