# 处理链路修复（2026-08-06）

用户报告「处理总是失败」，根因排查与修复记录。

## 根因（叠加的三层问题）

### 1. `api/graph/extract.ts` AbortError 未捕获 → dev server 崩溃（主因）
- `callChatCompletion` 25s 硬超时 abort 后抛 `AbortError`，无 catch（只有 finally clearTimeout）
- unhandled rejection 冒泡 → Windows 下 Vercel CLI 的 serverless 模拟崩溃
  （`Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94`）
- 所有 graph/extract 请求返回 `FUNCTION_INVOCATION_FAILED` → 前端 processing_status=failed
- 修复：`callChatCompletion` + `fetchModels` 捕获 AbortError → 返回结构化结果
  （`{ ok:false, status:504/502, ... }`），绝不冒泡

### 2. 超时预算错配
- 单次超时 25s 太短：实测上游 MiniMax-M2.5 单次生成需 ~50s，有效调用被误杀
- 总预算 45s < 单次超时，预算永远先触发
- 修复：单次 55s（对齐 maxDuration 60s）、总预算 58s（> 单次超时）
- 前端 `src/lib/graph.ts` FETCH_TIMEOUT_MS=60s > 服务端 58s 预算 ✓

### 3. embedding 429 qpm 限流一次即判失败
- 批量重试时并发 embedding 调用触发上游 `RateLimitExceeded`（`metadata.reason: qpm limit exceeded`）
- `api/_lib/embedding.ts` 无 429 处理 → 直接 throw → embedding_status=failed
- 修复：429 指数退避重试（2s/4s/8s，最多 4 次）+ 30s 超时（防挂起占满 maxDuration）

### 4. 生产隐患：maxDuration 缺失
- 只有 `api/graph/extract.ts` 声明 `export const maxDuration = 60`
- 其余 5 个 LLM API（extract/embed/backfill/graph-embed/graph-backfill）生产 Hobby 默认 10s 会被杀（extract 实测 54s）
- 修复：全部补齐 `export const maxDuration = 60`

## 验证证据
- POST /api/graph/extract：`FUNCTION_INVOCATION_FAILED` → **HTTP 200 + 完整图谱 JSON**（34.9s / 7.6s 两次）
- 浏览器端到端：「EvolvMind 复习系统计划」pending → **completed/completed/completed**（66s 内）
- 全库 failed=0；UI 刷新后 completed=4 / failed=0（与数据库一致）
- `npm run typecheck` + `npm run build` 通过

## 附带清理
- `(res as any).writableEnded` → VercelResponse 类型加 `writableEnded?: boolean` 字段
- `catch (e: any)` → `catch (e: unknown)` + `in` 收窄
- `new Promise(resolve => setTimeout)` → `Promise.withResolvers`（tsconfig lib ES2022 → ES2024）

## 遗留提醒
- 本地 `.env.local` 的 MINIMAX key 已失效（len=9 占位符）；vercel dev 靠 `VERCEL_OIDC_TOKEN` 从远程拉有效 key。
  脱离 vercel dev 直接跑 API 会 403。生产不受影响（部署用远程 env）。
- embedding qpm 配额本身有限，极端批量仍可能部分限流（退避后仍失败可重试）。
- 改动未 commit、未部署；O1 验收阻塞已解除，可重新本地验收。

## 涉及文件
- `api/graph/extract.ts`（AbortError 捕获、55s/58s 超时预算）
- `api/_lib/embedding.ts`（429 退避重试、30s 超时、类型清理）
- `api/extract.ts`、`api/embed.ts`、`api/backfill.ts`、`api/graph/embed.ts`、`api/graph/backfill.ts`（maxDuration=60）
- `tsconfig.json`（lib ES2024）

---

## 追加：一键处理(批量重试)7/8 失败排查与修复（2026-08-06 晚）

### 根因
- 上游 QPM 限流（HTTP 429 qpm limit exceeded）：每项消耗 2-3 个 LLM 请求（graph chat + embedding），
  8 项 ≈ 16+ 请求在分钟级配额窗口内必然打爆（第一项就 429）。
- `api/graph/extract.ts` 的 `callChatCompletion` 无 429 退避 → 一次 429 直接判失败。
- 前端一键处理项间无等待；且 `retryCapturedItem` 中 `generateEmbeddingForRow` 是 fire-and-forget
  （未 await）→ embedding 失败不进入循环 catch，UI 失败计数与库实际不一致。

### 修复
1. `api/graph/extract.ts` `callChatCompletion` 加 429 指数退避（2s/4s/8s，最多 4 次，
   对齐 embedding.ts；循环内 `if (!r) continue` 收窄 null）。
2. `src/app/components/DataPage.tsx` `handleRetryAll` 项间 `await sleep(8000)` 限速
   （`Promise.withResolvers`），失败项收集继续跑完。
3. `src/lib/search.ts` `generateEmbeddingForRow` 改为返回 `Promise<void>`：失败落 failed 并抛错；
   `src/lib/process.ts` `retryCapturedItem` 中 await 它 → 批量/单条重试都等 embedding 完成、
   失败计入统计；`src/app/components/CapturePage.tsx` fire-and-forget 调用改
   `void ...catch(() => {})`。
4. 一键处理按钮条件 `retryAll !== null` → `retryAll?.running`：全部完成后按钮消失
   （无 actionable 项时不显示残留的完成态文本）。

### 实测结果（本地 vercel dev + 浏览器真实点击）
- 第 1 轮（无退避/限速）：8 项 → 1 成功 7 失败（graph/embed 全 429）
- 第 2 轮（退避+8s 限速，embed fire-and-forget）：8 项 → 6 成功，UI 计数 2（embedding 异步失败未计入）
- 第 3 轮（+ await embedding）：5 项 → 4 成功 1 失败（embed 45s 超时——devapi 本地 libuv 连接波动，
  非 429）；单条重试成功
- 终态：**全库 15 行 completed/completed/completed，failed=0**；UI 无「一键处理」按钮、无重试按钮
- `npm run typecheck` + `npm run build` 通过；`git diff --check` 通过

### 经验
- 本地 devapi（vercel dev）Windows 下 libuv 会刷 `Assertion failed: ... async.c line 94` 噪音，
  偶发请求连接断开（前端表现为 `Failed to fetch` / embed 45s 超时）——生产真 serverless 无此问题。
- 批量处理必须「服务端退避 + 前端项间限速」双保险；embedding 必须 await 才能统计准确。
