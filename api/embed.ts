/**
 * POST /api/embed — 为单条 captured_info 生成 embedding
 * 用于 CapturePage 保存后的 fire-and-forget 调用
 */
import { generateEmbedding, buildEmbeddingText, type VercelRequest, type VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';
// Vercel Hobby 默认函数时长 10s, embedding 上游调用需留出余量
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * O1: 若 graph 子状态已完成且整体未失败, 将整体状态推进为 completed,
 * 避免 processing_status 永远停在 'processing'
 */
async function finalizeIfComplete(updateUrl: string, headers: Record<string, string>) {
  // 子步骤(图谱+向量)均 completed 即推进整体 completed, 不因 processing_status 曾是 failed 而卡死
  const checkUrl = `${updateUrl}&select=graph_status,embedding_status`;
  const resp = await fetch(checkUrl, { method: 'GET', headers }).catch(() => null);
  if (!resp || !resp.ok) return;
  const rows = (await resp.json().catch(() => [])) as Array<{ graph_status?: string | null; embedding_status?: string | null }>;
  const cur = rows[0];
  if (cur && cur.graph_status === 'completed' && cur.embedding_status === 'completed') {
    await fetch(updateUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ processing_status: 'completed', processing_error: null }),
    }).catch(() => {});
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = process.env.MINIMAX_API_KEY || '';
  if (!apiKey) {
    res.status(500).json({ error: 'Missing MINIMAX_API_KEY on server' });
    return;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !supabaseKey) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY on server' });
    return;
  }

  let requestScope;
  try {
    requestScope = await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : 'Authentication required' });
    return;
  }

  const requestSupabaseKey = requestScope.accessToken ? SUPABASE_ANON_KEY : supabaseKey;
  const headers = {
    'Content-Type': 'application/json',
    apikey: requestSupabaseKey,
    Authorization: `Bearer ${requestScope.accessToken || requestSupabaseKey}`,
  };

  const capturedId = typeof req.body?.captured_id === 'string' ? req.body.captured_id : '';
  if (!capturedId) {
    res.status(400).json({ error: 'Missing captured_id' });
    return;
  }
  let updateUrl = '';
  try {
    const scopeQuery = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(requestScope.scopeId)}`;
    const queryUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${capturedId}&${scopeQuery}&select=id,title,summary,content,tags&limit=1`;
    const queryResp = await fetch(queryUrl, { headers });

    if (!queryResp.ok) {
      const errText = await queryResp.text();
      res.status(queryResp.status).json({ error: 'Supabase query error', detail: errText });
      return;
    }

    const rows = await queryResp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(404).json({ error: 'Row not found' });
      return;
    }

    const row = rows[0];
    // 标记处理中: 先于耗时操作写入, 刷新后仍可见"处理中"
    updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${capturedId}`;
    await fetch(updateUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ embedding_status: 'processing' }),
    }).catch(() => {});

    const text = buildEmbeddingText(row);
    if (!text.trim()) {
      await fetch(updateUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ embedding_status: 'completed', processed_at: new Date().toISOString() }),
      }).catch(() => {});
      await finalizeIfComplete(updateUrl, headers);
      res.status(200).json({ ok: true, skipped: true, message: '空内容，跳过' });
      return;
    }

    // 2. 生成 embedding
    const { embedding, model } = await generateEmbedding({ text, apiKey });
    const embeddingStr = `[${embedding.join(',')}]`;
    // 3. 更新该行: 嵌入向量 + 完成状态
    const updateResp = await fetch(updateUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ embedding: embeddingStr, embedding_status: 'completed', processed_at: new Date().toISOString() }),
    });

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      // 更新失败也落库为 failed, 便于前端重试
      await fetch(updateUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ embedding_status: 'failed', processing_status: 'failed', processing_error: `supabase update: ${errText.slice(0, 300)}` }),
      }).catch(() => {});
      res.status(updateResp.status).json({ error: 'Supabase update error', detail: errText });
      return;
    }

    await finalizeIfComplete(updateUrl, headers);
    res.status(200).json({ ok: true, id: capturedId, model });
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    if (updateUrl) {
      await fetch(updateUrl, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ embedding_status: 'failed', processing_status: 'failed', processing_error: `embed: ${errMsg.slice(0, 500)}` }),
      }).catch(() => {});
    }
    res.status(500).json({ error: 'Embed failed', detail: errMsg });
  }
}
