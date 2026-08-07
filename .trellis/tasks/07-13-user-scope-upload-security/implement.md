# 执行计划

## 阶段 1：请求范围与认证

1. 读取并确认所有敏感 API 的认证入口和前端调用合同。
2. 修改 `api/search.ts`、`api/graph/search.ts` 使用 `resolveRequestScope`；统一处理 401 与配置错误。
3. 修改 `src/lib/search.ts`、`src/lib/graphSearch.ts` 发送 Bearer token 或 Demo 标记。
4. 修改 `App.tsx` 登出流程，调用 `supabase.auth.signOut()` 并清理 Demo 状态。
5. 检查 `api/embed.ts`、`api/backfill.ts` 是否暴露无认证写入；在不破坏现有设置页流程的前提下收口。

## 阶段 2：数据库与 Storage 隔离

1. 新增时间戳 migration，撤销/替换公开表和 Storage 策略。
2. 为真实用户与固定 Demo scope 建立明确策略，确保 `auth.uid()` 不能访问其他用户数据。
3. 调整捕获文件写入路径携带 scope，避免 Storage policy 无法判断归属。
4. 校验 migration SQL 语法与现有表字段、默认值及 RLS 交互。

## 阶段 3：上传与推荐正确性

1. 在 `CapturePage.tsx` 增加 10MB、MIME、扩展名校验，保存前再次校验。
2. 保留当前非文本元数据能力，但错误提示必须说明尚未执行 OCR/ASR；不在本任务伪造解析结果。
3. 修改 `api/recommend.ts` 使用 `source,target`，查询失败不再静默返回空链接。

## 阶段 4：验证与记录

1. 运行 `npm run typecheck`。
2. 运行 `npm run build`。
3. 用静态/单元级可复现脚本验证：无 token 拒绝、客户端 scope 不覆盖、推荐字段正确、超 10MB/不支持文件不上传。
4. 记录远程 Supabase migration 与双用户隔离验收所需步骤；无法访问生产凭据时明确标注未完成，不伪造通过。
5. 更新 `check.jsonl`、任务状态与必要的项目规范记录。

## Verification Record

- `npm run typecheck`: PASS after final Demo-key scope adjustment.
- `npm run build`: PASS after final Demo-key scope adjustment; Vite reports the existing large JS chunk warning (840.52 kB), not a build failure.
- Static security checks: PASS — search APIs resolve Bearer/demo scope and ignore request-body user/scope filters; embedding/backfill endpoints require the same scope; upload checks enforce 10MB and allowed type; recommendation uses `source/target` and surfaces link query failures.
- `supabase db push --linked --yes`: PASS. Applied `20260713000000_secure_user_scope_and_storage.sql` and `20260713000500_restore_captured_files_bucket.sql` to project `wocchwrvlhqdwtvfwfab`.
- `supabase migration list --linked`: PASS. Both security migrations are present remotely; a subsequent `supabase db push --linked --yes` reported `Remote database is up to date`.
- Remote smoke checks: PASS for anonymous table filtering (`captured_info?user_id=not.is.null` returned `[]`), Demo Storage path upload, and private object retrieval through the authenticated Storage endpoint. Public object URL returned `Bucket not found`/HTTP 400, confirming public access is disabled.
- Remote data observation: existing rows are Demo rows (`user_id = null`, `scope_id = 00000000-0000-0000-0000-000000000000`). A two-real-account isolation test was not run because no test account credentials were available; authenticated-user isolation remains to be exercised with two disposable accounts.
- Remote Supabase Auth registration/login and signed URL generation were not run in this environment. Do not treat those flows as verified.
- `git diff --check` on changed files: PASS. Existing `.gitignore` trailing whitespace was excluded from this check and remains outside this task.

## 待用户执行：真实账户隔离验收

### 前置条件

1. 在 Supabase Dashboard → Authentication → Providers 开启 Phone，并配置可用 SMS provider（如 Twilio）。
2. 准备两个可接收验证码的 disposable 测试手机号：账户 A、账户 B；不要使用生产数据。
3. 使用两个独立浏览器环境（普通窗口 A、无痕窗口 B），避免共享 Supabase session。

### 账户 A 流程

