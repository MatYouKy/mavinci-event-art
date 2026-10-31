'use client';

import { useId } from 'react';
import { Loader2 } from 'lucide-react';
import type { SellerArrangements } from '@/lib/seller/arrangements';
import { onsiteContactChoices, type OnsiteContact, type OnsiteContactSource } from '@/lib/seller/onsiteContact';
import { useSellerPortalContext } from '@/lib/seller/portal';

const field = 'mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/30';
const text = (value?: string | null) => value?.trim() || '';

export default function SellerOnsiteContactFields({ value, onChange, client, partnerId, companyId, disabled }: {
  value?: OnsiteContact;
  onChange: (value: OnsiteContact) => void;
  client?: SellerArrangements['client'];
  partnerId?: string;
  companyId?: string;
  disabled: boolean;
}) {
  const id = useId();
  const { context, loading } = useSellerPortalContext();
  // Never use a different seller's profile or another brand's business card.
  const ownProfile = context?.profile.id === partnerId ? context : null;
  const person = ownProfile?.profile.person;
  const branding = ownProfile?.brands.find(brand => brand.my_company_id === companyId)?.branding;
  const hasClient = Boolean(client && [client.name, client.company, client.phone, client.email].some(value => text(value)));

  const select = (source: OnsiteContactSource) => {
    const fields = source === 'seller' ? {
      name: text(branding?.display_name) || text(person?.name),
      role: text(branding?.position_title) || text(person?.position) || 'Koordynator na miejscu',
      phone: text(branding?.contact_phone) || text(person?.phone),
      email: text(branding?.contact_email) || text(person?.email),
    } : source === 'client' ? {
      name: text(client?.name), role: 'Klient — kontakt na miejscu',
      phone: text(client?.phone), email: text(client?.email),
    } : { name: '', role: '', phone: '', email: '' };
    onChange({ source, ...fields });
  };

  return <fieldset disabled={disabled} className="min-w-0 space-y-4">
    <legend className="mb-3 text-sm text-white/75">Kto będzie osobą kontaktową na miejscu?</legend>
    <div className="grid gap-2 sm:grid-cols-3">
      {onsiteContactChoices.map(choice => {
        const unavailable = choice.value === 'seller' ? loading : choice.value === 'client' && !hasClient;
        return <label key={choice.value} className={`flex min-h-12 items-center gap-2 rounded-lg p-3 text-sm ${value?.source === choice.value ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-black/15 text-white/70'} ${unavailable || disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-white/5'}`}>
          <input type="radio" name={id + '-source'} value={choice.value} checked={value?.source === choice.value}
            disabled={unavailable} onChange={() => select(choice.value)} className="accent-[#d3bb73]" />
          <span>{choice.label}{choice.value === 'seller' && loading && <Loader2 aria-label="Wczytywanie wizytówki" className="ml-1 inline h-3.5 w-3.5 animate-spin" />}</span>
        </label>;
      })}
    </div>
    {!hasClient && <p className="text-xs text-white/45">Przy tej ofercie nie ma danych klienta. Wybierz osobistą koordynację lub inny kontakt.</p>}
    {value && <>
      <p className="text-xs leading-5 text-white/50">
        {value.source === 'seller' ? 'Dane z Twojej wizytówki. Sprawdź telefon dostępny w dniu wydarzenia.'
          : value.source === 'client' ? `Dane klienta z tej oferty${client?.company ? ': ' + client.company : ''}. Uzupełnij brakujące pola.`
          : 'Podaj dane osoby, z którą zespół będzie mógł skontaktować się na miejscu.'}
        {' '}Możesz poprawić pola poniżej — nie zmieni to wizytówki ani bazy kontaktów.
      </p>
      {value.source === 'seller' && !loading && !ownProfile && <p role="alert" className="text-xs text-amber-200">Nie udało się pobrać Twoich danych. Uzupełnij je ręcznie.</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-white/60">Imię i nazwisko *
          <input required autoComplete="off" maxLength={160} value={value.name} onChange={event => onChange({ ...value, name: event.target.value })} className={field} />
        </label>
        <label className="block text-xs text-white/60">Stanowisko / rola *
          <input required autoComplete="off" maxLength={100} value={value.role} onChange={event => onChange({ ...value, role: event.target.value })} placeholder="np. kierownik recepcji" className={field} />
        </label>
        <label className="block text-xs text-white/60">Telefon *
          <input required type="tel" autoComplete="off" maxLength={50} value={value.phone} onChange={event => onChange({ ...value, phone: event.target.value })} placeholder="np. +48 600 000 000" className={field} />
        </label>
        <label className="block text-xs text-white/60">E-mail (opcjonalnie)
          <input type="email" autoComplete="off" maxLength={254} value={value.email} onChange={event => onChange({ ...value, email: event.target.value })} className={field} />
        </label>
      </div>
    </>}
  </fieldset>;
}
