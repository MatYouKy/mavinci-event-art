'use client';

/**
 * Wspólne elementy interfejsu CRM dla sprzedawców zewnętrznych (kokpit opiekuna, karta sprzedawcy,
 * kontakty i organizacje). Wyłącznie warstwa prezentacji — reguły dostępu wymusza baza (RPC / RLS).
 */
import type { ReactNode } from 'react';
import { Loader2, X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import {
  SELLER_PORTAL_ACCOUNT_LABELS,
  type SellerCockpitChat,
  type SellerCockpitReview,
  type SellerCockpitWizardStep,
  type SellerPortalAccount,
} from '@/lib/seller/sellerCockpit';

export const sellerFieldClass =
  'w-full rounded-lg bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none ring-1 ring-white/[0.06] placeholder:text-[#e5e4e2]/25 focus:ring-[#d3bb73]/30 disabled:opacity-50';
export const sellerPanelClass = 'rounded-2xl bg-[#1c1f33] p-5';
export const sellerInsetClass = 'rounded-xl bg-[#0f1119]/70';
export const sellerPrimaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] transition-colors hover:bg-[#dfca8b] disabled:cursor-not-allowed disabled:opacity-50';
export const sellerSecondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-white/[0.05] px-4 py-2.5 text-sm text-[#e5e4e2]/75 transition-colors hover:bg-white/[0.09] disabled:cursor-not-allowed disabled:opacity-50';

/** Status profilu sprzedawcy — te same etykiety co w ustawieniach sprzedawcy. */
export const SELLER_PROFILE_STATUS_LABELS: Record<string, string> = {
  active: 'Aktywny',
  onboarding: 'Do uzgodnienia',
  inactive: 'Nieaktywny',
};
const statusTone: Record<string, string> = {
  active: 'bg-emerald-400/10 text-emerald-200',
  onboarding: 'bg-amber-400/10 text-amber-200',
  inactive: 'bg-white/[0.06] text-white/50',
};
const portalTone: Record<SellerPortalAccount, string> = {
  active: 'bg-sky-400/10 text-sky-200',
  invited: 'bg-amber-400/10 text-amber-200',
  none: 'bg-white/[0.06] text-white/45',
};

export function errorText(error: unknown, fallback: string): string {
  if (error && typeof error === 'object' && 'message' in error && typeof (error as { message: unknown }).message === 'string') {
    const message = (error as { message: string }).message.trim();
    if (message) return message;
  }
  return fallback;
}

/** Błędy RLS / brak wiersza zwracane po angielsku — czytelny polski opis + oryginalny komunikat. */
export function sellerWriteErrorText(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code === '42501') return `Brak uprawnień do tej zmiany — dotyczy tylko Twoich sprzedawców (opiekun, zastępca) albo administratora. (${error.message || error.code})`;
  if (error.code === 'PGRST116') return 'Nie zapisano zmian: nie masz uprawnień do tego sprzedawcy albo jego profil już nie istnieje.';
  return error.message || fallback;
}

export const isMissingRpc = (error: { code?: string } | null | undefined) => ['PGRST202', '42883'].includes(error?.code || '');

const toDate = (value: string | null | undefined) => {
  if (!value) return null;
  // `YYYY-MM-DD` traktujemy jako datę lokalną (bez przesunięcia strefy).
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

export function formatSellerDate(value: string | null | undefined, empty = '—'): string {
  const date = toDate(value);
  return date ? date.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' }) : empty;
}

export function formatSellerDateTime(value: string | null | undefined, empty = '—'): string {
  const date = toDate(value);
  return date ? date.toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : empty;
}

/** „dziś”, „wczoraj”, „5 dni temu” — dla ostatniej aktywności i logowania. */
export function formatSellerRelative(value: string | null | undefined, empty = 'nigdy'): string {
  const date = toDate(value);
  if (!date) return empty;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000);
  if (days <= 0) return `dziś, ${date.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}`;
  if (days === 1) return 'wczoraj';
  if (days < 30) return `${days} dni temu`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'miesiąc temu' : `${months} mies. temu`;
  return formatSellerDate(value);
}

/** Dni do daty wydarzenia: „dziś”, „jutro”, „za 4 dni”. */
export function formatDaysUntil(value: string | null | undefined): string {
  const date = toDate(value);
  if (!date) return 'bez terminu';
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(date) - startOfDay(new Date())) / 86_400_000);
  if (days < 0) return `${Math.abs(days)} dni temu`;
  if (days === 0) return 'dziś';
  if (days === 1) return 'jutro';
  return `za ${days} dni`;
}

export const sellerPln = (value: number | null | undefined, digits = 0) =>
  new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN', minimumFractionDigits: digits, maximumFractionDigits: digits })
    .format(Number(value || 0));

