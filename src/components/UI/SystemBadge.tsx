import { systemLabel, systemTone, type BadgeTone, type SystemLabelDomain } from '@/lib/ui/systemLabels';

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-white/[0.06] text-[#e5e4e2]/75',
  info: 'bg-sky-400/10 text-sky-200',
  success: 'bg-emerald-400/10 text-emerald-200',
  warning: 'bg-amber-400/10 text-amber-200',
  danger: 'bg-red-400/10 text-red-200',
  brand: 'bg-[#d3bb73]/10 text-[#d3bb73]',
};

export default function SystemBadge({ value, domain = 'status', label, preserveCustom = false, className = '' }: {
  value?: string | null;
  domain?: SystemLabelDomain;
  /** For an already resolved, human-readable label (never a database code). */
  label?: string;
  preserveCustom?: boolean;
  className?: string;
}) {
  return <span className={`inline-flex max-w-full items-center rounded-full px-2 py-1 text-[11px] font-medium leading-4 ${tones[systemTone(value, domain)]} ${className}`}>
    {label || systemLabel(value, domain, { preserveCustom })}
  </span>;
}
