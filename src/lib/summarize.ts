/**
 * 近期总结模块
 * 按 7 天或 30 天周期，把捕获内容和图谱变化整理成用户可理解的总结。
 */

import { supabase } from './supabase';

export type SummaryPeriod = '7d' | '30d';

export interface SummaryTheme {
  name: string;
  count: number;
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
}

export interface SummaryTrend {
  label: string;
  direction: 'up' | 'down' | 'new' | 'stable';
  detail: string;
}

export interface SummaryResponse {
  ok: boolean;
  period: SummaryPeriod;
  /** 叙事式总结（LLM 生成时提供） */
  narrative?: string;
  themes: SummaryTheme[];
  importantNodes: ImportantNode[];
  newConnections: NewConnection[];
  nextActions: string[];
  /** 变化趋势（对比上一周期） */
  trends: SummaryTrend[];
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
}): Promise<SummaryResponse> {
  const { period } = params;

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
      body: JSON.stringify({ period, demo: isDemo }),
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