1. 清理旧状态：`localStorage.removeItem('demo_auth')`、`localStorage.removeItem('supabase_session')`，刷新应用。
2. 用手机号 A 获取短信验证码并登录。
3. 保存文字 `账户 A 私有测试内容 20260713`，确认列表、搜索、知识图谱均能看到该内容。
4. 上传一个小于 10MB 的 `.txt` 或图片文件，确认保存成功。
5. 退出登录，确认回到登录页。

### 账户 B 流程

1. 在独立浏览器环境中用手机号 B 登录。
2. 确认看不到账户 A 的文字、文件、搜索结果、推荐内容和图谱节点。
3. 保存文字 `账户 B 私有测试内容 20260713` 并上传一个小于 10MB 的文件。
4. 确认账户 B 只能看到自己的内容。

### 交叉隔离与防篡改

1. 切回账户 A，确认 A 数据仍可见、B 数据不可见；再切回 B 做反向确认。
2. 在账户 A DevTools Console 对 `/api/search` 发送 Bearer 请求，同时伪造 body 中的 `user_id`、`scope_id` 为 B；期望仍只按 A 的 token 查询。
3. 确认文件路径首段分别是 A/B 的用户 UUID；公开 Storage URL 不能访问，应用生成的 signed URL 可在有效期内访问。
4. 用一个超过 10MB 的文件和一个不支持扩展名的文件测试，确认前端拦截且不会产生 Storage 对象。

### 验收记录

将每项记录为 PASS/FAIL，并保留失败时间、浏览器环境、错误信息。通过标准：A/B 互不可见，搜索、推荐、图谱和 Storage 均按用户隔离；失败项不得标记为通过。
***

## Current User Acceptance Status (2026-07-15)

### Completed before real-account testing

- `npm run typecheck`: PASS.
- `npm run build`: PASS. Vite reported the existing large JavaScript chunk warning; the build did not fail.
- Static security checks: PASS. User scope is resolved from the Bearer token or explicit Demo mode; request-body `user_id` and `scope_id` do not override the resolved scope; upload checks enforce the 10 MiB limit and allowed file types; recommendation links use `source`/`target` and query failures are surfaced.
- Remote migrations: PASS. `20260713000000_secure_user_scope_and_storage.sql` and `20260713000500_restore_captured_files_bucket.sql` were applied to project `wocchwrvlhqdwtvfwfab`; a subsequent linked push reported the database was up to date.
- Remote smoke checks: PASS for anonymous table filtering, Demo Storage path upload, authenticated private object retrieval, and rejection of the public Storage object URL.
- Existing remote rows observed during implementation are Demo rows (`user_id = null`, fixed Demo `scope_id`); this does not prove real-user A/B isolation.

### Real-account acceptance currently blocked

- Required test: two independent real Supabase accounts (A and B), each using a disposable phone number, followed by cross-account checks for data, search, recommendations, graph, Storage, forged scope parameters, unauthenticated API access, and upload boundaries.
- Account A login was attempted from the local app at `http://127.0.0.1:5173/` using Supabase Phone provider `Twilio Verify`.
- Supabase/Twilio configuration entered: Phone enabled; Twilio Verify selected; Account SID entered as an `AC...` value; Verify Service SID entered as a `VA...` value; Auth Token entered in the dashboard but intentionally not recorded here.
- Actual error: `AuthApiError: Error sending confirmation OTP to provider: Messages to China require use case vetting` (Twilio error `60220`).
- Interpretation: Twilio has not yet approved this account for Verify SMS delivery to mainland China (+86). This is an external provider compliance block, not evidence that the Supabase Account SID or Verify Service SID is malformed.
- Account A real login: `BLOCKED`.
- Account B real login: `BLOCKED` by the same unmet SMS prerequisite; no B session was created.
- Steps that require authenticated A/B sessions were not executed and must not be marked PASS: A/B data isolation, keyword/semantic search isolation, recommendation isolation, graph isolation, Storage UUID paths, signed URL access, forged `user_id`/`scope_id` request, and the final reverse check.
- Demo mode was used only for the earlier Stage 1 P1-P5 acceptance. Demo login must not be used as evidence for this real-account security task because Demo data uses the shared fixed scope.

### Twilio support request

