import { resolveRequestScope } from './_lib/requestScope.js';
import { resolveApiKey } from './_lib/apiKey.js';
// 手动声明 Vercel 平台提供的请求与响应类型，避免依赖 @vercel/node
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

type ExtractedInfo = {
  title: string;
  keywords: string[];
  summary: string;
};

const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
// Vercel Hobby 默认函数时长 10s, 而 LLM 上游单次生成实测需 8-54s, 必须提到 60s 上限
export const maxDuration = 60;

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

/**
 * 修复 LLM 输出 JSON 中字符串值里未转义的 ASCII 引号
 * （例如 MiniMax 常输出 "由"处理中"切换" 这类内嵌引号，会导致 JSON.parse 失败）。
 * 仅在结构上下文之外的裸引号才转义，合法 JSON 不受影响。
 */
function repairUnescapedQuotes(text: string): string {
  const s = (text || '').trim();
  if (!s) return s;
  let out = '';
  let inString = false;
  let escaped = false;
  const isOpenContext = (ch: string | undefined) => ch === ':' || ch === ',' || ch === '[' || ch === '{' || ch === undefined;
  const isCloseContext = (ch: string | undefined) => ch === ',' || ch === '}' || ch === ']' || ch === ':' || ch === undefined;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = j >= s.length ? undefined : s[j];
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
          out += ch;
          inString = false;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(s[k])) k--;
      const prev = k < 0 ? undefined : s[k];
      if (prev === ':' || prev === ',' || prev === '[' || prev === '{' || prev === undefined) {
        out += ch;
        inString = true;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
}

function extractFirstJsonObject(text: string): string | null {
  const s = (text || '').trim();
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
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
        return s.slice(start, i + 1);
      }
    }
  }
  return null;
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
        if (ch === '"') {
          inString = false;
        }
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
      if (j === s.length - 1) {
        i = s.length;
      }
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
  const repaired = safeJsonParse(repairUnescapedQuotes(withoutFence));
  if (repaired) return repaired;


  const all = extractJsonObjects(withoutFence);
  if (all.length > 0) {
    for (let idx = all.length - 1; idx >= 0; idx--) {
      const parsed = safeJsonParse(all[idx]);
      if (parsed && (parsed.title || parsed.summary || parsed.keywords)) {
        return parsed;
      }
    }
  }

  const extracted = extractFirstJsonObject(withoutFence);
  if (!extracted) return null;
  return safeJsonParse(extracted);
}

function normalizeExtractedInfo(obj: any): ExtractedInfo {
  return {
    title: (obj?.title || '无标题').toString(),
    keywords: Array.isArray(obj?.keywords) ? obj.keywords.map((k: any) => String(k)).slice(0, 8) : [],
    summary: (obj?.summary || '无摘要').toString(),
  };
}

async function callChatCompletion(params: {
  url: string;
  apiKey: string;
  model: string;
  content: string;
}) {
  const resp = await fetch(params.url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: 'system',
          content:
            '你是一个专业的信息提取助手。请分析用户提供的内容，提取出一个简短的标题、3-5个关键词以及一段精简的摘要。请务必只返回严格的 JSON：{"title":"...","keywords":["..."],"summary":"..."}。不要输出 Markdown。',
        },
        { role: 'user', content: params.content },
      ],
    }),
  });

  const text = await resp.text();
  const json = safeJsonParse(text);
  return { ok: resp.ok, status: resp.status, statusText: resp.statusText, text, json };
}

async function fetchModels(url: string, apiKey: string) {
  const resp = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });
  const text = await resp.text();
  const json = safeJsonParse(text);
  return { ok: resp.ok, status: resp.status, text, json };
}

async function tryGetAvailableModels(baseUrl: string, apiKey: string) {
  const urlsToTry = Array.from(
    new Set([
      `${baseUrl.replace(/\/$/, '')}/models`,
      `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/models`,
    ]),
  );
  for (const url of urlsToTry) {
    const r = await fetchModels(url, apiKey);
    if (!r.ok) continue;
    const data = r.json?.data;
    const ids = Array.isArray(data) ? data.map((m: any) => m?.id).filter(Boolean) : [];
    return { ok: true as const, models: ids, triedUrls: urlsToTry };
  }
  return { ok: false as const, models: [], triedUrls: urlsToTry };
}

