type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
};

type VercelResponse = {
  status(code: number): VercelResponse;
  json(data: unknown): void;
  /** Node ServerResponse 属性: 响应是否已写出, 供超时回调判断 */
  writableEnded?: boolean;
  on?: (event: 'finish', cb: () => void) => void;
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

// Vercel 函数时长上限: 默认 Hobby 10s 会杀掉正常 LLM 调用(实测 8-13s), 提到 60s 与总预算对齐
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

  const repaired = safeJsonParse(repairUnescapedQuotes(withoutFence));
  if (repaired) return repaired;

  const all = extractJsonObjects(withoutFence);
  if (all.length > 0) {
    for (let idx = all.length - 1; idx >= 0; idx--) {
      const parsed = safeJsonParse(all[idx]);
      if (parsed && (Array.isArray(parsed.nodes) || Array.isArray(parsed.links))) return parsed;
    }
  }

  // 截断恢复: LLM 输出可能被 max_tokens/上游截断, 尝试补闭合 }/] 后解析
  const trimmed2 = withoutFence.trim();
  for (let n = 1; n <= 8; n++) {
    const byBrace = safeJsonParse(trimmed2 + '}'.repeat(n));
    if (byBrace && (Array.isArray(byBrace.nodes) || Array.isArray(byBrace.links))) return byBrace;
    const byBracketBrace = safeJsonParse(trimmed2 + ']}'.repeat(n));
    if (byBracketBrace && (Array.isArray(byBracketBrace.nodes) || Array.isArray(byBracketBrace.links))) return byBracketBrace;
    const byBracketThenBrace = safeJsonParse(trimmed2 + ']'.repeat(n) + '}');
    if (byBracketThenBrace && (Array.isArray(byBracketThenBrace.nodes) || Array.isArray(byBracketThenBrace.links))) return byBracketThenBrace;
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

type ChatResult = {
  ok: boolean;
  status: number;
  statusText: string;
  text: string;
  /** 上游原始响应 JSON(可能为 null): AI 动态载荷, 保持宽松类型 */
  json: any;
};

async function callChatCompletion(params: { url: string; apiKey: string; model: string; content: string }): Promise<ChatResult> {
  // 429 退避重试: 上游 qpm(每分钟配额) 限流时等待后重试, 避免批量一键处理时一次限流即判失败
  const sleep = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  };
  const MAX_ATTEMPTS = 4; // 原始 1 次 + 退避重试 3 次 (2s/4s/8s)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    // 上游超时 55s: 与 maxDuration 60s 对齐, 给慢速但有效的模型留出完成窗口;
    // 实测 MiniMax-M2.5 单次生成约 50s, 原 25s abort 会误杀有效调用
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 55_000);
    let resp: Response;
    try {
      resp = await fetch(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          model: params.model,
          temperature: 0.2,
          max_tokens: 4096,
          messages: [
            {
              role: 'system',
              content:
                '你是一个知识图谱抽取助手。你必须只返回严格 JSON，不要输出 Markdown/解释。目标：从输入内容抽取“人/事/物/概念/观点/结论/待办/疑问/时间/地点”并建立关系。输出格式必须为：{"nodes":[{"id":"n1","name":"...","kind":"person|event|object|concept|view|conclusion|todo|question|time|location","aliases":["..."],"confidence":0.0}],"links":[{"source":"n1","target":"n2","type":"causes|part_of|supports|happens_at|located_in|related_to","evidence":"输入中的原句片段","confidence":0.0}]}. 规则：1) 同一概念在本段内容内合并为一个 node，并把同义词/别名放入 aliases；2) nodes<=25 links<=40；3) evidence 尽量取原文短句；4) confidence 0-1；5) 如果不确定，type 用 related_to，kind 用 concept。',
            },
            { role: 'user', content: params.content },
          ],
        }),
        signal: controller.signal,
      });
    } catch (err) {
      // AbortError 必须结构化返回: 若冒泡成 unhandled rejection,
      // Windows 下 Vercel CLI 的 serverless 模拟会崩溃整个 dev server (FUNCTION_INVOCATION_FAILED)
      const aborted = err instanceof Error && err.name === 'AbortError';
      return {
        ok: false,
        status: aborted ? 504 : 502,
        statusText: aborted ? 'Upstream timeout' : 'Upstream error',
        text: '',
        json: null,
      };
    } finally {
      clearTimeout(timer);
    }

    const text = await resp.text();
    const json = safeJsonParse(text);
    if (resp.status === 429 && attempt < MAX_ATTEMPTS) {
      // 限流: 退避后重试同一模型/URL, 尝试耗尽才交给上层换候选
      await sleep(2000 * 2 ** (attempt - 1)); // 2s / 4s / 8s
      continue;
    }
    return { ok: resp.ok, status: resp.status, statusText: resp.statusText, text, json };
  }
  // 不可达: 循环内所有路径均 return/continue, 仅满足 TS 全路径检查
  return { ok: false, status: 502, statusText: 'Unreachable', text: '', json: null };
}

