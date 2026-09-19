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
export const EXPECTED_EMBEDDING_DIMENSIONS = 1024;

function getEmbeddingModels(preferredModel?: string) {
  const configuredModel = preferredModel || process.env.MINIMAX_EMBEDDING_MODEL || 'BAAI/bge-m3';
  return Array.from(new Set([configuredModel].filter(Boolean)));
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

  let lastError: unknown = null;

  // 429 退避重试: 上游 qpm(每分钟配额) 限流时等待后重试, 避免批量重试/回填时一次限流即判失败
  const sleep = (ms: number) => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, ms);
    return promise;
  };
  const MAX_ATTEMPTS = 4; // 原始 1 次 + 退避重试 3 次 (2s/4s/8s)

  // Key 回退（2026-09 修复）：chat key（resolveApiKey 首选 MINIMAX_CHAT_API_KEY）可能没有
  // /embeddings 权限（403 ModelNotAllowed），而 MINIMAX_API_KEY 实测有 bge-m3 权限。
  // 调用方 key 优先；失败时回退到环境 MINIMAX_API_KEY（去重）。
  const fallbackKey = (process.env.MINIMAX_API_KEY || '').trim();
  const keysToTry = Array.from(new Set([params.apiKey, fallbackKey].filter(Boolean)));

  for (const apiKey of keysToTry) {
  for (const model of models) {
    for (const url of urlsToTry) {
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        try {
          // 30s 超时: embedding 上游实测 2s, 30s 足够且防挂起占满 maxDuration
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 30_000);
          let resp: Response;
          try {
            resp = await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                model,
                input: params.text,
              }),
              signal: controller.signal,
            });
          } finally {
            clearTimeout(timer);
          }

          if (resp.status === 429) {
            // 限流: 记录错误并退避重试, 尝试耗尽才换 URL/模型
            const data = safeJsonParse(await resp.text());
            lastError = data || { status: 429 };
            if (attempt < MAX_ATTEMPTS) {
              await sleep(2000 * 2 ** (attempt - 1)); // 2s / 4s / 8s
              continue;
            }
            break;
          }

          if (resp.status === 404) {
            // 该 URL 不支持 embeddings 端点，尝试下一个 URL
            break;
          }

          const data = safeJsonParse(await resp.text());

          if (!resp.ok) {
            const reason = data?.reason;
            if (resp.status === 403 && reason === 'ModelNotAllowed') {
              lastError = {
                error: 'EmbeddingModelNotAllowed',
                message: '当前 MINIMAX_API_KEY 没有该 embedding 模型权限，请配置可用的 1024 维 embedding 模型/Key 后重试。',
                model,
                providerError: data,
                expectedDimensions: EXPECTED_EMBEDDING_DIMENSIONS,
              };
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

          if (embedding.length !== EXPECTED_EMBEDDING_DIMENSIONS) {
            lastError = {
              error: 'EmbeddingDimensionMismatch',
              message: `embedding 维度不匹配：当前数据库需要 ${EXPECTED_EMBEDDING_DIMENSIONS} 维向量。`,
              model,
              expected: EXPECTED_EMBEDDING_DIMENSIONS,
              actual: embedding.length,
            };
            break; // 换 URL/模型, 不重试同一端点(结果必然相同)
          }

          return { embedding, model };
        } catch (e: unknown) {
          lastError = { error: e instanceof Error ? e.message : String(e) };
          if (attempt < MAX_ATTEMPTS) {
            await sleep(2000 * 2 ** (attempt - 1));
            continue;
          }
          break;
        }
      }
    }
  }
  }

  const lastErrorText = JSON.stringify(lastError);
  let errorPrefix: string = 'EmbeddingGenerationFailed';
  if (lastError && typeof lastError === 'object' && 'error' in lastError) {
    if (lastError.error === 'EmbeddingModelNotAllowed') {
      errorPrefix = 'EmbeddingModelNotAllowed';
    } else if (lastError.error === 'EmbeddingDimensionMismatch') {
      errorPrefix = 'EmbeddingDimensionMismatch';
    }
  }

  throw new Error(
    `${errorPrefix}: Embedding 生成失败。当前数据库需要 ${EXPECTED_EMBEDDING_DIMENSIONS} 维向量；请配置有 /embeddings 权限且输出 ${EXPECTED_EMBEDDING_DIMENSIONS} 维的模型/Key。尝试的模型: ${models.join(', ')}. 最后错误: ${lastErrorText}`,
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
