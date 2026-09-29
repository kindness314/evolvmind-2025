/**
 * api/_lib/rateLimit.ts — API 限流（2026-09-29 安全审计遗留项）
 *
 * serverless 无共享内存，用 Supabase RPC rate_limit_hit 做原子固定窗口计数。
 * key 规则：真实用户 `u:<userId>`；demo/匿名 `ip:<x-forwarded-for 首段>`（demo 共享 scope，
 * 按 IP 避免一个访客刷爆全局 demo 额度）。
 *
 * Mock Input/Output:
 *   Input:  await rateLimitOrThrow({ req, scope, supabaseUrl, serviceKey, limit: 20 })
 *   Output: 未超限 resolve；超限 throw new Error('RATE_LIMITED')
 */
import type { VercelRequest } from './embedding.js';
import type { RequestScope } from './requestScope.js';

export const RATE_LIMIT_ERROR = 'RATE_LIMITED';

function clientIp(req: VercelRequest): string {
  const fwd = req.headers['x-forwarded-for'];
  const first = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim();
  if (first) return first;
  const real = req.headers['x-real-ip'];
  return (Array.isArray(real) ? real[0] : real)?.trim() || 'unknown';
}

/**
 * 固定窗口限流。超限抛 RATE_LIMITED；RPC 故障时放行（可用性优先，限流是成本保护不是安全边界）。
 */
export async function rateLimitOrThrow(params: {
  req: VercelRequest;
  scope: RequestScope;
  supabaseUrl: string;
  serviceKey: string;
  /** 窗口内允许次数，默认 20 */
  limit?: number;
  /** 窗口秒数，默认 60 */
  windowSeconds?: number;
  /** 端点分组（不同组独立计数），默认 'llm' */
  bucket?: string;
}): Promise<void> {
  const { req, scope, supabaseUrl, serviceKey } = params;
  const limit = params.limit ?? 20;
  const windowSeconds = params.windowSeconds ?? 60;
  const bucket = params.bucket ?? 'llm';
  if (!supabaseUrl || !serviceKey) return;

  const identity = scope.isDemo ? `ip:${clientIp(req)}` : `u:${scope.scopeId}`;
  const key = `${bucket}:${identity}`;

  try {
    const resp = await fetch(`${supabaseUrl.replace(/\/$/, '')}/rest/v1/rpc/rate_limit_hit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({ p_key: key, p_limit: limit, p_window_seconds: windowSeconds }),
    });
    if (!resp.ok) return; // 限流服务故障不阻断业务
    const allowed = await resp.json();
    if (allowed === false) throw new Error(RATE_LIMIT_ERROR);
  } catch (e) {
    if (e instanceof Error && e.message === RATE_LIMIT_ERROR) throw e;
    // 网络异常放行
  }
}

/** 统一 429 响应 */
export function sendRateLimited(res: { status: (n: number) => { json: (d: unknown) => void } }): void {
  res.status(429).json({ error: '请求过于频繁，请稍后再试' });
}
