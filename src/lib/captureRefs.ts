import { supabase } from './supabase';

/**
 * 删除捕获记录后，同步清理知识节点/关系中引用的捕获 id。
 * migration 20260926000000 的 DB 触发器是权威兜底（本机无法直连 PG 暂未 push）；
 * 触发器生效前由本函数在应用层清理，生效后变为无害的重复清理。
 * 失败不抛出：悬空引用只会让计数虚高，可事后用 REST 清理脚本修复。
 */
export async function cleanupCaptureRefs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  try {
    const removed = new Set(ids);
    const orNodes = ids.map((id) => `source_captured_ids.cs.{${id}}`).join(',');
    const { data: nodes } = await supabase
      .from('knowledge_nodes')
      .select('id,source_captured_ids')
      .or(orNodes);
    for (const n of (nodes || []) as { id: string; source_captured_ids: string[] | null }[]) {
      const kept = (n.source_captured_ids || []).filter((cid) => !removed.has(cid));
      await supabase.from('knowledge_nodes').update({ source_captured_ids: kept }).eq('id', n.id);
    }

    const orLinks = ids.map((id) => `evidence_captured_ids.cs.{${id}}`).join(',');
    const { data: links } = await supabase
      .from('knowledge_links')
      .select('id,evidence_captured_ids')
      .or(orLinks);
    for (const l of (links || []) as { id: string; evidence_captured_ids: string[] | null }[]) {
      const kept = (l.evidence_captured_ids || []).filter((cid) => !removed.has(cid));
      await supabase.from('knowledge_links').update({ evidence_captured_ids: kept }).eq('id', l.id);
    }
  } catch (e) {
    console.error('清理捕获引用失败（不影响删除）:', e);
  }
}
