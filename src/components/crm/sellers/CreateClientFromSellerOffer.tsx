'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Building2, CheckCircle2, Loader2, UserPlus, UserRound } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SellerDialog, errorText, sellerPrimaryButton, sellerSecondaryButton } from './sellerUi';

type Preview = {
  contact: Record<string, unknown> | null;
  organization: Record<string, unknown> | null;
  matches: { contact_id?: string | null; organization_id?: string | null };
};
type Result = { contact_id: string | null; organization_id: string | null; created: boolean };

/** Znane pola podglądu z polskimi etykietami; pozostałych (kody, identyfikatory) nie pokazujemy. */
const CONTACT_FIELDS: [string, string][] = [
  ['full_name', 'Imię i nazwisko'], ['first_name', 'Imię'], ['last_name', 'Nazwisko'], ['email', 'E-mail'],
  ['phone', 'Telefon'], ['mobile', 'Telefon komórkowy'], ['position', 'Stanowisko'], ['city', 'Miasto'],
];
const ORGANIZATION_FIELDS: [string, string][] = [
  ['name', 'Nazwa'], ['alias', 'Nazwa skrócona'], ['nip', 'NIP'], ['email', 'E-mail'], ['phone', 'Telefon'],
  ['address', 'Adres'], ['postal_code', 'Kod pocztowy'], ['city', 'Miasto'],
];

function Fields({ data, fields }: { data: Record<string, unknown>; fields: [string, string][] }) {
  const rows = fields.filter(([key]) => {
    const value = data[key];
    return (typeof value === 'string' && value.trim()) || typeof value === 'number';
  });
  // full_name zastępuje imię i nazwisko — bez powtórzeń.
  const visible = rows.filter(([key]) => !(data.full_name && (key === 'first_name' || key === 'last_name')));
  if (!visible.length) return <p className="text-xs text-white/40">Brak danych w ofercie.</p>;
  return <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-[auto_1fr]">
    {visible.map(([key, label]) => <div key={key} className="contents"><dt className="text-xs text-white/40 sm:pt-0.5">{label}</dt><dd className="break-words">{String(data[key])}</dd></div>)}
  </dl>;
}

/**
 * „Utwórz klienta z danych oferty” — oferta z portalu sprzedawcy (create_client_from_seller_offer).
 * Najpierw podgląd (p_confirm = false), po potwierdzeniu utworzenie / powiązanie kontaktu i organizacji.
 */
