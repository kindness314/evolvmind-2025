/**
 * POST /api/judge — 总结质量裁判端点（评估工具，非产品功能）
 *
 * 输入一份总结（narrative/themes/actions）、系统计算的统计数据与生成它所用的原始捕获，
 * 由 LLM 按评分卡逐维打分并做幻觉检查：
 *   - faithfulness 忠实度: 总结断言能否在【系统计算的数据】或捕获原文中找到依据
 *   - insight 洞察深度: 是否找到跨记录模式/因果链/趋势，而非罗列
 *   - actionability 行动可执行: 建议是否具体可测量
 *   - structure 结构与可读性: 分层清晰、主次分明
 *   - hallucinations: 总结中两边都找不到依据的具体断言清单（空 = 无幻觉）
 *
 * Mock Input/Output:
 *   Input:  POST { "demo": true, "narrative": "…", "themes": [...], "nextActions": [...],
 *                  "stats": {...}, "trends": [...], "themeTrends": [...],
 *                  "captures": [{ "title": "…", "summary": "…", "content": "…" }] }
 *   Output: { "ok": true, "scores": { "faithfulness": 8, "insight": 9, "actionability": 8, "structure": 7 },
 *             "hallucinations": ["…"], "overall": "…", "raw": "…" }
 */
import type { VercelRequest, VercelResponse } from './_lib/embedding.js';

const DEFAULT_BASE_URL = 'https://api.edgefn.net/v1';

function safeJsonParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return null; }
}

