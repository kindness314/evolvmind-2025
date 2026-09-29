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
O3 signed URL 生命周期           ✅ 已完成 (2026-08-18：storage 元数据列 + 动态 signed URL + storage_path 删除；migration 20260818000000 已应用)
O4 Settings 真实化               ✅ 已完成 (2026-08-18：真实用户/Demo 标注、删假模型下拉改服务端真实模型、删无行为假开关改数据隐私说明、删假存储用量)
O5 ProcessPage                   ✅ 已完成 (2026-08-18：删除静态页，清理 App.tsx 引用与 KEEP_ALIVE 清单)
O6 图谱聚焦缩放 + 懒加载         ✅ 已完成 (2026-08-18：可用区域/详情面板遮挡修复、移动端 390×844 验证、React.lazy 拆 chunk；仅剩滚轮缩放联动可选项)
O7 自动化测试                    ✅ 已完成 (2026-08-18：Vitest 32 用例覆盖上传边界/社区检测/噪声/时间窗/PPR/图桥；`npm test` 全过)
体验优化路线图 (P0-P7, 总结社区化/推送融合化/图谱规范化) ✅ **已完成** (2026-08-14, 评估综合 98%/叙事 8.8/CLUENER 84%)
图谱可视化分层改造 (话题总览→下钻→成员详情) ✅ 已完成 v4 (2026-08-14, 用户在浏览器验收中)
图谱显示优化 v5 (布局归一化/碰撞松弛/金色角配色/标签防重叠) ✅ 已完成 (2026-08-16；总览 0 重叠、节点 10-22px、标签 84 可读；`scripts/analyze-layout.mjs` 量化可复现)
话题模型命名归纳 ✅ 已完成 (2026-08-18；社区检测 + LLM 簇名/说明，`topic_labels` 缓存表，前端分批命名，侧边面板/总览显示模型簇名)
图谱分层最终方案·语义两层粒度 ✅ 已完成 (2026-08-19 用户验收"效果不错"；总览 12 宽主题 → 下钻1 细主题(LLM 分类 `topic_labels` ~59 项) → 下钻2 成员；`src/lib/community.ts` buildSemanticHierarchy + SEMANTIC_FINE_TOPICS + `src/lib/topicLayout.ts` 关联度布局)
语义主题图谱 + 图谱驱动预测 + 推荐理由建设化 ✅ 已完成 (2026-09-01, 提交 `83a01bc`)
自定义 Key + 服务状态检测 + 多模态读取 + 向量后台化 ✅ 已完成 (2026-09-03, 提交 `8fd5f49`)
2026-09-19 遗留集中修复        ✅ 已完成：滚轮缩放自动下钻/回退（浏览器实测）、alert→Sonner 10 处、旧模型名清理（abab*/gpt-3.5-turbo）、summarize 叙事 LLM 55s 超时、embedding key 回退（CHAT key 无 bge-m3 权限 → MINIMAX_API_KEY 兑底）、数据修复（无 embedding 41→0、悬空边已为 0、主题“其他”桶 255→39 重分类）。详见 `.serena/memories/2026-09-19-fixes-embedding-key-fallback.md`

手机号 OTP（Twilio）仍 BLOCKED（Trial + 中国短信），与 Email 验收分开记录，见 `.serena/memories/acceptance/`。

Git 状态（2026-09-19）：09-01 `83a01bc`（语义主题图谱+图谱驱动预测）、09-03 `8fd5f49`（自定义 Key+服务状态检测+多模态读取+向量后台化）已 commit；08-14 以来遗留的 working tree 改动（图谱 v5/O3-O7/语义两层文档、HomePage 推荐折叠、demo html）随 2026-09-19 修复一并入库。**是否 push 过 origin/vercel 需以 `git status` 实时为准**；推送仍需用户明确要求（AGENTS.md §9）。

## 二、已知问题与缺陷