const NON_CHAT_PATTERNS = [/bge/i, /reranker/i];
function isNonChatModel(model: string) {
  return NON_CHAT_PATTERNS.some((p) => p.test(model));
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = resolveApiKey(req);
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;

  const preferredModel = process.env.MINIMAX_MODEL || '';

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      route: '/api/extract',
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

  // 发布门禁 4: LLM 端点认证 —— Demo（header/body.demo）或真实 Bearer 才允许调用，防止匿名消耗配额
  try {
    await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : 'Authentication required' });
    return;
  }

  if (!apiKey) {
    res.status(500).json({ error: 'Missing MINIMAX_CHAT_API_KEY (or MINIMAX_API_KEY) on server' });
    return;
  }

  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  if (!content) {
    res.status(400).json({ error: 'Missing content' });
    return;
  }

  const candidates = Array.from(new Set([
    preferredModel,
    'DeepSeek-V4-Pro',
    'DeepSeek-V3',
    'MiniMax-M3',
    'MiniMax-M2.5',
    'MiniMax-M2.1',
    'MiniMax-M2',
  ].filter(Boolean)));

  let lastError: any = null;

  const urlsToTry = Array.from(
    new Set([
      `${baseUrl.replace(/\/$/, '')}/chat/completions`,
      `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/chat/completions`,
    ]),
  );

  for (const model of candidates) {
    let r: Awaited<ReturnType<typeof callChatCompletion>> | null = null;

    for (const url of urlsToTry) {
      r = await callChatCompletion({ url, apiKey, model, content });

      if (!r.ok && r.status === 404) {
        continue;
      }

      break;
    }

    if (!r) {
      res.status(502).json({ error: 'Upstream not reachable' });
      return;
    }

    if (!r.ok) {
      const reason = r.json?.reason;
      if (r.status === 403 && reason === 'ModelNotAllowed') {
        lastError = r.json || { status: r.status, message: r.text };
        continue;
      }
      res.status(r.status).json({ error: 'AI API error', detail: r.json || r.text, model, baseUrl, triedUrls: urlsToTry });
      return;
    }

    const contentStr = r.json?.choices?.[0]?.message?.content;
    const extracted = normalizeContentToJson(contentStr);
    if (!extracted) {
      res.status(502).json({ error: 'Invalid AI response format', raw: contentStr, model });
      return;
    }

    res.status(200).json({ data: normalizeExtractedInfo(extracted), model });
    return;
  }

  // Dynamic fallback: try models from the provider's /models endpoint
  const available = await tryGetAvailableModels(baseUrl, apiKey);
  if (available.ok && available.models.length > 0) {
    const triedSet = new Set(candidates);
    const dynamicModels = available.models.filter((m: string) => !triedSet.has(m) && !isNonChatModel(m)).slice(0, 5);

    for (const model of dynamicModels) {
      let r: Awaited<ReturnType<typeof callChatCompletion>> | null = null;

      for (const url of urlsToTry) {
        r = await callChatCompletion({ url, apiKey, model, content });
        if (!r.ok && r.status === 404) continue;
        break;
      }

      if (!r) continue;

      if (!r.ok) {
        const reason = r.json?.reason;
        if (r.status === 403 && reason === 'ModelNotAllowed') {
          lastError = r.json || { status: r.status, message: r.text };
          continue;
        }
        res.status(r.status).json({ error: 'AI API error', detail: r.json || r.text, model, baseUrl, triedUrls: urlsToTry });
        return;
      }

      const contentStr = r.json?.choices?.[0]?.message?.content;
      const extracted = normalizeContentToJson(contentStr);
      if (!extracted) {
        res.status(502).json({ error: 'Invalid AI response format', raw: contentStr, model });
        return;
      }

      res.status(200).json({ data: normalizeExtractedInfo(extracted), model });
      return;
    }
  }

  res.status(403).json({
    error: 'ModelNotAllowed',
    detail: lastError || null,
    tried: candidates,
    availableModels: available.ok ? available.models : undefined,
    modelsLookupTriedUrls: available.triedUrls,
  });
}
