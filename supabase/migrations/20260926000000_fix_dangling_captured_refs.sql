-- 修复悬空捕获引用: 删除捕获记录时未同步清理 knowledge_nodes.source_captured_ids /
-- knowledge_links.evidence_captured_ids, 导致节点"N 条记录"等计数虚高(实测 demo 约 30% 悬空)。
-- 1) 存量清理: 剔除已不存在的捕获 id
-- 2) 触发器: 之后任何删除捕获的路径(客户端批量删/详情页删/脚本)都自动同步清理

-- 1a. knowledge_nodes.source_captured_ids 只保留存在的捕获 id
UPDATE knowledge_nodes n
SET source_captured_ids = COALESCE((
  SELECT array_agg(cid)
  FROM unnest(n.source_captured_ids) AS cid
  WHERE EXISTS (SELECT 1 FROM captured_info c WHERE c.id = cid)
), '{}'::uuid[])
WHERE n.source_captured_ids IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(n.source_captured_ids) AS cid
    WHERE NOT EXISTS (SELECT 1 FROM captured_info c WHERE c.id = cid)
  );

-- 1b. knowledge_links.evidence_captured_ids 同理
UPDATE knowledge_links l
SET evidence_captured_ids = COALESCE((
  SELECT array_agg(cid)
  FROM unnest(l.evidence_captured_ids) AS cid
  WHERE EXISTS (SELECT 1 FROM captured_info c WHERE c.id = cid)
), '{}'::uuid[])
WHERE l.evidence_captured_ids IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM unnest(l.evidence_captured_ids) AS cid
    WHERE NOT EXISTS (SELECT 1 FROM captured_info c WHERE c.id = cid)
  );

-- 2. 删除捕获时自动清理引用(AFTER DELETE, SECURITY DEFINER 绕过 RLS 由属主执行)
CREATE OR REPLACE FUNCTION public.remove_deleted_capture_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE knowledge_nodes
  SET source_captured_ids = array_remove(source_captured_ids, OLD.id)
  WHERE source_captured_ids IS NOT NULL AND OLD.id = ANY(source_captured_ids);

  UPDATE knowledge_links
  SET evidence_captured_ids = array_remove(evidence_captured_ids, OLD.id)
  WHERE evidence_captured_ids IS NOT NULL AND OLD.id = ANY(evidence_captured_ids);

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_captured_info_cleanup_refs ON captured_info;
CREATE TRIGGER trg_captured_info_cleanup_refs
AFTER DELETE ON captured_info
FOR EACH ROW EXECUTE FUNCTION public.remove_deleted_capture_refs();