function extractJsonObjects(text: string): string[] {
  const results: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (text[i] === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        results.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return results;
}

function normalizeContentToJson(text: string): Record<string, unknown> | null {
  const objects = extractJsonObjects(text);
  for (const obj of objects.reverse()) {
    const parsed = safeJsonParse(obj) as Record<string, unknown> | null;
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

interface JudgeContext {
  narrative: string;
  themes: unknown;
  actions: unknown;
  captures: unknown[];
  stats: unknown;
  trends: unknown;
  themeTrends: unknown;
}

function buildJudgePrompt(ctx: JudgeContext): string {
  const captureText = ctx.captures
    .slice(0, 30)
    .map((c, i) => {
      const cap = c as Record<string, unknown>;
      const excerpt = String(cap.content || cap.summary || '').slice(0, 100);
      return `${i + 1}. 【${cap.title || '未命名'}】${excerpt}${excerpt.length >= 100 ? '…' : ''}`;
    })
    .join('\n');
  const themesText = Array.isArray(ctx.themes)
    ? (ctx.themes as Array<{ name?: unknown; insight?: unknown }>).map((t) => `- ${t.name ?? ''}${t.insight ? `: ${t.insight}` : ''}`).join('\n')
    : '';
  const actionsText = Array.isArray(ctx.actions) ? (ctx.actions as string[]).join('\n- ') : '';
  const statsText = ctx.stats ? JSON.stringify(ctx.stats) : '（无）';
  const trendsText = Array.isArray(ctx.trends)
    ? (ctx.trends as Array<{ label?: unknown; detail?: unknown }>).map((t) => `- ${t.label ?? ''}: ${t.detail ?? ''}`).join('\n')
    : '';
  const themeTrendsText = Array.isArray(ctx.themeTrends)
    ? (ctx.themeTrends as Array<{ name?: unknown; direction?: unknown; recent?: unknown; older?: unknown }>)
      .map((t) => `- ${t.name ?? ''}(${t.direction ?? '?'}, 近窗${t.recent ?? '?'}次/远窗${t.older ?? '?'}次)`)
      .join('\n')
    : '';

  return `你是一位严格的总结质量评审员。以下是"用户最近的原始捕获记录"、"系统计算的数据"和"系统生成的总结"，请按评分卡客观打分。

## 原始捕获记录（事实依据，仅以此为准）
${captureText}

## 系统计算的数据（可信依据，由确定性代码从完整数据算出，无需逐条核对捕获）
统计数据: ${statsText}
变化趋势:
${trendsText}
主题方向:
${themeTrendsText}

## 待评审的总结
### 叙事
${ctx.narrative}

### 主题
${themesText}

### 建议行动
${actionsText}

## 评分卡（每维 0-10 整数）
{
  "scores": {
    "faithfulness": 0,
    "insight": 0,
    "actionability": 0,
    "structure": 0
  },
  "hallucinations": ["列出总结中出现的、在【系统计算的数据】与【原始捕获记录】里都找不到依据的具体断言（原样引用总结原文）。没有则返回空数组"],
  "overall": "一句话总评"
}

要求：
- faithfulness: 逐条核对总结的事实断言（数字、因果、次数、趋势）。能与【系统计算的数据】或捕获原文对上的不算幻觉；对不上的（编造数字、错误时间跨度、无据因果）记为幻觉并扣分
- insight: 是否发现跨记录的因果链/趋势/模式并给出解释，而非"A 和 B 有关"式罗列
- actionability: 建议是否具体（有测量指标/时间/对照），空话不得分
- structure: 叙事-主题-行动是否有清晰层级
- 只返回 JSON，不要 Markdown。`;
}

interface JudgeResult {
  ok: boolean;
  status: number;
  text: string;
  json: unknown;
}

async function callJudge(
  url: string,
  apiKey: string,
  model: string,
  content: string,
): Promise<JudgeResult> {
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: '你是严格的总结质量评审员。只返回 JSON，不要 Markdown。' },
        { role: 'user', content },
      ],
    }),
  });
  const text = await resp.text();
  const json = safeJsonParse(text);
  return { ok: resp.ok, status: resp.status, text, json };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    res.status(200).json({ ok: true, route: '/api/judge' });
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method Not Allowed' });
    return;
  }

  const narrative = typeof req.body?.narrative === 'string' ? req.body.narrative : '';
  const captures = Array.isArray(req.body?.captures) ? req.body.captures as unknown[] : [];
  if (!narrative || captures.length === 0) {
    res.status(400).json({ error: 'Missing narrative or captures' });
    return;
  }

  const apiKey = process.env.MINIMAX_CHAT_API_KEY || process.env.MINIMAX_API_KEY || '';
  if (!apiKey) {
    res.status(503).json({ error: 'Judge unavailable: no LLM key' });
    return;
  }

  try {
    const baseUrl = process.env.MINIMAX_BASE_URL || DEFAULT_BASE_URL;
    const preferredModel = process.env.MINIMAX_MODEL || 'abab6.5s-chat';
    const candidates = [preferredModel, 'MiniMax-M2.5', 'MiniMax-M2.1', 'abab6.5s-chat'].filter(Boolean);
    const base = baseUrl.replace(/\/$/, '');
    const urlsToTry = [
      `${base}/chat/completions`,
      `${base.replace(/\/v1\/?$/, '')}/chat/completions`,
    ];
    const content = buildJudgePrompt({
      narrative,
      themes: req.body?.themes,
      actions: req.body?.nextActions,
      captures,
      stats: req.body?.stats,
      trends: req.body?.trends,
      themeTrends: req.body?.themeTrends,
    });

    for (const model of candidates) {
      let r: JudgeResult | null = null;
      for (const url of urlsToTry) {
        r = await callJudge(url, apiKey, model, content);
        if (!r.ok && r.status === 404) continue;
        break;
      }
      if (!r || !r.ok) continue;
      const choicesRaw = r.json && typeof r.json === 'object' && 'choices' in r.json
        ? (r.json as Record<string, unknown>).choices
        : [];
      const choices = Array.isArray(choicesRaw) ? choicesRaw as Record<string, unknown>[] : [];
      const messageContent = choices[0]?.['message'] as Record<string, unknown> | undefined;
      const text = typeof messageContent?.content === 'string' ? messageContent.content : '';
      const parsed = normalizeContentToJson(text);
      if (parsed && typeof parsed.scores === 'object' && parsed.scores) {
        const s = parsed.scores as Record<string, unknown>;
        const clamp = (v: unknown) => Math.max(0, Math.min(10, typeof v === 'number' ? Math.round(v) : 0));
        res.status(200).json({
          ok: true,
          scores: {
            faithfulness: clamp(s.faithfulness),
            insight: clamp(s.insight),
            actionability: clamp(s.actionability),
            structure: clamp(s.structure),
          },
          hallucinations: Array.isArray(parsed.hallucinations)
            ? (parsed.hallucinations as unknown[]).filter((h): h is string => typeof h === 'string').slice(0, 10)
            : [],
          overall: typeof parsed.overall === 'string' ? parsed.overall : '',
          raw: text.slice(0, 2000),
        });
        return;
      }
    }
    res.status(502).json({ error: 'Judge failed: LLM 未返回可用评分' });
  } catch (e: unknown) {
    res.status(500).json({ error: 'Judge failed', detail: e instanceof Error ? e.message : 'Unknown' });
  }
}
