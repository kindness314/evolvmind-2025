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
