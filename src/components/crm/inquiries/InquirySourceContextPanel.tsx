'use client';

import Link from 'next/link';
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Mail,
  MapPin,
  MessageSquareText,
  Phone,
  Target,
  UserRound,
} from 'lucide-react';
import { useState } from 'react';

type ContextItem = {
  label: string;
  value?: string | null;
  kind?: 'date' | 'location' | 'scope';
};

type InquirySourceContextPanelProps = {
  inquiryTitle: string;
  message?: string | null;
  sourceLabel?: string | null;
  clientName?: string | null;
  clientEmail?: string | null;
  clientPhone?: string | null;
  sourceHref?: string | null;
  items?: ContextItem[];
  defaultOpen?: boolean;
  className?: string;
};

const formatDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('pl-PL', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

const itemIcon = {
  date: CalendarClock,
  location: MapPin,
  scope: Target,
};

export default function InquirySourceContextPanel({
  inquiryTitle,
  message,
  sourceLabel,
  clientName,
  clientEmail,
  clientPhone,
  sourceHref,
  items = [],
  defaultOpen = true,
  className = '',
}: InquirySourceContextPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const visibleItems = items.filter((item) => item.value);

  return (
    <section className={`overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] ${className}`}>
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left hover:bg-[#d3bb73]/5"
        aria-expanded={isOpen}
      >
        <span className="min-w-0">
          <span className="flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
            <MessageSquareText className="h-4 w-4 shrink-0 text-[#d3bb73]" />
            Kontekst zapytania
          </span>
          <span className="mt-1 block truncate text-xs text-[#e5e4e2]/45">{inquiryTitle}</span>
        </span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-[#e5e4e2]/45 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="space-y-4 border-t border-[#d3bb73]/10 px-4 py-4">
          {sourceLabel && (
            <div className="text-[11px] uppercase tracking-[0.12em] text-[#d3bb73]/70">Źródło: {sourceLabel}</div>
          )}

          <div className="space-y-2 text-xs text-[#e5e4e2]/65">
            {clientName && <div className="flex items-start gap-2"><UserRound className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d3bb73]" /><span>{clientName}</span></div>}
            {clientEmail && <a href={`mailto:${clientEmail}`} className="flex items-start gap-2 hover:text-[#d3bb73]"><Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-all">{clientEmail}</span></a>}
            {clientPhone && <a href={`tel:${clientPhone}`} className="flex items-start gap-2 hover:text-[#d3bb73]"><Phone className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{clientPhone}</span></a>}
          </div>

          {visibleItems.length > 0 && (
            <div className="space-y-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
              {visibleItems.map((item) => {
                const Icon = itemIcon[item.kind || 'scope'];
                const value = item.kind === 'date' && item.value ? formatDate(item.value) : item.value;
                return (
                  <div key={`${item.label}-${item.value}`} className="flex items-start gap-2 text-xs">
                    <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d3bb73]" />
                    <span><span className="text-[#e5e4e2]/40">{item.label}: </span><span className="text-[#e5e4e2]/70">{value}</span></span>
                  </div>
                );
              })}
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-medium text-[#e5e4e2]/55">Treść wiadomości</div>
            <div className="max-h-[42vh] overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-xs leading-5 text-[#e5e4e2]/70">
              {message?.trim() || 'Brak zapisanej treści źródłowej.'}
            </div>
          </div>

          {sourceHref && (
            <Link href={sourceHref} className="inline-flex items-center gap-2 text-xs text-[#d3bb73] hover:underline">
              Otwórz wiadomość źródłową <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      )}
    </section>
  );
}