| 问题 | 位置 | 严重度 | 关联项 |
|------|------|--------|--------|
| ~~存量 `note` 类型无图标、正文误标 `[文件]`~~ | `DataPage.tsx`/`ItemDetailPage.tsx` | ✅ 已修 (2026-08-16, note 与 text 同义展示) | — |
| ~~处理中死行(子步骤 pending、无 processed_at)永卡"处理中"且不可重试~~ | `DataPage.tsx` reconcileStatuses | ✅ 已修 (2026-08-16, 3 分钟无推进→failed；22 条存量死行已修复) | — |
| ~~DataPage/ItemDetail `select('*')` 拉 1.4MB embedding~~ | `DataPage.tsx`/`ItemDetailPage.tsx` | ✅ 已修 (2026-08-16, 显式列裁剪, 轮询流量降 14.5x) | — |
| ~~demo 数据 45 条重复捕获（评估污染）~~ | demo scope captured_info | ✅ 已清理 (2026-08-16, 删 25 条完全重复, 144 条全 completed, 引用已清理) | — |
| 188 条悬空链接（存量） | `knowledge_links` | ✅ 已清零（2026-09-19 复查为 0，无需操作） | — |
| ~~41/1000 节点无 embedding~~ | `knowledge_nodes` | ✅ 已修 (2026-09-19：根因=MINIMAX_CHAT_API_KEY 无 bge-m3 权限而 MINIMAX_API_KEY 有；`embedding.ts` 加 key 回退后 backfill 全量回填，剩余 0) | — |
| ~~图谱页/推荐/总结被 PostgREST 1000 行上限静默截断~~ | `KnowledgePage.tsx`/`api/recommend.ts`/`api/summarize.ts` | ✅ 已修 (2026-08-16, Range 分页拉全；1027 节点/1570 边/30d 120 捕获不再截断) | — |
| ~~设置页数据统计为硬编码假数据~~ | `SettingsPage.tsx` | ✅ 已修 (2026-08-16, 真实计数) | — |
| ~~图谱线性 fitScale 不感知邻域大小~~ | `KnowledgePage.tsx` | ✅ 已修 (log2 非线性缩放, 2026-08-14) | O6 |
| ~~详情面板打开后节点被裁切~~ | `KnowledgePage.tsx` | ✅ 已修 (可用视口, 2026-08-18) | O6 |
| ~~分类视图长标签溢出~~ | `KnowledgePage.tsx` zoomToFit | ✅ 已修 (话题标签画在节点内) | O6 |
| ~~移动端缩放感不一致~~ | `KnowledgePage.tsx` | ✅ 已修 (2026-08-18) | O6 |
| ~~侧边面板（w-52）遮挡画布左 46% 下方节点不可点击~~ | `KnowledgePage.tsx` | ✅ 已修 (2026-09-03 侧栏默认折叠 + 「话题列表」按钮展开) | O6 |
| ~~悬空捕获引用致节点"N 条"计数虚高（demo 实测约 30%）~~ | `knowledge_nodes.source_captured_ids` / `knowledge_links.evidence_captured_ids` | ✅ 数据已修复 (2026-09-26 REST 清理 232 节点/313 关系共 778 条悬空引用；验证：专注度 17→10、推存面板与话题状况计数与真实记录一致) | — |
| ⏳ migration `20260926000000_fix_dangling_captured_refs`（存量清理 + 删除捕获自动清引用触发器）**已建文件但未能 push**：本机 supabase CLI 直连 PG 超时（代理不承载 PG 协议），需在可直连网络下跑 `supabase db push --linked --yes`；应用层已加 `src/lib/captureRefs.ts` 删除后同步清理兜底 | migration 文件 | ⬜ 待 push | — |
| ~~topic_labels 用 limit(5000) 拉取被 PostgREST max_rows=1000 静默截为 1000，60 个节点丢失分类落入「其他」，话题成员数/推荐数虚低（工作 353→316）~~ | `KnowledgePage.tsx` | ✅ 已修 (2026-09-27 改分页 range 拉全) | — |
| ~~graph.ts 合并时全量拉 nodes/links 未分页，超 1000 后 merge/dedupe 看不到老行 → 重复建节点/边~~ | `src/lib/graph.ts` | ✅ 已修 (2026-09-27 分页拉全) | — |
| ~~DataPage 主列表查询未分页，超 1000 条记录丢尾部~~ | `DataPage.tsx` | ✅ 已修 (2026-09-27 分页拉全) | — |
| ~~滚轮缩放自动下钻/回总览未做~~ | `KnowledgePage.tsx` | ✅ 已修 (2026-09-19：onZoomEnd + 程序化 zoom 抑制，放大 1.7x 下钻 / 缩小 0.55x 回退，浏览器实测双向通过) | O6 |
| ~~Settings 显示 GPT-4/Claude/Whisper 假模型下拉~~ | `SettingsPage.tsx` | ✅ 已修 (O4, 2026-08-18) | O4 |
| ~~聊天模型候选列表含被拒绝的旧模型名~~ | `api/extract.ts`, `api/summarize.ts`, `api/judge.ts` | ✅ 已修 (2026-09-19：删 abab*/gpt-3.5-turbo，默认改 MiniMax-M2.5) | O4 |
| ~~部分页面用 `alert()` 而非 Sonner toast~~ | CapturePage/DataPage/ItemDetailPage | ✅ 已修 (2026-09-19：10 处全替换 toast.error) | — |
| ~~多模态文件仅存元数据，不解析正文~~ | CapturePage 上传链路 | ✅ 已修 (2026-09-03：txt/md 前端读正文、pdf/docx 后端 pdf-parse/mammoth、图片 tesseract.js OCR、语音 Web Speech API) | — |
| ~~生产构建 ~840KB JS chunk~~ | force-graph 未动态 import | ✅ 已修 (O6 懒加载, 2026-08-18；主 chunk ~682KB + KnowledgePage 227KB) | O6 |
| ~~无自动化测试，依赖人工验收~~ | — | ✅ 已补 (O7 Vitest 32 用例, 2026-08-18) | O7 |

