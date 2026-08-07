# Twilio Verify 中国短信验收阻断

- 场景：Supabase Auth 的 Phone provider 已选择 `Twilio Verify`；Account SID 使用 `AC...`，Verify Service SID 使用 `VA...`，Auth Token 已在 Supabase 控制台填写。不要在记忆、截图或代码中保存 Auth Token。
- 实际错误：EvolvMind 登录页调用 `supabase.auth.signInWithOtp({ phone: \`+86${phone}\` })` 时，浏览器 Console 报 `AuthApiError: Error sending confirmation OTP to provider: Messages to China require use case vetting ... Twilio error 60220`。
- 根因：Twilio 账号尚未完成面向中国大陆的 Verify 短信 use-case vetting/白名单审核。该错误不是现有 `AC...`、`VA...` 字段格式错误的证据；反复重填配置不会绕过地区审核。
- 当前验收处理：真实手机号短信登录记录为 `BLOCKED`；登录页点击“演示模式登录（开发使用）”进入应用，Demo 模式通过 `localStorage.demo_auth === 'true'` 工作，可继续 P1-P5 功能验收。Demo 登录不代表真实手机号登录已通过。
- 后续调整选项：
  1. 在 Twilio Support 提交 China Verify use-case vetting，审核通过后复测中国手机号；
  2. 若只需测试短信链路，使用允许发送的非中国号码，并相应调整登录页国家码逻辑；
  3. 改进登录页，把 Supabase/Twilio provider 的具体错误（如 60220）展示给用户，而不是只显示“验证码发送失败，请检查短信服务配置”。
- 2026-07-15 收到 Twilio 支持回复（ticket #28192140）：要求通过 Reply All 确认 Account SID、公司名、用途/行业、公司网站、预计中国短信量，并确认接受 Twilio provider 的默认签名模板。该邮件是补充审核资料请求，不是已批准通知；在回复并得到明确放行前，真实 A/B 验收仍为 BLOCKED。
- 随后收到同一工单的最新回复（邮件标题/正文仍引用 `#28192140`，由 Saurabh / Twilio Support 发出）：确认当前 Account 为 Trial 计划，Trial 期间中国短信线路未启用；要解除该限制，必须先升级到付费 Twilio 账户。Twilio 表示升级完成后回复工单，他们会继续处理启用 China route。该回复将当前阻断从“等待审核资料”明确为“Trial 账户计划限制 + 升级后继续开通”，但仍不是线路已启用通知。
- 支持邮件中给出的旧公司网站 `https://evolvmind-2025-4n7tsh88-kindness31413-6660-s-projects.vercel.app/` 于 2026-07-15 检查返回 Vercel `404: NOT_FOUND / DEPLOYMENT_NOT_FOUND`。
- 2026-07-15 已将当前代码部署到 Vercel Production 项目 `evolvmind-2025`：主地址 `https://evolvmind-2025.vercel.app/`，部署地址 `https://evolvmind-2025-b2asnpff2-kindness31413-6660s-projects.vercel.app`，部署 ID `dpl_6c69kHBLAoiWNsTbDMtnAyhXXu2u`，状态 `READY`。无登录访问主地址返回 EvolvMind 登录页；演示登录可加载首页。部署构建通过，但存在已知约 840 KB JS chunk warning。
- 主地址可作为 Twilio 回复中的公司网站候选；回复前仍应在无痕浏览器确认其对支持人员所在网络可访问。
- 相关官方错误说明：`https://www.twilio.com/docs/errors/60220`；审核说明链接由 Twilio 错误页指向 `https://support.twilio.com/hc/en-us/articles/17024185400859-Use-Case-Vetting-for-Verify-Messages-to-China`。

- 2026-07-17 变通方案：因用户无法支付 Twilio $20 付费升级，已实现 Email OTP 替代登录。LoginPage 新增邮箱/手机号 Tab 切换，邮件模板改用 `{{ .Token }}` 发 6 位验证码。A/B 验收计划已适配 email OTP：`mem:acceptance/email-otp-ab-verification`。手机号 A/B 验收保持 BLOCKED，等付费升级完成。