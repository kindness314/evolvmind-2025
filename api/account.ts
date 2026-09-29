/**
 * POST /api/account — 账号管理（仅真实用户，Demo 拒绝）
 * body: { action: 'delete' }
 * 流程: 验证 Bearer Token -> service role 按已验证 user_id 删除数据与文件 -> admin 删除 Auth 用户
 * 安全不变量: service role 只在 Token 验证通过后、且所有操作强制 scope 到该 user_id 时使用。
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';

export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  if (req.body?.action !== 'delete') {
    res.status(400).json({ error: 'Unknown action' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on server' });
    return;
  }

  let scope;
  try {
    scope = await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : 'Authentication required' });
    return;
  }
  if (scope.isDemo) {
    res.status(400).json({ error: '演示模式无账户可注销' });
    return;
  }
  const userId = scope.scopeId;

  const adminHeaders = {
    'Content-Type': 'application/json',
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };
  const base = SUPABASE_URL.replace(/\/$/, '');

  try {
    // 1. 收集并删除 Storage 文件（首段 = userId）
    const listResp = await fetch(`${base}/storage/v1/object/list/captured-files`, {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({ prefix: `${userId}/`, limit: 1000 }),
    });
    if (listResp.ok) {
      const objs = (await listResp.json()) as { name?: string }[];
      const paths = objs.map((o) => o.name).filter((n): n is string => Boolean(n)).map((n) => `${userId}/${n}`);
      if (paths.length) {
        await fetch(`${base}/storage/v1/object/captured-files`, {
          method: 'DELETE',
          headers: adminHeaders,
          body: JSON.stringify({ prefixes: paths }),
        });
      }
    }

    // 2. 删业务数据（全部强制 user_id 过滤）
    for (const table of ['knowledge_links', 'knowledge_nodes', 'topic_labels', 'captured_info']) {
      const del = await fetch(`${base}/rest/v1/${table}?user_id=eq.${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: adminHeaders,
      });
      // topic_labels 可能以 scope_id 为列名，user_id 不存在时 400/42703 -> 回退 scope_id
      if (!del.ok && table === 'topic_labels') {
        await fetch(`${base}/rest/v1/topic_labels?scope_id=eq.${encodeURIComponent(userId)}`, {
          method: 'DELETE',
          headers: adminHeaders,
        });
      }
    }

    // 3. 删除 Auth 用户
    const delUser = await fetch(`${base}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      headers: adminHeaders,
    });
    if (!delUser.ok) {
      const text = await delUser.text();
      throw new Error(`删除 Auth 用户失败: ${delUser.status} ${text.slice(0, 200)}`);
    }

    res.status(200).json({ ok: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : '注销失败' });
  }
}
