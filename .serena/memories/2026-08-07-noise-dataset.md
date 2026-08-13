# noise 混合质量数据集（第三套）验收记录 2026-08-07

## 数据集
- `scripts/seed-test-data.mjs` 的 `DATASETS['noise']`：24 条 = 8 信号 + 8 碎片 + 8 噪声。
- 信号：睡眠银行实验第二周、六月家庭预算复盘、无手机晚餐坚持 30 天、深度工作周报: 四象限实践、读书笔记《稀缺》、晨间例行动作微调: 冥想替代刷手机、外卖 vs 做饭成本对比、加班与睡眠因果记录。
- 碎片（浅记录/部分无标签）：地铁上读完了一章、感觉最近效率还行、午饭吃了食堂、想买个机械键盘、跑步 5 公里、会议又超时了、咖啡喝多了晚上睡不着、整理了书桌。
- 噪声（无关/无意义/无标签）：窗外有只猫在晒太阳、今天天气不错、测试测试 123、随便记点东西、网购的快递到了三个、隔壁装修好吵、想起了小时候的事、无意义记录一条。

## 注入与清理
- 注入命令：`node scripts/seed-test-data.mjs --dataset noise --fill-embeds`（需本地 API 3000 端口在跑）。
- 严禁 `import()` 该脚本：无 main guard，import 即触发全量注入。
- `--only` 参数只接受数字（前 N 条），不是标题列表。
- 第二轮 fill-embeds 的 `findExistingCaptured` 预检可能失败 → 按全量重插前 12 条造成重复；按 title 分组保留 created_at 最早一条、删除其余（只删 captured_info，节点/引用不清理）。
- Supabase REST：captured_info 无 scope_id 列，demo 数据用 `user_id=is.null` 过滤；knowledge_nodes 才有 scope_id。DELETE 返回 200（非 204）也是成功。

## 验收结果（全部通过）
1. summarize 30d：主题全为信号内容（加班与时间错觉 8/效率与深度工作 6/健康 4/计划实验复盘 4/工作家庭平衡 3），无噪声主题混入。
2. recommend：无噪声进核心 related/forming；无节点关联的"今天天气不错"沉底 review（"尚未关联知识节点"）；related 全为信号对（共享标签）。
3. 图谱合并：多捕获共享节点（专注度 17 源、睡觉 12、家庭 7、外卖 7），噪声捕获并入既有节点，无重复节点膨胀。
4. 不崩溃：summarize/recommend 均 200。

## 状态
- 基线数据：captures 96 条（user_id=null）全 completed、knowledge_nodes 878 全有 embedding、links >1000。
- typecheck + build 通过；seed 脚本改动已提交（413e0df）。
