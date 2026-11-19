'use client';

import {
  SOCIAL_CONSENT_LABELS, SOCIAL_CONSENT_SOURCE_LABELS, socialConsentAllows, socialPostStatusLabel,
  type SocialConsentStatus, type SocialPostStatus,
} from '@/lib/social/socialShared';
import type { SocialConsentState } from './socialApi';

/* Wspólne elementy widoków social media w CRM (kolory statusów, plakietki, daty). */

export const cardClass = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]';
export const inputClass = 'w-full rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73]/40 disabled:opacity-50';
export const buttonClass = 'inline-flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40';
export const primaryButton = `${buttonClass} bg-[#d3bb73] font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90`;
export const secondaryButton = `${buttonClass} border border-[#d3bb73]/20 bg-[#d3bb73]/5 text-[#d3bb73] hover:bg-[#d3bb73]/15`;
export const dangerButton = `${buttonClass} border border-red-400/25 bg-red-500/10 text-red-300 hover:bg-red-500/20`;

export const POST_STATUS_CLASSES: Record<SocialPostStatus, string> = {
  draft: 'border-[#e5e4e2]/20 bg-[#e5e4e2]/5 text-[#e5e4e2]/70',
  in_review: 'border-amber-400/30 bg-amber-400/10 text-amber-200',
  changes_requested: 'border-orange-400/30 bg-orange-500/10 text-orange-200',
  approved: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200',
  scheduled: 'border-sky-400/30 bg-sky-400/10 text-sky-200',
  publishing: 'border-sky-400/40 bg-sky-400/15 text-sky-100 animate-pulse',
  failed: 'border-red-400/40 bg-red-500/15 text-red-200',
  published: 'border-[#d3bb73]/40 bg-[#d3bb73]/15 text-[#d3bb73]',
  cancelled: 'border-red-400/20 bg-red-500/5 text-red-300/70',
};

export function PostStatusBadge({ status, title }: { status: SocialPostStatus; title?: string | null }) {
  return (
    <span title={title || undefined} className={`inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] ${POST_STATUS_CLASSES[status] || POST_STATUS_CLASSES.draft}`}>
      {socialPostStatusLabel(status)}
    </span>
  );
}

export function ConsentBadge({ consent, compact = false }: { consent: SocialConsentState; compact?: boolean }) {
  const ok = socialConsentAllows(consent.status);
  const denied = consent.status === 'denied';
  const label = SOCIAL_CONSENT_LABELS[(consent.status in SOCIAL_CONSENT_LABELS ? consent.status : 'unknown') as SocialConsentStatus];
  return (
    <span title={`Zgoda klienta: ${label} (${SOCIAL_CONSENT_SOURCE_LABELS[consent.source]})`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${ok ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-200' : denied ? 'border-red-400/30 bg-red-500/10 text-red-200' : 'border-amber-400/30 bg-amber-400/10 text-amber-200'}`}>
      {compact ? (ok ? 'Zgoda ✓' : denied ? 'Brak zgody' : 'Zgoda ?') : `Zgoda: ${label}`}
    </span>
  );
}

const pad = (value: number) => String(value).padStart(2, '0');

/** ISO → wartość pola `datetime-local` (czas lokalny przeglądarki). */
export function toLocalInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Wartość pola `datetime-local` → ISO albo `null`. */
export function fromLocalInput(value: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export const dayKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export function timeLabel(value: string | null) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function shortDate(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function dateTimeLabel(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const errorMessage = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
