-- 话题模型命名缓存（2026-08-18）
-- 社区检测（贪心模块度）给出话题簇后，调服务端 LLM 归纳更贴切的簇名+说明；
-- 结果按 (scope_id, cluster_key) 缓存，避免每次加载图谱重复调用 LLM。
-- cluster_key = 簇成员节点 id 排序后拼接的 hash（内容确定则 key 稳定）。

create table if not exists public.topic_labels (
  id uuid primary key default gen_random_uuid(),
  scope_id text not null,
  cluster_key text not null,
  name text not null,
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (scope_id, cluster_key)
);

alter table public.topic_labels enable row level security;

-- 真实用户：仅能读写自己 scope 的标注（scope_id = auth.uid()）
create policy "topic_labels_select_own" on public.topic_labels
  for select using (auth.uid()::text = scope_id);
create policy "topic_labels_insert_own" on public.topic_labels
  for insert with check (auth.uid()::text = scope_id);
create policy "topic_labels_delete_own" on public.topic_labels
  for delete using (auth.uid()::text = scope_id);

-- Demo 例外：固定共享 scope（与 captured_info/knowledge_nodes 的 demo 策略一致）
create policy "topic_labels_demo_select" on public.topic_labels
  for select using (scope_id = '00000000-0000-0000-0000-000000000000');
create policy "topic_labels_demo_insert" on public.topic_labels
  for insert with check (scope_id = '00000000-0000-0000-0000-000000000000');
create policy "topic_labels_demo_delete" on public.topic_labels
  for delete using (scope_id = '00000000-0000-0000-0000-000000000000');