- Support ticket submitted: `#28192140`.
- Subject: `China Verify vetting request - Error 60220 request`.
- Priority: `P3 (General)`.
- Status at submission: `new`.
- Submitted date: 2026-07-15.
- Request states that EvolvMind is a student-built private development/acceptance project, uses Verify only for user-requested transactional login OTPs, targets mainland China, estimates approximately 100 verification messages per month during development/acceptance testing with a possible increase to 150-200, and uses the Trial preview template `Your (SAMPLE TEST) verification code is: {{code}}`.
- No Auth Token, Supabase key, real phone number, or OTP was included in the ticket.
- Do not treat the ticket's translated phrase `if approved` as approval; ticket status `new` means Twilio has not yet approved the use case.
- 2026-07-15 follow-up: Twilio support replied on ticket `#28192140` requesting confirmation of the Account SID, company name, use case/industry, company website, estimated China volume, and acceptance of Twilio's default provider signature template. This is a request for additional vetting information, not approval. Reply must use Reply All so the comment remains attached to the ticket.
- The website supplied in the email (`https://evolvmind-2025-4n7tsh88-kindness31413-6660-s-projects.vercel.app/`) was checked on 2026-07-15 and returned Vercel `404: NOT_FOUND / DEPLOYMENT_NOT_FOUND`; do not claim it is a working public production site. Before replying, provide a reachable public page or accurately state that the project is a private development/acceptance deployment and ask whether the support team can review it without a public production website.
- Do not include the Twilio Auth Token, Supabase keys, OTPs, or private credentials in the reply.
- 2026-07-15 deployment follow-up: redeployed the current code to Vercel Production project `evolvmind-2025`. Canonical URL: `https://evolvmind-2025.vercel.app/`; deployment URL: `https://evolvmind-2025-b2asnpff2-kindness31413-6660s-projects.vercel.app`; deployment ID: `dpl_6c69kHBLAoiWNsTbDMtnAyhXXu2u`; Vercel status: `READY`.
- Public browser verification: canonical URL loaded the EvolvMind login page without a Vercel login prompt; Demo login loaded the Home page and existing Demo data. Vercel build passed with the known large JavaScript chunk warning (~840 KB).
- The canonical site is the candidate URL for the Twilio Reply All response. Real SMS login and real A/B isolation remain unverified and blocked until Twilio approves the China use case.

### Resume condition

- Wait for Twilio's response on ticket `#28192140`.
- If Twilio approves China Verify delivery, retry Account A login, then create separate Account B and continue the real-account procedure from the A/B steps above.
- If Twilio requests more information, reply in ticket `#28192140`; do not create a duplicate ticket or change Supabase credentials without a provider-related reason.
- Until China Verify is approved, this task remains `in_progress`; the real-account acceptance cannot be closed or represented as PASS.
### Twilio Trial upgrade and recovery procedure

The latest Twilio reply confirms that this Account is on the Trial plan and China messaging is disabled during Trial. This is a plan restriction, not evidence of malformed Supabase/Twilio credentials.

1. The account owner reviews the Twilio Console upgrade page before paying: payment method, Verify/SMS pricing, balance or recharge behavior, spending limits, auto-recharge, trial-to-paid terms, and China delivery costs.
2. Upgrade the Twilio Account from Trial to a paid plan through the Console's `Upgrade` entry.
3. Reply All in the existing ticket `#28192140` using the following message:

```text
Hi Saurabh,

Thank you for the clarification.

I have upgraded the Twilio account from the Trial plan to a paid plan.

Please proceed with reviewing and enabling the China route for Verify messages on account <REDACTED_SID>.

The use case remains limited to user-initiated transactional login verification codes for the EvolvMind development and acceptance-testing application, with an estimated volume of approximately 200 messages per month towards China.

Please let me know once the China route has been enabled, or if any additional information is required.

Kind regards,

Kindness
EvolvMind
```

4. Keep the Zendesk `support+...@twilio.zendesk.com` recipient and original CC; do not create a new ticket or click `This ticket is solved`.
5. Wait for explicit confirmation such as `China route has been enabled`; an acknowledgment or promise to review is not enough.
6. Only after route confirmation, test real OTP for account A, then create account B and execute the A/B isolation, signed URL, forged scope, unauthenticated API, and upload-boundary procedure in this task.
7. Keep the task `in_progress` and real-account acceptance `BLOCKED` until paid upgrade, route confirmation, and real OTP delivery are all evidenced.

Do not record payment details, Auth Token, Supabase keys, OTPs, or real test phone numbers in this file or in memories.