/** Karta sprzedawcy: z kontaktem — zakładka w kartotece kontaktu, bez kontaktu — widok w module Sprzedawcy. */
export function sellerCardHref(seller: { id: string; contact_id?: string | null }, section?: string): string {
  const base = seller.contact_id ? `/crm/contacts/${seller.contact_id}?tab=seller` : `/crm/salespeople?seller=${seller.id}`;
  return section ? `${base}&section=${section}` : base;
}

export function sellerReviewHref(review: Pick<SellerCockpitReview, 'offer_id' | 'document_id'>): string {
  return review.document_id
    ? `/crm/offers/${review.offer_id}?document=${review.document_id}&preview=1#seller-offer-review`
    : `/crm/offers/${review.offer_id}#seller-offer-review`;
}

export function sellerWizardHref(step: Pick<SellerCockpitWizardStep, 'offer_id' | 'event_id'>): string {
  return step.event_id ? `/crm/events/${step.event_id}?tab=seller-arrangements` : `/crm/offers/${step.offer_id}`;
}

/** Rozmowa otwiera się tam, gdzie dziś: w zakładce sprzedawcy kontaktu albo w widoku sprzedawcy. */
export function sellerChatHref(chat: Pick<SellerCockpitChat, 'contact_id' | 'sales_partner_id' | 'conversation_id'>): string {
  const conversation = encodeURIComponent(chat.conversation_id);
  return chat.contact_id
    ? `/crm/contacts/${chat.contact_id}?tab=seller&section=chat&conversation=${conversation}`
    : `/crm/salespeople?seller=${chat.sales_partner_id}&section=chat&conversation=${conversation}`;
}

export function SellerStatusPill({ status, className = '' }: { status: string; className?: string }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${statusTone[status] || statusTone.inactive} ${className}`}>
    {SELLER_PROFILE_STATUS_LABELS[status] || 'Status nieznany'}
  </span>;
}

export function PortalAccountPill({ account, enabled = true, className = '' }: { account: SellerPortalAccount; enabled?: boolean; className?: string }) {
  if (!enabled) return <span className={`inline-flex items-center rounded-full bg-white/[0.04] px-2 py-0.5 text-[11px] text-white/40 ${className}`}>Portal wyłączony</span>;
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${portalTone[account]} ${className}`}>
    {SELLER_PORTAL_ACCOUNT_LABELS[account]}
  </span>;
}

export function SellerCountChip({ count, tone = 'brand' }: { count: number; tone?: 'brand' | 'warning' | 'muted' }) {
  if (!count) return null;
  const tones = { brand: 'bg-[#d3bb73] text-[#111522]', warning: 'bg-amber-300 text-[#111522]', muted: 'bg-white/10 text-white/70' };
  return <span className={`inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold leading-5 ${tones[tone]}`}>{count > 99 ? '99+' : count}</span>;
}

/** Prosty dialog CRM (bez obramowań; tło, cień, przyciemnienie). */
export function SellerDialog({ open, title, description, onClose, children, footer, busy = false, wide = false }: {
  open: boolean;
  title: string;
  description?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
  footer?: ReactNode;
  busy?: boolean;
  wide?: boolean;
}) {
  if (!open) return null;
  return <OverlayPortal>
    <div data-app-overlay="true" className="fixed inset-0 z-[120] flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-[#1c1f33] p-6 text-[#e5e4e2] shadow-[0_24px_80px_rgba(0,0,0,0.55)] sm:rounded-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-lg'}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium">{title}</h2>
            {description && <div className="mt-1.5 text-sm leading-6 text-white/55">{description}</div>}
          </div>
          <button type="button" onClick={onClose} disabled={busy} aria-label="Zamknij" className="rounded-lg p-1.5 text-white/50 hover:bg-white/5 hover:text-white disabled:opacity-40"><X className="h-5 w-5" /></button>
        </div>
        {children && <div className="mt-5 space-y-4">{children}</div>}
        {footer && <div className="mt-6 flex flex-wrap justify-end gap-2">{footer}</div>}
      </div>
    </div>
  </OverlayPortal>;
}

export function SellerLoading({ label }: { label: string }) {
  return <div role="status" className="flex items-center gap-2 rounded-2xl bg-[#1c1f33] p-6 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />{label}</div>;
}

export function SellerError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <div role="alert" className="rounded-2xl bg-amber-300/[0.07] p-5 text-sm text-amber-100/85">
    <p>{message}</p>
    {onRetry && <button type="button" onClick={onRetry} className="mt-3 rounded-lg bg-white/5 px-3 py-2 text-[#d3bb73] hover:bg-white/10">Spróbuj ponownie</button>}
  </div>;
}
