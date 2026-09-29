/**
 * 近期总结模块
 * 按 7 天或 30 天周期，把捕获内容和图谱变化整理成用户可理解的总结。
 */

import { supabase } from './supabase';

export type SummaryPeriod = '7d' | '30d' | 'custom';

export interface SummaryTheme {
  name: string;
  count: number;
  /** LLM 对该主题的深度分析 */
  insight?: string;
  /** 主题趋势方向（本期 vs 上期） */
  direction?: 'up' | 'down' | 'new' | 'stable';
  detail?: string;
}

export interface ImportantNode {
  name: string;
  kind: string;
  reason: string;
}

export interface NewConnection {
  from: string;
  to: string;
  relationType: string;
  /** 该关联对用户的意义 */
  significance?: string;
}

export interface SummaryTrend {
  label: string;
  direction: 'up' | 'down' | 'new' | 'stable';
  detail: string;
}

export interface SummaryResponse {
  ok: boolean;
  period: SummaryPeriod;
  /** 变化趋势（对比上一周期） */
  trends: SummaryTrend[];
  /** 主题方向明细（确定性信号，含升温/新生/降温） */
  themeTrends?: Array<{
    name: string;
    recent: number;
    older: number;
    direction: 'up' | 'down' | 'new' | 'stable';
    detail: string;
  }>;
  narrative?: string;
  themes: SummaryTheme[];
  /** 本期新增主题（确定性，direction='new'） */
  newThemes?: Array<{ name: string; recent: number }>;
  /** 本期新增知识节点（窗口内 created_at） */
  newNodes?: Array<{ name: string; kind: string }>;
  importantNodes: ImportantNode[];
  newConnections: NewConnection[];
  nextActions: string[];
  /** 代表性原文摘录 */
  highlights: string[];
  /** 摘要总数统计 */
  stats: {
    capturedCount: number;
    newNodeCount: number;
    newLinkCount: number;
  };
  /** LLM 解析失败时保留原始统计 */
  raw?: {
    themes: SummaryTheme[];
    importantNodes: ImportantNode[];
    newConnections: NewConnection[];
    nextActions: string[];
  };
  error?: string;
  detail?: string;
}

/**
 * 调用 /api/summarize 生成近期总结
 */
export async function fetchSummary(params: {
  period: SummaryPeriod;
  /** period === 'custom' 时的起始日期 'YYYY-MM-DD'（必填） */
  since?: string;
  /** period === 'custom' 时的结束日期 'YYYY-MM-DD'（缺省为今天） */
  until?: string;
}): Promise<SummaryResponse> {
  const { period, since, until } = params;

  try {
    const isDemo = localStorage.getItem('demo_auth') === 'true';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isDemo) {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    }

    const resp = await fetch('/api/summarize', {
      method: 'POST',
      headers,
      body: JSON.stringify({ period, since, until, demo: isDemo }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('总结生成失败:', resp.status, errText);
      return {
        ok: false,
        period,
        themes: [],
        importantNodes: [],
        newConnections: [],
        nextActions: [],
        trends: [],
        highlights: [],
        stats: { capturedCount: 0, newNodeCount: 0, newLinkCount: 0 },
        error: `HTTP ${resp.status}`,
        detail: errText,
      };
    }

    return resp.json();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('总结请求异常:', message);
    return {
      ok: false,
      period,
      themes: [],
      importantNodes: [],
      newConnections: [],
      nextActions: [],
      trends: [],
      highlights: [],
      stats: { capturedCount: 0, newNodeCount: 0, newLinkCount: 0 },
      error: 'Network error',
      detail: message,
    };
  }
}
