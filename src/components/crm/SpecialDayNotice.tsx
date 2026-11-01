'use client';

import { AlertTriangle, CalendarX2, Info } from 'lucide-react';
import { usePublicHolidays } from '@/hooks/usePublicHolidays';
import { specialDaysInRange } from '@/lib/CRM/calendar/publicHolidays';

const TONE = {
  danger: 'border-red-400/30 bg-red-500/[0.08] text-red-200',
  warning: 'border-amber-400/30 bg-amber-500/[0.08] text-amber-200',
  info: 'border-sky-400/25 bg-sky-500/[0.07] text-sky-200',
} as const;

/**
 * Informacja przy dacie zapytania lub wydarzenia: dzień ustawowo wolny, niedziela, długi weekend,
 * dzień między świętem a weekendem, Sylwester. Zwykły dzień roboczy — nic nie pokazuje.
 */
export default function SpecialDayNotice({ from, to, className = '' }: { from?: string | null; to?: string | null; className?: string }) {
  const { holidays } = usePublicHolidays(from, to);
  const days = specialDaysInRange(from, to, holidays);
  if (days.length === 0) return null;
  const shown = days.slice(0, 3);
  return (
    <div className={`space-y-1.5 ${className}`} role="status">
      {shown.map((day) => {
        const Icon = day.tone === 'danger' ? CalendarX2 : day.tone === 'warning' ? AlertTriangle : Info;
        return (
          <div key={day.date} className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5 ${TONE[day.tone]}`}>
            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{day.message}</span>
          </div>
        );
      })}
      {days.length > shown.length && (
        <p className="text-[11px] text-[#e5e4e2]/50">…i jeszcze {days.length - shown.length} nietypowych dni w tym zakresie.</p>
      )}
    </div>
  );
}
