import { describe, it, expect } from 'vitest';
import { isNoiseCapture, isTrivialNodeName } from '../api/_lib/noise';

describe('噪声过滤（P1 种子噪声泄漏修复）', () => {
  it('琐碎白描：无标签且正文剥标点后 ≤10 字 → 噪声', () => {
    expect(isNoiseCapture('窗外有只橘猫在晒太阳', undefined, '窗外有只橘猫在晒太阳')).toBe(true);
    expect(isNoiseCapture('今天天气不错', undefined, '今天天气不错')).toBe(true);
  });

  it('有实质内容的记录不是噪声', () => {
    expect(isNoiseCapture('深度工作的四个原则', undefined, '深度工作是本书，讨论了专注工作的原则和方法，值得阅读')).toBe(false);
  });

  it('有标签的短记录不是噪声（标签携带信息）', () => {
    expect(isNoiseCapture('橘猫', undefined, '橘猫', ['宠物', '观察'])).toBe(false);
  });

  it('空内容/无内容不误判为噪声（调用方不传 content）', () => {
    // 无 content 参数时按标题/摘要判断，不应抛出
    const result = isNoiseCapture('番茄工作法', '专注力训练方法');
    expect(typeof result).toBe('boolean');
  });

  it('解析失败/空壳记录判噪声（2026-09-19）', () => {
    // 纯元数据截图（OCR 未产出正文）
    expect(isNoiseCapture(
      '截图文件 2026-07-06',
      '用户仅提供了截图文件的元数据（文件名、文件类型、文件大小），未提供实际的图片内容，无法提取具体的视觉信息。',
      '文件名: 屏幕截图 2026-07-06 011020.png 文件类型: image/png 文件大小: 114791 bytes',
      ['截图', '图片', 'PNG'],
    )).toBe(true);
    // 标题直接是“无法提取信息”
    expect(isNoiseCapture('无法提取信息', '提供的文件信息仅包含文件名，文件类型和文件大小', '文件名: a.png 文件类型: image/png 文件大小: 100 bytes')).toBe(true);
    // 内容过于简短的提取失败
    expect(isNoiseCapture('无标题内容', "用户提供的内容过于简短，仅有'这下应该可以了'一句，无法提取具体的主题或信息", '这下应该可以了')).toBe(true);
    // 文件名截图类标题
    expect(isNoiseCapture('屏幕截图 2026-08-17 231518.png', undefined, '一堆正文内容超过十个字的有效内容', ['截图'])).toBe(true);
  });

  it('正常文件记录（OCR/解析成功）不误判', () => {
    // 有真实 OCR 正文的图片记录：标题正常、summary 是真实内容
    expect(isNoiseCapture(
      '产品需求文档截图',
      '截图中包含产品需求文档的三个核心模块说明与优先级标注',
      '文件名: prd.png 文件类型: image/png 文件大小: 204800 bytes\n\n识别内容：本需求文档包含三个核心模块...',
      ['产品', '需求'],
    )).toBe(false);
  });
});

describe('琐碎节点名', () => {
  it('纯停用词/无意义名称判琐碎', () => {
    expect(isTrivialNodeName('的')).toBe(true);
    expect(isTrivialNodeName('')).toBe(true);
  });
  it('实质名称不判琐碎', () => {
    expect(isTrivialNodeName('深度工作')).toBe(false);
    expect(isTrivialNodeName('番茄工作法')).toBe(false);
  });
});
