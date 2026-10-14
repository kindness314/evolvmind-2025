# 2026-10-14: 演示模式针对性种子数据 + 数据审计修复

## 一、做了什么(全部已生效于生产库)

### 种子数据(scripts/seed-demo.mjs,可重跑幂等)
5 簇 30 节点 + 26 边 + 29 条 captures(过去 30 天分布):
- **睡眠因果环**: 下午咖啡→入睡困难→睡眠质量差→白天犯困→午睡过长→晚间清醒→深夜刷手机→(回到)入睡困难
- **跑步打卡**: 隔天晨跑 9 条(配速/心率/膝盖/跑鞋演进),周小结 1 条
- **阅读**: 三本书+元认知/复利/渐进总结,含"跑后读书效率高"跨簇联系
- **工作**: 需求变更→项目延期→加班→(跨簇)下午咖啡/晚间清醒;评审→上线
- **育儿**: 夜奶→睡眠碎片化→(跨簇)睡眠质量差;哄睡;辅食
- 全部节点带 1024 维向量(本地 edgefn bge-m3 生成,和存量同模型同维度)

### 审计发现并修复的四个问题
1. **demo 979/980 节点向量丢失**(历史回填不知何时没了)→ scripts/backfill-demo-emb.mjs 全部补齐(1006/1006)。教训:白山 embedding QPM 限流,脚本带 20s 退避+分片断点续跑。
2. **演示约定**: captured_info 演示模式 `user_id IS NULL`(summarize/recommend 按此过滤!),knowledge_nodes 用 scope_id=demo UUID(user_id 生成列)。种子首次写成 demo UUID 导致总结看不到。
3. **topicize classifyNodes 真 bug**: LLM 返回"节点名做键"时 `nodes[Number(k)]` 全落空→静默兜底"其他";已改键兼容(序号/名/id),extractMessageText 补错误体提取(此前上游 401 静默成空文本无法排障)。
4. **缓存投毒**: 错误分类会写 topic_labels(DELETE+INSERT),调试时先删 cluster_key(注意:前端传的 id 可能是名字字符串,缓存键=传入 id,不一定是 DB uuid)。

### 验证(生产 e2e)
- recommend 200:语义关联推荐正常("又推掉了家庭晚餐↔账单整理:外卖超支 40%")
- summarize 7d 200:**高质量叙事**——"晨跑本期 0 次 vs 上期 3 次,热度下降;小结里写习惯成型但频次回落,值得留意的张力"

## 二、环境坑(重要)
- **vercel dev 混合环境**: 云端 Development env(BASE_URL=deepseek) + 本地 .env.local(旧白山 key)拼在一起 → DeepSeek 收到白山 key 401。本地调试 AI 链路要么 `vercel env pull` 对齐,要么直接打生产。
- **supabase CLI**: npx 缓存会被并发跑坏("No matching binary/Invalid Version"),修复=清缓存+`npx -y supabase@2.121.0`(平台包名 @supabase/cli-windows-x64)。
- **Windows taskkill**: git-bash 里 `//F //PID` 会变无效参数,用单斜杠 `/F /PID`;杀 dev server 要按端口找 PID(dev:api 脚本端口占用会静默退出,日志 0 字节=没起来)。

## 三、复现/重置
- 重新播种: `node scripts/seed-demo.mjs && npx -y supabase@2.121.0 db query --linked --file seed-demo.sql`
- 向量补齐: `node scripts/backfill-demo-emb.mjs` + 逐分片执行
- 烟测: GitHub Actions → Prod Smoke workflow(extract/backfill/recommend/summarize)
