/**
 * 共享 Embedding 工具模块
 * 复用 api/extract.ts 的模式（model fallback、URL stripping）
 * 调用 /v1/embeddings 端点生成文本向量
 */

// 手动声明 Vercel 平台类型，避免依赖 @vercel/node
export type VercelRequest = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: any;
  query: Record<string, string | string[]>;
  cookies: Record<string, string>;
};

export type VercelResponse = {
  status(code: number): VercelResponse;
  json(data: any): void;
};

export const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

function getEmbeddingModels(preferredModel?: string) {
  const configuredModel = preferredModel || process.env.MINIMAX_EMBEDDING_MODEL || '';
  if (configuredModel) return [configuredModel];

  return [
    'embo-01',
    'text-embedding-3-small',
    'text-embedding-ada-002',
  ];
}

export function stripTrailingV1(url: string) {
  return url.replace(/\/v1\/?$/, '');
}

export function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface EmbeddingResult {
  embedding: number[];
  model: string;
}

/**
 * 调用 embedding API 生成文本向量
 * 尝试多个模型候选和 URL 模式
 */
export async function generateEmbedding(params: {
  text: string;
  apiKey: string;
  baseUrl?: string;
  preferredModel?: string;
}): Promise<EmbeddingResult> {
  const baseUrl = params.baseUrl || process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
  const models = getEmbeddingModels(params.preferredModel);

  const urlsToTry = Array.from(
    new Set([
      `${baseUrl.replace(/\/$/, '')}/embeddings`,
      `${stripTrailingV1(baseUrl).replace(/\/$/, '')}/embeddings`,
    ]),
  );

  let lastError: any = null;

  for (const model of models) {
    for (const url of urlsToTry) {
      try {
        const resp = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${params.apiKey}`,
          },
          body: JSON.stringify({
            model,
            input: params.text,
          }),
        });

        if (resp.status === 404) {
          // 该 URL 不支持 embeddings 端点，尝试下一个 URL
          continue;
        }

        const data = safeJsonParse(await resp.text());

        if (!resp.ok) {
          const reason = data?.reason;
          if (resp.status === 403 && reason === 'ModelNotAllowed') {
            lastError = data;
            break; // 换模型
          }
          // 其他错误，记录后继续
          lastError = data || { status: resp.status };
          continue;
        }

        // 提取 embedding 数组
        const embedding = data?.data?.[0]?.embedding;
        if (!Array.isArray(embedding)) {
          lastError = { error: 'Invalid response format', raw: data };
          continue;
        }

        return { embedding, model };
      } catch (e: any) {
        lastError = { error: e.message };
        continue;
      }
    }
  }

  throw new Error(
    `Embedding 生成失败: ${JSON.stringify(lastError)}. 尝试的模型: ${models.join(', ')}`,
  );
}

/**
 * 从 captured_info 行构造用于 embedding 的文本
 */
export function buildEmbeddingText(row: {
  title?: string;
  summary?: string;
  content?: string;
  tags?: string[];
}): string {
  const parts = [
    row.title,
    row.summary,
    row.content,
    row.tags?.join(', '),
  ].filter(Boolean);
  const text = parts.join('\n');
  return text.length > 8000 ? text.slice(0, 8000) : text;
}

export function buildKnowledgeNodeEmbeddingText(row: {
  name?: string;
  normalized_name?: string;
  kind?: string;
  aliases?: string[];
  metadata?: Record<string, unknown> | null;
}): string {
  const metadataText = row.metadata && Object.keys(row.metadata).length > 0
    ? JSON.stringify(row.metadata)
    : '';
  const parts = [
    row.name,
    row.normalized_name && row.normalized_name !== row.name ? row.normalized_name : '',
    row.kind,
    row.aliases?.join(', '),
    metadataText,
  ].filter(Boolean);
  const text = parts.join('\n');
  return text.length > 8000 ? text.slice(0, 8000) : text;
}
