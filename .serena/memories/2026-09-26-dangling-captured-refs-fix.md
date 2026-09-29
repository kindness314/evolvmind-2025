# 2026-09-26 悬空捕获引用修复 + 推荐精细化

## 根因
删除捕获记录（批量删/详情页删）不清理 `knowledge_nodes.source_captured_ids` /
`knowledge_links.evidence_captured_ids` 里的 id → 悬空引用堆积 → 节点「N 条」计数虚高。
demo 实测约 30% 悬空（例：节点「专注度」17 条中 7 条指向已删记录）。

## 已做
1. **REST 数据清理（已生效）**：anon key + demo scope PATCH（RLS 允许）。
   232 节点剔除 396 悬空 id；313 关系剔除 382 悬空 id。
   验证：专注度 17→10 条 ✓；推荐面板分组节点数 305→280（25 个节点的记录全是悬空，被正确滤掉）✓。
2. **migration 文件已建未 push**：`supabase/migrations/20260926000000_fix_dangling_captured_refs.sql`
   = 存量清理（全 scope）+ `trg_captured_info_cleanup_refs` 触发器（AFTER DELETE 自动 array_remove）。
   本机 `supabase db push --linked` 直连 PG 超时（代理 7890 只走 HTTP，不承载 PG 协议），
   **push 后触发器与应用层清理会双跑（无害幂等）**。
   ⚠️ 补充排查：demo 之外若还有删除捕获的路径（脚本/管理端），以触发器为唯一兜底。
3. **应用层防再发（已生效）**：新增 `src/lib/captureRefs.ts` `cleanupCaptureRefs(ids)`，
   两处删除路径（DataPage 批量删、ItemDetailPage 详情删）删完捕获后同步从节点/关系剔除 id
   （PostgREST `cs` 数组包含过滤定位受影响行；失败不阻塞删除）。
   端到端验证：造临时捕获+节点 → 删除 → 节点引用自动清空 ✓（pass:true）。
4. **前端（KnowledgePage.tsx）**：
   - 话题状况：memberCount（节点数）不再冒充「内容条数」；新增 capturedCount = 成员
     source_captured_ids **并集**（同一记录可关联多节点，不能累加）。文案「这里有 N 个知识节点 · M 条记录」。
   - 节点推荐：下钻小话题层（drillTopicId）top 4→top 8，排序 记录数→关联数（degreeMap
     由 graphData.links 算，端点用 `linkEndpointId` 因 force-graph 会把 source/target 变成节点对象），
     条目显示「N 条 · M 关联」。其余层不变。
   - 验证（浏览器 demo）：专注力下钻面板 8 项含关联数 ✓；话题状况「61 个知识节点 · 36 条记录」✓。

## 环境踩坑
- supabase CLI `db push`/`migration list` 在本机挂起（直连 aws-1-ap-northeast-1 pooler 5432 不通），
  加 HTTP(S)_PROXY 无效（PG 协议不走 HTTP 代理）。
- 但 **REST/PostgREST HTTPS 从 bash 直连可用**（PATCH knowledge_nodes/links 成功，demo RLS 允许 update）。
- 浏览器 tab.reload 不是函数——用 `location.reload()`。

tsc ✓ / build ✓（2026-09-26）

## 2026-09-27 续：PostgREST max_rows=1000 静默截断同类排查
用户反馈「推荐数量还是不对」→ 抓到第二个同类根因：**topic_labels 用 `.limit(5000)` 拉取，
被 PostgREST max_rows=1000 截为 1000 行**（limit 大不过 max_rows），1060 个节点里 60 个拿不到分类
→ 全落「其他」桶（总览隐藏）→ 画布话题数虚低（工作 353→316）、推荐面板虚低（307→280）。
修复并全仓排查同模式：
- `KnowledgePage.tsx` topic_labels 加载 → range 分页 ✓（验证：工作 353/307 与 DB 一致）
- `src/lib/graph.ts` applyGraphToSupabase 全量拉 nodes/links **未分页** → 超 1000 后 merge/dedupe
  看不到老行会**重复建节点/边** → 已改分页（影响最大的隐患）
