import type { VercelRequest, VercelResponse } from './_lib/embedding.js';

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

  const apiKey = process.env.MINIMAX_API_KEY || '';
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

