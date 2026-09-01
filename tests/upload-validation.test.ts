import { describe, it, expect } from 'vitest';
import { MAX_FILE_SIZE, isSupportedFile, isWithinFileSizeLimit } from '../src/lib/uploadValidation';

const file = (name: string, type: string, size: number) => ({ name, type, size });

describe('上传边界（O7）', () => {
  it('photo 模式：接受 image/*，拒绝其他类型', () => {
    expect(isSupportedFile(file('a.png', 'image/png', 1), 'photo')).toBe(true);
    expect(isSupportedFile(file('a.jpg', 'image/jpeg', 1), 'photo')).toBe(true);
    expect(isSupportedFile(file('a.webp', 'image/webp', 1), 'photo')).toBe(true);
    expect(isSupportedFile(file('a.mp3', 'audio/mpeg', 1), 'photo')).toBe(false);
    expect(isSupportedFile(file('a.pdf', 'application/pdf', 1), 'photo')).toBe(false);
  });

  it('audio 模式：接受 audio/*，拒绝其他类型', () => {
    expect(isSupportedFile(file('a.mp3', 'audio/mpeg', 1), 'audio')).toBe(true);
    expect(isSupportedFile(file('a.wav', 'audio/wav', 1), 'audio')).toBe(true);
    expect(isSupportedFile(file('a.png', 'image/png', 1), 'audio')).toBe(false);
  });

  it('import 模式：扩展名白名单（pdf/doc/docx/txt/md），大小写不敏感，无扩展名拒绝', () => {
    for (const ext of ['pdf', 'doc', 'docx', 'txt', 'md']) {
      expect(isSupportedFile(file(`a.${ext}`, 'application/octet-stream', 1), 'import')).toBe(true);
      expect(isSupportedFile(file(`A.${ext.toUpperCase()}`, 'application/octet-stream', 1), 'import')).toBe(true);
    }
    expect(isSupportedFile(file('a.exe', 'application/x-msdownload', 1), 'import')).toBe(false);
    expect(isSupportedFile(file('a.zip', 'application/zip', 1), 'import')).toBe(false);
    expect(isSupportedFile(file('noext', 'application/octet-stream', 1), 'import')).toBe(false);
  });

  it('大小边界：10 MiB 严格上限，恰好 10 MiB 通过，超过拒绝', () => {
    expect(MAX_FILE_SIZE).toBe(10 * 1024 * 1024);
    expect(isWithinFileSizeLimit(10 * 1024 * 1024)).toBe(true);
    expect(isWithinFileSizeLimit(10 * 1024 * 1024 - 1)).toBe(true);
    expect(isWithinFileSizeLimit(10 * 1024 * 1024 + 1)).toBe(false);
  });

  it('text 模式：不接受文件（无文件场景由调用方保证）', () => {
    expect(isSupportedFile(file('a.png', 'image/png', 1), 'text')).toBe(false);
  });
});
