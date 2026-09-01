/**
 * POST /api/graph/disambiguate — P1 实体消歧（GraphRAG 思路）
 *
 * 输入：抽取出的新节点候选（name + kind），已排除精确匹配（normalized_name/aliases）
 * 命中的节点。服务端对这些候选生成 embedding，与 scope 内已有节点（已带 embedding）
 * 做余弦相似度比较；同 kind 且相似度 > 0.85 的返回"建议合并到已有节点"映射。
 *
 * 输出：{ merges: [{ name, targetId, targetName, similarity }] }，前端据此把新节点
 * 合并进已有节点（别名 + 捕获关联），而不是新建重复节点。
 */
import { generateEmbedding, type VercelRequest, type VercelResponse } from '../_lib/embedding.js';
import { resolveRequestScope } from '../_lib/requestScope.js';
import { cosineSimilarity } from '../_lib/similarity.js';

export const maxDuration = 60;

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || process.env.MINIMAX_CHAT_API_KEY || '';

/** 消歧相似度阈值：>0.85 且同 kind 才合并（避免误并） */
const MERGE_SIMILARITY = 0.85;

interface DisambiguateCandidate {
  name: string;
  kind: string;
}

interface ExistingNode {
  id: string;
  name: string;
  normalized_name?: string | null;
  kind?: string | null;
  embedding?: number[] | null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });
    return;
  }

  const rawCandidates = Array.isArray(req.body?.candidates) ? req.body.candidates : [];
  const candidates: DisambiguateCandidate[] = [];
  for (const c of rawCandidates) {
    if (!c || typeof c !== 'object') continue;
    const name = (c as Record<string, unknown>).name;
    const kind = (c as Record<string, unknown>).kind;
    if (typeof name !== 'string' || typeof kind !== 'string') continue;
    const trimmed = name.trim();
    if (!trimmed) continue;
    candidates.push({ name: trimmed, kind });
  }
  if (candidates.length === 0) {
    res.status(200).json({ merges: [] });
    return;
  }

  const supabaseKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY;
  try {
    const requestScope = await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
    const queryKey = requestScope.accessToken || supabaseKey;
    const headers = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${queryKey}`,
    };

    // 查询已有节点（带 embedding 的，供余弦比较）
    const scopeFilter = requestScope.isDemo
      ? 'user_id=is.null'
      : `user_id=eq.${encodeURIComponent(requestScope.scopeId)}`;
    const nodesUrl = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/knowledge_nodes?select=id,name,normalized_name,kind,embedding&${scopeFilter}&embedding=not.is.null&limit=1000`;
    const nodesResp = await fetch(nodesUrl, { headers });
    if (!nodesResp.ok) {
      res.status(nodesResp.status).json({ error: 'Supabase query error', detail: await nodesResp.text() });
      return;
    }
    const existing = (await nodesResp.json()) as ExistingNode[];
    // embedding 列在 PostgREST 中是 JSON 数组文本（string），解析为 number[]
    const parseEmbedding = (raw: unknown): number[] | null => {
      if (Array.isArray(raw)) return raw.length > 0 ? (raw as number[]) : null;
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const arr = JSON.parse(raw);
          return Array.isArray(arr) && arr.length > 0 ? (arr as number[]) : null;
        } catch {
          return null;
        }
      }
      return null;
    };
    const withEmbedding = existing
      .map((n) => ({ ...n, embedding: parseEmbedding(n.embedding) }))
      .filter((n): n is ExistingNode & { embedding: number[] } => Array.isArray(n.embedding) && n.embedding.length > 0);
    if (withEmbedding.length === 0) {
      res.status(200).json({ merges: [], skipped: 'no existing embeddings' });
      return;
    }

    // 逐候选生成 embedding 并比较（并发 4，控制 qpm 限流）
    const merges: Array<{ name: string; targetId: string; targetName: string; similarity: number }> = [];
    let cursor = 0;
    const workerCount = 4;
    const workers = Array.from({ length: workerCount }, async () => {
      while (cursor < candidates.length) {
        const idx = cursor;
        cursor += 1;
        const c = candidates[idx];
        try {
          const text = `${c.name} ${c.kind}`.trim();
          const { embedding } = await generateEmbedding({ text, apiKey: MINIMAX_API_KEY });
          if (!embedding || embedding.length === 0) continue;
          let bestSim = 0;
          let bestNode: ExistingNode | null = null;
          for (const n of withEmbedding) {
            // 同 kind 才比较（person 不并 concept）
            if (n.kind && c.kind && n.kind !== c.kind) continue;
            const sim = cosineSimilarity(embedding, n.embedding as number[]);
            if (sim > bestSim) {
              bestSim = sim;
              bestNode = n;
            }
          }
          if (bestNode && bestSim > MERGE_SIMILARITY) {
            merges.push({ name: c.name, targetId: bestNode.id, targetName: bestNode.name, similarity: Number(bestSim.toFixed(3)) });
          }
        } catch {
          // 单候选失败跳过，不影响其它候选与主流程
        }
      }
    });
    await Promise.all(workers);

    res.status(200).json({ merges });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    const status = message === 'Authentication required' || message === 'Invalid authentication token' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Disambiguate failed', detail: message });
  }
}
