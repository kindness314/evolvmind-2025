/**
 * src/lib/backHandler.ts — 全局返回拦截栈(2026-10-15)
 *
 * 配合 App.tsx 的 popstate 路由:页面级返回走 history 栈(App 内),
 * 页面内部的"弹层/多选/搜索/下钻"通过 useBackHandler 注册到本栈;
 * 侧滑/返回键先由栈顶活跃处理器消费(关弹层/退一层下钻),
 * 全部消费完才落到页面级返回。
 *
 * Mock Input:
 *   useBackHandler(() => showEdit, () => { setShowEdit(false); return true; })
 *   → showEdit 时侧滑=关编辑层,否则不拦截
 */
import { useEffect, useRef } from 'react';

type BackHandler = {
  /** 是否有可拦截的内部状态(弹层开着/处于下钻) */
  isActive: () => boolean;
  /** 消费一次返回(关最上层内部状态);返回 false 表示实际没处理,放行 */
  handle: () => boolean;
};

const stack: BackHandler[] = [];

/** 组件内注册返回拦截;卸载自动注销。同组件重复渲染以最新为准 */
export function useBackHandler(isActive: () => boolean, handle: () => boolean) {
  const ref = useRef<BackHandler>({ isActive, handle });
  ref.current = { isActive, handle };
  useEffect(() => {
    const entry: BackHandler = {
      isActive: () => ref.current.isActive(),
      handle: () => ref.current.handle(),
    };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, []);
}

/** popstate 时调用:栈顶向下找第一个活跃处理器执行;无则返回 false 走页面级返回 */
export function consumeBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (stack[i].isActive()) return stack[i].handle();
  }
  return false;
}
