> 状态（2026-08-06）：**已归档，不再执行**。实际发件采用 Supabase Custom SMTP + 163 邮箱（2026-07-22 配置），Email OTP A/B 隔离验收 13/13 PASS（2026-07-25）。Brevo 方案未采用。

# Brevo SMTP → Email OTP 续接计划（历史）

> 创建：2026-07-17。下文为当时的候选方案与步骤，仅作历史参考；当前主线见 `mem:acceptance/email-otp-ab-verification`。
## 当前事实

- `LoginPage.tsx` 已支持邮箱/手机号切换。
- Email OTP 前端流程已正确使用：
  - `supabase.auth.signInWithOtp({ email })`
  - `supabase.auth.verifyOtp({ email, token, type: 'email' })`
- 已修复发送成功后没有 `setStep('code')` 的前端问题。
- Supabase Magic Link 模板已改为使用 `{{ .Token }}`，目标是发送 6 位验证码。
- 浏览器 smoke test 已确认当前阻断来自 Supabase 默认邮件服务：`HTTP 429 / over_email_send_rate_limit / email rate limit exceeded`。
- Twilio 中国短信仍为 BLOCKED，不要把 Email OTP 结果写成手机号验收通过。
- 旧的 A/B 执行步骤在：`mem:acceptance/email-otp-ab-verification`。

## 方案决定

使用 **Brevo Free SMTP** 作为 Supabase Auth 的自定义发件服务；保留 Supabase Auth 负责验证码生成、验证、用户创建、Session 和 RLS。

不自建 OTP 服务，不在前端保存验证码，不绕过 Supabase Auth。这样不会破坏现有 `auth.uid()`、Bearer token、Storage policy 和后端 `apiAuth.ts`。

Brevo 官方免费层当前资料显示约 300 封/天；实际额度、审核和中国邮箱投递以 Brevo 控制台当前显示为准，不把宣传额度当作验收证据。

## 1. 下次第一步：注册并准备 Brevo

1. 打开 Brevo 官方站点并注册 Free 账户。
2. 进入发件人设置，验证一个可控的发件邮箱；优先使用专用发件地址，不要在代码中写密码。
3. 进入 SMTP & API，创建 SMTP Key。
4. 只记录以下非敏感配置名称；SMTP Key 不写入仓库、记忆、截图或聊天：

```text
SMTP Host: 以 Brevo 控制台显示为准（常见为 smtp-relay.brevo.com）
SMTP Port: 587（STARTTLS）
SMTP Username: Brevo 控制台显示的登录邮箱/用户名
SMTP Password: Brevo SMTP Key（仅填 Supabase Dashboard）
From address: 已验证的发件邮箱
Sender name: EvolvMind
```

5. 若 Brevo 要求域名验证，完成 SPF/DKIM；没有域名时先按控制台允许的已验证邮箱方案测试。

官方入口：

- https://www.brevo.com/free-smtp-server/
- https://developers.brevo.com/docs/smtp-integration
- https://help.brevo.com/hc/en-us/articles/208580669-FAQs-What-are-the-limits-of-the-Free-plan

## 2. 在 Supabase 接入自定义 SMTP

进入：

```text
Supabase Dashboard
→ Authentication
→ SMTP Settings（或 Emails / SMTP）
```

填写 Brevo 提供的 SMTP Host、Port、Username、SMTP Key、From address、Sender name，保存并确认启用 Custom SMTP。

然后检查：

```text
Authentication
→ Rate Limits
```

不要为了测试关闭全部限流。只确认自定义 SMTP 已启用、当前邮件/OTP限制可用，并保留每邮箱请求冷却。

## 3. 确认 OTP 模板

进入：

```text
Authentication
→ Email Templates
→ Magic Link（或 Magic Link or OTP）
```

模板必须包含验证码变量：

```html
<h2>EvolvMind 登录验证码</h2>
<p>请输入以下 6 位验证码：</p>
<h1>{{ .Token }}</h1>
<p>验证码将在有效期内使用一次。</p>
```

