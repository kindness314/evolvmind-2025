/**
 * api/_lib/apiKey.ts — 自定义 API Key 解析（2026-09）
 *
 * 前端"用我自己的 Key"时，每个 AI 请求带 `X-Api-Key` 头（仅 HTTPS 传输，不落库）。
 * 后端统一从这里解析：优先请求头里的自定义 key，其次环境变量。
 *
 * Mock Input:
 *   req.headers['x-api-key'] = 'sk-xxx'   → 返回 'sk-xxx'
 *   无请求头 key                          → 返回环境变量 MINIMAX key
 */
import type { VercelRequest } from './embedding.js';

/** 自定义 key 请求头名（前端 getApiAuthHeaders 会带上） */
export const CUSTOM_KEY_HEADER = 'x-api-key';

const ENV_CANDIDATES = ['MINIMAX_CHAT_API_KEY', 'MINIMAX_API_KEY'];

/** 解析本次请求应使用的 LLM key：请求头自定义 key 优先，否则环境变量 */
export function resolveApiKey(req: VercelRequest): string {
  const raw = req.headers[CUSTOM_KEY_HEADER];
  const custom = Array.isArray(raw) ? raw[0] : raw;
  if (typeof custom === 'string' && custom.trim().length > 0) {
    return custom.trim();
  }
  for (const name of ENV_CANDIDATES) {
    const env = process.env[name];
    if (env && env.trim().length > 0) return env.trim();
  }
  return '';
}

/** 是否是自定义 key（非环境变量默认）——供日志/状态展示区分来源 */
export function isCustomKey(req: VercelRequest): boolean {
  const raw = req.headers[CUSTOM_KEY_HEADER];
  const custom = Array.isArray(raw) ? raw[0] : raw;
  return typeof custom === 'string' && custom.trim().length > 0;
}

/** 图片语义识别专用 Key 请求头名 */
export const VISION_KEY_HEADER = 'x-vision-key';

/** 解析 vision 请求 key：专用头 -> 主自定义 key -> 环境变量（与 resolveApiKey 同回退链） */
export function resolveVisionKey(req: VercelRequest): string {
  const raw = req.headers[VISION_KEY_HEADER];
  const vision = Array.isArray(raw) ? raw[0] : raw;
  if (typeof vision === 'string' && vision.trim().length > 0) {
    return vision.trim();
  }
  return resolveApiKey(req);
}