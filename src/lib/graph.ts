import { generateEmbeddingForKnowledgeNode } from './graphSearch';
import { getApiAuthHeaders } from './apiAuth';
import { supabase } from './supabase';

const FETCH_TIMEOUT_MS = 60_000;

/** fetch 带超时: API/LLM 挂起时抛错, 由调用方落 failed, 避免永久卡在 processing */
async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
  | 'location'
  | 'organization'
  | 'role';

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
      if (parsed && (parsed.nodes || parsed.links)) return parsed;
    }
  }

  return null;
}

export function normalizeName(input: string): string {
  return (input || '')
    .trim()
    .toLowerCase()
    .replace(/[，。！？、,.!?;；:"'“”‘’（）()【】[\]{}<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function stringifyError(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  if (typeof err === 'object') {
    // PostgREST 唯一冲突等结构化错误：带上 details/hint，便于定位具体冲突键值
    const msg = 'message' in err && typeof err.message === 'string' ? err.message : '';
    const detail =
      'details' in err && typeof err.details === 'string'
        ? err.details
        : 'hint' in err && typeof err.hint === 'string'
          ? err.hint
          : '';
    if (msg) return detail ? `${msg} [${detail}]` : msg;
  }
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/**
 * 插入知识节点；唯一键 (scope_id, normalized_name) 冲突时回退为「按同 norm 拉取已有节点并合并」，
 * 而不是整批失败。LLM 对重复内容/跨行重复节点常输出同 norm 名，此前会触发 scope_norm_uidx 冲突
 * 导致整条重试失败（实测 22 条批量重试中 15 条因此 failed）。
 */
async function insertKnowledgeNodeWithFallback(params: {
  scopeId: string;
  payload: Record<string, unknown>;
  nodeId: string;
  names: string[];
  norms: string[];
  capturedId?: string;
  normToNode: Map<string, DbNode>;
  extractedIdToDbId: Map<string, string>;
  changedNodeIds: Set<string>;
  /** 本次新插入（非合并既有）的节点 db id —— 用于数据生成时语义主题分类 */
  newNodeIds: Set<string>;
}): Promise<void> {
  const { scopeId, payload, nodeId, names, norms, capturedId, normToNode, extractedIdToDbId, changedNodeIds, newNodeIds } = params;
  const insertResp = await supabase
    .from('knowledge_nodes')
    .insert(payload)
    .select('id,name,normalized_name,kind,aliases,source_captured_ids,val,color')
    .single();
  if (!insertResp.error) {
    const created = insertResp.data as DbNode;
    extractedIdToDbId.set(nodeId, created.id);
    changedNodeIds.add(created.id);
    newNodeIds.add(created.id);
    for (const n of norms) normToNode.set(n, created);
    return;
  }
  const errMsg = stringifyError(insertResp.error);
  if (!errMsg.includes('duplicate key')) throw insertResp.error;
  // 唯一键冲突：拉取同 normalized_name 的已有节点合并
  const { data: existing, error: fetchError } = await supabase
    .from('knowledge_nodes')
    .select('id,name,normalized_name,aliases,source_captured_ids')
    .eq('scope_id', scopeId)
    .eq('normalized_name', payload.normalized_name)
    .maybeSingle();
  if (fetchError) throw fetchError;
  if (!existing) throw insertResp.error;
  const mergedAliases = uniqStrings([...(existing.aliases || []), ...names].filter((s) => s !== existing.name));
  const mergedCapturedIds = capturedId
    ? uniqStrings([...(existing.source_captured_ids || []), capturedId])
    : (existing.source_captured_ids || []);
  const { error: updateError } = await supabase
    .from('knowledge_nodes')
    .update({ aliases: mergedAliases, source_captured_ids: mergedCapturedIds, updated_at: new Date().toISOString() })
    .eq('id', existing.id);
  if (updateError) throw updateError;
  extractedIdToDbId.set(nodeId, existing.id);
  changedNodeIds.add(existing.id);
  for (const n of norms) normToNode.set(n, existing);
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
    const r = await fetchWithTimeout('/api/graph/extract', { method: 'GET' });
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
  const resp = await fetchWithTimeout('/api/graph/extract', {
    method: 'POST',
    headers: await getApiAuthHeaders(),
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

export interface GraphBuildResult {
  nodesProcessed: number;
  linksProcessed: number;
  linksInserted: number;
  linksUpdated: number;
}

/**
 * 数据生成时的语义主题分类（2026-08-19 改向）：
 * 对新入库节点调 /api/graph/topicize，把 nodeId -> 细主题 写进 topic_labels 缓存，
 * 使图谱总览层走"语义主题"而非模块度碎片。失败不抛：未分到的节点 topic_labels 缺失，
 * 即视为"待分类"，下次数据生成涉及该节点时再补。仅作后台任务，不阻塞图谱入库结果。
 */
async function classifyNewNodes(nodeIds: Set<string>): Promise<void> {
  if (nodeIds.size === 0) return;
  try {
    const ids = Array.from(nodeIds);
    const { data, error } = await supabase
      .from('knowledge_nodes')
      .select('id,name,aliases')
      .in('id', ids);
    if (error || !data || data.length === 0) return;
    const isDemo = localStorage.getItem('demo_auth') === 'true';
    // 服务端一次最多 200 节点；超出分批
    const nodes = data.map((n) => ({ id: n.id, name: n.name || '', aliases: n.aliases || [] }));
    for (let i = 0; i < nodes.length; i += 200) {
      const batch = nodes.slice(i, i + 200);
      const resp = await fetch('/api/graph/topicize', {
        method: 'POST',
        headers: await getApiAuthHeaders(),
        body: JSON.stringify({ nodes: batch, demo: isDemo }),
      });
      if (!resp.ok) continue; // 失败不阻塞；未分到即待分类，下次再补
    }
  } catch {
    // 分类失败静默：不阻塞图谱入库，节点保持"待分类"
  }
}

export async function applyGraphToSupabase(params: { graph: ExtractedGraph; capturedId?: string }): Promise<GraphBuildResult> {
  const capturedId = params.capturedId;
  const currentUser = (await supabase.auth.getUser()).data.user;
  const scopeId = currentUser?.id || '00000000-0000-0000-0000-000000000000';

  // 分页拉全: PostgREST max_rows=1000 会静默截断, 截断后 merge 匹配看不到老节点 → 重复建节点
  const existingNodes: DbNode[] = [];
  for (let from = 0; ; from += 1000) {
    const nodesResp = await supabase
      .from('knowledge_nodes')
      .select('id,name,normalized_name,kind,aliases,source_captured_ids,val,color')
      .eq('scope_id', scopeId)
      .range(from, from + 999);
    if (nodesResp.error) throw nodesResp.error;
    if (!nodesResp.data || nodesResp.data.length === 0) break;
    existingNodes.push(...(nodesResp.data as DbNode[]));
    if (nodesResp.data.length < 1000) break;
  }

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
  /** 本次新插入的节点（非既有合并），用于数据生成时对其做语义主题分类 */
  const newNodeIds = new Set<string>();
  // P1 消歧候选：精确匹配未命中的新节点，等待 embedding 近邻消歧
  const disambiguateCandidates: Array<{ node: (typeof params.graph.nodes)[number]; names: string[]; norms: string[] }> = [];

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

    // 精确未命中：暂存，稍后做 embedding 消歧（P1）
    disambiguateCandidates.push({ node, names, norms });
  }

  // P1 实体消歧：服务端用 embedding 近邻（>0.85 且同 kind）找可合并的已有节点
  if (disambiguateCandidates.length > 0) {
    const headers = await getApiAuthHeaders();
    const resp = await fetchWithTimeout('/api/graph/disambiguate', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        candidates: disambiguateCandidates.map(({ node }) => ({ name: node.name, kind: node.kind })),
        demo: localStorage.getItem('demo_auth') === 'true',
      }),
    });
    if (resp.ok) {
      const data = (await resp.json()) as { merges?: Array<{ name: string; targetId: string; targetName: string; similarity: number }> };
      const mergeByNodeName = new Map<string, { targetId: string; targetName: string }>();
      for (const m of data.merges || []) mergeByNodeName.set(m.name, { targetId: m.targetId, targetName: m.targetName });

      for (const { node, names, norms } of disambiguateCandidates) {
        const merge = mergeByNodeName.get(node.name);
        const hit = merge ? existingNodes.find((n) => n.id === merge.targetId) : undefined;
        if (hit) {
          // 合并：别名并入已有节点，捕获关联保留
          const mergedAliases = uniqStrings([...(hit.aliases || []), ...names].filter((s) => s !== hit.name));
          const mergedCapturedIds = capturedId
            ? uniqStrings([...(hit.source_captured_ids || []), capturedId])
            : (hit.source_captured_ids || []);
          const { error } = await supabase
            .from('knowledge_nodes')
            .update({
              aliases: mergedAliases,
              source_captured_ids: mergedCapturedIds,
              updated_at: new Date().toISOString(),
            })
            .eq('id', hit.id);
          if (error) throw error;
          extractedIdToDbId.set(node.id, hit.id);
          changedNodeIds.add(hit.id);
          if (norms.length > 0) {
            for (const n of norms) normToNode.set(n, hit);
          }
          continue;
        }

        // 无消歧命中：插入前重查 normToNode —— 本批先前候选可能已插入同 norm 节点
        // （LLM 对重复内容常输出同名单节点；跳过此查会触发 scope_norm_uidx 唯一冲突，整条重试失败）
        let reHit: DbNode | undefined;
        for (const n of norms) {
          const maybe = normToNode.get(n);
          if (maybe) {
            reHit = maybe;
            break;
          }
        }
        if (reHit) {
          const mergedAliases = uniqStrings([...(reHit.aliases || []), ...names].filter((s) => s !== reHit.name));
          const mergedCapturedIds = capturedId
            ? uniqStrings([...(reHit.source_captured_ids || []), capturedId])
            : (reHit.source_captured_ids || []);
          const { error } = await supabase
            .from('knowledge_nodes')
            .update({ aliases: mergedAliases, source_captured_ids: mergedCapturedIds, updated_at: new Date().toISOString() })
            .eq('id', reHit.id);
          if (error) throw error;
          extractedIdToDbId.set(node.id, reHit.id);
          changedNodeIds.add(reHit.id);
          for (const n of norms) normToNode.set(n, reHit);
          continue;
        }

        // 无消歧命中：正常插入（唯一键冲突自动回退合并，见 insertKnowledgeNodeWithFallback）
        const payload = {
          name: node.name,
          normalized_name: normalizeName(node.name) || normalizeName(node.name),
          kind: node.kind,
          aliases: uniqStrings((node.aliases || []).filter((s) => s !== node.name)),
          source_captured_ids: capturedId ? [capturedId] : [],
          color: kindColor(node.kind),
          val: kindVal(node.kind),
          updated_at: new Date().toISOString(),
        };
        await insertKnowledgeNodeWithFallback({ scopeId, payload, nodeId: node.id, names, norms, capturedId, normToNode, extractedIdToDbId, changedNodeIds, newNodeIds });
      }
    } else {
      // 消歧端点不可用：全部按新建插入，保证不丢数据（插入前同样重查 normToNode 防本批同 norm 冲突）
      for (const { node, names, norms } of disambiguateCandidates) {
        let reHit: DbNode | undefined;
        for (const n of norms) {
          const maybe = normToNode.get(n);
          if (maybe) {
            reHit = maybe;
            break;
          }
        }
        if (reHit) {
          const mergedAliases = uniqStrings([...(reHit.aliases || []), ...names].filter((s) => s !== reHit.name));
          const mergedCapturedIds = capturedId
            ? uniqStrings([...(reHit.source_captured_ids || []), capturedId])
            : (reHit.source_captured_ids || []);
          const { error } = await supabase
            .from('knowledge_nodes')
            .update({ aliases: mergedAliases, source_captured_ids: mergedCapturedIds, updated_at: new Date().toISOString() })
            .eq('id', reHit.id);
          if (error) throw error;
          extractedIdToDbId.set(node.id, reHit.id);
          changedNodeIds.add(reHit.id);
          for (const n of norms) normToNode.set(n, reHit);
          continue;
        }
        const payload = {
          name: node.name,
          normalized_name: normalizeName(node.name) || normalizeName(node.name),
          kind: node.kind,
          aliases: uniqStrings((node.aliases || []).filter((s) => s !== node.name)),
          source_captured_ids: capturedId ? [capturedId] : [],
          color: kindColor(node.kind),
          val: kindVal(node.kind),
          updated_at: new Date().toISOString(),
        };
        await insertKnowledgeNodeWithFallback({ scopeId, payload, nodeId: node.id, names, norms, capturedId, normToNode, extractedIdToDbId, changedNodeIds, newNodeIds });
      }
    }
  }

  for (const nodeId of changedNodeIds) {
    generateEmbeddingForKnowledgeNode(nodeId);
  }

  // 分页拉全: 同上, 截断会导致去重看不到老边 → 重复建边
  const existingLinks: DbLink[] = [];
  for (let from = 0; ; from += 1000) {
    const linksResp = await supabase
      .from('knowledge_links')
      .select('id,source,target,relation_type,evidence_captured_ids')
      .eq('scope_id', scopeId)
      .range(from, from + 999);
    if (linksResp.error) throw linksResp.error;
    if (!linksResp.data || linksResp.data.length === 0) break;
    existingLinks.push(...(linksResp.data as DbLink[]));
    if (linksResp.data.length < 1000) break;
  }

  const linkKey = (source: string, target: string, rel: string) => `${source}::${target}::${rel}`;
  const dedupe = new Map<string, DbLink>();
  for (const l of existingLinks) {
    dedupe.set(linkKey(l.source, l.target, l.relation_type || 'related_to'), l);
  }

  let insertedLinks = 0;
  let updatedLinks = 0;

  // 本批已插入的 link key：LLM 可能对同一对节点输出多条相同关系（source::target::rel 重复），
  // 不跟踪会触发 scope_dedupe_uidx 唯一冲突；合并后 source===target 的自环也无意义，跳过
  const insertedLinkKeys = new Set<string>();
  for (const link of params.graph.links) {
    const source = extractedIdToDbId.get(link.source);
    const target = extractedIdToDbId.get(link.target);
    if (!source || !target || source === target) continue;

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

    if (insertedLinkKeys.has(key)) continue;
    insertedLinkKeys.add(key);

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
    if (error) {
      // 唯一键冲突（并发/跨次重试已插入同对边）：按同键拉取已有边合并证据，不再整批失败
      const errMsg = stringifyError(error);
      if (errMsg.includes('duplicate key')) {
        const { data: existingLink, error: fetchError } = await supabase
          .from('knowledge_links')
          .select('id,evidence_captured_ids')
          .eq('scope_id', scopeId)
          .eq('source', source)
          .eq('target', target)
          .eq('relation_type', rel)
          .maybeSingle();
        if (fetchError) throw fetchError;
        if (existingLink) {
          const mergedEvidence = capturedId
            ? uniqStrings([...(existingLink.evidence_captured_ids || []), capturedId])
            : (existingLink.evidence_captured_ids || []);
          const { error: updateError } = await supabase
            .from('knowledge_links')
            .update({ evidence_captured_ids: mergedEvidence, updated_at: new Date().toISOString() })
            .eq('id', existingLink.id);
          if (updateError) throw updateError;
          updatedLinks++;
          continue;
        }
      }
      throw error;
    }
    insertedLinks++;
  }

  // 数据生成时语义主题分类（2026-08-19 改向）：对新入库节点异步调 /api/graph/topicize，
  // 把主题写进 topic_labels 缓存。不阻塞入库结果、失败不抛（未分到即 topic_labels 缺失=待分类，
  // 下次数据生成涉及该节点时再补）。页面图谱加载只读缓存，不再实时调 LLM。
  if (newNodeIds.size > 0) {
    void classifyNewNodes(newNodeIds);
  }

  return {
    nodesProcessed: params.graph.nodes.length,
    linksProcessed: params.graph.links.length,
    linksInserted: insertedLinks,
    linksUpdated: updatedLinks,
  };
}

export async function buildKnowledgeGraphFromContent(params: { content: string; capturedId?: string }): Promise<GraphBuildResult> {
  const graph = await extractGraph(params.content);
  return applyGraphToSupabase({ graph, capturedId: params.capturedId });
}


/**
 * O1: 重试单条捕获记录的图谱构建
 * 先落库 processing, 成功后 completed, 失败 failed + processing_error
 * 供 HomePage / ItemDetailPage 的失败重试按钮使用
 */
export async function retryGraphForCaptured(capturedId: string): Promise<GraphBuildResult> {
  const { data: row, error: rowError } = await supabase
    .from('captured_info')
    .select('title, summary, content, tags')
    .eq('id', capturedId)
    .single();
  if (rowError) throw rowError;

  const setup = await checkGraphSetup();
  if (!setup.schemaOk) {
    throw new Error(setup.schemaError?.toLowerCase().includes('invalid api key') ? 'Supabase 连接配置错误' : '数据库未应用图谱迁移');
  }
  if (!setup.llmOk) {
    throw new Error('LLM 未配置');
  }

  await supabase.from('captured_info').update({ graph_status: 'processing', processing_status: 'processing', processed_at: new Date().toISOString() }).eq('id', capturedId);

  try {
    const contentForGraph = `标题: ${row.title || ''}\n摘要: ${row.summary || ''}\n关键词: ${(row.tags || []).join(', ')}\n资源: ${row.content || ''}`;
    const result = await buildKnowledgeGraphFromContent({ content: contentForGraph, capturedId });
    // O1: 成功只更新 graph_status; 若 embedding 也已 completed 则整体完成,
    // 避免 processing_status 永远停在 'processing'
    const { data: cur } = await supabase
      .from('captured_info')
      .select('embedding_status, processing_status')
      .eq('id', capturedId)
      .single();
    const patch: Record<string, unknown> = { graph_status: 'completed', processed_at: new Date().toISOString() };
    // 子步骤全 completed 即推进整体, 不因 processing_status 曾是 failed 而卡死(否则 UI 红徽章无按钮)
    if (cur && cur.embedding_status === 'completed') {
      patch.processing_status = 'completed';
    }
    await supabase.from('captured_info').update(patch).eq('id', capturedId);
    return result;
  } catch (e: unknown) {
    const msg = stringifyError(e);
    await supabase
      .from('captured_info')
      .update({ graph_status: 'failed', processing_status: 'failed', processing_error: `graph: ${msg.slice(0, 500)}` })
      .eq('id', capturedId);
    throw e;
  }
}
