# 安全审计报告（2026-09-29）

> 范围：全部 API 端点、RLS/Storage 策略、前端密钥与 XSS、密钥流转。
> 结论：RLS 基线健全；审计中修复 4 个漏洞（2 high / 1 medium / 1 已于同日早些时候修复的 high)。

## 已修复

### HIGH-1 PATCH 更新缺 scope 过滤（越权写）
- `api/embed.ts`、`api/graph/embed.ts`:SELECT 带 scope 过滤，但 PATCH URL 只有 `id=eq.<请求体id>`。
  demo 路径用 service-role 绕过 RLS → 知道目标行 UUID 即可跨 scope 改写 embedding/状态字段。
- 修复：PATCH URL 追加 scope 过滤 + id `encodeURIComponent`。
- 验证：伪造外部 UUID → 404；demo 范围内节点 → 200 正常回填。

### HIGH-2 导入打错 scope 标（同日早些时候修复）
- `importJsonBackup` 剥离 user_id 后真实用户导入的行变 demo 可见。已改为统一打当前 scope 的 user_id。

### HIGH-3 documents/extract 越权读文件（同日早些时候修复）
- storage_path 未校验前缀，service-role 下载 → 可读他人文件。已强制 `scopeId/` 前缀。

### MED-1 models.ts 无认证
- 匿名 GET 即可用系统 key 探测上游模型清单。已加 `resolveRequestScope`(demo 可用）。
- 验证：匿名 401;demo 200。

## 审计通过项
- **RLS 矩阵**(20260713 迁移）:真实用户 `user_id=auth.uid()` 全操作；demo 仅 `user_id IS NULL` 行（共享沙盒，设计如此）;2024 年 `USING(true)` 老策略已全部 DROP。
- **Storage**：私有 bucket，前缀隔离（`uid/` 或 demo UUID/),update 有策略、demo 无 update（先删后插模式）。
- **RPC**(match_captured_info 等）:SECURITY INVOKER + RLS 生效，filter_user_id 来自已验证 scope。
- **topic_labels**：自有 scope + demo 固定 scope，无 update 策略（DELETE+INSERT 有意设计）。
- **触发器** remove_deleted_capture_refs:SECURITY DEFINER 但只清 OLD.id 引用，无注入面。
- **密钥**:custom/vision key 只发往服务端 env 配置的 baseUrl（请求不可控）;无 VITE_ 泄漏的服务端密钥；无端点回显 key;无密钥日志。
- **前端**：无 markdown 渲染器（纯文本展示，无 XSS 面）;chart.tsx 的 dangerouslySetInnerHTML 是 shadcn 标准模式，颜色来自开发者配置。
- **_lib**(insights/community/noise/similarity)：纯计算，无 DB 访问。
- **graph/extract、judge**：纯 LLM 端点，不写库，scope 已验证。
- graph/search 的 `or=(source.eq...)` 拼接：id 来自本 scope 前置查询，非用户直接输入。

## 已知遗留（未修，按优先级）
1. **LLM 端点无限流**（发布门禁已有此项）:demo 任何人可调 LLM 烧系统 key 额度；serverless 内存限流无效，需 Upstash/Vercel KV 或 Vercel WAF 规则。发布前必做。
2. **demo scope 可伪造**(`x-evolvmind-demo` header 无验证）：共享沙盒是设计决策，但意味着任何人可读写删 demo 数据（包括危险区清空）。生产演示接受；真实用户不受影响。
3. **api/account.ts 无频率限制**：注销端点认证后任意调用，影响有限（只删自己）。
4. 真实双账户 A/B 交叉验证仍以 2026-07-25（13/13 PASS）为准，本次为定向审计。

## 验证
tsc ✓ / build ✓ / npm test 52 ✓ / curl 越权回归（404/401)✓ / 正常路径（200)✓

## 追记:限流已落地(2026-09-29)
- 迁移 `20260929000000_add_rate_limits.sql`(已 db push):`rate_limit_counters` 表(无 RLS 策略,直连全拒)+ `rate_limit_hit(key, limit, window_seconds)` RPC(SECURITY DEFINER,原子 upsert 自增,1% 概率机会式清理旧窗口)。
- `api/_lib/rateLimit.ts`:`rateLimitOrThrow`(demo/匿名按 `x-forwarded-for` 首段 IP,真实用户按 user_id;RPC 故障放行——限流是成本保护不是安全边界)+ `sendRateLimited`(429 中文提示)。
- 接入 14 个端点:extract/judge/embed/backfill/recommend/search/summarize/graph/*(extract, embed, backfill, search, topicize, classify-topics, disambiguate)/documents/extract。默认 20/分钟;search、embed 30/分钟;summarize、backfill、topicize、classify-topics、disambiguate、judge 10/分钟;documents/extract 15/分钟。
- 实测:topicize(限10)连发 13 次 -> 前 10 次 400(业务校验)、11 次起 429 `{"error":"请求过于频繁,请稍后再试"}`。
- 注意:限流计数在业务校验之前(失败请求也计数),防探测/烧额度。
