/**
 * POST /api/backfill — 批量回填 embedding 向量
 * 为 embedding IS NULL 的 captured_info 行批量生成向量
 */
import { generateEmbedding, buildEmbeddingText, type VercelRequest, type VercelResponse } from './_lib/embedding.js';
import { resolveRequestScope } from './_lib/requestScope.js';
import { resolveApiKey } from './_lib/apiKey.js';
// Vercel Hobby 默认函数时长 10s, 批量回填可能串行处理多行, 需留出余量
export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/backfill' });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const apiKey = resolveApiKey(req) || process.env.MINIMAX_API_KEY || '';
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

  const batchSize = typeof req.body?.batch_size === 'number' ? Math.min(req.body.batch_size, 5) : 5;
  const baseUrl = process.env.MINIMAX_BASE_URL;
  const requestSupabaseKey = requestScope.accessToken ? SUPABASE_ANON_KEY : supabaseKey;
  const headers = {
    'Content-Type': 'application/json',
    apikey: requestSupabaseKey,
    Authorization: `Bearer ${requestScope.accessToken || requestSupabaseKey}`,
  };

  try {
    const scopeQuery = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(requestScope.scopeId)}`;
    const queryUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?embedding=is.null&${scopeQuery}&select=id,title,summary,content,tags&limit=${batchSize}`;
    const queryResp = await fetch(queryUrl, { headers });

    if (!queryResp.ok) {
      const errText = await queryResp.text();
      res.status(queryResp.status).json({ error: 'Supabase query error', detail: errText });
      return;
    }

    const rows = await queryResp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(200).json({ ok: true, processed: 0, message: '没有需要回填的行' });
      return;
    }

    // 2. 逐行生成 embedding 并更新
    let processed = 0;
    const errors: Array<{ id: string; error: string }> = [];

    for (const row of rows) {
      try {
        const text = buildEmbeddingText(row);
        if (!text.trim()) {
          // 空内容视为完成, 避免永久 pending
          await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${row.id}`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ embedding_status: 'completed', processed_at: new Date().toISOString() }),
          }).catch(() => {});
          continue;
        }

        const { embedding } = await generateEmbedding({ text, apiKey, baseUrl });
        const embeddingStr = `[${embedding.join(',')}]`;

        // 更新该行的 embedding + 完成状态
        const updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${row.id}`;
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ embedding: embeddingStr, embedding_status: 'completed', processed_at: new Date().toISOString() }),
        });

        if (!updateResp.ok) {
          const errText = await updateResp.text();
          await fetch(updateUrl, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ embedding_status: 'failed', processing_status: 'failed', processing_error: `backfill update: ${errText.slice(0, 300)}` }),
          }).catch(() => {});
          errors.push({ id: row.id, error: errText });
          continue;
        }

        processed++;
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${row.id}`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ embedding_status: 'failed', processing_status: 'failed', processing_error: `backfill: ${errMsg.slice(0, 500)}` }),
        }).catch(() => {});
        errors.push({ id: row.id, error: errMsg });
      }
    }

    res.status(200).json({
      ok: true,
      processed,
      total: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: 'Backfill failed', detail: e instanceof Error ? e.message : String(e) });
  }
}
