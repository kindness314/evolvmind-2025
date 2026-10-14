# 2026-10-13: 侧滑返回适配 + 生产 AI 故障诊断(白山智算封海外 IP)

## 一、侧滑/返回键回退上一页(已完成,commit 0c46889)

- 方案: 页面导航接入浏览器 history 栈,零路由库,不违反"无 react-router"不变量。
- `src/app/App.tsx`:
  - `handlePageChange` 末尾 `history.pushState({evolvmind:true, page, itemId})`
  - 顶层 `useEffect`(必须在所有条件 return **之前**,否则 Hooks 顺序违规导致 App 崩溃——已踩坑修复)`replaceState` 初始条目 + `popstate` 监听恢复 currentPage/selectedItemId/selectedKnowledgeNodeId
  - item-detail `onBack` 改 `history.back()`
- APK/WebView 默认行为"历史能回则回、回不动退出",无需重打包、无需 Capacitor 插件。
- 浏览器实测: 首页→知识→设置两级返回、数据→详情(带 itemId)返回均正确。typecheck/52 测试/build 全绿。

## 二、生产"文字提取失败"根因(未解决,等用户决策)

诊断链(证据齐全):
1. 本地 dev API extract 全通;生产 `/api/extract` 返回 AI API error,上游 ACCESS DENIED。
2. `api.edgefn.net` = 白山智算(白山云 MaaS)。同一把好 key 从 GitHub Actions 美国 runner 直调 → **HTTP 403,`Server: web cache / X-Ser: i90340_c27779`** = 白山边缘节点在门口拒绝,连鉴权层都到不了(假 key 也 403 HTML 而非 401 JSON)。
3. 同 key 本机(国内 IP)200 正常。
4. 结论: **白山智算边缘网拒绝海外数据中心 IP**(近期收紧),Vercel(美国)所有 AI 端点(提取/总结/图谱/话题)全挂;与代码和 key 无关。文档只有 `api.edgefn.net` 单入口,无海外域名。
5. 用户自查项: 白山控制台 API Key 是否开了 IP 白名单。
6. 候选方案(用户未定): 换全球供应商 / 国内中转服务器 / 问白山客服。
7. 附带隐患: 本机国内网络直连 `evolvmind-2025.vercel.app` 超时(vercel.app 域名间歇被墙);用户手机可用是因为 PWA 缓存+Supabase 直连,长期建议绑自定义域名。

## 三、环境事实

- GitHub 443 从本机间歇/周期性全断(10-13 当天多次 Connection reset/超时);应急通道: `gh api` 创建 contents 文件提交(可用),git push 不行时可用。
- 本地 .env.local 值带引号需剥离;MINIMAX_API_KEY 仅 embeddings 权限,chat 用 MINIMAX_CHAT_API_KEY。
- 诊断工具: `.github/workflows/prod-smoke.yml`(workflow_dispatch,可用 Actions 海外 IP 测生产/上游连通性)。

## 四、最终解法(2026-10-14 收尾):chat→DeepSeek 官方,embedding→硅基流动

- 根因链条: 白山边缘网拒海外 IP(key/模型名无关,对照实验三组已证) → Vercel 全部 AI 端点挂。
- 方案: `MINIMAX_BASE_URL=api.deepseek.com` + `MINIMAX_MODEL=deepseek-chat` + `MINIMAX_CHAT_API_KEY`(DeepSeek key);
  新增 `EMBEDDING_BASE_URL=https://api.siliconflow.cn/v1` + `MINIMAX_API_KEY`(硅基流动 key,embedding 专用) + `BAAI/bge-m3`(不变,1024 维兼容存量向量)。
- 代码: embedding.ts / multimodal.ts / backfill.ts / graphOps/backfill.ts 拆出 EMBEDDING_BASE_URL / VISION_BASE_URL;
  **坑: backfill 两处显式传 `MINIMAX_BASE_URL` 给 generateEmbedding 盖掉环境回退**,导致向量打去 DeepSeek 报 key 无效——已修。
- 排障技巧: 按"上游报错格式"判断请求实际打到谁(DeepSeek: `Authentication Fails`+request_id;硅基流动: `{"code":30014,...}`;白山边缘: HTML ACCESS DENIED)。
- 终验: prod-smoke 双链路 extract 200 / backfill processed 2/2。
- 用户 key 流转: 全部经 Vercel 控制台自助,未经过会话;EDGEFN_TEST_KEY secret 是旧白山 key(仍有效,仅烟测用,可删)。

## 五、追记(2026-10-15):侧滑返回全场景覆盖 + 真因复盘

- **v1.0.1 真因**: Capacitor 8 核心没有任何返回键处理(无 onBackPressed/canGoBack),默认=直接 finish Activity。此前"WebView 默认能回则回"的假设错误。修: MainActivity 注册 OnBackPressedCallback(goBack or 透传)。
- **v1.0.2 分层拦截**: `src/lib/backHandler.ts` 全局栈 + App.popstate 先 consumeBack(消费后 pushState 保持深度)。keep-alive 页面**必须传 active 门控**,否则切走后残留内部状态会误拦截别的页的返回。
- 覆盖: 知识页(搜索→选中→聚焦→下钻)、数据页(删除确认→多选→搜索)、详情页(删除确认→编辑)、捕获页(退出模式)、设置页(资料编辑)。
- 验证通道: 手机开 USB 调试 + 小米"USB 调试(安全设置)"后,`adb shell input keyevent 4` + `uiautomator dump` 可全自动真机回归(读 text 判页面)。
- 真机白屏一次: 自动化连点切换页时懒加载 chunk 闪白,瞬态非 bug。

## 六、断点(2026-10-15 凌晨,明日续):手机端知识页白屏

- 现象: v1.0.3(39f7f79)后手机进知识网络页整页白屏(OCR 只有状态栏,连底部导航都没有),App 不崩、仍在后台。浏览器 demo 下知识页正常 → 疑真机/真账号数据相关或懒加载 chunk 经手机代理拉取失败。
- 已排除: 生产部署正常(39f7f79 Production);返回键处理正常(app 不退出);logcat 无 crash。
- 断点动作: 正在出 **debug APK**(.github/workflows/debug-apk.yml,WebView 调试可用)——构建中,装上后 `adb forward tcp:9222 localabstract:webview_devtools_remote_*` + chrome://inspect 或 CDP 抓真机控制台,定位白屏报错。注意 debug 包与 release 签名不同,需先卸载(登录态会掉)。
- 手机调试已就绪: USB 调试+安全设置已开,input 注入可用;platform-tools 在 D:/evolvmind-2025/platform-tools。
- 备忘: adb exec-out 截图在 git-bash 会 CRLF 损坏,要 `shell screencap -p /sdcard/s.png` + `adb pull`。
