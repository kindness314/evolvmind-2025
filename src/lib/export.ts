import { supabase } from './supabase';
import { normalizeName } from './graph';
import { nodeTopicCacheKey } from './nodeTopics';

/**
 * 数据导出（个人中心-数据管理）
 * 全部查询走 range 分页：PostgREST max_rows=1000 会静默截断 limit/默认拉取。
 * 导出内容受 RLS 限制为当前 scope（Demo 为固定演示空间，真实用户为本人数据）。
 */

const PAGE = 1000;

async function fetchAll<T>(table: string, columns: string, orderCol = 'created_at'): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderCol, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const dateStamp = () => new Date().toISOString().slice(0, 10);

// 与上传规则一致：单文件超 10MiB 不内嵌（备份体积保护）
const ATTACHMENT_CAP = 10 * 1024 * 1024;

export interface BackupAttachment {
  capture_id: string;
  storage_path: string;
  file_name: string | null;
  mime_type: string | null;
  data_base64: string;
}

function bufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

interface CaptureRow {
  id: string;
  type: string;
  title: string | null;
  content: string | null;
  summary: string | null;
  tags: string[] | null;
  note: string | null;
  created_at: string;
  file_name: string | null;
  mime_type: string | null;
  storage_path: string | null;
  file_size: number | null;
}

/** 完整备份：捕获 + 图谱节点 + 关联 + 文件附件内嵌(base64)，JSON 自包含可跨项目迁移 */
export async function exportJsonBackup(): Promise<{ captures: number; nodes: number; links: number; attachments: number; skippedLarge: number }> {
  const captures = await fetchAll<CaptureRow & Record<string, unknown>>(
    'captured_info',
    'id,type,title,content,summary,tags,note,created_at,is_pinned,file_name,mime_type,file_size,storage_path,processing_status',
  );
  // source_captured_ids / evidence_captured_ids 必须带上：恢复后节点-捕获引用链才不会断
  const nodes = await fetchAll<Record<string, unknown>>('knowledge_nodes', 'id,name,normalized_name,kind,aliases,source_captured_ids,created_at,updated_at');
  const links = await fetchAll<Record<string, unknown>>('knowledge_links', 'id,source,target,relation_type,confidence,evidence_captured_ids,created_at');
  // 附件本体：逐文件下载内嵌（超过 10MiB 跳过并计数）
  const attachments: BackupAttachment[] = [];
  let skippedLarge = 0;
  for (const c of captures) {
    if (!c.storage_path) continue;
    if (c.file_size && c.file_size > ATTACHMENT_CAP) { skippedLarge += 1; continue; }
    try {
      const { data, error } = await supabase.storage.from('captured-files').download(c.storage_path);
      if (error || !data) { skippedLarge += 1; continue; }
      attachments.push({
        capture_id: c.id as string,
        storage_path: c.storage_path,
        file_name: (c.file_name as string | null) ?? null,
        mime_type: (c.mime_type as string | null) ?? null,
        data_base64: bufferToBase64(await data.arrayBuffer()),
      });
    } catch { skippedLarge += 1; }
  }
  const payload = {
    app: 'EvolvMind',
    version: 1,
    exported_at: new Date().toISOString(),
    counts: { captures: captures.length, knowledge_nodes: nodes.length, knowledge_links: links.length, attachments: attachments.length },
    captured_info: captures,
    knowledge_nodes: nodes,
    knowledge_links: links,
    attachments,
  };
  download(`evolvmind-backup-${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  return { captures: captures.length, nodes: nodes.length, links: links.length, attachments: attachments.length, skippedLarge };
}

/** 可读存档：每条捕获一节 Markdown */
export async function exportMarkdownArchive(): Promise<number> {
  const captures = await fetchAll<CaptureRow>('captured_info', 'id,type,title,content,summary,tags,note,created_at,file_name,mime_type');
  const esc = (s: string) => s.replace(/^#/gm, '\\#');
  const lines: string[] = [
    '# EvolvMind 数据存档',
    '',
    `导出时间：${new Date().toLocaleString('zh-CN')}，共 ${captures.length} 条`,
    '',
  ];
  const typeLabel: Record<string, string> = { text: '文字', photo: '图片', audio: '语音', document: '文档', link: '链接' };
  for (const c of captures) {
    lines.push(`## ${esc(c.title?.trim() || '(无标题)')}`);
    lines.push('');
    lines.push(`- 时间：${new Date(c.created_at).toLocaleString('zh-CN')}`);
    lines.push(`- 类型：${typeLabel[c.type] || c.type}`);
    if (c.tags?.length) lines.push(`- 标签：${c.tags.join('、')}`);
    if (c.file_name) lines.push(`- 文件：${c.file_name}${c.mime_type ? ` (${c.mime_type})` : ''}`);
    lines.push('');
    if (c.content && !c.content.startsWith('http')) { lines.push(esc(c.content)); lines.push(''); }
    if (c.summary) { lines.push(`> 摘要：${esc(c.summary)}`); lines.push(''); }
    if (c.note) { lines.push(`> 备注：${esc(c.note)}`); lines.push(''); }
    lines.push('---');
    lines.push('');
  }
  download(`evolvmind-archive-${dateStamp()}.md`, lines.join('\n'), 'text/markdown');
  return captures.length;
}

