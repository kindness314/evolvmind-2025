/**
 * 上传校验（O7 可测试纯函数）。
 * 与 AGENTS.md 文件上传规范一致：支持 image/*、audio/*、.pdf/.doc/.docx/.txt/.md，
 * 单文件上限严格 10 MiB；前端选取时与上传前均需校验。
 */

export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export const ALLOWED_DOCUMENT_EXTENSIONS = new Set(['pdf', 'doc', 'docx', 'txt', 'md']);

export type CaptureMode = 'text' | 'photo' | 'audio' | 'import' | null;

/** 类型/扩展名校验（不含大小）：photo=image/*、audio=audio/*、import=文档扩展名白名单 */
export function isSupportedFile(file: { type: string; name: string }, mode: CaptureMode): boolean {
  if (mode === 'photo') return file.type.startsWith('image/');
  if (mode === 'audio') return file.type.startsWith('audio/');
  if (mode === 'import') {
    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    return ALLOWED_DOCUMENT_EXTENSIONS.has(extension);
  }
  return false;
}

/** 大小校验：严格 ≤10 MiB */
export function isWithinFileSizeLimit(size: number): boolean {
  return size <= MAX_FILE_SIZE;
}