export default function CreateClientFromSellerOffer({ offerId, linkedContactId, onDone }: {
  offerId: string;
  linkedContactId?: string | null;
  onDone?: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState<'preview' | 'confirm' | null>(null);
  const [error, setError] = useState('');

  const loadPreview = async () => {
    if (busy) return;
    setOpen(true);
    setResult(null);
    setPreview(null);
    setError('');
    setBusy('preview');
    const { data, error: rpcError } = await supabase.rpc('create_client_from_seller_offer', { p_offer: offerId, p_confirm: false });
    setBusy(null);
    if (rpcError) { setError(errorText(rpcError, 'Nie udało się przygotować podglądu klienta.')); return; }
    const raw = (data && typeof data === 'object' ? data : {}) as Partial<Preview>;
    setPreview({
      contact: raw.contact && typeof raw.contact === 'object' ? raw.contact : null,
      organization: raw.organization && typeof raw.organization === 'object' ? raw.organization : null,
      matches: raw.matches && typeof raw.matches === 'object' ? raw.matches : {},
    });
  };

  const confirm = async () => {
    if (busy) return;
    setBusy('confirm');
    setError('');
    const { data, error: rpcError } = await supabase.rpc('create_client_from_seller_offer', { p_offer: offerId, p_confirm: true });
    setBusy(null);
    if (rpcError) {
      const message = errorText(rpcError, 'Nie udało się utworzyć klienta.');
      setError(message);
      showSnackbar(message, 'error');
      return;
    }
    const raw = (data && typeof data === 'object' ? data : {}) as Partial<Result>;
    const next = { contact_id: raw.contact_id || null, organization_id: raw.organization_id || null, created: raw.created === true };
    setResult(next);
    showSnackbar(next.created ? 'Utworzono klienta i powiązano go z ofertą.' : 'Oferta została powiązana z istniejącym klientem.', 'success');
    onDone?.();
  };

  const nothingToCreate = preview && !preview.contact && !preview.organization;

  return <>
    <button type="button" onClick={() => void loadPreview()} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#d3bb73] no-underline hover:bg-[#d3bb73]/25">
      <UserPlus className="h-4 w-4" />{linkedContactId ? 'Uzupełnij klienta z danych oferty' : 'Utwórz klienta z danych oferty'}
    </button>
    <SellerDialog
      open={open}
      busy={busy === 'confirm'}
      wide
      onClose={() => setOpen(false)}
      title={result ? 'Klient zapisany w CRM' : 'Utwórz klienta z danych oferty'}
      description={result ? undefined : 'Dane klienta wpisane przez sprzedawcę trafią do kartoteki CRM. Istniejący kontakt lub organizacja zostaną powiązane zamiast duplikowania; puste dane klienta w wydarzeniu zostaną uzupełnione.'}
      footer={result
        ? <button type="button" onClick={() => setOpen(false)} className={sellerPrimaryButton}>Zamknij</button>
        : <>
          <button type="button" onClick={() => setOpen(false)} disabled={busy === 'confirm'} className={sellerSecondaryButton}>Anuluj</button>
          <button type="button" onClick={() => void confirm()} disabled={Boolean(busy) || !preview || Boolean(nothingToCreate)} className={sellerPrimaryButton}>
            {busy === 'confirm' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Utwórz i powiąż
          </button>
        </>}
    >
      {busy === 'preview' && <p className="flex items-center gap-2 text-sm text-white/55"><Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />Sprawdzamy dane oferty i kartotekę CRM…</p>}
      {error && <p role="alert" className="rounded-xl bg-red-400/10 p-3 text-sm text-red-100">{error}</p>}
      {result && <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-xl bg-emerald-400/10 p-3 text-sm text-emerald-100"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{result.created ? 'Utworzono nowego klienta i powiązano go z ofertą.' : 'Oferta została powiązana z klientem, który już był w CRM.'}</p>
        <div className="flex flex-wrap gap-2">
          {result.contact_id && <Link href={`/crm/contacts/${result.contact_id}`} className={sellerSecondaryButton}><UserRound className="h-4 w-4" />Otwórz kontakt</Link>}
          {result.organization_id && <Link href={`/crm/contacts/${result.organization_id}`} className={sellerSecondaryButton}><Building2 className="h-4 w-4" />Otwórz organizację</Link>}
        </div>
      </div>}
      {!result && preview && <div className="grid gap-3 md:grid-cols-2">
        <section className="rounded-xl bg-[#0f1119]/70 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><UserRound className="h-4 w-4 text-[#d3bb73]" />Osoba kontaktowa</h3>
          {preview.matches.contact_id
            ? <p className="mb-3 rounded-lg bg-sky-400/10 px-3 py-2 text-xs text-sky-100">Taki kontakt już jest w CRM — oferta zostanie z nim powiązana. <Link href={`/crm/contacts/${preview.matches.contact_id}`} target="_blank" className="underline">Podgląd</Link></p>
            : preview.contact && <p className="mb-3 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">Zostanie utworzony nowy kontakt.</p>}
          {preview.contact ? <Fields data={preview.contact} fields={CONTACT_FIELDS} /> : <p className="text-xs text-white/40">Sprzedawca nie podał osoby kontaktowej.</p>}
        </section>
        <section className="rounded-xl bg-[#0f1119]/70 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-medium"><Building2 className="h-4 w-4 text-[#d3bb73]" />Organizacja</h3>
          {preview.matches.organization_id
            ? <p className="mb-3 rounded-lg bg-sky-400/10 px-3 py-2 text-xs text-sky-100">Ta organizacja już jest w CRM — zostanie powiązana. <Link href={`/crm/contacts/${preview.matches.organization_id}`} target="_blank" className="underline">Podgląd</Link></p>
            : preview.organization && <p className="mb-3 rounded-lg bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">Zostanie utworzona nowa organizacja.</p>}
          {preview.organization ? <Fields data={preview.organization} fields={ORGANIZATION_FIELDS} /> : <p className="text-xs text-white/40">Klient indywidualny — bez organizacji.</p>}
        </section>
        {nothingToCreate && <p className="md:col-span-2 rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">Oferta nie zawiera danych klienta, z których można utworzyć kontakt.</p>}
      </div>}
    </SellerDialog>
  </>;
}
