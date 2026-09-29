/**
 * POST /api/documents/extract — 多模态文档正文提取（2026-09）
 *
 * 读取 storage_path 指向的文件，按 MIME 提取可读正文（pdf/docx/txt/md），
 * 更新 captured_info.content 并返回正文，供总结/图谱使用。
 * (图片 vision / 语音 ASR 不在此端点；见后续。)
 *
 * Mock Input/Output:
 *   Input:  POST { "id": "uuid", "storage_path": "scopeId/file.pdf", "file_name": "a.pdf", "mime_type": "application/pdf", "demo": true }
 *   Output: { "ok": true, "text": "提取的正文", "extracted": true }
 */
import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '../_lib/embedding.js';
import { resolveRequestScope } from '../_lib/requestScope.js';
import { resolveVisionKey } from '../_lib/apiKey.js';
import { rateLimitOrThrow, sendRateLimited, RATE_LIMIT_ERROR } from '../_lib/rateLimit.js';
import { extractTextFromBuffer, isDocumentTextMime, mimeFromFileName, extractImageText, isImageMime, extractAudioText, isAudioMime } from '../_lib/multimodal.js';

const SUPABASE_URL = process.env.SUPABASE_URL || (process.env.VITE_SUPABASE_PROJECT_ID ? `https://${process.env.VITE_SUPABASE_PROJECT_ID}.supabase.co` : '');
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const apiKey = resolveVisionKey(req);
  if (req.method === 'GET') {
    // 服务状态探测：?deep=1 时用 1x1 图真实调一次 vision，验证模型权限而非仅 key 存在
    const hasKey = Boolean(apiKey);
    if (req.query?.deep === '1') {
      const TINY_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
      const text = hasKey ? await extractImageText(TINY_PNG, 'image/png', apiKey) : '';
      res.status(200).json({ ok: true, route: '/api/documents/extract', hasKey, hasVision: text.trim().length > 0 });
      return;
    }
    res.status(200).json({ ok: true, route: '/api/documents/extract', hasKey });
    return;
  }
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY' });
    return;
  }
  const storagePath = typeof req.body?.storage_path === 'string' ? req.body.storage_path : '';
  if (!storagePath) {
    res.status(400).json({ error: 'Missing storage_path' });
    return;
  }
  const mime = (typeof req.body?.mime_type === 'string' && req.body.mime_type) || mimeFromFileName(String(req.body?.file_name || ''));
  const isImage = isImageMime(mime);
  const isAudio = isAudioMime(mime);
  if (mime && !isImage && !isAudio && !isDocumentTextMime(mime)) {
    res.status(400).json({ error: 'Unsupported document type for text extraction', mime });
    return;
  }

  try {
    const scope = await resolveRequestScope({
      req,
      supabaseUrl: SUPABASE_URL,
      anonKey: SUPABASE_ANON_KEY,
    });
    // 隔离不变量：storage_path 首段必须等于本次请求的已验证 scope，禁止跨账户读文件
    if (!storagePath.startsWith(`${scope.scopeId}/`)) {
      res.status(403).json({ error: 'storage_path 不属于当前账户' });
      return;
    }
    // 限流(安全审计): vision/ASR 消耗 LLM,超限 429;RPC 故障放行
    await rateLimitOrThrow({ req, scope, supabaseUrl: SUPABASE_URL, serviceKey: SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, limit: 15 });
    // 后端下载用 service-role（允许读私有 bucket 且不暴露给前端；scope 已在上方强制校验）
    const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    const { data: blob, error: dlErr } = await admin.storage
      .from('captured-files')
      .download(storagePath);
    if (dlErr || !blob) {
      res.status(404).json({ error: 'Failed to download file', detail: String(dlErr?.message || '') });
      return;
    }
    const buffer = Buffer.from(await blob.arrayBuffer());
    const file_name = String(req.body?.file_name || '');
    const text = isImage
      ? await extractImageText(buffer, mime || 'image/png', apiKey)
      : isAudio
        ? await extractAudioText(buffer, mime || 'audio/mpeg', file_name, apiKey)
        : await extractTextFromBuffer(mime, buffer);
    const extracted = text.trim().length > 0;

    // 更新 captured_info.content 为提取的正文（仅当提取到非空）
    if (extracted && typeof req.body?.id === 'string') {
      const adminDb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY, { auth: { persistSession: false } });
      // captured_info 只有 user_id 列（demo 为 null，真实为用户 UUID），scope 已在上方验证
      let q = adminDb.from('captured_info').update({ content: text.slice(0, 200000) }).eq('id', req.body.id);
      q = scope.isDemo ? q.is('user_id', null) : q.eq('user_id', scope.scopeId);
      await q;
    }

    res.status(200).json({ ok: true, extracted, text: extracted ? text.slice(0, 8000) : '' });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    if (message === RATE_LIMIT_ERROR) { sendRateLimited(res); return; }
    const status = message === 'Authentication required' || message === 'Invalid authentication token' ? 401 : 500;
    res.status(status).json({ error: status === 401 ? 'Unauthorized' : 'Document extract failed', detail: message });
  }
}
