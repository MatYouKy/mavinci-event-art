'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Building2, Check, Loader2, Search, User, X } from 'lucide-react';
import SearchCombobox from '@/components/crm/SearchCombobox';
import { fetchCompanyDataFromGUS } from '@/lib/gus';
import { formatSellerAddress, hasSellerAddress, normalizeSellerAddress, sellerAddressError, sellerAddressFromRegistry, sellerAddressTypes, suggestSellerAddress, type SellerAddressParts } from '@/lib/seller/contactAddress';
import { supabase } from '@/lib/supabase/browser';
import type { SellerPortalBrand } from '@/lib/seller/portal';
import { loadSellerContacts, sellerContactError, type SellerContact, type SellerContactKind, type SellerContactOrganization } from '@/lib/seller/contacts';

const field = 'mt-1.5 min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/40';
const secondary = 'rounded-lg bg-white/5 px-4 py-2.5 text-sm text-white/70 hover:bg-white/10 disabled:opacity-40';
type Draft = {
  companyId: string; kind: SellerContactKind; business: boolean; organizationId: string;
  name: string; company: string; email: string; phone: string;
  position: string; tax_id: string; address: string; website: string;
  addressParts: SellerAddressParts; addressStructured: boolean;
};

export default function SellerContactEditor({ brands, contact, initialBrandId = '', initialKind = 'person', organization, onClose, onSaved }: {
  brands: SellerPortalBrand[];
  contact?: SellerContact;
  initialBrandId?: string;
  initialKind?: SellerContactKind;
  organization?: SellerContactOrganization | null;
  onClose: () => void;
  onSaved: (companyId: string) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => ({
    companyId: contact?.my_company_id || organization?.my_company_id || initialBrandId || (brands.length === 1 ? brands[0].my_company_id : ''),
    kind: contact?.kind || (organization ? 'person' : initialKind),
    business: Boolean(organization || (contact?.kind === 'person' && (contact.organization_id || contact.company))),
    organizationId: contact?.organization_id || organization?.id || '',
    name: contact?.name || '', company: contact?.organization_id ? '' : contact?.company || '',
    email: contact?.email || '', phone: contact?.phone || '', position: contact?.position || '',
    tax_id: contact?.tax_id || '', address: contact?.address || '', website: contact?.website || '',
    addressParts: contact?.address_parts ? normalizeSellerAddress(contact.address_parts) : suggestSellerAddress(contact?.address),
    addressStructured: Boolean(contact?.address_parts),
  }));
  const initial = useRef(JSON.stringify(draft));
  const dirty = initial.current !== JSON.stringify(draft);
  const dialog = useRef<HTMLDialogElement>(null);
  const errorElement = useRef<HTMLParagraphElement>(null);
  const lock = useRef(false);
  const requestId = useRef<string | null>(contact?.id || null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const nipRequest = useRef<AbortController | null>(null);
  const [nipLoading, setNipLoading] = useState(false);
  const [nipError, setNipError] = useState('');
  const [nipMessage, setNipMessage] = useState('');
  const [registryAddress, setRegistryAddress] = useState<SellerAddressParts | null>(null);
  const [organizationQuery, setOrganizationQuery] = useState('');
  const [organizations, setOrganizations] = useState<SellerContactOrganization[]>([]);
  const [chosenOrganization, setChosenOrganization] = useState<SellerContactOrganization | null>(() => organization
    || (contact?.organization_id ? { id: contact.organization_id, company: contact.organization_name || contact.company, my_company_id: contact.my_company_id } : null));
  const [organizationsLoading, setOrganizationsLoading] = useState(false);
  const [organizationsError, setOrganizationsError] = useState('');
  const [organizationRetry, setOrganizationRetry] = useState(0);
  const cancelNipLookup = () => {
    nipRequest.current?.abort();
    nipRequest.current = null;
    setNipLoading(false); setNipError(''); setNipMessage(''); setRegistryAddress(null);
  };
  const change = (patch: Partial<Draft>) => {
    if ('tax_id' in patch || 'kind' in patch || 'companyId' in patch) cancelNipLookup();
    setDraft((current) => ({ ...current, ...patch }));
  };

  const changeAddress = (patch: Partial<SellerAddressParts>) => setDraft((current) => ({
    ...current, addressParts: { ...current.addressParts, ...patch }, addressStructured: true,
  }));
  const addressPreview = draft.addressStructured ? formatSellerAddress(draft.addressParts) : draft.address;

  useEffect(() => () => {
    nipRequest.current?.abort();
    nipRequest.current = null;
  }, []);

  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (element && !element.open) element.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { if (error) errorElement.current?.focus(); }, [error]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  useEffect(() => {
    if (draft.kind !== 'person' || !draft.business || !draft.companyId) return;
    let active = true;
    const controller = new AbortController();
    setOrganizationsLoading(true); setOrganizationsError(''); setOrganizations([]);
    const timer = window.setTimeout(() => {
      void loadSellerContacts({ companyId: draft.companyId, kind: 'organizations', query: organizationQuery, limit: 30, signal: controller.signal })
        .then((data) => { if (active) setOrganizations(data.items); })
        .catch((cause) => { if (active) setOrganizationsError(sellerContactError(cause, 'Nie udało się wczytać organizacji. Spróbuj ponownie.')); })
        .finally(() => { if (active) setOrganizationsLoading(false); });
    }, 250);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [draft.kind, draft.business, draft.companyId, organizationQuery, organizationRetry]);

  const close = () => {
    if (lock.current) return;
    if (!dirty || window.confirm('Porzucić niezapisane zmiany kontaktu?')) {
      cancelNipLookup();
      onClose();
    }
  };
  const lookupNip = async () => {
    if (lock.current || nipRequest.current || draft.kind !== 'organization') return;
    const nip = draft.tax_id.trim().replace(/^PL[\s-]*/i, '').replace(/[\s-]/g, '');
    setNipError(''); setNipMessage(''); setRegistryAddress(null); setError('');
    if (!/^\d{10}$/.test(nip)) {
      setNipError('Podaj polski NIP: 10 cyfr, opcjonalnie ze spacjami, myślnikami lub prefiksem PL. Dane firmy zagranicznej wpisz ręcznie.');
      return;
    }
    const controller = new AbortController();
    nipRequest.current = controller;
    const started = { ...draft };
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, 60_000);
    setNipLoading(true);
    try {
      const data = await fetchCompanyDataFromGUS(nip, { signal: controller.signal });
      if (nipRequest.current !== controller) return;
      if (!data?.name?.trim()) throw new Error('Nie znaleziono danych firmy dla tego NIP. Sprawdź numer lub uzupełnij dane ręcznie.');
      if (data.nip && data.nip.replace(/\D/g, '') !== nip) throw new Error('Rejestr zwrócił dane dla innego NIP. Dane formularza nie zostały zmienione. Spróbuj ponownie.');
      const addressParts = sellerAddressFromRegistry(data);
      if (hasSellerAddress(addressParts)) setRegistryAddress(addressParts);
      let website = '';
      if (data.website?.trim()) {
        try {
          const raw = data.website.trim();
          const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(raw) ? raw : `https://${raw}`);
          if (['http:', 'https:'].includes(url.protocol) && url.hostname && !url.username && !url.password) website = url.href;
        } catch { /* An unusable registry URL must not replace the manually entered website. */ }
      }
      const values = {
        tax_id: nip, company: data.name.trim(),
        email: data.email?.trim() || '', phone: data.phone?.trim() || '', website,
      };
      setDraft((current) => {
        if (current.kind !== 'organization' || current.tax_id !== started.tax_id || current.companyId !== started.companyId) return current;
        const next = { ...current };
        for (const key of Object.keys(values) as Array<keyof typeof values>) {
          // Keep edits made while the registry request was running, and never clear missing values.
          if (values[key] && current[key] === started[key]) next[key] = values[key];
        }
        // Address components must remain an atomic set: never mix a new building
        // with an apartment from the previously entered address.
        if (!current.address.trim() && !hasSellerAddress(current.addressParts)
          && current.addressStructured === started.addressStructured
          && JSON.stringify(current.addressParts) === JSON.stringify(started.addressParts)
          && hasSellerAddress(addressParts)) {
          next.addressParts = addressParts;
          next.addressStructured = true;
        }
        return next;
      });
      setNipMessage('Pobrano dane firmy z rejestrów. Sprawdź je przed zapisem. Jeśli rejestr podaje inny adres niż wpisany, możesz wybrać go w sekcji adresu poniżej.');
    } catch (cause) {
      if (nipRequest.current !== controller) return;
      const message = timedOut
        ? 'Rejestry nie odpowiedziały na czas. Spróbuj ponownie lub wpisz dane ręcznie.'
        : cause instanceof Error && !(cause instanceof TypeError) && !(cause instanceof SyntaxError)
          ? cause.message
          : 'Nie udało się pobrać danych firmy. Sprawdź połączenie i spróbuj ponownie lub wpisz dane ręcznie.';
      setNipError(`${message} Wpisane dane pozostają w formularzu.`);
    } finally {
      window.clearTimeout(timeout);
      if (nipRequest.current === controller) {
        nipRequest.current = null;
        setNipLoading(false);
      }
    }
  };
  const choices = chosenOrganization?.my_company_id === draft.companyId && !organizations.some((item) => item.id === chosenOrganization.id)
    ? [chosenOrganization, ...organizations] : organizations;
  const legacyCompany = contact?.kind === 'person' && !contact.organization_id && contact.company
    && draft.company === contact.company;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (lock.current || nipRequest.current) return;
    setError('');
    if (!brands.some((brand) => brand.my_company_id === draft.companyId)) { setError('Wybierz bazę klientów.'); return; }
    if (draft.kind === 'person' && !draft.name.trim()) { setError('Podaj imię i nazwisko osoby.'); return; }
    if (draft.kind === 'organization' && !draft.company.trim()) { setError('Podaj nazwę organizacji.'); return; }
    if (draft.kind === 'person' && draft.business && !draft.organizationId && !legacyCompany) { setError('Wybierz organizację z listy. Jeśli jeszcze jej nie ma, dodaj ją najpierw w zakładce Organizacje.'); return; }
    const addressParts = draft.kind === 'organization' && draft.addressStructured ? normalizeSellerAddress(draft.addressParts) : null;
    const invalidAddress = addressParts ? sellerAddressError(addressParts) : '';
    if (invalidAddress) { setError(invalidAddress); return; }
    requestId.current ||= crypto.randomUUID();
    const values = {
      id: requestId.current, kind: draft.kind,
      organization_id: draft.kind === 'person' && draft.business ? draft.organizationId || null : null,
      name: draft.kind === 'person' ? draft.name.trim() : '',
      company: draft.kind === 'organization' || (draft.business && !draft.organizationId) ? draft.company.trim() : '',
      email: draft.email.trim().toLowerCase(), phone: draft.phone.trim(),
      position: draft.kind === 'person' && draft.business ? draft.position.trim() : '',
      tax_id: draft.kind === 'organization' ? draft.tax_id.trim() : '',
      address: draft.kind === 'organization' ? addressParts ? formatSellerAddress(addressParts) : draft.address.trim() : '',
      address_parts: addressParts,
      website: draft.kind === 'organization' ? draft.website.trim() : '',
    };
    lock.current = true; setSaving(true);
    try {
      const { data, error: failed } = await supabase.rpc('save_seller_portal_contact_v2', {
        p_company_id: draft.companyId, p_contact: values, p_revision: contact?.revision || 0,
      });
      if (failed) throw failed;
      if (!data) throw new Error('Missing save confirmation');
    } catch (cause) {
      setError(sellerContactError(cause, 'Nie udało się potwierdzić zapisu. Dane pozostają w formularzu. Ponowienie z tymi samymi danymi nie utworzy drugiego kontaktu.'));
      return;
    } finally { lock.current = false; setSaving(false); }
    onSaved(draft.companyId);
  };

  return <dialog ref={dialog} aria-labelledby="seller-contact-editor-title"
    onCancel={(event) => { event.preventDefault(); close(); }}
    className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-2xl overflow-y-auto rounded-2xl border-0 bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/65">
    <header className="flex items-center justify-between gap-4 p-5 pb-0">
      <h2 id="seller-contact-editor-title" className="text-xl font-light uppercase">{contact ? 'Edytuj ' : 'Dodaj '}{draft.kind === 'organization' ? 'organizację' : 'kontakt'}</h2>
      <button type="button" disabled={saving} onClick={close} aria-label="Zamknij formularz" className="rounded-lg p-2 text-white/60 hover:bg-white/5 disabled:opacity-40"><X className="h-5 w-5" /></button>
    </header>
    <form onSubmit={submit} className="space-y-5 p-5">
      <p className="text-sm leading-6 text-white/55">Twoja prywatna baza klientów. Zmiany nie nadpisują danych we wcześniej zapisanych ofertach ani PDF-ach.</p>
      {error && <p ref={errorElement} role="alert" tabIndex={-1} className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200 outline-none">{error}</p>}
      <fieldset disabled={saving} className="min-w-0 space-y-4">
        {!contact && !organization && <div role="group" aria-label="Typ wpisu" className="flex flex-wrap gap-2">
          {([{ id: 'person', label: 'Osoba', icon: User }, { id: 'organization', label: 'Organizacja / firma', icon: Building2 }] as const).map((item) => <button key={item.id} type="button" aria-pressed={draft.kind === item.id} onClick={() => change({ kind: item.id })}
            className={'flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm ' + (draft.kind === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-white/60')}><item.icon className="h-4 w-4" />{item.label}</button>)}
        </div>}
        {brands.length > 1 && <label className="block text-xs text-white/55">Baza klientów dla ofert
          <select required disabled={Boolean(contact || organization)} value={draft.companyId} onChange={(event) => { change({ companyId: event.target.value, organizationId: '' }); setChosenOrganization(null); setOrganizationQuery(''); }} className={field}>
            <option value="" disabled>Wybierz bazę klientów</option>{brands.map((brand) => <option key={brand.my_company_id} value={brand.my_company_id}>{brand.name}</option>)}
          </select>
        </label>}
        {draft.kind === 'person' ? <>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs text-white/55">Imię i nazwisko<input required autoComplete="name" maxLength={300} value={draft.name} onChange={(event) => change({ name: event.target.value })} className={field} /></label>
            <label className="text-xs text-white/55">Rodzaj kontaktu<select value={draft.business ? 'business' : 'individual'} onChange={(event) => {
              const business = event.target.value === 'business'; change(business ? { business } : { business, organizationId: '', company: '' }); if (!business) setChosenOrganization(null);
            }} className={field}><option value="individual">Indywidualny</option><option value="business">Firmowy — osoba w organizacji</option></select></label>
          </div>
          {draft.business && <div className="space-y-2 rounded-xl bg-white/[0.025] p-3">
            <p className="text-xs text-white/55">Organizacja osoby</p>
            <SearchCombobox value={draft.organizationId} disabled={!draft.companyId || saving} loading={organizationsLoading}
              options={choices.map((item) => ({ id: item.id, label: item.company }))} filterOption={() => true}
              ariaLabel="Organizacja osoby" placeholder="Wyszukaj organizację w swojej bazie…" emptyLabel={organizationsError ? 'Nie udało się wczytać organizacji' : 'Brak organizacji — dodaj ją najpierw w Kontaktach'}
              onSearchChange={(query) => { if (query !== organizationQuery) { setOrganizationQuery(query); setOrganizationsLoading(true); } }}
              onChange={(id) => { change({ organizationId: id, company: '' }); setChosenOrganization(choices.find((item) => item.id === id) || null); }} />
            {organizationsError && <p role="alert" className="text-xs text-amber-200">{organizationsError} <button type="button" onClick={() => setOrganizationRetry((value) => value + 1)} className="underline">Spróbuj ponownie</button></p>}
            {legacyCompany && !draft.organizationId && <p className="text-xs leading-5 text-amber-200">Wcześniej wpisana firma: {contact?.company}. Nie jest jeszcze powiązana z organizacją. Możesz zachować tę nazwę przy edycji lub wskazać organizację powyżej.</p>}
            <label className="block text-xs text-white/55">Stanowisko / rola<input maxLength={160} autoComplete="organization-title" value={draft.position} onChange={(event) => change({ position: event.target.value })} className={field} placeholder="np. koordynator wydarzeń" /></label>
          </div>}
        </> : <>
          <div className="space-y-2 rounded-xl bg-white/[0.025] p-3">
            <label htmlFor="seller-contact-nip" className="block text-xs text-white/55">NIP / identyfikator podatkowy</label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
              <input id="seller-contact-nip" maxLength={40} value={draft.tax_id} onChange={(event) => change({ tax_id: event.target.value })}
                aria-describedby={'seller-contact-nip-help' + (nipError || nipMessage ? ' seller-contact-nip-feedback' : '')}
                placeholder="Wpisz NIP firmy" className={field + ' !mt-0 min-w-0 flex-1'} />
              <button type="button" onClick={lookupNip} disabled={nipLoading || !draft.tax_id.trim()}
                className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] hover:bg-[#c4a859] disabled:opacity-40">
                {nipLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                {nipLoading ? 'Pobieranie…' : 'Pobierz dane po NIP'}
              </button>
            </div>
            <p id="seller-contact-nip-help" className="text-xs leading-5 text-white/50">GUS / rejestry — uzupełnij nazwę, adres i dostępne dane kontaktowe. Przed zapisem możesz je poprawić.</p>
            {nipLoading && <p role="status" className="text-xs text-white/60">Pobieranie danych firmy… <button type="button" onClick={cancelNipLookup} className="text-[#d3bb73] underline">Anuluj pobieranie</button></p>}
            {nipError && <p id="seller-contact-nip-feedback" role="alert" className="text-xs leading-5 text-amber-200">{nipError}</p>}
            {nipMessage && <p id="seller-contact-nip-feedback" role="status" className="text-xs leading-5 text-emerald-300">{nipMessage}</p>}
          </div>
          <label className="block text-xs text-white/55">Nazwa firmy / organizacji<input required autoComplete="organization" maxLength={300} value={draft.company} onChange={(event) => change({ company: event.target.value })} className={field} /></label>
          <label className="block text-xs text-white/55">Strona WWW<input type="url" maxLength={500} placeholder="https://…" value={draft.website} onChange={(event) => change({ website: event.target.value })} className={field} /></label>
          <div role="group" aria-labelledby="seller-organization-address-title" className="space-y-3 rounded-xl bg-white/[0.025] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="seller-organization-address-title" className="text-sm font-medium">Adres organizacji</h3>
              {(addressPreview || hasSellerAddress(draft.addressParts)) && <button type="button" onClick={() => changeAddress(normalizeSellerAddress())} className="text-xs text-white/55 hover:text-white">Wyczyść adres</button>}
            </div>
            {contact?.address && !contact.address_parts && <div className="space-y-1 rounded-lg bg-white/5 p-3 text-xs leading-5 text-white/65">
              <p className="whitespace-pre-wrap">Dotychczasowy zapis: {contact.address}</p>
              <p>{draft.addressStructured ? 'Po zapisaniu zastąpią go dane z poniższych pól.' : 'Sprawdź podpowiedzi w polach. Dotychczasowy adres zachowamy bez zmian, dopóki nie zatwierdzisz podziału lub nie zmienisz pól.'}</p>
              {!draft.addressStructured && hasSellerAddress(draft.addressParts) && <button type="button" onClick={() => changeAddress({})} className="text-[#d3bb73] underline">Zatwierdź rozdzielone pola</button>}
            </div>}
            {registryAddress && formatSellerAddress(registryAddress) !== addressPreview && <div className="space-y-2 rounded-lg bg-[#d3bb73]/10 p-3 text-xs leading-5">
              <p className="text-white/70">Adres z rejestru: {formatSellerAddress(registryAddress)}</p>
              <button type="button" onClick={() => changeAddress(registryAddress)} className="text-[#d3bb73] underline">Użyj tego adresu</button>
            </div>}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs text-white/55">Prefiks<select value={draft.addressParts.type} onChange={(event) => changeAddress({ type: event.target.value })} className={field}>
                {Object.entries(sellerAddressTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select></label>
              <label className="text-xs text-white/55">Ulica / miejscowość bez ulicy<input maxLength={200} autoComplete="address-line1" placeholder="np. Długa lub Ługwałd" value={draft.addressParts.name} onChange={(event) => changeAddress({ name: event.target.value })} className={field} /></label>
              <label className="text-xs text-white/55">Numer budynku<input maxLength={20} placeholder="np. 12A" value={draft.addressParts.house} onChange={(event) => changeAddress({ house: event.target.value })} className={field} /></label>
              <label className="text-xs text-white/55">Numer lokalu — opcjonalnie<input maxLength={20} placeholder="np. 4" value={draft.addressParts.apartment} onChange={(event) => changeAddress({ apartment: event.target.value })} className={field} /></label>
              <label className="text-xs text-white/55">Kod pocztowy<input maxLength={20} autoComplete="postal-code" placeholder="00-000" value={draft.addressParts.postal_code} onChange={(event) => changeAddress({ postal_code: event.target.value })} className={field} /></label>
              <label className="text-xs text-white/55">Miejscowość<input maxLength={120} autoComplete="address-level2" value={draft.addressParts.city} onChange={(event) => changeAddress({ city: event.target.value })} className={field} /></label>
              <label className="text-xs text-white/55 sm:col-span-2">Kraj<input maxLength={80} autoComplete="country-name" placeholder="Polska" value={draft.addressParts.country} onChange={(event) => changeAddress({ country: event.target.value })} className={field} /></label>
            </div>
            <p className="text-xs leading-5 text-white/45">Dla adresu bez ulicy wybierz „Bez prefiksu” i wpisz nazwę miejscowości. Numer lokalu pozostaw pusty, jeśli go nie ma. Cały adres jest opcjonalny; jeśli go podajesz, uzupełnij pozostałe pola.</p>
            {addressPreview && <p className="break-words text-xs leading-5 text-white/65">Podgląd: {addressPreview}</p>}
          </div>
        </>}
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-xs text-white/55">{draft.kind === 'organization' ? 'E-mail organizacji' : 'E-mail osoby'}<input type="email" autoComplete="email" maxLength={320} value={draft.email} onChange={(event) => change({ email: event.target.value })} className={field} /></label>
          <label className="text-xs text-white/55">Telefon<input type="tel" autoComplete="tel" maxLength={80} value={draft.phone} onChange={(event) => change({ phone: event.target.value })} className={field} /></label>
        </div>
      </fieldset>
      <footer className="flex flex-wrap justify-end gap-2">
        <button type="button" disabled={saving} onClick={close} className={secondary}>Anuluj</button>
        <button type="submit" disabled={saving || nipLoading || !draft.companyId || (Boolean(contact) && !dirty)} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] disabled:opacity-40">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{saving ? 'Zapisywanie…' : 'Zapisz'}
        </button>
      </footer>
    </form>
  </dialog>;
}
