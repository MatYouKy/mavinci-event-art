'use client';

import SellerDatePicker from '@/app/(public)/seller/_components/SellerDatePicker';
import { sellerInquiryEventTypes, type SellerInquiryValues } from '@/lib/seller/inquiries';

export const sellerInquiryFieldClass = 'mt-1.5 min-h-11 w-full rounded-lg bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none placeholder:text-white/30 focus:border-[#d3bb73]/45 disabled:opacity-50';

/**
 * Shared fields of the quick inquiry ("Sprawdź termin"): the seller portal form
 * and the public QR form send the same values to the database.
 */
export default function SellerInquiryFields({ value, onChange, onDateValidity, disabled = false, compact = false, guestLabel = 'Gość — imię i nazwisko *' }: {
  value: SellerInquiryValues;
  onChange: (patch: Partial<SellerInquiryValues>) => void;
  onDateValidity: (field: 'event_date' | 'event_end_date', valid: boolean) => void;
  disabled?: boolean;
  /** Public form: fewer optional fields are shown by default. */
  compact?: boolean;
  /** Label of the name field. */
  guestLabel?: string;
}) {
  return <fieldset disabled={disabled} className="grid min-w-0 gap-4 sm:grid-cols-2">
    <legend className="sr-only">Dane zapytania</legend>
    <label className="text-xs text-white/60 sm:col-span-2">{guestLabel}
      <input required autoComplete="name" maxLength={200} value={value.guest_name} onChange={(event) => onChange({ guest_name: event.target.value })} className={sellerInquiryFieldClass} placeholder="np. Anna Kowalska" />
    </label>
    <label className="text-xs text-white/60">Telefon
      <input type="tel" inputMode="tel" autoComplete="tel" maxLength={50} value={value.guest_phone} onChange={(event) => onChange({ guest_phone: event.target.value })} className={sellerInquiryFieldClass} placeholder="+48 600 000 000" />
    </label>
    <label className="text-xs text-white/60">E-mail
      <input type="email" inputMode="email" autoComplete="email" maxLength={200} value={value.guest_email} onChange={(event) => onChange({ guest_email: event.target.value })} className={sellerInquiryFieldClass} placeholder="adres@firma.pl" />
    </label>
    <p className="-mt-2 text-[11px] text-white/45 sm:col-span-2">Wystarczy telefon lub e-mail.</p>
    <SellerDatePicker label="Data wydarzenia *" value={value.event_date} onChange={(event_date) => onChange({ event_date })} onValidityChange={(valid) => onDateValidity('event_date', valid)} />
    <SellerDatePicker label="Data zakończenia (opcjonalnie)" value={value.event_end_date} onChange={(event_end_date) => onChange({ event_end_date })} onValidityChange={(valid) => onDateValidity('event_end_date', valid)} />
    <label className="text-xs text-white/60">Liczba gości
      <input type="number" inputMode="numeric" min={1} max={100000} step={1} value={value.guest_count} onChange={(event) => onChange({ guest_count: event.target.value })} className={sellerInquiryFieldClass} placeholder="np. 120" />
    </label>
    <label className="text-xs text-white/60">Rodzaj wydarzenia
      <select value={value.event_type} onChange={(event) => onChange({ event_type: event.target.value as SellerInquiryValues['event_type'] })} className={sellerInquiryFieldClass}>
        <option value="">Wybierz…</option>
        {sellerInquiryEventTypes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
    </label>
    {!compact && <>
      <label className="text-xs text-white/60">Firma gościa
        <input autoComplete="organization" maxLength={200} value={value.guest_company} onChange={(event) => onChange({ guest_company: event.target.value })} className={sellerInquiryFieldClass} placeholder="Opcjonalnie" />
      </label>
      <label className="text-xs text-white/60">Budżet netto (zł)
        <input inputMode="decimal" maxLength={20} value={value.budget_net} onChange={(event) => onChange({ budget_net: event.target.value })} className={sellerInquiryFieldClass} placeholder="Opcjonalnie" />
      </label>
      <label className="text-xs text-white/60 sm:col-span-2">Sala lub miejsce
        <input maxLength={300} value={value.venue_note} onChange={(event) => onChange({ venue_note: event.target.value })} className={sellerInquiryFieldClass} placeholder="np. sala balowa, ogród" />
      </label>
    </>}
    <label className="text-xs text-white/60 sm:col-span-2">{compact ? 'Krótko o wydarzeniu' : 'Czego potrzebuje gość?'}
      <textarea rows={3} maxLength={3000} value={value.note} onChange={(event) => onChange({ note: event.target.value })} className={`${sellerInquiryFieldClass} resize-y`} placeholder={compact ? 'np. wesele, potrzebujemy DJ-a i oświetlenia' : 'np. DJ i oświetlenie, pierwszy taniec, ok. 6 godzin'} />
    </label>
  </fieldset>;
}
