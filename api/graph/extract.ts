type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  json(data: any): void;
};

type GraphNodeKind =
  | 'person'
  | 'event'
  | 'object'
  | 'concept'
  | 'view'
  | 'conclusion'
  | 'todo'
  | 'question'
  | 'time'
  | 'location';

type GraphLinkType =
  | 'causes'
  | 'part_of'
  | 'supports'
  | 'happens_at'
  | 'located_in'
  | 'related_to';

type ExtractedGraphNode = {
  id: string;
  name: string;
  kind: GraphNodeKind;
  aliases: string[];
  confidence?: number;
};

type ExtractedGraphLink = {
  source: string;
  target: string;
  type: GraphLinkType;
  evidence?: string;
  confidence?: number;
};

type ExtractedGraph = {
  nodes: ExtractedGraphNode[];
  links: ExtractedGraphLink[];
};

const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

function stripTrailingV1(url: string) {
  return url.replace(/\/v1\/?$/, '');
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObjects(text: string): string[] {
  const s = (text || '').trim();
  const results: string[] = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = start; j < s.length; j++) {
      const ch = s[j];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          results.push(s.slice(start, j + 1));
          i = j + 1;
          break;
        }
      }
      if (j === s.length - 1) i = s.length;
    }
  }
  return results;
}

function normalizeContentToJson(text: string): any {
  const trimmed = (text || '').trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const direct = safeJsonParse(withoutFence);
  if (direct) return direct;

  const all = extractJsonObjects(withoutFence);
  if (all.length > 0) {
    for (let idx = all.length - 1; idx >= 0; idx--) {
      const parsed = safeJsonParse(all[idx]);
      if (parsed && (parsed.nodes || parsed.links)) return parsed;
    }
  }

  return null;
}

function uniqStrings(values: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v ?? '').toString().trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeKind(k: any): GraphNodeKind {
  const v = (k ?? '').toString().trim().toLowerCase();
  const allowed: GraphNodeKind[] = ['person', 'event', 'object', 'concept', 'view', 'conclusion', 'todo', 'question', 'time', 'location'];
  if ((allowed as string[]).includes(v)) return v as GraphNodeKind;
  return 'concept';
}

function normalizeLinkType(t: any): GraphLinkType {
  const v = (t ?? '').toString().trim().toLowerCase();
  const allowed: GraphLinkType[] = ['causes', 'part_of', 'supports', 'happens_at', 'located_in', 'related_to'];
  if ((allowed as string[]).includes(v)) return v as GraphLinkType;
  return 'related_to';
}

function normalizeGraph(obj: any): ExtractedGraph {
  const nodesRaw = Array.isArray(obj?.nodes) ? obj.nodes : [];
  const linksRaw = Array.isArray(obj?.links) ? obj.links : [];

  const nodes: ExtractedGraphNode[] = nodesRaw
    .map((n: any, idx: number) => {
      const id = (n?.id ?? `n${idx + 1}`).toString().trim() || `n${idx + 1}`;
      const name = (n?.name ?? '').toString().trim();
      const aliases = uniqStrings([...(Array.isArray(n?.aliases) ? n.aliases : [])]);
      const confidence = typeof n?.confidence === 'number' ? n.confidence : undefined;
      return {
        id,
        name,
        kind: normalizeKind(n?.kind),
        aliases,
        confidence,
      };
    })
    .filter((n: ExtractedGraphNode) => n.name.length > 0)
    .slice(0, 50);

  const nodeIds = new Set(nodes.map((n) => n.id));

  const links: ExtractedGraphLink[] = linksRaw
    .map((l: any) => {
      const source = (l?.source ?? '').toString().trim();
      const target = (l?.target ?? '').toString().trim();
      const evidence = (l?.evidence ?? '').toString().trim() || undefined;
      const confidence = typeof l?.confidence === 'number' ? l.confidence : undefined;
      return {
        source,
        target,
        type: normalizeLinkType(l?.type),
        evidence,
        confidence,
      };
    })
    .filter((l: ExtractedGraphLink) => nodeIds.has(l.source) && nodeIds.has(l.target) && l.source !== l.target)
    .slice(0, 80);

  return { nodes, links };
}

async function callChatCompletion(params: { url: string; apiKey: string; model: string; content: string }) {
  const resp = await fetch(params.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      temperature: 0.2,
      messages: [
        {
          role: 'system',
          content:
            '你是一个知识图谱抽取助手。你必须只返回严格 JSON，不要输出 Markdown/解释。目标：从输入内容抽取“人/事/物/概念/观点/结论/待办/疑问/时间/地点”并建立关系。输出格式必须为：{"nodes":[{"id":"n1","name":"...","kind":"person|event|object|concept|view|conclusion|todo|question|time|location","aliases":["..."],"confidence":0.0}],"links":[{"source":"n1","target":"n2","type":"causes|part_of|supports|happens_at|located_in|related_to","evidence":"输入中的原句片段","confidence":0.0}]}. 规则：1) 同一概念在本段内容内合并为一个 node，并把同义词/别名放入 aliases；2) nodes<=25 links<=40；3) evidence 尽量取原文短句；4) confidence 0-1；5) 如果不确定，type 用 related_to，kind 用 concept。',
        },
        { role: 'user', content: params.content },
      ],
    }),
  });

  const text = await resp.text();
  const json = safeJsonParse(text);
  return { ok: resp.ok, status: resp.status, statusText: resp.statusText, text, json };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.MINIMAX_API_KEY || '';
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const preferredModel = process.env.MINIMAX_MODEL || '';

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      route: '/api/graph/extract',
      hasKey: Boolean(apiKey),
      baseUrl,
      model: preferredModel || null,
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ error: 'Missing MINIMAX_API_KEY on server' });
    return;
  }

  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!content) {
    res.status(400).json({ error: 'Missing content' });
    return;
  }

  const candidates = [
    preferredModel,
    'abab6.5s-chat',
    'abab6.5-chat',
    'abab6-chat',
    'MiniMax-M2.1',
    'MiniMax-M2',
  ].filter(Boolean);

  const urlsToTry = Array.from(
    new Set([`${baseUrl.replace(/\/$/, '')}/chat/completions`, `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/chat/completions`]),
  );

  for (const model of candidates) {
    let r: Awaited<ReturnType<typeof callChatCompletion>> | null = null;

    for (const url of urlsToTry) {
      r = await callChatCompletion({ url, apiKey, model, content });
      if (!r.ok && r.status === 404) continue;
      break;
    }

    if (!r) {
      res.status(502).json({ error: 'Upstream not reachable' });
      return;
    }

    if (!r.ok) {
      res.status(r.status).json({ error: 'AI API error', detail: r.json || r.text, model, baseUrl, triedUrls: urlsToTry });
      return;
    }

    const contentStr = r.json?.choices?.[0]?.message?.content || '';
    const extracted = normalizeContentToJson(contentStr);
    if (!extracted) {
      res.status(502).json({ error: 'Invalid AI response format', raw: contentStr, model });
      return;
    }

    const graph = normalizeGraph(extracted);
    res.status(200).json({ data: graph, model });
    return;
  }

  res.status(502).json({ error: 'No model succeeded', tried: candidates });
}