/** 真实存储用量：captured_info.file_size 求和 + 文件数 */
export async function fetchStorageUsage(): Promise<{ bytes: number; files: number }> {
  const rows = await fetchAll<{ file_size: number | null }>('captured_info', 'file_size');
  let bytes = 0;
  let files = 0;
  for (const r of rows) {
    if (r.file_size && r.file_size > 0) { bytes += r.file_size; files += 1; }
  }
  return { bytes, files };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/* ---------- 导入（恢复备份） ---------- */

export interface BackupData {
  exportedAt: string | null;
  captures: Record<string, unknown>[];
  nodes: Record<string, unknown>[];
  links: Record<string, unknown>[];
  attachments: BackupAttachment[];
}

/** 解析并校验备份文件结构；不合法抛错 */
export function parseBackup(jsonText: string): BackupData {
  let raw: unknown;
  try { raw = JSON.parse(jsonText); } catch { throw new Error('不是合法的 JSON 文件'); }
  const obj = raw as Record<string, unknown>;
  if (!obj || typeof obj !== 'object') throw new Error('备份文件结构无效');
  const captures = obj.captured_info;
  const nodes = obj.knowledge_nodes;
  const links = obj.knowledge_links;
  if (!Array.isArray(captures) || !Array.isArray(nodes) || !Array.isArray(links)) {
    throw new Error('备份文件缺少 captured_info / knowledge_nodes / knowledge_links 数据');
  }
  for (const c of captures) {
    if (!c || typeof c !== 'object' || typeof (c as Record<string, unknown>).id !== 'string') throw new Error('捕获数据缺少 id，文件可能损坏');
  }
  const rawAttachments = Array.isArray(obj.attachments) ? obj.attachments : [];
  const attachments: BackupAttachment[] = rawAttachments.filter(
    (a): a is BackupAttachment => Boolean(a) && typeof a === 'object'
      && typeof (a as BackupAttachment).capture_id === 'string'
      && typeof (a as BackupAttachment).data_base64 === 'string',
  );
  return {
    exportedAt: typeof obj.exported_at === 'string' ? obj.exported_at : null,
    captures: captures as Record<string, unknown>[],
    nodes: nodes as Record<string, unknown>[],
    links: links as Record<string, unknown>[],
    attachments,
  };
}

const BATCH = 500;
// 这些列由当前账户决定（RLS 默认/触发器），不信任文件里的值，也不允许覆盖
const stripCols = (rows: Record<string, unknown>[], drop: string[]) =>
  rows.map((r) => {
    const out = { ...r };
    for (const k of drop) delete out[k];
    return out;
  });

/** 分批 ignore-duplicates 插入；返回实际插入条数 */
async function insertIgnoreDup(table: string, rows: Record<string, unknown>[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const { data, error } = await supabase.from(table).upsert(batch, { onConflict: 'id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(`${table}: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return inserted;
}

/**
 * 危险区：清空当前 scope 全部数据（RLS 限制为当前账户/演示空间）。
 * 顺序：Storage 文件 -> 关联 -> 节点 -> 主题缓存 -> 捕获 -> 本地缓存。
 */
export async function wipeAllData(): Promise<{ captures: number; nodes: number; links: number; files: number }> {
  const captureRows = await fetchAll<{ id: string; storage_path: string | null }>('captured_info', 'id,storage_path');
  const filePaths = captureRows.map((r) => r.storage_path).filter((p): p is string => Boolean(p));
  if (filePaths.length) {
    await supabase.storage.from('captured-files').remove(filePaths);
  }
  const count = async (table: string) => {
    const { count: n } = await supabase.from(table).select('id', { count: 'exact', head: true });
    return n ?? 0;
  };
  const [nodes, links] = [await count('knowledge_nodes'), await count('knowledge_links')];
  for (const table of ['knowledge_links', 'knowledge_nodes', 'topic_labels', 'captured_info']) {
    // RLS 已限定 scope；用非空过滤构成全表删除
    const { error } = await supabase.from(table).delete().not('id', 'is', null);
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  // 本地主题缓存（按 scope 分键）
  const { data: { user } } = await supabase.auth.getUser();
  localStorage.removeItem(nodeTopicCacheKey(user?.id || '00000000-0000-0000-0000-000000000000'));
  return { captures: captureRows.length, nodes, links, files: filePaths.length };
}

/**
 * 恢复备份：已存在的 id 跳过（不覆盖现有数据），新 id 插入到当前账户 scope。
 * 注意：节点不含 embedding，导入后需走 /api/graph/backfill 重新生成向量才能进语义搜索。
 */
export async function importJsonBackup(data: BackupData): Promise<{
  inserted: { captures: number; nodes: number; links: number; attachments: number };
  skipped: { captures: number; nodes: number; links: number };
}> {
  // 隔离不变量：插入行一律打当前 scope 标，不信任文件里的 user_id/scope_id。
  // captured_info 只有 user_id（demo=null，真实=uid）；nodes/links 的 scope_id 是 GENERATED 列
  // （由 user_id 推导：null->demo UUID，真实->uid），不能显式插入，只需打 user_id。
  const { data: { user } } = await supabase.auth.getUser();
  const scopeUserId = user?.id || null;
  const stamp = (rows: Record<string, unknown>[]): Record<string, unknown>[] =>
    stripCols(rows, ['user_id', 'scope_id', 'updated_at']).map((r) => ({ ...r, user_id: scopeUserId }));
  // 捕获先按「不带附件路径」插入，拿到实际新增 id 后再传附件并重映射 storage_path
  const captures = stamp(data.captures)
    .map((c) => ({ ...c, storage_path: null }));
  const insertedCaptures = await insertIgnoreDup('captured_info', captures);

  // 附件重传：只处理本次实际插入的捕获；新路径首段为当前账户 scope
  let insertedAttachments = 0;
  if (insertedCaptures > 0 && data.attachments.length) {
    const scopeId = user?.id || '00000000-0000-0000-0000-000000000000';
    // insertIgnoreDup 只插入了部分行，需查出哪些 id 真实存在且属于本次备份集合
    const wanted = new Set(data.captures.map((c) => c.id as string));
    const attByCapture = new Map(data.attachments.map((a) => [a.capture_id, a]));
    const { data: existing } = await supabase
      .from('captured_info')
      .select('id,storage_path')
      .in('id', [...wanted]);
    for (const row of existing || []) {
      if (row.storage_path) continue; // 已有附件（老数据或同项目恢复）不动
      const att = attByCapture.get(row.id as string);
      if (!att) continue;
      const ext = att.file_name?.split('.').pop()?.toLowerCase() || 'bin';
      const newPath = `${scopeId}/${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
      const { error } = await supabase.storage
        .from('captured-files')
        .upload(newPath, base64ToBlob(att.data_base64, att.mime_type || 'application/octet-stream'));
      if (error) continue;
      const { error: upErr } = await supabase
        .from('captured_info')
        .update({ storage_path: newPath })
        .eq('id', row.id);
      if (!upErr) insertedAttachments += 1;
    }
  }

  const inserted = {
    captures: insertedCaptures,
    nodes: await insertIgnoreDup('knowledge_nodes', stamp(data.nodes)
      // 节点不携带 embedding（维度/陈旧风险），导入后走 backfill 重建
      .map((n) => { const { embedding: _e, ...rest } = n; return rest; })
      .map((n) => ({ ...n, normalized_name: (typeof n.normalized_name === 'string' && n.normalized_name) || normalizeName(String(n.name || '')) }))),
    links: await insertIgnoreDup('knowledge_links', stamp(data.links)),
    attachments: insertedAttachments,
  };
  return {
    inserted,
    skipped: {
      captures: data.captures.length - inserted.captures,
      nodes: data.nodes.length - inserted.nodes,
      links: data.links.length - inserted.links,
    },
  };
}
