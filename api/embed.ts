/**
 * POST /api/embed — 为单条 captured_info 生成 embedding
 * 用于 CapturePage 保存后的 fire-and-forget 调用
 */
import { generateEmbedding, buildEmbeddingText, type VercelRequest, type VercelResponse } from './_lib/embedding.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

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

  const capturedId = typeof req.body?.captured_id === 'string' ? req.body.captured_id : '';
  if (!capturedId) {
    res.status(400).json({ error: 'Missing captured_id' });
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    // 1. 查询该行
    const queryUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${capturedId}&select=id,title,summary,content,tags&limit=1`;
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
    const text = buildEmbeddingText(row);
    if (!text.trim()) {
      res.status(200).json({ ok: true, skipped: true, message: '空内容，跳过' });
      return;
    }

    // 2. 生成 embedding
    const { embedding, model } = await generateEmbedding({ text, apiKey });
    const embeddingStr = `[${embedding.join(',')}]`;

    // 3. 更新该行
    const updateUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/captured_info?id=eq.${capturedId}`;
    const updateResp = await fetch(updateUrl, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ embedding: embeddingStr }),
    });

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      res.status(updateResp.status).json({ error: 'Supabase update error', detail: errText });
      return;
    }

    res.status(200).json({ ok: true, id: capturedId, model });
  } catch (e: any) {
    res.status(500).json({ error: 'Embed failed', detail: e.message });
  }
}
