/**
 * api/_lib/multimodal.ts — 多模态文件正文提取（2026-09）
 *
 * 职责：从文件 Buffer 按 MIME 类型提取可读文本正文，供总结/图谱使用。
 * 仅处理能纯提取文本的类型：txt/md（UTF-8）、pdf（pdf-parse）、docx（mammoth）。
 * 图片（vision）与语音（ASR）不在此函数内，见对应端点/后续。
 *
 * Mock Input/Output:
 *   Input:  extractTextFromBuffer('application/pdf', Buffer)
 *   Output: string（提取的文本正文；空则返回 ''）
 */
import type { Buffer } from 'node:buffer';

/** 支持的文档 MIME 类型白名单 */
export function isDocumentTextMime(mime: string): boolean {
  return (
    mime === 'application/pdf' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    mime === 'text/plain' ||
    mime === 'text/markdown' ||
    mime === ''
  );
}

/** 从文件 Buffer 提取正文（pdf/docx/txt/md）；不支持的类型返回 ''，失败也返回 ''（不抛） */
export async function extractTextFromBuffer(mime: string, buffer: Buffer): Promise<string> {
  try {
    if (mime === 'application/pdf') {
      // pdf-parse 是 CommonJS，走动态 default；v2 支持 import 后 default
      const mod = await import('pdf-parse');
      const pdfParse = (mod as unknown as { default?: unknown }).default ?? mod;
      const parsed = await (pdfParse as (b: Buffer) => { text: string })(buffer);
      return parsed?.text || '';
    }
    if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      const mammoth = await import('mammoth');
      const { value } = await mammoth.extractRawText({ buffer });
      return value || '';
    }
    // txt / md / 无 MIME：按 UTF-8 读
    return buffer.toString('utf-8');
  } catch {
    return '';
  }
}

/** 按扩展名推断 MIME（后端兜底，Storage 的 mime 可能缺失） */
export function mimeFromFileName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (ext === 'md') return 'text/markdown';
  if (ext === 'txt') return 'text/plain';
  return '';
}

const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

/**
 * 图片正文提取（LLM vision）：把图片 buffer 转 base64 data-URL 喂给 vision 模型，
 * 返回识别的文字/内容描述（OCR/截图/文档图）。失败返回 ''。
 */
export async function extractImageText(buffer: Buffer, mime: string, customKey = ''): Promise<string> {
  const apiKey = customKey || process.env.MINIMAX_CHAT_API_KEY || process.env.MINIMAX_API_KEY || '';
  if (!apiKey) return '';
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.MINIMAX_VISION_MODEL || 'GLM-4.5V';
  const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  try {
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: '识别这张图片。若含文字，忠实转写图片中的文字内容；若是截图/文档/图表，提取其中的文本。只用中文或原文简明输出识别到的内容，不要解释。' },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
      }),
    });
    if (!resp.ok) return '';
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = json.choices?.[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch {
    return '';
  }
}

/** 图片 MIME 判断（供后端按 mime 路由到 vision 提取） */
export function isImageMime(mime: string): boolean {
  return mime.startsWith('image/');
}

/** 音频 MIME 判断（供后端按 mime 路由到 ASR 转写） */
export function isAudioMime(mime: string): boolean {
  return mime.startsWith('audio/');
}

/**
 * 语音 → 文本（ASR）：用 OpenAI 兼容的 /audio/transcriptions 转写音频 buffer。
 * 失败返回 ''（不抛）。
 */
export async function extractAudioText(buffer: Buffer, mime: string, fileName = '', customKey = ''): Promise<string> {
  const apiKey = customKey || process.env.MINIMAX_CHAT_API_KEY || process.env.MINIMAX_API_KEY || '';
  if (!apiKey) return '';
  const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const model = process.env.MINIMAX_ASR_MODEL || 'whisper-1';
  const ext = fileName.split('.').pop()?.toLowerCase() || (mime.split('/')[1] || 'mp3');
  try {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mime || 'audio/mpeg' }), `audio.${ext}`);
    form.append('model', model);
    const resp = await fetch(`${baseUrl.replace(/\/$/, '')}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!resp.ok) return '';
    const json = (await resp.json()) as { text?: unknown };
    return typeof json.text === 'string' ? json.text : '';
  } catch {
    return '';
  }
}
