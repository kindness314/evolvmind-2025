/**
 * src/lib/nodeTopics.ts — 节点语义主题分类的本地缓存（2026-08-19）
 *
 * LLM 主题分类（/api/graph/topicize）结果按 scope 缓存到 localStorage，
 * 避免每次加载图谱重复调用 LLM。demo 持久缓存；真实用户也临时缓存当前会话。
 */

export type NodeTopicMap = Map<string, string>;

const CACHE_KEY_PREFIX = 'evolvmind:node-topics:';

export function nodeTopicCacheKey(scope: string): string {
  // v2：2026-08-19 语义分类粒度改为"细主题"（旧 v1 缓存是 12 宽类，会遮蔽新分类）
  return `${CACHE_KEY_PREFIX}${scope}:v2`;
}

export function loadNodeTopicCache(scope: string): NodeTopicMap {
  try {
    const raw = localStorage.getItem(nodeTopicCacheKey(scope));
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const m: NodeTopicMap = new Map();
    for (const [id, v] of Object.entries(obj)) {
      if (typeof v === 'string' && v) m.set(id, v);
    }
    return m;
  } catch {
    return new Map();
  }
}

export function saveNodeTopicCache(scope: string, map: NodeTopicMap): void {
  try {
    localStorage.setItem(nodeTopicCacheKey(scope), JSON.stringify(Object.fromEntries(map)));
  } catch {
    // 缓存写满/禁用不阻塞图谱展示
  }
}
