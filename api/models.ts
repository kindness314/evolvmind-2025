import type { VercelRequest, VercelResponse } from './_lib/embedding.js';
import { resolveApiKey } from './_lib/apiKey.js';
import { resolveRequestScope } from './_lib/requestScope.js';

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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  // 模型清单查询走系统额度，需认证（demo 亦可），防匿名滥用/信息探测
  const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
  try {
    await resolveRequestScope({ req, supabaseUrl: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY });
  } catch (e: unknown) {
    res.status(401).json({ error: e instanceof Error ? e.message : 'Authentication required' });
    return;
  }

  const apiKey = resolveApiKey(req) || process.env.MINIMAX_API_KEY || '';
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;

  if (!apiKey) {
    res.status(500).json({ error: 'Missing MINIMAX_API_KEY on server' });
    return;
  }

  const urlsToTry = Array.from(
    new Set([
      `${baseUrl.replace(/\/$/, '')}/models`,
      `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/models`,
    ]),
  );

  let last: any = null;
  for (const url of urlsToTry) {
    const r = await fetchModels(url, apiKey);
    last = r;
    if (r.ok) {
      const data = r.json?.data;
      const ids = Array.isArray(data) ? data.map((m: any) => m?.id).filter(Boolean) : [];
      res.status(200).json({ ok: true, baseUrl, triedUrls: urlsToTry, models: ids, raw: r.json || r.text });
      return;
    }
  }

  res.status(last?.status || 502).json({ ok: false, baseUrl, triedUrls: urlsToTry, detail: last?.json || last?.text || null });
}

