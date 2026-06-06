import { buildKnowledgeNodeEmbeddingText, generateEmbedding, type VercelRequest, type VercelResponse } from '../_lib/embedding.js';

const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
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

  const nodeId = typeof req.body?.node_id === 'string' ? req.body.node_id : '';
  if (!nodeId) {
    res.status(400).json({ error: 'Missing node_id' });
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
  };

  try {
    const queryUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/knowledge_nodes?id=eq.${nodeId}&select=id,name,normalized_name,kind,aliases,metadata&limit=1`;
    const queryResp = await fetch(queryUrl, { headers });

    if (!queryResp.ok) {
      const errText = await queryResp.text();
      res.status(queryResp.status).json({ error: 'Supabase query error', detail: errText });
      return;
    }

    const rows = await queryResp.json();
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(404).json({ error: 'Node not found' });
      return;
    }

    const text = buildKnowledgeNodeEmbeddingText(rows[0]);
    if (!text.trim()) {
      res.status(200).json({ ok: true, skipped: true, message: '空节点，跳过' });
      return;
    }

    const { embedding, model } = await generateEmbedding({ text, apiKey });
    const embeddingStr = `[${embedding.join(',')}]`;

    const updateResp = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/knowledge_nodes?id=eq.${nodeId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ embedding: embeddingStr }),
    });

    if (!updateResp.ok) {
      const errText = await updateResp.text();
      res.status(updateResp.status).json({ error: 'Supabase update error', detail: errText });
      return;
    }

    res.status(200).json({ ok: true, id: nodeId, model });
  } catch (e: any) {
    res.status(500).json({ error: 'Graph node embed failed', detail: e.message });
  }
}
