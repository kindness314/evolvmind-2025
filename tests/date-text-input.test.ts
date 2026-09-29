import { describe, it, expect } from 'vitest';
import { commitDateParts } from '../src/app/components/ui/date-text-input';

describe('三段式日期提交校验(自选时间)', () => {
  it('合法日期规范化补零', () => {
    expect(commitDateParts('2026', '9', '1')).toBe('2026-09-01');
    expect(commitDateParts('2026', '09', '01')).toBe('2026-09-01');
    expect(commitDateParts('2026', '12', '31')).toBe('2026-12-31');
  });

  it('不完整或格式错误拒绝', () => {
    expect(commitDateParts('202', '9', '1')).toBeNull();   // 年不足4位
    expect(commitDateParts('2026', '', '1')).toBeNull();
    expect(commitDateParts('2026', '9', '')).toBeNull();
    expect(commitDateParts('2026', 'ab', '1')).toBeNull();
  });

  it('越界与伪日期拒绝', () => {
    expect(commitDateParts('2026', '13', '1')).toBeNull();
    expect(commitDateParts('2026', '0', '1')).toBeNull();
    expect(commitDateParts('2026', '9', '32')).toBeNull();
    expect(commitDateParts('2026', '2', '30')).toBeNull();  // 2 月 30 日不存在
    expect(commitDateParts('2025', '2', '29')).toBeNull();  // 平年 2 月 29
    expect(commitDateParts('2024', '2', '29')).toBe('2024-02-29'); // 闰年合法
  });

  it('min/max 边界', () => {
    expect(commitDateParts('2026', '9', '1', '2026-09-01', '2026-09-28')).toBe('2026-09-01');
    expect(commitDateParts('2026', '8', '31', '2026-09-01')).toBeNull();
    expect(commitDateParts('2026', '9', '29', undefined, '2026-09-28')).toBeNull();
  });
});
