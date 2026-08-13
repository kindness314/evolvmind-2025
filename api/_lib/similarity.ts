/**
 * api/_lib/similarity.ts — 共享 Embedding 相似度工具
 *
 * 供 /api/recommend 和 /api/summarize 共用：
 * - 批量生成 capture embedding
 * - 余弦相似度计算
 * - 语义相似捕获对发现
 */

import { generateEmbedding, buildEmbeddingText, EXPECTED_EMBEDDING_DIMENSIONS } from './embedding.js';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface CapturedForEmbedding {
  id: string;
  title?: string;
  summary?: string;
  content?: string;
  tags?: string[];
}

export interface CapturedWithEmbedding extends CapturedForEmbedding {
  embedding: number[];
}

export interface SimilarPair {
  a: CapturedWithEmbedding;
  b: CapturedWithEmbedding;
  similarity: number;
}

// ---------------------------------------------------------------------------
// 余弦相似度
// ---------------------------------------------------------------------------

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

// ---------------------------------------------------------------------------
// 批量 embedding
// ---------------------------------------------------------------------------

/**
 * 为一组捕获批量生成 embedding（并行，带 8s 总超时）。
 * 超时或全部失败时返回空数组，调用方跳过语义规则。
 */
export async function batchEmbedCaptures(
  captures: CapturedForEmbedding[],
  apiKey: string,
): Promise<CapturedWithEmbedding[]> {
  if (captures.length === 0 || !apiKey) return [];

  const tasks = captures.map(async (cap) => {
    const text = buildEmbeddingText({
      title: cap.title,
      summary: cap.summary,
      content: cap.content,
      tags: cap.tags,
    });
    if (!text.trim()) return null;

    try {
      const { embedding } = await generateEmbedding({
        text,
        apiKey,
      });
      return { ...cap, embedding };
    } catch {
      return null;
    }
  });

  // 8s 总超时：embedding 可选增强，超时跳过语义规则
  const timer: Promise<null> = new Promise((resolve) => setTimeout(() => resolve(null), 8000));
  const results = await Promise.race([Promise.all(tasks), timer]);
  if (results === null) return [];
  return results.filter((r): r is CapturedWithEmbedding => r !== null);
}

// ---------------------------------------------------------------------------
// 相似对发现
// ---------------------------------------------------------------------------

/**
 * 在 embedding 化的捕获中发现语义相似对。
 * - minSimilarity: 最低余弦相似度阈值（默认 0.70）
 * - excludeSharedTags: 排除已共享标签的对（发现隐藏关联）
 * - maxPairs: 最多返回对数
 */
export function findSimilarPairs(
  embedded: CapturedWithEmbedding[],
  options: {
    minSimilarity?: number;
    excludeSharedTags?: boolean;
    maxPairs?: number;
  } = {},
): SimilarPair[] {
  const { minSimilarity = 0.70, excludeSharedTags = true, maxPairs = 10 } = options;
  const pairs: SimilarPair[] = [];

  for (let i = 0; i < embedded.length && pairs.length < maxPairs; i++) {
    for (let j = i + 1; j < embedded.length && pairs.length < maxPairs; j++) {
      const a = embedded[i];
      const b = embedded[j];

      // 排除共享标签（我们希望发现隐藏的语义关联）
      if (excludeSharedTags) {
        const aTags = new Set((a.tags || []).map((t) => t.toLowerCase()));
        const bTags = (b.tags || []).map((t) => t.toLowerCase());
        const hasSharedTag = bTags.some((t) => aTags.has(t));
        if (hasSharedTag) continue;
      }

      const sim = cosineSimilarity(a.embedding, b.embedding);
      if (sim >= minSimilarity) {
        pairs.push({ a, b, similarity: sim });
      }
    }
  }

  // 按相似度降序
  pairs.sort((x, y) => y.similarity - x.similarity);
  return pairs.slice(0, maxPairs);
}

/**
 * 在已有节点 embedding（来自 DB）和捕获 embedding 之间找相似。
 * 用于发现哪些捕获内容与已有知识节点语义相近。
 */
export function findCaptureNodeSimilarity(
  captureEmbedding: number[],
  nodeEmbeddings: Array<{
    nodeId: string;
    nodeName: string;
    nodeKind: string;
    embedding: number[];
  }>,
  minSimilarity = 0.65,
  maxResults = 5,
): Array<{ nodeId: string; nodeName: string; nodeKind: string; similarity: number }> {
  return nodeEmbeddings
    .map((n) => ({
      nodeId: n.nodeId,
      nodeName: n.nodeName,
      nodeKind: n.nodeKind,
      similarity: cosineSimilarity(captureEmbedding, n.embedding),
    }))
    .filter((r) => r.similarity >= minSimilarity)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, maxResults);
}
