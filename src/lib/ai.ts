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