### Latest Twilio reply interpretation (2026-07-15)

- The pasted email is a newer reply in the same Zendesk thread: it explicitly references ticket `#28192140` and the prior agent Saurabh. It confirms the Twilio Account is on a Trial plan.
- Twilio states that messaging to China is disabled while the account remains on Trial. This is an account-plan restriction, not proof of an incorrect Supabase/Twilio SID configuration.
- Twilio's requested next action is to upgrade the Twilio account to a paid plan, then reply on the same ticket so Support can proceed with enabling the China route.
- This does **not** mean China SMS is enabled yet. Keep real-account A/B acceptance `BLOCKED` until the account is upgraded, the ticket confirms the China route is enabled, and a real OTP delivery is successfully tested.
- Upgrade has billing and usage-cost consequences. The account owner must review Twilio pricing, payment method, spending limits, and any trial-to-paid terms in the Twilio Console before upgrading. Do not record payment details or Auth Token in project files or memories.
### Recommended Reply All draft

Use **Reply All** for ticket `#28192140`. The following version explicitly includes the requested industry classification:

```text
Hi Saurabh,

Thank you for your response.

Please find the requested information below:

Twilio Account SID:
<REDACTED_SID>

Company name:
EvolvMind

Company use case / industry:
EvolvMind is a student-built personal knowledge management application in the software development and education technology space.

Twilio Verify is used only to send one-time verification codes when users explicitly request phone-based login during development and acceptance testing. This is a transactional authentication use case, not marketing.

Users enter their own phone number and actively request a verification code from the login page. We do not send unsolicited messages, advertisements, URLs, political content, financial content, or promotional messages.

Company website:
https://evolvmind-2025.vercel.app/

This is a publicly reachable development and acceptance-testing deployment for EvolvMind.

Estimated monthly volume towards China:
Approximately 200 Verify messages per month.

Default provider signature template:
We confirm that we can use Twilio's default provider signature template, and we understand that the SMS body may change without notice.

Please let us know if any further information is required to complete the China Verify use-case vetting.

Kind regards,

Kindness
EvolvMind
```

## Current Email OTP Acceptance Status (2026-07-22)

- Supabase Auth custom SMTP now uses the configured 163 mailbox. The local Email OTP request to `/auth/v1/otp` returned HTTP 200 and delivered a usable six-digit code.
- Account A (`kindness314@163.com`) completed a real Email OTP login in the local application. This verifies the single-account Email OTP flow only; A/B isolation is not yet proven.
- Fixed `LoginPage.tsx` so `InputOTP.onComplete` passes the completed token directly to verification. Previously, the handler read stale React `code` state and incorrectly showed `请输入完整的验证码` after all six digits were entered.
- Improved OTP send-rate error handling to recognize Supabase `error.status === 429` and `error.code === 'over_email_send_rate_limit'`, with the user-facing message `发送过于频繁，请稍后再试`.
- Verification after these changes: `npm.cmd run typecheck` PASS; `npm.cmd run build` PASS with the existing Vite large-chunk warning. Browser regression with invalid token `123456` now reaches Supabase verification and shows `验证码错误，请重试` instead of the stale-state length error. A subsequent real OTP login was reported successful by the user.
- Local full-stack service was started with `cmd.exe /c npm.cmd run dev:full` and was reachable at `http://127.0.0.1:5173/`. It is not a persistent prerequisite; restart it before continuing if unavailable.
- Next acceptance step: continue at `email-otp-ab-verification.md` A1. Create and verify account A text/file data, then use an independent private browser with a second email account for B. Complete cross-account search, recommendations, graph, Storage UUID path, forged-scope, unauthenticated API, and upload-boundary checks.
- Current result: Account A Email OTP login `PASS`; Account A data creation `NOT RUN`; Account B login/data `NOT RUN`; A/B isolation and security boundary checks `NOT RUN`. Keep this task `in_progress`.
- Production `https://evolvmind-2025.vercel.app/` still showed the older phone-only login during this session. Do not use it for Email OTP acceptance until the current frontend is deployed and smoke-tested.

Do not include the Twilio Auth Token, Verify Service SID, Supabase keys, OTPs, or test phone numbers. Do not click the ticket's `This ticket is solved` link unless Twilio confirms the issue is resolved.
***