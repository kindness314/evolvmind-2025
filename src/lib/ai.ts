import { getApiAuthHeaders } from './apiAuth';

export interface ExtractedInfo {
  title: string;
  keywords: string[];
  summary: string;
  /** O1: 分析是否成功; false 表示 AI 提取失败, 原文仍可保存 */
  ok: boolean;
  error?: string;
}

function safeJsonParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * 修复 LLM 输出 JSON 中字符串值里未转义的 ASCII 引号
 * （例如 MiniMax 常输出 "由"处理中"切换" 这类内嵌引号，会导致 JSON.parse 失败）。
 * 仅在结构上下文之外的裸引号才转义，合法 JSON 不受影响。
 */
function repairUnescapedQuotes(text: string): string {
  const s = (text || '').trim();
  if (!s) return s;
  let out = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && /\s/.test(s[j])) j++;
        const next = j >= s.length ? undefined : s[j];
        if (next === ',' || next === '}' || next === ']' || next === ':' || next === undefined) {
          out += ch;
          inString = false;
        } else {
          out += '\\"';
        }
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') {
      let k = i - 1;
      while (k >= 0 && /\s/.test(s[k])) k--;
      const prev = k < 0 ? undefined : s[k];
      if (prev === ':' || prev === ',' || prev === '[' || prev === '{' || prev === undefined) {
        out += ch;
        inString = true;
      } else {
        out += '\\"';
      }
      continue;
    }
    out += ch;
  }
  return out;
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


  const repaired = safeJsonParse(repairUnescapedQuotes(withoutFence));
  if (repaired) return repaired;

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
      headers: await getApiAuthHeaders(),
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
      summary: result.summary || '无摘要',
      ok: true
    };
  } catch (error) {
    console.error('提取信息失败:', error);
    return {
      title: '提取失败',
      keywords: ['错误'],
      summary: '调用 AI 提取信息时发生错误，请检查网络或 API 配置。',
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}
