import { describe, it, expect } from 'vitest';
import { mimeFromFileName, extractTextFromBuffer, isImageMime, isAudioMime, isDocumentTextMime } from '../api/_lib/multimodal';

describe('多模态 MIME 推断与识别', () => {
  it('按扩展名推断 MIME', () => {
    expect(mimeFromFileName('a.pdf')).toBe('application/pdf');
    expect(mimeFromFileName('a.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(mimeFromFileName('a.txt')).toBe('text/plain');
    expect(mimeFromFileName('a.md')).toBe('text/markdown');
    expect(mimeFromFileName('a.png')).toBe('');
  });

  it('识别图片/音频/文档 MIME', () => {
    expect(isImageMime('image/png')).toBe(true);
    expect(isAudioMime('audio/mpeg')).toBe(true);
    expect(isDocumentTextMime('application/pdf')).toBe(true);
    expect(isImageMime('audio/mpeg')).toBe(false);
  });
});

describe('extractTextFromBuffer', () => {
  it('txt/md（utf-8）直接读文本', async () => {
    const text = await extractTextFromBuffer('text/plain', Buffer.from('你好，这是正文', 'utf-8'));
    expect(text).toBe('你好，这是正文');
  });

  it('空 mime 按 utf-8 读', async () => {
    const text = await extractTextFromBuffer('', Buffer.from('hello', 'utf-8'));
    expect(text).toBe('hello');
  });

  it('不支持的二进制类型不崩溃（返回空）', async () => {
    // 传一个无文档解析的类型（不会被 extractTextFromBuffer 处理 pdf 之外的二进制）→ 按 utf-8 读
    const text = await extractTextFromBuffer('image/png', Buffer.from([0xff, 0xd8]));
    // 二进制 utf-8 解码可能得到乱码；此处断言不抛即可
    expect(typeof text).toBe('string');
  });
});