## 三、优化方向 O1-O7

### O1. 捕获处理状态 ✅ 已完成 (2026-08-06)

- `processing_status` / `embedding_status` / `graph_status` 三状态字段，`processing_error` / `processed_at`
- migration `20260806000000_add_processing_status.sql`，已应用正式库
- 2026-08-07 已部署至 Vercel Production + origin
- 存量行默认 `pending`，经回填/重试转 completed
- 详情见 `mem:core` + `mem:fix-processing-chain-2026-08-06` + `mem:incremental-refresh-and-graph-speedup-2026-08-07`

### O2. 搜索结果补查 ✅ 已完成

- `sourcePreviews` 已恢复（`api/search.ts`、`api/graph/search.ts`），HomePage 展示匹配片段；scope 经 Bearer 解析，不 fallback service role（提交 `a2b4864`）。

### O3. 文件生命周期（signed URL）✅ 已完成 (2026-08-18)

- **痛点**：上传文件的临时 signed URL（60 分钟）被存入 `captured_info.content`，过期后详情/列表不可访问。
- **方案**：
  - migration `20260818000000_add_storage_metadata.sql`（已应用正式库）：`captured_info` 加 `storage_path`/`file_name`/`mime_type`/`file_size`
  - `CapturePage.tsx`：上传后 content 存**文件描述文本**（文件名/类型/大小），storage_path 存对象路径，不再存 signed URL
  - `ItemDetailPage.tsx`：按 `storage_path` 动态生成 signed URL（60 分钟窗口，重进详情重新生成）用于 photo/audio 预览；正文显示 `file_name`；删除优先 `storage_path`，旧数据回退 content URL 推导
  - `DataPage.tsx`：`CAPTURED_COLUMNS` 加列；photo 列表缩略图按 storage_path 动态生成（`photoUrlMap` ref 缓存防轮询重复请求）；批量删除优先 `storage_path`
  - 存量数据兼容：`storage_path` 为 null 时读取/删除回退 content 内旧 URL
