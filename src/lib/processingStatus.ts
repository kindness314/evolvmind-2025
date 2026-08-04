/**
 * O1 捕获处理状态 — 共享类型与派生逻辑
 * captured_info 上的 AI 处理状态在前后端复用。
 */

export type ProcessingStatus = 'pending' | 'processing' | 'done' | 'error';
export type StepStatus = ProcessingStatus | 'skipped';

export interface ProcessingStatusFields {
  processing_status: ProcessingStatus;
  embedding_status: StepStatus;
  graph_status: StepStatus;
  processing_error: string | null;
  processed_at: string | null;
}

export type DisplayStatus = 'idle' | 'pending' | 'processing' | 'error' | 'done';

/**
 * 由 DB 行派生用户可见的整体状态。
 * 任一环节失败 → error；任一环节处理中 → processing；
 * 整体完成且各步骤均 done/skipped → done；否则 pending。
 */
export function deriveDisplayStatus(info: Partial<ProcessingStatusFields> | null | undefined): DisplayStatus {
  if (!info) return 'idle';

  const steps: StepStatus[] = [info.embedding_status || 'pending', info.graph_status || 'pending'];
  const isError = info.processing_status === 'error' || steps.includes('error');
  const isProcessing = info.processing_status === 'processing' || steps.includes('processing');
  const allDone = steps.every((s) => s === 'done' || s === 'skipped');

  if (isError) return 'error';
  if (isProcessing) return 'processing';
  if (info.processing_status === 'done' && allDone) return 'done';
  return 'pending';
}

export const STATUS_LABELS: Record<DisplayStatus, string | null> = {
  idle: null,
  pending: null,
  processing: '处理中',
  error: '处理失败',
  done: '已处理',
};