- `DataPage.tsx` 主列表查询未分页 → 已改分页（当前 156 条未触发，属排雷）
- 已分页的：DataPage loadCapturedTopics、KnowledgePage fetchAllPaged(nodes/links)、api/* fetchAllRows ✓
规律：**任何 PostgREST 全表/大集合查询都必须 range 分页，limit(N>1000) 无效且静默**。
另：画布气泡数=话题全部成员；推荐面板数=有记录节点（≥1 条），后者恒 ≤ 前者，差异是 0 记录节点。

## 2026-09-28 续:全局 Toaster 从未挂载
`<Toaster />` 只在 ui/sonner.tsx 定义、**从未在任何页面渲染** -> 全应用所有 toast.* 静默吞掉
(错误提示不可见,违反 AGENTS.md「失败必须对用户可见」)。已在 App.tsx 根部挂载
`<Toaster position="top-center" richColors closeButton />`。
同日:个人中心新增「数据管理」(src/lib/export.ts:JSON 完整备份 + Markdown 可读存档 +
真实存储用量 file_size 求和;全部 range 分页)、资料自定义(profile_name/profile_avatar 存
localStorage)、删除数据与隐私/模型与能力/关于/运行环境静态卡。
注意:knowledge_nodes 无 first_seen_at 列、links 类型列叫 relation_type(不是 type)。

### 2026-09-28 续3:个人中心账号管理 + 危险区清空
- **账号管理**(仅真实账户,SettingsPage 卡片):改邮箱/改密码走前端 `supabase.auth.updateUser`;**注销账户走新端点 `api/account.ts`**(验证 Bearer -> service role 按已验证 user_id 删 links/nodes/topic_labels(列名是 scope_id)/captured_info + Storage `userId/` 前缀文件 -> `auth/v1/admin/users/:id` 删除)。前端注销成功后 signOut + 清 session。
- **危险区清空**(`wipeAllData()` in `src/lib/export.ts`,真实+Demo 均可用):Storage 文件 -> links -> nodes -> topic_labels -> captured_info -> 本地 nodeTopics 缓存,纯前端 RLS 删除;输入「清空」确认。
- **踩坑**:`/object/sign` 返回的 signedURL 是 `/object/sign/...` **不带 `/storage/v1` 前缀**,直接拼 host 会 404;Storage 对已有对象 POST+`x-upsert` 触发 UPDATE 策略被拒(RLS 无 update 策略时) -> **先 DELETE 再 INSERT**(同 topic_labels 模式)。
- **验证**:Demo 清空(157/980/1519/1 文件归零)-> 全量备份导入(同量恢复)闭环实测 ✓;清空后导入的附件字节级一致(101B 测试 PNG 上传下载一致)✓。tsc/build ✓。

### 2026-09-28 续4:vision 专用 Key + 状态检测去假阳性
- **vision 专用 Key**(可选):前端 `getVisionApiKey/setVisionApiKey`(apiKey.ts,同款混淆存储)-> 请求带 `X-Vision-Key` 头;后端 `resolveVisionKey`(api/_lib/apiKey.ts):专用头 -> 主自定义 key -> 环境 key。documents/extract 的 vision/ASR 走此链。
- **关键发现**:两把系统 Key(CHAT/API)在 edgefn 网关上**全部 vision 模型 403 ModelNotAllowed**(GLM-4.5V/MiniMax-VL-01/glm-4v-flash/GLM-4V/qwen-vl-max 均试;M2.5 文本模型忽略图片),所以 vision 只能靠用户专用 Key 或新环境 Key。
- **extractImageText 加固**:key 回退链(自定义->CHAT->API)+ 模型候选(MINIMAX_VISION_MODEL|GLM-4.5V -> MiniMax-VL-01)+ console.warn 日志(不再静默吞错)。
- **状态检测诚实化**:`GET /api/documents/extract?deep=1` 用 1x1 PNG **真实调一次 vision**,返回 hasVision;只查 key 存在会假阳性(key 有但模型无权限)。OCR 行改 'ok'(本地可用不算降级),warn 徽标文案「降级」->「提示」。
- **捕获链路**:photo 模式 OCR 文字为空时 -> 自动调 /api/documents/extract(vision);extractDocumentText 认证改走 getApiAuthHeaders(带自定义+vision Key)。
- 实测:深测 `{hasKey:true, hasVision:false}` ✓;设置页显示「当前 Key 无 vision 模型权限,可在上方填专用 Key」✓;测试捕获已清理。tsc/build ✓。

### 2026-09-28 续5:隔离审计 — 2 个漏洞修复 + schema 事实
- **表结构事实**:`captured_info` 只有 `user_id`(demo=null);`knowledge_nodes/links` 的 `scope_id` 是 **GENERATED 列**(由 user_id 推导:null->demo UUID,真实->uid),**不能显式插入**(400 non-DEFAULT value);`topic_labels` 是独立 scope_id 列(可显式写,但无 update 策略,写用 DELETE+INSERT)。
- **漏洞1(已修)**:`api/documents/extract.ts` 用 service-role 按请求体 `storage_path` 下载文件但**未校验 scope 前缀** -> 任何登录/demo 调用者可提取他人文件文本。修复:强制 `storage_path.startsWith(scopeId + '/')` 否则 403;顺带修 `.eq('scope_id')` 失效列(captured_info 无此列,改 demo 用 `user_id is null` / 真实用 `user_id=eq`)。curl 实测:他人路径 403 ✓,自有路径放行 ✓。
- **漏洞2(已修)**:`importJsonBackup` 旧逻辑剥离 user_id 后插入 -> 真实用户导入的行 user_id=null 变 demo 可见/自己不可见。修复:`stamp()` 统一剥离文件内 user_id/scope_id 并打当前 scope 的 user_id(真实=uid,demo=null,scope_id 由 GENERATED 列自动推导)。
- 回归:demo 全量备份再导入「新增 0/跳过 2656」幂等 ✓;新 id 插入+附件 ✓;tsc/build ✓。
- **未变**:真实 A/B 双账户交叉验证仍以 2026-07-25 记录(13/13 PASS)为准;本次只修了审计发现的单点,未重做全量 A/B。
