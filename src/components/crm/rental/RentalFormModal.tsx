'use client';

import { useEffect, useMemo, useState } from 'react';
import { Building2, Search, User, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  RENTAL_HANDOVER_LABELS,
  rentalErrorMessage,
  rentalIsoFromLocal,
  rentalLocalInput,
  saveRental,
  type RentalAccess,
  type RentalDetail,
  type RentalHandover,
  type RentalSaveData,
} from '@/lib/CRM/rental/rental';
import { RentalError, RentalField, RentalModal, numberOrNull, rentalInput, rentalPrimaryButton, rentalButton } from './rentalUi';

/*
 * Nowe wypożyczenie i zmiana danych (klient, termin, odbierający, przekazanie, opiekun, firma, kaucja, rabat, uwagi) — `rental_save`.
 * Po wydaniu nie zmienia się daty wydania ani sposobu przekazania, po zwrocie — terminu (pola zablokowane).
 */

type ClientHit = { kind: 'organization' | 'contact'; id: string; name: string };
type Option = { id: string; name: string };

const tomorrowAt = (hour: number, plusDays = 1) => {
  const now = new Date();
  const local = rentalLocalInput(now.toISOString()).slice(0, 10);
  const [y, m, d] = local.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + plusDays));
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00`;
};

export default function RentalFormModal({
  rental,
  access,
  onClose,
  onSaved,
}: {
  rental?: RentalDetail | null;
  access: RentalAccess;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const editing = Boolean(rental);
  const issued = rental ? ['issued', 'returned'].includes(rental.status) : false;
  const returned = rental?.status === 'returned';
  const canSeller = access.admin || access.sales_all;

  const [client, setClient] = useState<ClientHit | null>(
    rental?.organization_id ? { kind: 'organization', id: rental.organization_id, name: rental.organization_name || rental.client_name }
      : rental?.contact_id ? { kind: 'contact', id: rental.contact_id, name: rental.contact_name || rental.client_name } : null,
  );
  const [clientName, setClientName] = useState(rental && !rental.organization_id && !rental.contact_id ? rental.client_name : '');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<ClientHit[]>([]);
  const [title, setTitle] = useState(rental?.title || '');
  const [startsAt, setStartsAt] = useState(rental ? rentalLocalInput(rental.starts_at) : tomorrowAt(10));
  const [endsAt, setEndsAt] = useState(rental ? rentalLocalInput(rental.ends_at) : tomorrowAt(12, 3));
  const [recipientName, setRecipientName] = useState(rental?.recipient_name || '');
  const [recipientPhone, setRecipientPhone] = useState(rental?.recipient_phone || '');
  const [handover, setHandover] = useState<RentalHandover>(rental?.handover || 'pickup');
  const [address, setAddress] = useState(rental?.delivery_address || '');
  const [sellerId, setSellerId] = useState(rental?.seller_id || access.employee_id || '');
  const [companyId, setCompanyId] = useState(rental?.my_company_id || '');
  const [deposit, setDeposit] = useState(rental?.sales ? String(rental.sales.deposit_amount ?? 0) : '0');
  const [discount, setDiscount] = useState(rental?.sales ? String(rental.sales.discount_percent ?? 0) : '0');
  const [vat, setVat] = useState(rental?.sales ? String(rental.sales.vat_rate ?? 23) : '23');
  const [salesNote, setSalesNote] = useState(rental?.sales?.sales_note || '');
  const [warehouseNote, setWarehouseNote] = useState(rental?.warehouse_note || '');
  const [sellers, setSellers] = useState<Option[]>([]);
  const [companies, setCompanies] = useState<Option[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const [companyRows, employeeRows] = await Promise.all([
        supabase.from('my_companies').select('id, name').order('name'),
        canSeller ? supabase.from('employees').select('id, name, surname').eq('is_active', true).order('name') : Promise.resolve({ data: [] as any[] }),
      ]);
      if (!alive) return;
      setCompanies(((companyRows.data || []) as any[]).map((row) => ({ id: String(row.id), name: String(row.name || '') })));
      setSellers(((employeeRows.data || []) as any[]).map((row) => ({ id: String(row.id), name: `${row.name || ''} ${row.surname || ''}`.trim() })));
    })();
    return () => {
      alive = false;
    };
  }, [canSeller]);

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) {
      setHits([]);
      return;
    }
    let alive = true;
    const timer = setTimeout(async () => {
      const pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
      const [organizations, contacts] = await Promise.all([
        supabase.from('organizations').select('id, name').ilike('name', pattern).order('name').limit(8),
        supabase.from('contacts').select('id, full_name, first_name, last_name').ilike('full_name', pattern).order('full_name').limit(8),
      ]);
      if (!alive) return;
      setHits([
        ...((organizations.data || []) as any[]).map((row) => ({ kind: 'organization' as const, id: String(row.id), name: String(row.name || '') })),
        ...((contacts.data || []) as any[]).map((row) => ({
          kind: 'contact' as const, id: String(row.id), name: String(row.full_name || `${row.first_name || ''} ${row.last_name || ''}`).trim(),
        })),
      ]);
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query]);

  const startIso = useMemo(() => rentalIsoFromLocal(startsAt), [startsAt]);
  const endIso = useMemo(() => rentalIsoFromLocal(endsAt), [endsAt]);

  const submit = async () => {
    setError(null);
    if (!client && !clientName.trim()) return setError('Wskaż klienta z bazy albo wpisz nazwę klienta.');
    if (!startIso || !endIso) return setError('Podaj datę i godzinę wydania oraz zwrotu.');
    if (new Date(endIso) <= new Date(startIso)) return setError('Zwrot musi być po wydaniu.');
    if (handover === 'delivery' && !address.trim()) return setError('Podaj adres dostawy.');
    const data: RentalSaveData = {
      title: title.trim(),
      organization_id: client?.kind === 'organization' ? client.id : null,
      contact_id: client?.kind === 'contact' ? client.id : null,
      client_name: client ? client.name : clientName.trim(),
      recipient_name: recipientName.trim() || null,
      recipient_phone: recipientPhone.trim() || null,
      sales_note: salesNote.trim() || null,
      warehouse_note: warehouseNote.trim() || null,
      deposit_amount: numberOrNull(deposit) ?? 0,
      discount_percent: numberOrNull(discount) ?? 0,
      vat_rate: numberOrNull(vat) ?? 23,
    };
    if (!issued) {
      data.starts_at = startIso;
      data.handover = handover;
    }
    if (!returned) data.ends_at = endIso;
    data.delivery_address = handover === 'delivery' ? address.trim() : null;
    if (companyId) data.my_company_id = companyId;
    if (canSeller && sellerId) data.seller_id = sellerId;
    setSaving(true);
    try {
      const id = await saveRental(supabase, rental?.id || null, data);
      showSnackbar(editing ? 'Zapisano zmiany wypożyczenia' : 'Utworzono wypożyczenie', 'success');
      onSaved(id);
    } catch (failure) {
      setError(rentalErrorMessage(failure));
    } finally {
      setSaving(false);
    }
  };

  return (
    <RentalModal
      title={editing ? 'Dane wypożyczenia' : 'Nowe wypożyczenie'}
      subtitle={rental ? `${rental.number}${rental.title ? ` · ${rental.title}` : ''}` : 'Klient, termin i sposób przekazania. Po utworzeniu wybierzesz sprzęt z katalogu magazynu.'}
      onClose={onClose}
      footer={
        <>
          <button type="button" className={rentalButton} onClick={onClose} disabled={saving}>Anuluj</button>
          <button type="button" className={rentalPrimaryButton} onClick={submit} disabled={saving}>
            {saving ? 'Zapisywanie…' : editing ? 'Zapisz' : 'Utwórz wypożyczenie'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <RentalError message={error} />
        <RentalField label="Klient">
          {client ? (
            <div className="flex items-center justify-between gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#e5e4e2]">
              <span className="flex min-w-0 items-center gap-2">
                {client.kind === 'organization' ? <Building2 className="h-4 w-4 shrink-0 text-[#d3bb73]" /> : <User className="h-4 w-4 shrink-0 text-[#d3bb73]" />}
                <span className="truncate">{client.name}</span>
              </span>
              <button type="button" onClick={() => setClient(null)} className="rounded p-1 text-[#e5e4e2]/60 hover:text-[#e5e4e2]" aria-label="Zmień klienta">
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" aria-hidden />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj organizacji lub osoby w bazie…" className={`${rentalInput} pl-9`} />
              </div>
              {hits.length > 0 && (
                <ul className="max-h-48 overflow-y-auto rounded-lg border border-white/10 bg-[#0a0d1a]">
                  {hits.map((hit) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button type="button" onClick={() => { setClient(hit); setQuery(''); setHits([]); }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[#e5e4e2] hover:bg-white/5">
                        {hit.kind === 'organization' ? <Building2 className="h-4 w-4 text-[#d3bb73]" /> : <User className="h-4 w-4 text-[#d3bb73]" />}
                        <span className="truncate">{hit.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input value={clientName} onChange={(event) => setClientName(event.target.value)} placeholder="…albo nazwa klienta spoza bazy" className={rentalInput} />
            </div>
          )}
        </RentalField>
        <RentalField label="Nazwa wypożyczenia" hint="Np. „Dekoracje — wesele 12.12”. Widać ją na liście i w powiadomieniach.">
          <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} className={rentalInput} />
        </RentalField>
        <div className="grid gap-3 sm:grid-cols-2">
          <RentalField label="Wydanie" hint={issued ? 'Sprzęt został wydany.' : undefined}>
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={issued} className={rentalInput} />
          </RentalField>
          <RentalField label="Planowany zwrot" hint={returned ? 'Sprzęt został zwrócony.' : undefined}>
            <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={returned} className={rentalInput} />
          </RentalField>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <RentalField label="Odbierający">
            <input value={recipientName} onChange={(event) => setRecipientName(event.target.value)} placeholder="Imię i nazwisko" className={rentalInput} />
          </RentalField>
          <RentalField label="Telefon odbierającego">
            <input value={recipientPhone} onChange={(event) => setRecipientPhone(event.target.value)} inputMode="tel" className={rentalInput} />
          </RentalField>
        </div>
        <RentalField label="Przekazanie sprzętu">
          <div className="flex rounded-lg border border-white/10 p-0.5" role="radiogroup" aria-label="Przekazanie sprzętu">
            {(['pickup', 'delivery'] as RentalHandover[]).map((value) => (
              <button key={value} type="button" role="radio" aria-checked={handover === value} disabled={issued} onClick={() => setHandover(value)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm ${handover === value ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2]/70 hover:bg-white/5'} disabled:opacity-60`}>
                {RENTAL_HANDOVER_LABELS[value]}
              </button>
            ))}
          </div>
        </RentalField>
        {handover === 'delivery' && (
          <RentalField label="Adres dostawy" hint="Pojazd i godziny dostawy oraz odbioru ustawisz w sekcji „Dostawa i odbiór”.">
            <textarea value={address} onChange={(event) => setAddress(event.target.value)} rows={2} className={rentalInput} />
          </RentalField>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {companies.length > 1 && (
            <RentalField label="Firma">
              <select value={companyId} onChange={(event) => setCompanyId(event.target.value)} className={rentalInput}>
                <option value="">Domyślna</option>
                {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            </RentalField>
          )}
          {canSeller && sellers.length > 0 && (
            <RentalField label="Opiekun (sprzedaż)">
              <select value={sellerId} onChange={(event) => setSellerId(event.target.value)} className={rentalInput}>
                {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
              </select>
            </RentalField>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <RentalField label="Kaucja (zł)">
            <input value={deposit} onChange={(event) => setDeposit(event.target.value)} inputMode="decimal" className={rentalInput} />
          </RentalField>
          <RentalField label="Rabat na całość (%)">
            <input value={discount} onChange={(event) => setDiscount(event.target.value)} inputMode="decimal" className={rentalInput} />
          </RentalField>
          <RentalField label="VAT (%)">
            <input value={vat} onChange={(event) => setVat(event.target.value)} inputMode="decimal" className={rentalInput} />
          </RentalField>
        </div>
        <RentalField label="Uwagi sprzedaży" hint="Widzi tylko sprzedaż.">
          <textarea value={salesNote} onChange={(event) => setSalesNote(event.target.value)} rows={2} className={rentalInput} />
        </RentalField>
        <RentalField label="Uwagi dla magazynu" hint="Widzi magazyn (np. delikatne elementy, godzina odbioru).">
          <textarea value={warehouseNote} onChange={(event) => setWarehouseNote(event.target.value)} rows={2} className={rentalInput} />
        </RentalField>
      </div>
    </RentalModal>
  );
}
