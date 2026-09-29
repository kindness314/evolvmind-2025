import { useEffect, useRef, useState } from 'react';

/**
 * 三段式日期输入: 年/月/日三个格子, 纯数字键入, 自动跳格(替代原生 type=date)。
 * - 年: 4 位; 月/日: 1-2 位, 输入自动补零
 * - 月首位 2-9 直接定格跳日; 1 等第二位; 日首位 4-9 同理
 * - 非法(月>12、日超当月天数、2月30日等)红框并回退
 * - Enter/离开整组提交; Esc 回退; Backspace 空格时跳回上一格
 */

const pad2 = (n: string) => n.padStart(2, '0');

/** 三段是否构成真实日期且在 min/max 内; 通过则返回规范化 YYYY-MM-DD */
export function commitDateParts(y: string, m: string, d: string, min?: string, max?: string): string | null {
  if (!/^\d{4}$/.test(y) || !/^\d{1,2}$/.test(m) || !/^\d{1,2}$/.test(d)) return null;
  const yy = +y; const mm = +m; const dd = +d;
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const dt = new Date(yy, mm - 1, dd);
  if (dt.getFullYear() !== yy || dt.getMonth() !== mm - 1 || dt.getDate() !== dd) return null;
  const out = `${y}-${pad2(m)}-${pad2(d)}`;
  if ((min && out < min) || (max && out > max)) return null;
  return out;
}

const segCls = 'text-center bg-transparent outline-none text-[0.9em]';

export function DateSegmentInput({ value, onCommit, min, max, ariaLabel, className = '' }: {
  /** 当前值 YYYY-MM-DD */
  value: string;
  /** 校验通过后提交规范化日期 */
  onCommit: (v: string) => void;
  min?: string;
  max?: string;
  ariaLabel: string;
  className?: string;
}) {
  const [vy, vm, vd] = value.split('-');
  const [y, setY] = useState(vy);
  const [m, setM] = useState(vm);
  const [d, setD] = useState(vd);
  const [invalid, setInvalid] = useState(false);
  const groupRef = useRef<HTMLSpanElement>(null);
  const yRef = useRef<HTMLInputElement>(null);
  const mRef = useRef<HTMLInputElement>(null);
  const dRef = useRef<HTMLInputElement>(null);

  // 外部值变化且焦点不在本组时同步
  useEffect(() => {
    if (groupRef.current?.contains(document.activeElement)) return;
    const [ny, nm, nd] = value.split('-');
    setY(ny); setM(nm); setD(nd); setInvalid(false);
  }, [value]);

  const revert = () => { setY(vy); setM(vm); setD(vd); };

  // 提交: 成功->onCommit; 不完整->静默等; 完整但非法->红框回退
  const tryCommit = (yy: string, mm: string, dd: string, opts?: { revertOnFail?: boolean }) => {
    const done = commitDateParts(yy, mm, dd, min, max);
    if (done) { setInvalid(false); const [py, pm, pd] = done.split('-'); setY(py); setM(pm); setD(pd); if (done !== value) onCommit(done); return true; }
    if (yy.length === 4 && mm && dd) {
      if (opts?.revertOnFail !== false) { setInvalid(true); revert(); }
      return false;
    }
    return false;
  };

  const digits = (s: string, n: number) => s.replace(/\D/g, '').slice(0, n);

  const onYearChange = (raw: string) => {
    const v = digits(raw, 4);
    setY(v);
    if (v.length === 4) { tryCommit(v, m, d); mRef.current?.focus(); }
  };

  const onMonthChange = (raw: string) => {
    let v = digits(raw, 2);
    // 月首位 2-9 -> 定格; 两位时校验 1-12
    if (v.length === 2 && (+v < 1 || +v > 12)) v = v.slice(1); // 如 19 -> 9
    if (v.length === 1 && +v >= 2) {
      setM(v); tryCommit(y, v, d); dRef.current?.focus(); return;
    }
    setM(v);
    if (v.length === 2) { tryCommit(y, v, d); dRef.current?.focus(); }
  };

  const onDayChange = (raw: string) => {
    let v = digits(raw, 2);
    if (v.length === 2 && +v < 1) v = v.slice(1);
    if (v.length === 1 && +v >= 4) { setD(v); tryCommit(y, m, v); return; }
    setD(v);
    if (v.length === 2) tryCommit(y, m, v);
  };

  const onGroupBlur = (e: React.FocusEvent) => {
    if (groupRef.current?.contains(e.relatedTarget as Node)) return; // 组内移动
    const done = tryCommit(y, m, d);
    if (!done && !(y || m || d)) return;
    if (!done) revert(); // 不完整 -> 回退
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, prev?: React.RefObject<HTMLInputElement | null>) => {
    if (e.key === 'Enter') { tryCommit(y, m, d); (e.target as HTMLInputElement).blur(); }
    else if (e.key === 'Escape') { revert(); setInvalid(false); (e.target as HTMLInputElement).blur(); }
    else if (e.key === 'Backspace' && prev && (e.target as HTMLInputElement).value === '') prev.current?.focus();
  };

  return (
    <span
      ref={groupRef}
      onBlur={onGroupBlur}
      title={invalid ? '日期无效(如 2 月 30 日)' : undefined}
      className={`inline-flex items-center gap-0.5 border rounded-md bg-white ${invalid ? 'border-red-400 text-red-600' : 'border-gray-200 text-gray-600'} ${className}`}
    >
      <input ref={yRef} type="text" inputMode="numeric" aria-label={`${ariaLabel}-年`} placeholder="2026"
        value={y} onFocus={(e) => e.target.select()} onChange={(e) => onYearChange(e.target.value)} onKeyDown={(e) => onKeyDown(e)}
        className={`${segCls} w-8`} />
      <span className="text-gray-400">-</span>
      <input ref={mRef} type="text" inputMode="numeric" aria-label={`${ariaLabel}-月`} placeholder="09"
        value={m} onFocus={(e) => e.target.select()} onChange={(e) => onMonthChange(e.target.value)} onKeyDown={(e) => onKeyDown(e, yRef)}
        className={`${segCls} w-4`} />
      <span className="text-gray-400">-</span>
      <input ref={dRef} type="text" inputMode="numeric" aria-label={`${ariaLabel}-日`} placeholder="01"
        value={d} onFocus={(e) => e.target.select()} onChange={(e) => onDayChange(e.target.value)} onKeyDown={(e) => onKeyDown(e, mRef)}
        className={`${segCls} w-4`} />
    </span>
  );
}
