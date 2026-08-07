> 最新状态（2026-07-25）：**Email OTP 真实 A/B 隔离验收 13/13 PASS**（提交 `2fa3a2b`；隔离修复 `a2b4864`）。账户 A `kindness314@163.com` 经 163 Custom SMTP 完成真实 Email OTP 登录与 A/B 数据隔离验证；`07-13-user-scope-upload-security` 已通过 Email 路径关闭。本脚本保留为回归验收模板；手机号路径（Twilio）仍 BLOCKED，单独记录。

# Email OTP A/B 隔离验收执行脚本

> 创建：2026-07-17；更新：2026-07-25。
> 前置：Supabase Email 模板使用 `{{ .Token }}`（6 位验证码，非 Magic Link）；Custom SMTP 使用已验证的 163 邮箱。
> 已修复：`LoginPage.tsx` 的 OTP 完成回调直接把 token 传给 `verifyOtp`，避免读取滞后的 React state；Supabase HTTP 429 / `over_email_send_rate_limit` 会显示准确的限流提示。

## 账户准备

| 角色 | 邮箱 | 浏览器 |
|------|------|--------|
| A | kindness314@163.com | 普通窗口 |
| B | 另一个你能收邮件的新邮箱 | 无痕/隐私窗口 |

建议 B 使用 QQ 邮箱、Gmail 或另一 163 邮箱均可。

## 每次登录前清除旧状态

两个浏览器窗口都执行（F12 → Console）：

```js
localStorage.removeItem('demo_auth');
localStorage.removeItem('supabase_session');
```

然后刷新页面。

---

## A1. 账户 A 建立数据

**用普通窗口打开 `http://localhost:5173`，确保"邮箱"标签页选中。**

### 登录

1. 输入 `kindness314@163.com`
2. 点击「获取验证码」
3. 查收邮箱，输入 6 位验证码
4. 确认进入首页

### 保存文本

在首页输入以下内容保存：

```
账户 A 私有测试内容 2026-07-17
这是只有账户 A 才应该看到的数据。
验证点：A 可见，B 不可见。
```

### 上传文件

上传一个小文件（建议 `< 1KB` 的 `.txt`）：

```
文件名: a-test-file.txt
内容: 账户 A 上传文件验证 - 2026-07-17
```

### 验证可见性

- [ ] 首页能看到刚才保存的文本条目
- [ ] 点击条目进入详情，能看到完整内容和文件
- [ ] 搜索「私有测试」能找到该条目
- [ ] 搜索「A」能找到该条目
- [ ] 图谱页面出现对应节点

### 记录 UUID

F12 → Application → Local Storage → `supabase_session` → 找 `user.id`：

```
A UUID: ________________________________
```

### 退出

点击退出登录，确认回到登录页。

---

## A2. 账户 B 建立数据

**用无痕/隐私窗口打开 `http://localhost:5173`。**

务必新开无痕窗口——不能跟 A 共用窗口。

### 登录

1. 输入 B 邮箱
2. 点击「获取验证码」
3. 查收 B 邮箱，输入 6 位验证码

### 确认隔离

- [ ] 首页看不到「账户 A 私有测试内容」
- [ ] 搜索「私有测试」无结果
- [ ] 搜索「A」无 A 的数据
- [ ] 图谱没有 A 的节点

### 保存文本

```
账户 B 私有测试内容 2026-07-17
这是只有账户 B 才应该看到的数据。
验证点：B 可见，A 不可见。
```

### 上传文件

```
文件名: b-test-file.txt
内容: 账户 B 上传文件验证 - 2026-07-17
```

### 验证可见性

- [ ] 首页能看到 B 的文本条目
- [ ] 搜索「B 私有」能找到该条目
- [ ] 图谱出现 B 对应节点

### 记录 UUID

```
B UUID: ________________________________
```

### 退出

---

## A3. 交叉隔离

### 切回 A（普通窗口）

1. 清除旧状态，刷新
2. 用 A 邮箱重新登录

检查：

- [ ] 能看到 A 的文本和文件
- [ ] 搜索「B 私有」无结果
- [ ] 图谱只有 A 的节点，没有 B 的节点
- [ ] 条目推荐不包含 B 的内容
- [ ] AI 摘要不包含 B 的内容

### 切回 B（无痕窗口）

1. 清除旧状态，刷新
2. 用 B 邮箱重新登录

检查：

- [ ] 能看到 B 的文本和文件
- [ ] 搜索「A 私有」无结果
- [ ] 图谱只有 B 的节点，没有 A 的节点
- [ ] 条目推荐不包含 A 的内容
- [ ] AI 摘要不包含 A 的内容

---

## A4. 防篡改与未认证

打开 DevTools Network 标签，在 A 登录状态下进行以下测试。

### 4.1 伪造 scope_id

发送请求时在 body 中强行写入 B 的 UUID：

```js
// 在 A 登录的浏览器 Console 中执行
const B_UUID = '这里填 B 的 UUID';
fetch('/api/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'test', user_id: B_UUID, scope_id: B_UUID })
}).then(r => r.json()).then(console.log);
```

- [ ] 返回结果中数据属于 A，不是 B
- [ ] 不返回 B 的数据

### 4.2 未认证请求

```js
fetch('/api/extract', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ content: 'test' })
}).then(r => {
  console.log('Status:', r.status);
  return r.json();
}).then(console.log);
```

- [ ] 返回 401（或明确拒绝）

---

## A5. 上传边界

在 A 账户登录状态下：

### 5.1 正常文件（通过）

- [ ] 上传 < 10MB 的 `.txt`、`.jpg`、`.png`：成功
- [ ] 文件出现在 Storage 中，路径以 A UUID 开头

### 5.2 超大文件（拦截）

- [ ] 上传 > 10MB 文件：前端提示拦截，不发起上传
- [ ] Storage 中没有该文件

### 5.3 不支持扩展名（拦截）

- [ ] 上传 `.exe`、`.sh` 等不支持格式：前端拦截

---

## A6. 结论规则

| 检查项 | 结果 (PASS/FAIL/BLOCKED) |
|--------|--------------------------|
| A 成功登录 | |
| B 成功登录 | |
| A 数据 A 可见 | |
| B 看不到 A 数据 | |
| B 数据 B 可见 | |
| A 看不到 B 数据 | |
| 交叉搜索隔离 | |
| 推荐/摘要不混入 | |
| 图谱节点不跨 scope | |
| Storage 路径以正确 UUID 开头 | |
| 伪造 scope_id 无效 | |
| 未认证 API 返回 401 | |
| 上传边界通过 | |

**全部 PASS 才算验收通过。** 任一步 FAIL/BLOCKED 需记录具体错误和截图路径。

---

## 备注

- 原来的 A0-A6 计划（`twilio-verify-china-sms-recovery-plan.md`）针对手机号验证码，本文件是其 **email OTP 适配版**。
- Twilio 手机号验收方向保持 `BLOCKED`，等付费升级 + 中国线路开通后再单独验证。
- 本验收通过后，`07-13-user-scope-upload-security` 可以从 `in_progress` 关闭（标记为 email OTP 通过，phone 仍 blocked）。
