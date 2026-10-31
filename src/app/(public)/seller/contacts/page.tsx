'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Building2, ChevronLeft, ChevronRight, ExternalLink, Loader2, Mail, Pencil, Phone, Plus, RefreshCw, Search, Trash2, User, UserPlus, Users } from 'lucide-react';
import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import SellerContactEditor from '@/components/seller/SellerContactEditor';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { supabase } from '@/lib/supabase/browser';
import { useSellerPortalContext } from '@/lib/seller/portal';
import { loadSellerContacts, sellerContactError, sellerContactName, sellerContactTypeLabel, type SellerContact, type SellerContactFilter, type SellerContactKind, type SellerContactOrganization } from '@/lib/seller/contacts';

const pageSize = 25;
const field = 'min-h-11 w-full rounded-lg border border-white/10 bg-[#0f1119] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/40';
const secondary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-white/5 px-4 py-2.5 text-sm text-white/70 hover:bg-white/10 disabled:opacity-40';
const filters: { id: SellerContactFilter; label: string }[] = [
  { id: 'all', label: 'Wszystkie' }, { id: 'individual', label: 'Indywidualne' },
  { id: 'business', label: 'Firmowe' }, { id: 'organizations', label: 'Organizacje' },
];
type EditorState = { contact?: SellerContact; kind?: SellerContactKind; organization?: SellerContactOrganization };

