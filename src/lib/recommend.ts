/**
 * 主动推荐模块
 * 基于确定性规则生成推荐卡片，初版不依赖 LLM。
 *
 * Mock Input/Output:
 *   Input:  POST { "scope_id": "demo-uuid", "dismissedIds": [] }
 *   Output: { "ok": true, "recommendations": [{ "id":"r1","type":"related",
 *             "title":"...","reason":"共享标签","targetType":"captured","targetId":"..." }] }
 */

import { supabase } from './supabase';

export type RecommendationType = 'review' | 'semantic' | 'graph_bridge' | 'forming' | 'related' | 'knowledge_node' | 'knowledge_topic';
export type RecommendationTarget = 'captured' | 'node';

export interface Recommendation {
  id: string;
  type: RecommendationType;
  title: string;
  reason: string;
  /** 可执行建议（如"建议回顾这两条内容并建立联系"） */
  action: string;
  targetType: RecommendationTarget;
  targetId: string;
  /** 可选：关联节点 ID，用于图谱聚焦 */
  nodeId?: string;
  /** 可选：第二个目标（用于语义对/图桥推荐） */
  secondaryTargetId?: string;
  /** 证据引用：推荐依据的具体捕获/节点 */
  evidence?: Array<{ type: 'capture' | 'node'; id: string; title: string }>;
}

export interface RecommendResponse {
  ok: boolean;
  recommendations: Recommendation[];
  error?: string;
  detail?: string;
}

/**
 * 调用 /api/recommend 获取推荐
 */
export async function fetchRecommendations(params: {
  dismissedIds?: string[];
  /** 用户点击过的推荐 ID（正反馈信号，服务端 +0.5 加权） */
  clickedIds?: string[];
  /** 自定义时间范围起始 'YYYY-MM-DD'（与 until 一起限定推荐候选池） */
  since?: string;
  /** 自定义时间范围结束 'YYYY-MM-DD' */
  until?: string;
}): Promise<RecommendResponse> {
  const { dismissedIds = [], clickedIds = [], since, until } = params;

  try {
    const isDemo = localStorage.getItem('demo_auth') === 'true';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (!isDemo) {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    }

    const resp = await fetch('/api/recommend', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        demo: isDemo,
        dismissed_ids: dismissedIds,
        clicked_ids: clickedIds,
        since,
        until,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('推荐获取失败:', resp.status, errText);
      return { ok: false, recommendations: [], error: `HTTP ${resp.status}`, detail: errText };
    }

    return resp.json();
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    console.error('推荐请求异常:', message);
    return { ok: false, recommendations: [], error: 'Network error', detail: message };
  }
}
