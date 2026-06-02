'use client';

import { Eye, EyeOff, Star, ExternalLink, MapPin, Building2, Clock } from 'lucide-react';
import type { Tender } from '../page';

interface Props {
  tenders: Tender[];
  loading: boolean;
  onSelect: (tender: Tender) => void;
  onUpdate: (id: string, updates: Partial<Tender>) => void;
}

function getSourceBadge(source: string) {
  const config: Record<string, { label: string; classes: string }> = {
    bzp: { label: 'BZP', classes: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    ted: { label: 'TED', classes: 'bg-green-500/15 text-green-400 border-green-500/30' },
    baza_konkurencyjnosci: {
      label: 'Baza Konkurencyjności',
      classes: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
    },
  };
  const c = config[source] || {
    label: source,
    classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30',
  };
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${c.classes}`}>{c.label}</span>
  );
}

function getStatusBadge(status: string) {
  const config: Record<string, { label: string; classes: string }> = {
    new: { label: 'Nowy', classes: 'bg-[#d3bb73]/10 text-[#d3bb73] border-[#d3bb73]/30' },
    reviewing: { label: 'W analizie', classes: 'bg-blue-500/15 text-blue-400 border-blue-500/30' },
    interested: {
      label: 'Zainteresowany',
      classes: 'bg-green-500/15 text-green-400 border-green-500/30',
    },
    preparing: {
      label: 'Przygotowywanie',
      classes: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    },
    submitted: {
      label: 'Oferta złożona',
      classes: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
    },
    won: { label: 'Wygrana', classes: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
    lost: { label: 'Przegrana', classes: 'bg-red-500/15 text-red-400 border-red-500/30' },
    ignored: { label: 'Zignorowany', classes: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
  };
  const c = config[status] || config.new;
  return (
    <span className={`inline-flex rounded border px-2 py-0.5 text-xs ${c.classes}`}>{c.label}</span>
  );
}

function getScoreColor(score: number) {
  if (score >= 70) return 'text-green-400';
  if (score >= 40) return 'text-[#d3bb73]';
  return 'text-[#e5e4e2]/40';
}

function getScoreBg(score: number) {
  if (score >= 70) return 'bg-green-500/15 border-green-500/30';
  if (score >= 40) return 'bg-[#d3bb73]/10 border-[#d3bb73]/30';
  return 'bg-[#e5e4e2]/5 border-[#e5e4e2]/10';
}

function formatDate(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function daysUntilDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const diff = Math.ceil((new Date(deadline).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  if (diff < 0) return 'Minął';
  if (diff === 0) return 'Dziś';
  if (diff === 1) return '1 dzień';
  return `${diff} dni`;
}

export default function TenderList({ tenders, loading, onSelect, onUpdate }: Props) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
      </div>
    );
  }

  if (tenders.length === 0) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] py-16 text-center">
        <p className="text-[#e5e4e2]/40">Brak przetargów spełniających kryteria</p>
        <p className="mt-2 text-sm text-[#e5e4e2]/25">
          Spróbuj zmienić filtry lub uruchom import danych
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {tenders.map((tender) => {
        const deadlineDays = daysUntilDeadline(tender.submission_deadline);
        const isUrgent =
          tender.submission_deadline &&
          new Date(tender.submission_deadline).getTime() - Date.now() < 7 * 24 * 60 * 60 * 1000 &&
          new Date(tender.submission_deadline).getTime() > Date.now();

        return (
          <div
            key={tender.id}
            className={`group cursor-pointer rounded-xl border bg-[#1c1f33] p-4 transition-all hover:border-[#d3bb73]/40 ${
              tender.manual_relevance === 'relevant' || tender.is_matched
                ? 'border-[#d3bb73]/50 shadow-[0_0_0_1px_rgba(211,187,115,0.12)]'
                : tender.relevance_score >= 70
                  ? 'border-green-500/25'
                  : tender.relevance_score >= 40
                    ? 'border-[#d3bb73]/20'
                    : 'border-[#d3bb73]/10'
            } ${tender.is_hidden ? 'opacity-50' : ''}`}
            onClick={() => onSelect(tender)}
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border ${getScoreBg(tender.relevance_score)}`}
              >
                <span className={`text-sm font-medium ${getScoreColor(tender.relevance_score)}`}>
                  {tender.relevance_score}
                </span>
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-1 flex items-start gap-2">
                  <h3 className="line-clamp-1 flex-1 text-sm font-medium text-[#e5e4e2] group-hover:text-[#d3bb73]">
                    {tender.title || 'Bez tytułu'}
                  </h3>
                  <div className="flex flex-shrink-0 items-center gap-2">
                    {getSourceBadge(tender.source)}
                    {getStatusBadge(tender.status)}
                  </div>
                </div>

                <div className="mb-2 flex flex-wrap items-center gap-3 text-xs text-[#e5e4e2]/50">
                  {tender.contracting_authority && (
                    <span className="flex items-center gap-1">
                      <Building2 className="h-3 w-3" />
                      <span className="max-w-[200px] truncate">{tender.contracting_authority}</span>
                    </span>
                  )}
                  {tender.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {tender.location}
                    </span>
                  )}
                  {tender.submission_deadline && (
                    <span
                      className={`flex items-center gap-1 ${isUrgent ? 'text-orange-400' : ''}`}
                    >
                      <Clock className="h-3 w-3" />
                      Termin: {formatDate(tender.submission_deadline)}
                      {deadlineDays && <span className="ml-1">({deadlineDays})</span>}
                    </span>
                  )}
                  {tender.cpv_codes.length > 0 && (
                    <span className="text-[#e5e4e2]/30">
                      CPV: {tender.cpv_codes.slice(0, 3).join(', ')}
                      {tender.cpv_codes.length > 3 && ` +${tender.cpv_codes.length - 3}`}
                    </span>
                  )}
                </div>

                {tender.description && (
                  <p className="line-clamp-1 text-xs text-[#e5e4e2]/35">{tender.description}</p>
                )}
              </div>

              <div
                className="flex flex-shrink-0 items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => onUpdate(tender.id, { is_watched: !tender.is_watched })}
                  className={`rounded-lg p-2 transition-colors ${
                    tender.is_watched
                      ? 'text-[#d3bb73] hover:bg-[#d3bb73]/10'
                      : 'text-[#e5e4e2]/30 hover:bg-[#d3bb73]/5 hover:text-[#d3bb73]'
                  }`}
                  title={tender.is_watched ? 'Przestań obserwować' : 'Obserwuj'}
                >
                  <Star className={`h-4 w-4 ${tender.is_watched ? 'fill-current' : ''}`} />
                </button>

                <button
                  onClick={() => onUpdate(tender.id, { is_hidden: !tender.is_hidden })}
                  className="rounded-lg p-2 text-[#e5e4e2]/30 transition-colors hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]/60"
                  title={tender.is_hidden ? 'Pokaż' : 'Ukryj'}
                >
                  {tender.is_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                </button>

                <a
                  href={tender.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg p-2 text-[#e5e4e2]/30 transition-colors hover:bg-blue-500/5 hover:text-blue-400"
                  title="Otwórz źródło"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