export default function SellerContactsPage() {
  const { context, loading: contextLoading, error: contextError, reload: reloadContext } = useSellerPortalContext();
  const { showSnackbar } = useSnackbar();
  const [search, setSearch] = useState('');
  const [brandFilter, setBrandFilter] = useState('');
  const [filter, setFilter] = useState<SellerContactFilter>('all');
  const [organization, setOrganization] = useState<SellerContactOrganization | null>(null);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<SellerContact[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionError, setActionError] = useState('');
  const [message, setMessage] = useState('');
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [busy, setBusy] = useState(false);
  const operation = useRef(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    if (!context) return;
    setRows([]); setTotal(0); setError('');
    if (!context.brands.length) { setLoading(false); return; }
    let active = true;
    const controller = new AbortController();
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await loadSellerContacts({
            companyId: organization?.my_company_id || brandFilter, query: search,
            kind: organization ? 'persons' : filter, organizationId: organization?.id,
            limit: pageSize, offset: page * pageSize, signal: controller.signal,
          });
          if (!active) return;
          const lastPage = Math.max(0, Math.ceil(result.total / pageSize) - 1);
          if (page > lastPage) { setPage(lastPage); return; }
          setRows(result.items); setTotal(result.total);
        } catch (cause) {
          if (active) setError(sellerContactError(cause, 'Nie udało się pobrać kontaktów. Spróbuj ponownie.'));
        } finally { if (active) setLoading(false); }
      })();
    }, 250);
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [context, search, brandFilter, filter, organization, page, revision]);

  const refresh = () => { setLoading(true); setError(''); setRevision((value) => value + 1); };
  const openOrganization = (next: SellerContactOrganization) => {
    setOrganization(next); setSearch(''); setPage(0); setLoading(true); setActionError(''); setMessage('');
  };
  const backToOrganizations = () => {
    setOrganization(null); setFilter('organizations'); setSearch(''); setPage(0); setLoading(true);
  };
  const openEditor = (next: EditorState) => { setActionError(''); setMessage(''); setEditor(next); };
  const remove = async (contact: SellerContact) => {
    if (operation.current) return;
    const label = sellerContactName(contact);
    const explanation = contact.kind === 'organization'
      ? 'Organizacja zniknie z aktywnej bazy. Jeśli ma przypisane osoby, najpierw trzeba je przenieść lub odłączyć.'
      : 'Kontakt zniknie z aktywnej bazy i wyboru klienta przy nowych ofertach.';
    if (!window.confirm('Usunąć „' + label + '”?\n\n' + explanation + '\nDane w zapisanych ofertach i PDF-ach pozostaną bez zmian.')) return;
    operation.current = true; setBusy(true); setActionError(''); setMessage('');
    try {
      const { data, error: failed } = await supabase.rpc('delete_seller_portal_contact', { p_contact_id: contact.id, p_revision: contact.revision });
      if (failed) throw failed;
      if (data !== true) throw new Error('Missing deletion confirmation');
      const text = 'Usunięto z aktywnej bazy: ' + label + '. Zapisane oferty pozostały bez zmian.';
      setMessage(text); showSnackbar(text, 'success'); refresh();
    } catch (cause) {
      const text = sellerContactError(cause, 'Nie udało się potwierdzić usunięcia. Odśwież listę, aby sprawdzić aktualny stan.');
      setActionError(text); showSnackbar(text, 'error', 8000);
    } finally { operation.current = false; setBusy(false); }
  };

  if (contextLoading) return <div role="status" className="flex items-center justify-center gap-2 p-10 text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin" />Ładowanie kontaktów…</div>;
  if (!context) return <div className="space-y-4 p-10 text-center text-white/60"><p role="alert">{contextError ? 'Nie udało się wczytać Twojego dostępu do kontaktów.' : 'Brak dostępu do portalu sprzedawcy.'}</p><button type="button" onClick={() => void reloadContext()} className={secondary}>Spróbuj ponownie</button></div>;

  const brandNames = new Map(context.brands.map((brand) => [brand.my_company_id, brand.name]));
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const renderContact = (contact: SellerContact) => {
    const isOrganization = contact.kind === 'organization';
    const Icon = isOrganization ? Building2 : User;
    const organizationRef = { id: contact.id, company: contact.company, my_company_id: contact.my_company_id };
    return <article key={contact.id} className="rounded-xl bg-[#1c1f33] p-4">
      <div className="flex items-start gap-3">
        <Icon aria-hidden="true" className="mt-1 h-5 w-5 shrink-0 text-[#d3bb73]" />
        <div className="min-w-0 flex-1">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="min-w-0">
              <h2 className="break-words text-sm font-medium">{isOrganization
                ? <button type="button" onClick={() => openOrganization(organizationRef)} className="text-left text-[#d3bb73] hover:underline">{contact.company}</button>
                : contact.name}</h2>
              <p className="mt-1 text-xs text-white/45">{sellerContactTypeLabel(contact)}{contact.position ? ' · ' + contact.position : ''}</p>
              {!isOrganization && contact.organization_id && <button type="button" onClick={() => openOrganization({ id: contact.organization_id!, company: contact.organization_name || contact.company, my_company_id: contact.my_company_id })} className="mt-2 inline-flex items-center gap-1.5 text-left text-xs text-[#d3bb73] hover:underline"><Building2 className="h-3.5 w-3.5 shrink-0" />{contact.organization_name || contact.company}</button>}
              {!isOrganization && !contact.organization_id && contact.company && <p className="mt-2 text-xs leading-5 text-white/55">{contact.company}<span className="block text-amber-200/75">Firma wpisana ręcznie — wybierz organizację w edycji.</span></p>}
              {context.brands.length > 1 && <p className="mt-2 text-xs text-white/40">{brandNames.get(contact.my_company_id) || 'Twoja baza klientów'}</p>}
              {isOrganization && <button type="button" onClick={() => openOrganization(organizationRef)} className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#d3bb73] hover:underline"><Users className="h-3.5 w-3.5" />Powiązane osoby: {contact.people_count}</button>}
            </div>
            <div className="min-w-0 space-y-2 text-sm">
              {contact.email && <a href={'mailto:' + encodeURIComponent(contact.email)} className="flex items-center gap-2 text-[#d3bb73] hover:underline"><Mail aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="break-all">{contact.email}</span></a>}
              {contact.phone && <a href={'tel:' + encodeURIComponent(contact.phone.replace(/\s/g, ''))} className="flex items-center gap-2 text-white/70 hover:text-white"><Phone aria-hidden="true" className="h-4 w-4 shrink-0" /><span className="break-words">{contact.phone}</span></a>}
              {!contact.email && !contact.phone && <p className="text-xs text-white/40">Brak telefonu i e-maila</p>}
              {isOrganization && contact.tax_id && <p className="break-words text-xs text-white/55">NIP / identyfikator: {contact.tax_id}</p>}
              {isOrganization && contact.address && <p className="whitespace-pre-wrap break-words text-xs text-white/55">{contact.address}</p>}
              {isOrganization && /^https?:\/\//i.test(contact.website) && <a href={contact.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs text-[#d3bb73] hover:underline"><ExternalLink className="h-3.5 w-3.5" />Strona organizacji</a>}
            </div>
          </div>
        </div>
        <div role="group" aria-label={'Akcje: ' + sellerContactName(contact)} className="shrink-0">
          <ResponsiveActionBar alwaysDropdown compact actions={[
            { label: 'Edytuj', icon: <Pencil className="h-4 w-4" />, disabled: busy, onClick: () => openEditor({ contact }) },
            { label: 'Osoby w organizacji', icon: <Users className="h-4 w-4" />, show: isOrganization, disabled: busy, onClick: () => openOrganization(organizationRef) },
            { label: 'Dodaj osobę do organizacji', icon: <UserPlus className="h-4 w-4" />, show: isOrganization, disabled: busy, onClick: () => openEditor({ organization: organizationRef }) },
            { label: 'Usuń z bazy', icon: <Trash2 className="h-4 w-4" />, variant: 'danger', disabled: busy, onClick: () => void remove(contact) },
          ]} />
        </div>
      </div>
    </article>;
  };

  return <div className="min-h-screen p-4 text-[#e5e4e2] md:p-6">
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="flex items-center gap-3 text-2xl font-light uppercase"><Users className="h-6 w-6 text-[#d3bb73]" />Kontakty</h1><p className="mt-2 text-sm text-white/50">Osoby i organizacje w Twojej prywatnej bazie — dostępne także przy tworzeniu ofert.</p></div>
        <div className="flex flex-wrap gap-2">
          {!organization && <button type="button" disabled={busy || !context.brands.length} onClick={() => openEditor({ kind: 'organization' })} className={secondary}><Building2 className="h-4 w-4" />Dodaj organizację</button>}
          <button type="button" disabled={busy || !context.brands.length} onClick={() => openEditor({ kind: 'person', organization: organization || undefined })} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#111522] disabled:opacity-40"><Plus className="h-4 w-4" />{organization ? 'Dodaj osobę' : 'Dodaj kontakt'}</button>
        </div>
      </header>
      {message && <p role="status" className="rounded-lg bg-emerald-300/10 p-3 text-sm text-emerald-200">{message}</p>}
      {actionError && <p role="alert" className="rounded-lg bg-amber-300/10 p-3 text-sm text-amber-200">{actionError}</p>}
      {busy && <p role="status" className="flex items-center gap-2 text-sm text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin" />Usuwanie z aktywnej bazy…</p>}
      {!context.brands.length ? <p className="rounded-xl bg-white/5 p-5 text-sm text-white/60">Nie masz aktywnego cennika. Poproś opiekuna o przypisanie go w CRM, aby korzystać z bazy klientów.</p> : <>
        {organization ? <section className="space-y-3 rounded-xl bg-[#1c1f33] p-4">
          <button type="button" onClick={backToOrganizations} className="inline-flex items-center gap-2 text-xs text-[#d3bb73]"><ArrowLeft className="h-4 w-4" />Wróć do organizacji</button>
          <h2 className="break-words text-lg">{organization.company}</h2><p className="text-xs text-white/50">Osoby powiązane z tą organizacją w Twojej bazie klientów.</p>
        </section> : <div role="group" aria-label="Rodzaj kontaktów" className="flex flex-wrap gap-2">
          {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id}
            onClick={() => { if (filter !== item.id) { setFilter(item.id); setPage(0); setLoading(true); } }}
            className={'rounded-lg px-4 py-2.5 text-sm ' + (filter === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'bg-white/5 text-white/55 hover:bg-white/10')}>{item.label}</button>)}
        </div>}
        <section aria-label="Wyszukiwanie kontaktów" className="flex flex-wrap gap-3 rounded-xl bg-[#1c1f33] p-4">
          <label className="relative min-w-0 basis-full md:flex-1 md:basis-0"><span className="sr-only">Szukaj kontaktu</span><Search aria-hidden="true" className="absolute left-3 top-3.5 h-4 w-4 text-white/40" />
            <input type="search" maxLength={300} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); setLoading(true); }} placeholder="Szukaj po nazwisku, firmie, e-mailu, telefonie, NIP…" className={field + ' pl-9'} />
          </label>
          {!organization && context.brands.length > 1 && <select aria-label="Baza klientów dla ofert" value={brandFilter} onChange={(event) => { setBrandFilter(event.target.value); setPage(0); setLoading(true); }} className={field + ' md:w-auto'}>
            <option value="">Wszystkie moje bazy klientów</option>{context.brands.map((brand) => <option key={brand.my_company_id} value={brand.my_company_id}>{brand.name}</option>)}
          </select>}
          <button type="button" disabled={loading || busy} onClick={refresh} className={secondary}><RefreshCw className={'h-4 w-4 ' + (loading ? 'animate-spin' : '')} />Odśwież</button>
        </section>
        <div aria-busy={loading}>
          {loading ? <p role="status" className="flex items-center justify-center gap-2 p-10 text-sm text-[#d3bb73]"><Loader2 className="h-4 w-4 animate-spin" />Wczytywanie kontaktów…</p>
            : error ? <div role="alert" className="space-y-3 rounded-xl bg-amber-300/10 p-5 text-sm text-amber-200"><p>{error}</p><button type="button" onClick={refresh} className={secondary}>Spróbuj ponownie</button></div>
            : !rows.length ? <div className="space-y-2 rounded-xl bg-[#1c1f33] p-10 text-center"><p className="text-sm text-white/70">{organization ? 'Brak powiązanych osób spełniających kryteria.' : 'Brak kontaktów spełniających kryteria.'}</p><p className="text-xs text-white/45">{organization ? 'Dodaj osobę lub przypisz istniejący kontakt do tej organizacji w jego edycji.' : 'Zmień filtry albo dodaj osobę lub organizację.'}</p></div>
            : <>
              <p role="status" className="mb-3 text-xs text-white/45">Wpisy: {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} z {total}</p>
              <div className="space-y-3">{rows.map(renderContact)}</div>
              {pages > 1 && <nav aria-label="Strony kontaktów" className="mt-4 flex items-center justify-center gap-3">
                <button type="button" disabled={page === 0} onClick={() => { setPage((value) => value - 1); setLoading(true); }} className={secondary}><ChevronLeft className="h-4 w-4" /><span className="sr-only sm:not-sr-only">Poprzednie</span></button>
                <span className="text-sm text-white/55">{page + 1} / {pages}</span>
                <button type="button" disabled={page + 1 >= pages} onClick={() => { setPage((value) => value + 1); setLoading(true); }} className={secondary}><span className="sr-only sm:not-sr-only">Następne</span><ChevronRight className="h-4 w-4" /></button>
              </nav>}
            </>}
        </div>
      </>}
    </div>
    {editor && <SellerContactEditor brands={context.brands} contact={editor.contact} initialKind={editor.kind}
      organization={editor.organization} initialBrandId={brandFilter} onClose={() => setEditor(null)} onSaved={(companyId) => {
        setEditor(null); setSearch(''); setPage(0);
        if (brandFilter && brandFilter !== companyId) setBrandFilter(companyId);
        if (!organization) setFilter('all');
        const text = 'Zapisano dane w Twojej bazie. Wcześniejsze oferty i PDF-y pozostały bez zmian.';
        setMessage(text); showSnackbar(text, 'success'); refresh();
      }} />}
  </div>;
}
