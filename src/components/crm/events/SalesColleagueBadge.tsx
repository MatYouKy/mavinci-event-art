import { Users } from 'lucide-react';

/**
 * Oznaczenie wydarzenia sprzedanego przez innego sprzedawcę (podgląd sprzedaży bez kwot i dokumentów).
 * `compact` — sama ikona (np. w małych kafelkach kalendarza), z pełnym opisem w podpowiedzi i dla czytników ekranu.
 */
export default function SalesColleagueBadge({
  seller,
  compact = false,
  className = '',
}: {
  seller?: string | null;
  compact?: boolean;
  className?: string;
}) {
  const description = seller ? `Inny sprzedawca: ${seller}` : 'Inny sprzedawca';
  if (compact) {
    return (
      <span title={description} className={`inline-flex shrink-0 items-center opacity-70 ${className}`}>
        <Users className="h-3 w-3" aria-hidden />
        <span className="sr-only">{description}</span>
      </span>
    );
  }
  return (
    <span
      title={description}
      className={`inline-flex max-w-full shrink-0 items-center gap-1 rounded bg-white/[0.06] px-1.5 py-0.5 text-[10px] font-normal text-[#e5e4e2]/60 ${className}`}
    >
      <Users className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{description}</span>
    </span>
  );
}
