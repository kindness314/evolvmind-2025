import { Loader2, AlertCircle, CheckCircle2 } from 'lucide-react';
import { deriveDisplayStatus, STATUS_LABELS, type DisplayStatus, type ProcessingStatusFields } from '../../../lib/processingStatus';

const STYLES: Record<DisplayStatus, { className: string; Icon: typeof Loader2 | null; spin?: boolean }> = {
  idle: { className: '', Icon: null },
  pending: { className: '', Icon: null },
  processing: { className: 'bg-amber-100 text-amber-700', Icon: Loader2, spin: true },
  error: { className: 'bg-red-100 text-red-700', Icon: AlertCircle },
  done: { className: 'bg-green-100 text-green-700', Icon: CheckCircle2 },
};

export function ProcessingStatusBadge({
  info,
  className = '',
}: {
  info: Partial<ProcessingStatusFields> | null | undefined;
  className?: string;
}) {
  const display = deriveDisplayStatus(info);
  const label = STATUS_LABELS[display];
  if (!label) return null;

  const { className: styleClass, Icon, spin } = STYLES[display];
  return (
    <span
      title={info?.processing_error || undefined}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium flex-none ${styleClass} ${className}`}
      style={{ borderRadius: '4px' }}
    >
      {Icon && <Icon className={`w-3 h-3 ${spin ? 'animate-spin' : ''}`} />}
      {label}
    </span>
  );
}