- **验证**：浏览器实测——上传后 content=描述文本 + 四元组元数据 ✓；详情页图片动态 signed URL 显示 ✓；数据页缩略图 ✓；删除后 storage 对象与 DB 行均消失 ✓（demo scope 目录清空）；旧行兼容代码就位（demo 无存量文件行，未实测）

### O4. Settings 真实化 ✅ 已完成 (2026-08-18)

- **范围**：`SettingsPage.tsx`。
- **完成项**：
  1. 真实用户信息（`supabase.auth.getUser()` → email/name/首字母头像）；Demo 模式（`localStorage.demo_auth`）明确标注"演示账户 + 共享演示数据"琥珀色标签，且不请求会话
  2. 数据统计真实计数（2026-08-16 已修，保留）
  3. **删除 GPT-4/Claude 3/Whisper 三个假模型下拉** → "模型与能力"卡：调 `/api/models` 显示服务端真实文本模型（过滤 bge/embed，实测 25 个）+ BAAI/bge-m3（1024 维）嵌入 + "图像识别/语音转写/文档解析未启用"说明
  4. **删除 4 个无行为假开关**（消息通知/自动同步/隐私保护/深色模式）→ "数据与隐私"卡：数据存储/AI 处理/未启用能力如实说明
  5. 回填批次/成功/失败/取消/重试（2026-08-16 已实现，保留）
  6. 删除"存储管理 2.3 GB / 10 GB"假用量、无功能"导出数据/帮助与反馈"；保留"关于 v1.0.0"+"运行环境（演示/个人）"
- **验证**：浏览器实测——演示账户标注 ✓、无假模型下拉 ✓、无假开关（switchCount=0）✓、模型区与服务端 `/api/models` 一致 ✓、无假存储用量 ✓；非 demo（未登录）显示登录页不崩 ✓；typecheck + build ✓

### O5. ProcessPage ✅ 已完成 (2026-08-18，采用推荐方案删除)

- 静态硬编码页（产品会议要点/设计草图/客户访谈）无任何真实数据来源，且底部导航无入口（不可达）
- 删除 `ProcessPage.tsx`；App.tsx 清理：import、`case 'process'`、`Page` 类型、`KEEP_ALIVE_PAGES`
- 处理状态已由 O1 整合在首页/详情页（重试/一键处理），无需独立页面
- 验证：grep 无残留引用；typecheck + build ✓
### O6. 图谱聚焦缩放 + 性能 ✅ 已完成 (2026-08-18)

- **已完成 (2026-08-14)**：log2 非线性缩放（`Math.log2(fitScale+1)*0.85+1.0` 修 PENDING 缺陷1）；图谱分层改造（话题总览→下钻→成员详情，`src/lib/community.ts` buildHierarchicalGraph）；力导向按渲染规模调优；离散色板 + 对数大小 + 外部标签。
- **验收**：390×844 与桌面视口下节点不裁切、标签可读、详情面板不遮挡、分类视图仍居中、重复聚焦不漂移；`npm run build` 通过。
- **参考**：`.trellis/tasks/07-13-focus-zoom-pending/PENDING.md`；记忆 `2026-08-14-optimization-roadmap-graph-visualization.md`。
### O7. 自动化测试 ✅ 已完成 (2026-08-18)

