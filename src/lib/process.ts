import { supabase } from './supabase';
import { extractInformation } from './ai';
import { retryGraphForCaptured } from './graph';
import { generateEmbeddingForRow } from './search';

export interface AnalyzeOutcome {
  ok: boolean;
  title: string;
  summary: string;
  keywords: string[];
  error?: string;
}

/**
 * O1: 提交后自动提取标题/关键词/摘要, 不再手动触发。
 * 成功: 更新 title/tags/summary 并清空错误;
 * 失败: processing_status='failed' + 子步骤 'failed' + processing_error,
 * 保证聚合判定显示"处理失败"且可重试(重试会重新走本函数)。
 */
export async function analyzeAndPersist(itemId: string, content: string): Promise<AnalyzeOutcome> {
  const result = await extractInformation(content);
  if (!result.ok) {
    const msg = result.error || '内容分析失败';
    await supabase
      .from('captured_info')
      .update({
        processing_status: 'failed',
        graph_status: 'failed',
        embedding_status: 'failed',
        processing_error: `分析失败: ${msg.slice(0, 500)}`,
      })
      .eq('id', itemId);
    return { ok: false, title: '', summary: '', keywords: [], error: msg };
  }
  await supabase
    .from('captured_info')
    .update({ title: result.title, tags: result.keywords, summary: result.summary, processing_error: null })
    .eq('id', itemId);
  return { ok: true, title: result.title, summary: result.summary, keywords: result.keywords };
}

/**
 * O1: 失败/缺失重试统一入口(列表与详情页共用)。
 * 分析失败的行先重跑提取(成功后更新标题/关键词/摘要);
 * 再按子状态补做图谱与向量, 互不阻塞, 由 finalize 双端兜底完成收尾。
 */
export async function retryCapturedItem(capturedId: string): Promise<void> {
  const { data: row, error: rowError } = await supabase
    .from('captured_info')
    .select('content, graph_status, embedding_status, processing_error')
    .eq('id', capturedId)
    .single();
  if (rowError) throw rowError;
  if (!row) throw new Error('记录不存在');

  if ((row.processing_error || '').startsWith('分析失败')) {
    const outcome = await analyzeAndPersist(capturedId, row.content || '');
    if (!outcome.ok) {
      throw new Error(`分析失败: ${outcome.error || ''}`);
    }
  }

  const graphActionable = !row.graph_status || row.graph_status === 'failed' || row.graph_status === 'pending';
  const embedActionable = !row.embedding_status || row.embedding_status === 'failed' || row.embedding_status === 'pending';
  if (graphActionable) {
    await retryGraphForCaptured(capturedId);
  }
  if (embedActionable) {
    // await: 批量一键处理需要串行等待 embedding 完成, 失败能正确计入统计;
    // 单条重试同样等待, 完成后刷新列表状态一致
    await generateEmbeddingForRow(capturedId);
  }

  // 收敛兜底: 两个子步骤均已 completed 时, 把卡在 failed 的整体状态推进为 completed
  // (覆盖"embed 失败后 processing 被置 failed, 子步骤重试成功但整体未恢复"的死锁)
  const { data: after } = await supabase
    .from('captured_info')
    .select('graph_status, embedding_status, processing_status')
    .eq('id', capturedId)
    .single();
  if (
    after &&
    after.graph_status === 'completed' &&
    after.embedding_status === 'completed' &&
    after.processing_status !== 'completed'
  ) {
    await supabase
      .from('captured_info')
      .update({ processing_status: 'completed', processing_error: null })
      .eq('id', capturedId);
  }
}
