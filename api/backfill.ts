/**
 * POST /api/backfill — 批量回填 embedding 向量
 * 为 embedding IS NULL 的 captured_info 行批量生成向量
 */
import { generateEmbedding, buildEmbeddingText, type VercelRequest, type VercelResponse } from './_lib/embedding.js';

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

  const batchSize = typeof req.body?.batch_size === 'number' ? Math.min(req.body.batch_size, 5) : 5;
  const baseUrl = process.env.MINIMAX_BASE_URL;

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    // 1. 查询 embedding IS NULL 的行
    const queryUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?embedding=is.null&select=id,title,summary,content,tags&limit=${batchSize}`;
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
          // 空内容跳过
          continue;
        }

        const { embedding } = await generateEmbedding({ text, apiKey, baseUrl });
        const embeddingStr = `[${embedding.join(',')}]`;

        // 更新该行的 embedding
        const updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${row.id}`;
        const updateResp = await fetch(updateUrl, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ embedding: embeddingStr }),
        });

        if (!updateResp.ok) {
          const errText = await updateResp.text();
          errors.push({ id: row.id, error: errText });
          continue;
        }

        processed++;
      } catch (e: any) {
        errors.push({ id: row.id, error: e.message });
      }
    }

    res.status(200).json({
      ok: true,
      processed,
      total: rows.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (e: any) {
    res.status(500).json({ error: 'Backfill failed', detail: e.message });
  }
}
