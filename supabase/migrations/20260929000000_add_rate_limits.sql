-- LLM/API 限流计数（2026-09-29 安全审计遗留项 1）
-- serverless 实例间无共享内存,用 Supabase 表 + SECURITY DEFINER RPC 做原子固定窗口计数。
-- 表无 RLS 策略 -> 直连全拒,只能经 RPC 自增。

create table if not exists public.rate_limit_counters (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);

alter table public.rate_limit_counters enable row level security;
-- 故意不建任何策略: anon/authenticated 直连全部拒绝,仅 RPC(SECURITY DEFINER)可写。

-- 固定窗口:命中当前窗口计数+1,返回是否放行;顺带清 1 小时前的旧窗口。
create or replace function public.rate_limit_hit(
  p_key text,
  p_limit int,
  p_window_seconds int default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  -- 窗口起点按 p_window_seconds 对齐
  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limit_counters (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start)
  do update set count = public.rate_limit_counters.count + 1
  returning count into v_count;

  -- 机会式清理(低频,避免表膨胀)
  if random() < 0.01 then
    delete from public.rate_limit_counters where window_start < now() - interval '1 hour';
  end if;

  return v_count <= p_limit;
end;
$$;

grant execute on function public.rate_limit_hit(text, int, int) to anon;
grant execute on function public.rate_limit_hit(text, int, int) to authenticated;
