> **2026-07-17**: 因用户无法支付 Twilio $20 升级，已实现 Email OTP 替代方案。
> 本文件的手机号 A0-A6 流程已适配为 email 版本，见 `mem:acceptance/email-otp-ab-verification`。
> 手机号方向保持 BLOCKED，本文件保留供未来 Twilio 付费升级后使用。

# Twilio 中国 Verify 恢复与真实 A/B 验收流程

## 当前事实

- 工单：`#28192140`。
- Twilio 最新邮件确认：当前 Account 是 Trial 计划；Trial 期间中国短信线路未启用。
- Twilio 要求：先升级为付费计划，升级完成后回复同一工单，Support 才会继续处理启用 China route。
- 这不是已开通通知。升级完成不等于中国线路已经启用；必须等待 Twilio 明确确认并成功收到真实 OTP。
- 当前真实账户 A/B 验收继续为 `BLOCKED`。
- 不要把 Trial 账户限制误判为 Supabase Account SID、Verify Service SID 或 Auth Token 配置错误。
- Auth Token、支付信息、Supabase keys、OTP、真实测试手机号不得写入代码、记忆、截图或聊天记录。

## 用户需要执行的付费升级步骤

1. 登录 Twilio Console。
2. 使用账户控制台中的 `Upgrade` / Trial banner 入口查看升级页面。
3. 在升级前由账户所有者确认：付款方式、Verify/SMS 单价、账户余额/充值方式、消费上限、自动充值设置、Trial 转付费条款和中国短信可能产生的费用。
4. 确认后将 Account 从 Trial 升级为付费计划。
5. 不要把支付信息或 Auth Token 提供给助手。

官方参考：

- Trial 账户：https://www.twilio.com/docs/usage/trials
- 中国 Verify 错误 60220：https://www.twilio.com/docs/api/errors/60220
- Verify 地区可达性：https://www.twilio.com/docs/verify/verify-countries-and-regions-deliverability

## 升级后的 Reply All 流程

必须在原邮件线程中使用 **Reply All**，不要新建工单，不要点击 `This ticket is solved`。

发送内容：

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

发送前检查：

- To 保留 Zendesk 的 `support+...@twilio.zendesk.com` 工单回复地址；
- 原 CC 不删除；
- 主题和工单编号保留；
- 不包含 Auth Token、Verify Service SID、Supabase key、OTP、测试手机号、支付信息。

## 等待 Twilio 明确确认

不能把以下表述当作开通：

- “we will proceed”
- “we can review”
- “we will guide you”

应等待类似以下明确表述：

- `China route has been enabled`
- `China Verify messaging is now enabled for your account`

如果 Twilio 要求更多资料，继续在同一工单 Reply All 回复，并保持任务 `in_progress`。

## 线路确认后的真实验收顺序

### A0 前置

1. 打开当前 Production 地址：`https://evolvmind-2025.vercel.app/`。
2. 准备两个独立、无生产数据的可收验证码测试号码 A/B。
3. 使用普通窗口 A 和无痕/独立浏览器 B，避免共享 Supabase session。
4. 清除旧状态：

```js
localStorage.removeItem('demo_auth');
localStorage.removeItem('supabase_session');
```

5. 记录日期、浏览器、设备、项目 ref、错误和截图路径；敏感凭据不得截图。

### A1 账户 A

1. 真实手机号 A 请求 OTP 并登录。
2. 保存唯一文本 `账户 A 私有测试内容 <日期>`。
3. 上传小于 10 MiB 的 `.txt` 或图片。
4. 验证首页、详情、搜索、推荐、图谱能看到 A 数据。
5. 检查 Storage 路径第一段是 A 的 Supabase user UUID。
6. 退出登录并确认回到登录页/session 清除。

### A2 账户 B

1. 独立浏览器用手机号 B 真实登录。
2. 确认 B 看不到 A 的文字、文件、搜索、推荐、摘要和图谱节点。
3. 保存唯一文本 `账户 B 私有测试内容 <日期>`。
4. 上传小于 10 MiB 的文件。
5. 检查 B 只能看到 B 数据，路径第一段是 B UUID。

### A3 交叉隔离

1. 切回 A：A 可见，B 不可见。
2. 切回 B：B 可见，A 不可见。
3. 交叉测试首页搜索和图谱搜索。
4. 检查推荐、摘要、图谱来源/关系不混入对方内容。
5. 重新生成 signed URL，确认只允许当前用户路径。

### A4 防篡改与未认证

1. 用 A Bearer token 请求 API，在 body 伪造 B 的 `user_id`、`scope_id`；结果仍只返回 A。
2. 受保护 API 不带 Bearer 时返回 401。
3. 明确记录 Demo header/body 是开发例外，不能作为真实认证证据。
4. 检查 `/api/extract`、`/api/graph/extract`、`/api/models` 的认证/限流发布策略。

### A5 上传边界

1. 不超过 10 MiB 的允许文件成功。
2. 超过 10 MiB 文件被前端拦截且无 Storage 对象。
3. 不支持扩展名被拦截且无 Storage 对象。
4. 伪造 MIME/Storage 路径不能越权上传或读取。

### A6 结论规则

只有 A/B 真实登录、数据/搜索/推荐/摘要/图谱/Storage 隔离、signed URL、伪造 scope、未认证 API、上传边界全部有 PASS/FAIL/BLOCKED 证据后，才能关闭 `07-13-user-scope-upload-security`。

Trial 升级、China route 开通或真实 OTP 任一步未完成，都必须保持 `BLOCKED`，不能用 Demo 结果补齐。