- 引入 **Vitest**（`vitest.config.ts` + `npm test` = `vitest run`），`tests/` 目录 5 文件 32 用例全通过
- 覆盖：
  1. **上传边界**（`tests/upload-validation.test.ts`）：photo=image/*、audio=audio/*、import 扩展名白名单（pdf/doc/docx/txt/md，大小写不敏感）、10 MiB 严格上限（恰好通过/超出拒绝）——校验函数已抽为 `src/lib/uploadValidation.ts`（CapturePage 复用）
  2. **服务端社区检测**（`tests/api-community.test.ts`）：贪心模块度两簇不串、自环/重复边去重、孤立节点不成簇、minNodes 过滤、演化判定（growing/shrinking/stable）、社区描述
  3. **前端分层聚合**（`tests/frontend-community.test.ts`）：buildHierarchicalGraph 社区聚合、边缘节点吸收、其他知识桶（灰色 #94A3B8）、金色角配色互异、孤立节点计数
  4. **噪声过滤**（`tests/noise.test.ts`）：无标签短正文判噪声、有标签/实质内容不误判
  5. **推荐/总结信号**（`tests/insights.test.ts`）：splitByWindow 时间窗、buildGraphIndex 节点↔捕获映射（source_captured_ids）、二跳桥（mid 不关联捕获、共享标签排除）、PPR 沿链衰减、对称图多种子均衡、幽灵种子全 0
- **依赖注意**：`npm install -D vitest` 会重解析 `^2.95.3` 的 supabase-js；已锁回 HEAD 的 **2.101.1**（package-lock 同步）。`PostgrestFilterBuilder` 类型 import 从 `@supabase/supabase-js` 改为定义源 `@supabase/postgrest-js`（2.101.x 不再 re-export，旧 2.95.x 也不稳）——新旧版本均兼容；fetchAllPaged 改显式行类型（`KnowledgeNodeRow`/`KnowledgeLinkRow`）



## 四、发布待办（发布后扩展）

| # | 事项 | 状态 | 说明 |
|---|------|------|------|
| 1 | 多模态解析 | ✅ | 2026-09-03 已实现：txt/md 正文、pdf/docx 提取、图片 OCR、语音转写 |
| 2 | PWA 化 | ✅ | 2026-09-29 已实现：vite-plugin-pwa(autoUpdate SW、静态预缓存、API/Supabase NetworkOnly)、manifest(中文名/品牌蓝/maskable 图标)、index.html theme-color+apple 元信息、安全区适配。浏览器实测 manifest/SW/渲染 ✓ |
| 3 | 原生壳打包 | ⬜(Android 壳已就绪) | 2026-09-29：Capacitor Android 工程已生成(WebView 加载线上站，始终最新)、品牌图标全密度已生成；本机无 Android SDK，APK 走 GitHub Actions(`.github/workflows/android-apk.yml`)或装 SDK 后 `npm run apk`。iOS 需 Mac+开发者账号 |
| 4 | 推送通知 | ⬜ | 复习提醒/知识更新；FCM + Supabase Edge Functions；第一版先做首页"智能建议卡片"，不做系统通知 |
| 5 | 监控 & 崩溃收集 | ⬜ | Sentry（Vercel + React），覆盖前端/API/Supabase 错误 |
| 6 | 移动端适配增强 | ⬜ | Web Share API、原生文件选择、手势 |
| 7 | 冷启动方案 | ⬜ | Demo 样例空间、批量导入、少量内容即时洞察 |

## 五、高风险待确认项（工程整理专项）

以下事项影响运行行为、部署链路或历史兼容性，需单独确认后处理，不混入日常改动：

1. ~~**Supabase Edge Function 遗留目录** `supabase/functions/server/`~~：✅ 已删（2026-09-19；全仓搜索仅 IMPROVEMENT.md 自引用，5 个月未动的死代码）
2. ~~**未使用依赖清理**~~：✅ 已确认无需操作（2026-09-19；`@mui/*`/`react-slick`/`react-dnd` 等早已不在 package.json；lock 中仅剩合法的 `@radix-ui/react-popper` 与 motion 传递依赖 `@emotion/is-prop-valid`）
3. ~~**Vite `/api/llm` dev proxy**~~：✅ 已删（2026-09-19；全仓搜索无 `/api/llm` 调用，安全隐患消除）
4. **大规模目录迁移**：页面组件/业务逻辑逐步模块化（`src/features/*`），先抽 services/lib/types，再拆 UI 子组件，最后清理旧路径；不一次性大移动。
5. **RLS 与 demo mode 策略**：demo 共享 UUID、生产用户隔离、storage policy 是否进一步收紧——调整需 migration，先确认产品决策。

## 六、里程碑

| 阶段 | 内容 | 前置 |
|------|------|------|
| M1: 可部署 | ✅ 已完成（Embedding、生产部署、真实认证） | — |
| M2: 可分发 | PWA ✅ + Android 壳工程 ✅(待出 APK) | O1-O7 已完成 ✅(2026-09-29 推进) |
| M3: 可运营 | 推送 + 监控 | M2 |
| M4: 体验优化 | 性能 + 移动端 + 多模态解析 | 持续 |

## 七、发布门禁

正式发布前必须单独完成：

1. `npm run typecheck` ✅（持续通过）
2. `npm run build` ✅（持续通过；主 chunk ~682KB 大 chunk 警告为 Vite 阈值，非失败）
3. **Vercel Production 环境变量与 Supabase project ref 一致** ⬜（需推送部署后核对 `SUPABASE_URL`/`ANON_KEY`/`MINIMAX_KEY`）
4. 未认证 LLM 端点的认证、限流或配额策略 ✅（2026-08-18 已修：`/api/extract`、`/api/graph/extract`、`/api/judge` 加 `resolveRequestScope` —— Demo（`X-EvolvMind-Demo`/body.demo）或真实 Bearer，匿名 401；前端 `ai.ts`/`graph.ts` 调用改用 `getApiAuthHeaders()`；实测匿名 401/Demo 200）✅（2026-09-29 补：全量 LLM 端点接入 Supabase RPC 固定窗口限流 `rate_limit_hit`，真实用户按 user_id、demo 按访客 IP，默认 20/分钟（搜索 30、重负载 10），超限 429；`/api/models` 也补了认证。详见 `.serena/memories/2026-09-29-security-audit.md`）
5. 普通请求不得无条件使用 `SUPABASE_SERVICE_ROLE_KEY` ✅（通过 + 可审计 Demo 例外：仅 Demo 标识（header/body.demo）走 service-role 固定 UUID，普通请求经 Bearer → RLS 用户隔离）
6. 真实 A/B 隔离验收 ✅ **Email 路径已 PASS（2026-07-25，13/13，提交 `2fa3a2b` 关闭任务）**；手机号路径 BLOCKED（Twilio Trial + 中国短信，分开记录）
7. 生产域名 HTTPS / Auth / Storage / 搜索 / 图谱公网烟测 ⬜（需推送部署后公网执行）

## 八、相关文件索引

| 文件 | 内容 |
|------|------|
| `.serena/memories/ux-pain-points.md` | 十二大体验痛点 → 技术方案映射 |
| `.serena/memories/roadmap/dual-track-next-steps.md` | 后续路线与优先级（2026-08 已刷新） |
| `.trellis/tasks/07-13-focus-zoom-pending/PENDING.md` | 图谱缩放四缺陷详情 |
| `.trellis/tasks/07-13-app-deployment/TODO.md` | 发布待办历史记录（已并入本文档） |
| `.trellis/tasks/08-13-optimization-roadmap/plan.md` | 体验优化路线图（P0-P7，2026-08-13 制定，**2026-08-14 已完成**） |
| `.trellis/tasks/07-15-dual-track-roadmap/plan.md` | 历史执行计划（O 项字段/步骤细节参考） |
| `.trellis/tasks/07-13-user-scope-upload-security/` | 安全隔离执行记录 |
| `.serena/memories/2026-08-14-optimization-roadmap-graph-visualization.md` | **本次完成记录**：P0-P7 + 图谱分层改造详情、评估结果、验收指引 |
| `.serena/memories/acceptance/` | A/B 验收脚本与 Twilio 阻断记录 |