不要把登录按钮写成唯一内容，也不要保留 `{{ .ConfirmationURL }}` 作为登录入口，否则会变成 Magic Link 体验。

## 4. 单邮箱烟测

1. 打开 `http://localhost:5173`。
2. 清除旧状态：

```js
localStorage.removeItem('demo_auth');
localStorage.removeItem('supabase_session');
```

3. 输入 `kindness314@163.com`，点击「获取验证码」。
4. 预期页面切换到「输入验证码」，邮箱收到 6 位数字。
5. 输入验证码，预期创建 Supabase Session 并进入首页。
6. 若失败，记录浏览器 Console 的 HTTP 状态、Supabase error code、时间；不要记录验证码、SMTP Key、Auth Token 或完整 Session。

判定：

- 收到邮件 + 出现验证码框 + 验证成功：Email OTP 单邮箱 PASS。
- 返回 `429`：记录为 SMTP/OTP 限流 BLOCKED，先检查 Supabase Rate Limits、Brevo额度和 60 秒冷却，不反复点击。
- 返回 `email_address_not_authorized`：检查自定义 SMTP 是否真正启用、发件人/收件地址限制和 Brevo 发件人验证。
- 邮件未到但请求成功：检查垃圾邮件、Brevo活动日志、SPF/DKIM和发件地址。

## 5. 两账户 A/B 验收

单邮箱烟测 PASS 后，再执行：

- A：`kindness314@163.com`，普通窗口。
- B：另一个可收信邮箱，无痕窗口/独立浏览器。
- 不共享 Supabase Session；每个浏览器先清理 `demo_auth` 和 `supabase_session`。
- 按 `mem:acceptance/email-otp-ab-verification.md` 的 A1-A6 执行：登录、保存唯一文本、上传文件、搜索/推荐/摘要/图谱隔离、伪造 scope、未认证 API、10 MiB 上传边界。

建议测试标识：

```text
账户 A 私有测试内容 2026-07-17
账户 A 上传文件验证 - 2026-07-17
账户 B 私有测试内容 2026-07-17
账户 B 上传文件验证 - 2026-07-17
```

日期应替换为实际验收日期，避免与旧记录混淆。

## 6. 结论规则

只有以下项目全部有证据，才能将 Email OTP 真实 A/B 验收标记 PASS：

- A、B 都通过真实 Email OTP 登录；
- A/B 文本、文件、搜索、推荐、摘要和图谱互不可见；
- Storage 路径首段是对应 Supabase user UUID；
- signed URL 不能跨用户访问；
- 伪造 `user_id`/`scope_id` 不改变服务端身份范围；
- 未认证受保护 API 按发布策略返回 401/拒绝；
- 允许文件、10 MiB 边界和不支持扩展名结果符合预期；
- 每一步记录 PASS/FAIL/BLOCKED、浏览器、时间、可见错误和非敏感证据路径。

Email OTP A/B PASS 不等于 Twilio 中国手机号 OTP PASS；手机号方向仍单独保持 BLOCKED。

## 安全约束

- Brevo SMTP Key、Supabase service role key、Auth Token、OTP、Session access token、真实测试邮箱密码不得写入仓库、记忆、截图或聊天。
- SMTP 密钥只能配置在 Supabase Dashboard 的 Custom SMTP 或服务端密钥管理中；禁止 `VITE_` 前缀。
- 不要在前端生成、保存或比较 OTP。
- 不要用 Demo 登录结果替代真实 Email OTP 或真实 A/B 隔离证据。

## 下次对话的直接指令

用户说“继续 SMTP”或“开始验收”时：

1. 先读取本文件；
2. 询问/检查 Brevo 是否已注册、发件人是否已验证、SMTP Key 是否已创建（不要要求用户发送 Key）；
3. 指导 Supabase Custom SMTP 配置；
4. 先执行单邮箱烟测；
5. 单邮箱成功后再执行 `email-otp-ab-verification.md` 的 A1-A6；
6. 最后运行项目要求的 `npm run typecheck` 和 `npm run build`，并单独记录人工验收结论。
