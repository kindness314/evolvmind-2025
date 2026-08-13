# 推荐与总结深度化 — 续接 2026-08-08

## 上次完成的工作

在 08-07 推荐/总结深度化的基础上继续完成了全面的噪声过滤强化。

### 核心改动

**api/_lib/noise.ts**（共享噪声模块）：
- NODE_STOP_WORDS 从 ~40 扩充到 150+，新增类别：餐饮（做饭/买菜）、购物（购物/逛街/网购/取快递）、家务（做家务/打扫/洗碗/倒垃圾）
- 新增 TIME_CONTAINS_PATTERNS（4 条）：星期+时段组合（周X+上/下午N点）、每X+Y点结构、纯时段片段
- 新增 meaningfulLength()：剥离停用词后剩余 <=1 汉字则判纯噪声
- 修复 decimal time: ^\d+(分钟|小时) -> ^\d+(.\d+)?(分钟|小时) 支持1.5小时
- isTrivialNodeName 从5层升级到7层过滤：停用词->极短->单字->标点->锚定时间->包含时间->有意义长度

**api/graph/extract.ts**：将内联40词停用词替换为 import noise module

**api/summarize.ts**：确定性回退路径 centralNodes 和 linkList 均已接噪声过滤；LLM prompt 增加显式忽略指令

**数据库清理**：第一轮删除20噪声节点+56链接；第二轮删除购物/红烧肉/22点/00:40/午饭 5个节点

### 测试结果
- 提取完整测试：9/10 PASS, 1 PARTIAL
- 纯噪声5例全部返回空节点
- Summarize API (LLM路径)：importantNodes全部有意义
- Typecheck + Build：通过

### 已知状态
- devfull 进程运行中 (http://127.0.0.1:5173 + :3000)
- MiniMax API 频率限制：浏览器端首调可能触发429，回退到确定性路径
- Supabase Demo scope：00000000-0000-0000-0000-000000000000

### 遗留项
1. LLM prompt微调：单字概念(失眠)可更多提取
2. 单字符中文节点当前全量过滤，可能偏激进
3. 确定性回退newConnections仍有少量时间噪声(加班->1.5小时)
4. 第4章节点缺乏上下文