async function fetchModels(url: string, apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let resp: Response;
  try {
    resp = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    // 与 callChatCompletion 同理: abort/网络错误结构化返回, 不冒泡
    const aborted = err instanceof Error && err.name === 'AbortError';
    return { ok: false, status: aborted ? 504 : 502, text: '', json: null };
  } finally {
    clearTimeout(timer);
  }
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

function getGraphModelCandidates(preferredModel: string) {
  // 候选压缩: 全量候选 × 55s 单次超时会让最坏情况拖到数分钟(前端 60s 超时兜底)。
  // 只保留 env 首选 + 3 个高命中模型, 配合 handler 总预算 58s 兜底。
  return Array.from(
    new Set(
      [
        preferredModel,
        'DeepSeek-V4-Pro',
        'MiniMax-M3',
        'MiniMax-M2.5',
      ].filter(Boolean),
    ),
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = process.env.MINIMAX_CHAT_API_KEY || process.env.MINIMAX_API_KEY || '';
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const preferredModel = process.env.MINIMAX_MODEL || '';

  // 总预算 58s: 略大于单次超时 55s, 允许一个慢速但有效的模型完成(实测 MiniMax-M2.5 约 50s);
  // 超过即 502, 避免候选模型串行重试把请求拖到数分钟(前端 60s 超时兜底)
  const BUDGET_MS = 58_000;
  let timedOut = false;
  const budgetTimer = setTimeout(() => {
    if (res.writableEnded) return; // 已正常响应则不再二次写
    timedOut = true;
    res.status(502).json({ error: 'Graph extract timeout', note: `LLM 上游响应超过 ${BUDGET_MS / 1000}s 预算` });
  }, BUDGET_MS);
  // 任何响应路径(finish)都清理预算 timer; 502 预算响应自身触发后 finish 亦会清(no-op)
  res.on?.('finish', () => clearTimeout(budgetTimer));

  const candidates = getGraphModelCandidates(preferredModel);

  if (req.method === 'GET') {
    res.status(200).json({
      ok: true,
      route: '/api/graph/extract',
      hasKey: Boolean(apiKey),
      baseUrl,
      model: preferredModel || null,
      modelCandidates: candidates,
    });
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
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

  let lastError: unknown = null;

  const urlsToTry = Array.from(
    new Set([`${baseUrl.replace(/\/$/, '')}/chat/completions`, `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/chat/completions`]),
  );

  for (const model of candidates) {
    if (timedOut) return;
    let r: ChatResult | null = null;

    for (const url of urlsToTry) {
      r = await callChatCompletion({ url, apiKey, model, content });
      if (timedOut) return;
      if (!r) continue;
      if (!r.ok && r.status === 404) continue;
      break;
    }

    if (!r) {
      res.status(502).json({ error: 'Upstream not reachable' });
      return;
    }

    if (!r.ok) {
      const reason = r.json?.reason || r.json?.detail?.reason;
      if (r.status === 403 && reason === 'ModelNotAllowed') {
        lastError = r.json || { status: r.status, message: r.text };
        continue;
      }
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

  // Dynamic fallback: try models from the provider's /models endpoint
  const available = await tryGetAvailableModels(baseUrl, apiKey);
  if (available.ok && available.models.length > 0) {
    const triedSet = new Set(candidates);
    const dynamicModels = available.models.filter((m: string) => !triedSet.has(m) && !isNonChatModel(m)).slice(0, 5);
    for (const model of dynamicModels) {
      if (timedOut) return;
      let r: ChatResult | null = null;
      for (const url of urlsToTry) {
        r = await callChatCompletion({ url, apiKey, model, content });
        if (timedOut) return;
        if (!r) continue;
        if (!r.ok && r.status === 404) continue;
        break;
      }

      if (!r) continue;

      if (!r.ok) {
        const reason = r.json?.reason || r.json?.detail?.reason;
        if (r.status === 403 && reason === 'ModelNotAllowed') {
          lastError = r.json || { status: r.status, message: r.text };
          continue;
        }
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
  }

  clearTimeout(budgetTimer);
  res.status(403).json({
    error: 'ModelNotAllowed',
    detail: lastError || null,
    tried: candidates,
    availableModels: available.ok ? available.models : undefined,
    modelsLookupTriedUrls: available.triedUrls,
  });
}

