const MINIMAX_API_KEY = import.meta.env.VITE_MINIMAX_API_KEY;
const MINIMAX_BASE_URL = import.meta.env.VITE_MINIMAX_BASE_URL || 'https://api.edgefn.net/v1';
const MINIMAX_MODEL = import.meta.env.VITE_MINIMAX_MODEL;

export interface ExtractedInfo {
  title: string;
  keywords: string[];
  summary: string;
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObjects(text: string): string[] {
  const s = (text || '').trim();
  const results: string[] = [];
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{', i);
    if (start < 0) break;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = start; j < s.length; j++) {
      const ch = s[j];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') {
        depth++;
        continue;
      }
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          results.push(s.slice(start, j + 1));
          i = j + 1;
          break;
        }
      }
      if (j === s.length - 1) i = s.length;
    }
  }
  return results;
}

function normalizeContentToJson(text: string): any {
  const trimmed = (text || '').trim();
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  const direct = safeJsonParse(withoutFence);
  if (direct) return direct;

  const all = extractJsonObjects(withoutFence);
  if (all.length > 0) {
    for (let idx = all.length - 1; idx >= 0; idx--) {
      const parsed = safeJsonParse(all[idx]);
      if (parsed && (parsed.title || parsed.summary || parsed.keywords)) return parsed;
    }
  }

  return null;
}

export async function extractInformation(content: string): Promise<ExtractedInfo> {
  try {
    const useClientKey = Boolean(MINIMAX_API_KEY) && import.meta.env.DEV;

    if (useClientKey) {
      const modelName = MINIMAX_MODEL || 'abab6.5s-chat';
      const response = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MINIMAX_API_KEY}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            {
              role: 'system',
              content: '你是一个专业的信息提取助手。请分析用户提供的内容，提取出一个简短的标题、3-5个关键词以及一段精简的摘要。请务必只返回严格的 JSON：{"title":"...","keywords":["..."],"summary":"..."}。不要输出 Markdown。'
            },
            {
              role: 'user',
              content: content
            }
          ]
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`AI API error: ${response.status} ${errorText}`);
      }

      const data = await response.json();
      let contentStr = data.choices?.[0]?.message?.content || '';
      const result = normalizeContentToJson(contentStr);
      if (!result) {
        throw new Error('Invalid AI response format');
      }

      return {
        title: result.title || '无标题',
        keywords: Array.isArray(result.keywords) ? result.keywords : [],
        summary: result.summary || '无摘要'
      };
    }

    if (import.meta.env.DEV) {
      throw new Error('AI API error: 404 /api/extract (本地开发请使用线上地址或使用 vercel dev 运行以启用 /api 路由)');
    }

    const resp = await fetch('/api/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content })
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      throw new Error(`AI API error: ${resp.status} ${errorText}`);
    }

    const payload = await resp.json();
    const result = payload.data;
    
    return {
      title: result.title || '无标题',
      keywords: result.keywords || [],
      summary: result.summary || '无摘要'
    };
  } catch (error) {
    console.error('提取信息失败:', error);
    return {
      title: '提取失败',
      keywords: ['错误'],
      summary: '调用 AI 提取信息时发生错误，请检查网络或 API 配置。'
    };
  }
}
