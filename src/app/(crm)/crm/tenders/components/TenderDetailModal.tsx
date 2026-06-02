'use client';

import { useState } from 'react';
import {
  X,
  ExternalLink,
  MapPin,
  Building2,
  Clock,
  Calendar,
  Star,
  EyeOff,
  Eye,
  ThumbsUp,
  ThumbsDown,
  Save,
} from 'lucide-react';
import type { Tender } from '../page';

interface Props {
  tender: Tender;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Tender>) => void;
}

const STATUS_OPTIONS = [
  { value: 'new', label: 'Nowy' },
  { value: 'reviewing', label: 'W analizie' },
  { value: 'interested', label: 'Zainteresowany' },
  { value: 'preparing', label: 'Przygotowywanie oferty' },
  { value: 'submitted', label: 'Oferta złożona' },
  { value: 'won', label: 'Wygrana' },
  { value: 'lost', label: 'Przegrana' },
  { value: 'ignored', label: 'Zignorowany' },
];

function formatDate(date: string | null) {
  if (!date) return '—';
  return new Date(date).toLocaleDateString('pl-PL', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function getScoreBar(score: number) {
  const color = score >= 70 ? 'bg-green-400' : score >= 40 ? 'bg-[#d3bb73]' : 'bg-[#e5e4e2]/30';
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 rounded-full bg-[#0a0d1a]">
        <div className={`h-2 rounded-full ${color}`} style={{ width: `${score}%` }} />
      </div>
      <span
        className={`text-lg font-medium ${score >= 70 ? 'text-green-400' : score >= 40 ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`}
      >
        {score}/100
      </span>
    </div>
  );
}

export default function TenderDetailModal({ tender, onClose, onUpdate }: Props) {
  const [notes, setNotes] = useState(tender.notes || '');
  const [status, setStatus] = useState(tender.status);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    await onUpdate(tender.id, { notes, status });
    setSaving(false);
  };

  const handleManualRelevance = (value: 'relevant' | 'irrelevant' | null) => {
    onUpdate(tender.id, { manual_relevance: value });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 pt-12">
      <div className="w-full max-w-3xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-6 py-4">
          <h2 className="text-lg font-light text-[#e5e4e2]">Szczegóły przetargu</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-[#e5e4e2]/40 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">
          <h3 className="mb-4 text-base font-medium text-[#e5e4e2]">{tender.title}</h3>

          <div className="mb-4">
            <label className="mb-1 block text-xs text-[#e5e4e2]/50">Ocena trafności</label>
            {getScoreBar(tender.relevance_score)}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                <Building2 className="h-3 w-3" /> Zamawiający
              </div>
              <div className="text-sm text-[#e5e4e2]">{tender.contracting_authority || '—'}</div>
            </div>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                <MapPin className="h-3 w-3" /> Lokalizacja
              </div>
              <div className="text-sm text-[#e5e4e2]">{tender.location || '—'}</div>
            </div>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                <Calendar className="h-3 w-3" /> Data publikacji
              </div>
              <div className="text-sm text-[#e5e4e2]">{formatDate(tender.publication_date)}</div>
            </div>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3">
              <div className="mb-1 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                <Clock className="h-3 w-3" /> Termin składania ofert
              </div>
              <div className="text-sm text-[#e5e4e2]">{formatDate(tender.submission_deadline)}</div>
            </div>
          </div>

          {tender.cpv_codes.length > 0 && (
            <div className="mb-4">
              <label className="mb-2 block text-xs text-[#e5e4e2]/50">Kody CPV</label>
              <div className="flex flex-wrap gap-1.5">
                {tender.cpv_codes.map((cpv, i) => (
                  <span
                    key={i}
                    className="rounded border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-2 py-0.5 text-xs text-[#d3bb73]"
                  >
                    {cpv}
                  </span>
                ))}
              </div>
            </div>
          )}

          {tender.estimated_value > 0 && (
            <div className="mb-4">
              <label className="mb-1 block text-xs text-[#e5e4e2]/50">Szacowana wartość</label>
              <div className="text-sm text-[#d3bb73]">
                {tender.estimated_value.toLocaleString('pl-PL', { minimumFractionDigits: 2 })}{' '}
                {tender.currency}
              </div>
            </div>
          )}

          {tender.description && (
            <div className="mb-5">
              <label className="mb-1 block text-xs text-[#e5e4e2]/50">Opis</label>
              <div className="max-h-40 overflow-y-auto rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3 text-sm leading-relaxed text-[#e5e4e2]/70">
                {tender.description}
              </div>
            </div>
          )}

          <div className="mb-4 border-t border-[#d3bb73]/10 pt-4">
            <label className="mb-2 block text-xs text-[#e5e4e2]/50">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73]/40 focus:outline-none"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-xs text-[#e5e4e2]/50">Notatki</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/40 focus:outline-none"
              placeholder="Dodaj notatki..."
            />
          </div>

          <div className="mb-4">
            <label className="mb-2 block text-xs text-[#e5e4e2]/50">Ocena manualna</label>
            <div className="flex gap-2">
              <button
                onClick={() =>
                  handleManualRelevance(tender.manual_relevance === 'relevant' ? null : 'relevant')
                }
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  tender.manual_relevance === 'relevant'
                    ? 'border-green-500/40 bg-green-500/10 text-green-400'
                    : 'border-[#d3bb73]/15 text-[#e5e4e2]/50 hover:border-green-500/30'
                }`}
              >
                <ThumbsUp className="h-4 w-4" /> Trafny
              </button>
              <button
                onClick={() =>
                  handleManualRelevance(
                    tender.manual_relevance === 'irrelevant' ? null : 'irrelevant',
                  )
                }
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                  tender.manual_relevance === 'irrelevant'
                    ? 'border-red-500/40 bg-red-500/10 text-red-400'
                    : 'border-[#d3bb73]/15 text-[#e5e4e2]/50 hover:border-red-500/30'
                }`}
              >
                <ThumbsDown className="h-4 w-4" /> Nietrafny
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-[#d3bb73]/10 px-6 py-4">
          <div className="flex gap-2">
            <button
              onClick={() => onUpdate(tender.id, { is_watched: !tender.is_watched })}
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors ${
                tender.is_watched
                  ? 'border-[#d3bb73]/40 bg-[#d3bb73]/10 text-[#d3bb73]'
                  : 'border-[#d3bb73]/15 text-[#e5e4e2]/50 hover:border-[#d3bb73]/30'
              }`}
            >
              <Star className={`h-4 w-4 ${tender.is_watched ? 'fill-current' : ''}`} />
              {tender.is_watched ? 'Obserwowany' : 'Obserwuj'}
            </button>
            <button
              onClick={() => onUpdate(tender.id, { is_hidden: !tender.is_hidden })}
              className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/15 px-3 py-2 text-sm text-[#e5e4e2]/50 hover:border-red-500/30 hover:text-red-400"
            >
              {tender.is_hidden ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              {tender.is_hidden ? 'Pokaż' : 'Ukryj'}
            </button>
            {tender.source_url && (
              <a
                href={tender.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/15 px-3 py-2 text-sm text-[#e5e4e2]/50 hover:border-blue-500/30 hover:text-blue-400"
              >
                <ExternalLink className="h-4 w-4" /> Otwórz źródło
              </a>
            )}
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
        </div>
      </div>
    </div>
  );
}
