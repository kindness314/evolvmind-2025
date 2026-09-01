-- O3: 文件生命周期 —— 存储元数据列。
-- 背景：此前上传文件的临时 signed URL（60 分钟）被存入 captured_info.content，
-- 过期后详情页/列表无法再访问。新增元数据列后：
--   - 新上传：content 存文件描述文本，storage_path 存对象路径，展示时动态生成 signed URL
--   - 存量数据：content 仍是旧 signed URL，读取/删除逻辑需兼容（fallback 推导路径）
-- 保持 Private bucket、用户 UUID 首段路径、10 MiB 限制不变。

alter table public.captured_info
  add column if not exists storage_path text,
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint;
