import { generateEmbeddingForKnowledgeNode } from './graphSearch';
import { supabase } from './supabase';

export type GraphNodeKind =
  | 'person'
  | 'event'
  | 'object'
  | 'concept'
  | 'view'
  | 'conclusion'
  | 'todo'
  | 'question'
  | 'time'
  | 'location';

export type GraphLinkType =
  | 'causes'
  | 'part_of'
  | 'supports'
  | 'happens_at'
  | 'located_in'
  | 'related_to';

export type ExtractedGraphNode = {
  id: string;
  name: string;
  kind: GraphNodeKind;
  aliases: string[];
  confidence?: number;
};

export type ExtractedGraphLink = {
  source: string;
  target: string;
  type: GraphLinkType;
  evidence?: string;
  confidence?: number;
};

export type ExtractedGraph = {
  nodes: ExtractedGraphNode[];
  links: ExtractedGraphLink[];
};

export type GraphSetupStatus = {
  schemaOk: boolean;
  llmOk: boolean;
  schemaError?: string;
  llmError?: string;
};

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
      if (parsed && (parsed.nodes || parsed.links)) return parsed;
    }
  }

  return null;
}

function normalizeName(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:"'“”‘’（）()【】[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stringifyError(err: any): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  const msg = (err as any)?.message;
  if (typeof msg === 'string') return msg;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

export async function checkGraphSetup(): Promise<GraphSetupStatus> {
  const status: GraphSetupStatus = { schemaOk: true, llmOk: true };

  const nodesResp = await supabase
    .from('knowledge_nodes')
    .select('id,normalized_name,kind,aliases,source_captured_ids')
    .limit(1);
  if (nodesResp.error) {
    status.schemaOk = false;
    status.schemaError = stringifyError(nodesResp.error);
  }

  const linksResp = await supabase
    .from('knowledge_links')
    .select('id,relation_type,evidence_captured_ids')
    .limit(1);
  if (linksResp.error) {
    status.schemaOk = false;
    status.schemaError = status.schemaError || stringifyError(linksResp.error);
  }

  try {
    const r = await fetch('/api/graph/extract', { method: 'GET' });
    if (!r.ok) {
      status.llmOk = false;
      status.llmError = `GET /api/graph/extract ${r.status}`;
      return status;
    }
    const j = await r.json();
    if (!j?.hasKey) {
      status.llmOk = false;
      status.llmError = '服务端未配置 MINIMAX_API_KEY';
    }
  } catch (e) {
    status.llmOk = false;
    status.llmError = stringifyError(e);
  }

  return status;
}

function uniqStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const s = (v || '').toString().trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function kindPriority(kind: string): number {
  switch (kind) {
    case 'person':
      return 10;
    case 'event':
      return 9;
    case 'object':
      return 8;
    case 'concept':
      return 7;
    case 'view':
      return 6;
    case 'conclusion':
      return 6;
    case 'todo':
      return 6;
    case 'question':
      return 6;
    case 'time':
      return 5;
    case 'location':
      return 5;
    default:
      return 0;
  }
}

function kindColor(kind: string): string {
  switch (kind) {
    case 'person':
      return '#22C55E';
    case 'event':
      return '#F97316';
    case 'object':
      return '#14B8A6';
    case 'concept':
      return '#3B82F6';
    case 'view':
      return '#6366F1';
    case 'conclusion':
      return '#A855F7';
    case 'todo':
      return '#EF4444';
    case 'question':
      return '#0EA5E9';
    case 'time':
      return '#64748B';
    case 'location':
      return '#EAB308';
    default:
      return '#3B82F6';
  }
}

function kindVal(kind: string): number {
  switch (kind) {
    case 'person':
      return 18;
    case 'event':
      return 16;
    case 'todo':
      return 16;
    case 'question':
      return 14;
    case 'conclusion':
      return 14;
    case 'view':
      return 13;
    case 'concept':
      return 12;
    case 'object':
      return 12;
    case 'location':
      return 11;
    case 'time':
      return 10;
    default:
      return 10;
  }
}

async function extractGraphViaServer(content: string): Promise<ExtractedGraph> {
  const resp = await fetch('/api/graph/extract', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Graph extract error: ${resp.status} ${text}`);
  }

  const payload = await resp.json();
  return payload.data as ExtractedGraph;
}

export async function extractGraph(content: string): Promise<ExtractedGraph> {
  return extractGraphViaServer(content);
}

type DbNode = {
  id: string;
  name: string;
  normalized_name?: string;
  kind?: string;
  aliases?: string[];
  source_captured_ids?: string[];
  val?: number;
  color?: string;
};

type DbLink = {
  id: string;
  source: string;
  target: string;
  relation_type?: string;
  evidence_captured_ids?: string[];
};

export async function applyGraphToSupabase(params: { graph: ExtractedGraph; capturedId?: string }) {
  const capturedId = params.capturedId;

  const nodesResp = await supabase
    .from('knowledge_nodes')
    .select('id,name,normalized_name,kind,aliases,source_captured_ids,val,color');
  if (nodesResp.error) throw nodesResp.error;
  const existingNodes = (nodesResp.data || []) as DbNode[];

  const normToNode = new Map<string, DbNode>();
  for (const n of existingNodes) {
    const norm = n.normalized_name || normalizeName(n.name);
    if (norm) normToNode.set(norm, n);
    for (const a of n.aliases || []) {
      const an = normalizeName(a);
      if (an && !normToNode.has(an)) normToNode.set(an, n);
    }
  }

  const extractedIdToDbId = new Map<string, string>();
  const changedNodeIds = new Set<string>();

  for (const node of params.graph.nodes) {
    const names = uniqStrings([node.name, ...(node.aliases || [])]);
    const norms = uniqStrings(names.map(normalizeName)).filter(Boolean);
    const primaryNorm = normalizeName(node.name);

    let hit: DbNode | undefined = undefined;
    for (const n of norms) {
      const maybe = normToNode.get(n);
      if (maybe) {
        hit = maybe;
        break;
      }
    }

    if (hit) {
      const mergedAliases = uniqStrings([...(hit.aliases || []), ...names].filter((s) => s !== hit.name));
      const nextKind = kindPriority(node.kind) > kindPriority(hit.kind || 'concept') ? node.kind : hit.kind || 'concept';
      const mergedCapturedIds = capturedId
        ? uniqStrings([...(hit.source_captured_ids || []), capturedId])
        : (hit.source_captured_ids || []);

      const { error } = await supabase
        .from('knowledge_nodes')
        .update({
          kind: nextKind,
          aliases: mergedAliases,
          normalized_name: hit.normalized_name || normalizeName(hit.name),
          source_captured_ids: mergedCapturedIds,
          color: hit.color || kindColor(nextKind),
          val: hit.val || kindVal(nextKind),
          updated_at: new Date().toISOString(),
        })
        .eq('id', hit.id);
      if (error) throw error;

      extractedIdToDbId.set(node.id, hit.id);
      changedNodeIds.add(hit.id);

      if (primaryNorm) normToNode.set(primaryNorm, hit);
      for (const n of norms) normToNode.set(n, hit);
      continue;
    }

    const payload = {
      name: node.name,
      normalized_name: primaryNorm || normalizeName(node.name),
      kind: node.kind,
      aliases: uniqStrings((node.aliases || []).filter((s) => s !== node.name)),
      source_captured_ids: capturedId ? [capturedId] : [],
      color: kindColor(node.kind),
      val: kindVal(node.kind),
      updated_at: new Date().toISOString(),
    };

    const insertResp = await supabase
      .from('knowledge_nodes')
      .insert(payload)
      .select('id,name,normalized_name,kind,aliases,source_captured_ids,val,color')
      .single();
    if (insertResp.error) throw insertResp.error;
    const created = insertResp.data as DbNode;

    extractedIdToDbId.set(node.id, created.id);
    changedNodeIds.add(created.id);
    for (const n of norms) normToNode.set(n, created);
  }

  for (const nodeId of changedNodeIds) {
    generateEmbeddingForKnowledgeNode(nodeId);
  }

  const linksResp = await supabase
    .from('knowledge_links')
    .select('id,source,target,relation_type,evidence_captured_ids');
  if (linksResp.error) throw linksResp.error;
  const existingLinks = (linksResp.data || []) as DbLink[];

  const linkKey = (source: string, target: string, rel: string) => `${source}::${target}::${rel}`;
  const dedupe = new Map<string, DbLink>();
  for (const l of existingLinks) {
    dedupe.set(linkKey(l.source, l.target, l.relation_type || 'related_to'), l);
  }

  let insertedLinks = 0;
  let updatedLinks = 0;

  for (const link of params.graph.links) {
    const source = extractedIdToDbId.get(link.source);
    const target = extractedIdToDbId.get(link.target);
    if (!source || !target) continue;

    const rel = link.type || 'related_to';
    const key = linkKey(source, target, rel);
    const hit = dedupe.get(key);

    if (hit) {
      if (!capturedId) continue;
      const mergedEvidence = uniqStrings([...(hit.evidence_captured_ids || []), capturedId]);
      const { error } = await supabase
        .from('knowledge_links')
        .update({
          evidence_captured_ids: mergedEvidence,
          updated_at: new Date().toISOString(),
        })
        .eq('id', hit.id);
      if (error) throw error;
      updatedLinks++;
      continue;
    }

    const payload = {
      source,
      target,
      relation_type: rel,
      evidence_captured_ids: capturedId ? [capturedId] : [],
      confidence: typeof link.confidence === 'number' ? link.confidence : null,
      metadata: link.evidence ? { evidence: link.evidence } : {},
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from('knowledge_links').insert(payload);
    if (error) throw error;
    insertedLinks++;
  }

  return {
    nodesProcessed: params.graph.nodes.length,
    linksProcessed: params.graph.links.length,
    linksInserted: insertedLinks,
    linksUpdated: updatedLinks,
  };
}

export async function buildKnowledgeGraphFromContent(params: { content: string; capturedId?: string }) {
  const graph = await extractGraph(params.content);
  return applyGraphToSupabase({ graph, capturedId: params.capturedId });
}

