'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Ban,
  ClipboardCheck,
  ClipboardList,
  FileText,
  History,
  MapPin,
  Paperclip,
  Pencil,
  Printer,
  RotateCcw,
  Trash2,
  Truck,
  Upload,
  User,
  Wallet,
  Wrench,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  RENTAL_HANDOVER_LABELS,
  RENTAL_LOG_LABELS,
  RENTAL_TRIP_LABELS,
  getRental,
  isRentalId,
  removeRentalFile,
  rentalDateTime,
  rentalErrorMessage,
  rentalFileUrl,
  rentalMoney,
  rentalOutQty,
  setRentalStatus,
  setRentalWarehouseNote,
  uploadRentalFile,
  type RentalDetail,
  type RentalFile,
  type RentalItem,
  type RentalStatus,
} from '@/lib/CRM/rental/rental';
import RentalFormModal from '@/components/crm/rental/RentalFormModal';
import RentalItemsModal from '@/components/crm/rental/RentalItemsModal';
import RentalProtocolModal from '@/components/crm/rental/RentalProtocolModal';
import RentalResolveModal from '@/components/crm/rental/RentalResolveModal';
import RentalTripsModal from '@/components/crm/rental/RentalTripsModal';
import RentalSettlement from '@/components/crm/rental/RentalSettlement';
import {
  RentalError,
  RentalSection,
  RentalStatusBadge,
  rentalButton,
  rentalDangerButton,
  rentalInput,
  rentalPrimaryButton,
} from '@/components/crm/rental/rentalUi';

/*
 * Karta wypożyczenia (Rental → Wypożyczenia klientom, `docs/rental.md`). Sprzedaż: dane, pozycje z cenami, rezerwacja,
 * anulowanie, rozliczenie (naliczenia, kaucja, faktury). Magazyn: pozycje bez cen, protokoły wydania i odbioru (PDF do
 * podpisu, skan), rozbieżności, uwagi magazynu, dostawa i odbiór. Co kto widzi i robi — `rental_access` w bazie.
 */

type Modal =
  | { kind: 'form' }
  | { kind: 'items'; catalog?: boolean }
  | { kind: 'trips' }
  | { kind: 'protocol'; protocol: 'issue' | 'return' }
  | { kind: 'resolve'; item: RentalItem }
  | null;

const size = (bytes: number | null) => (bytes == null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

export default function RentalDetailPage() {
  const params = useParams<{ id: string }>();
  const id = String(params?.id || '');
  const router = useRouter();
  /** `?pozycje=1` — zaraz po utworzeniu wypożyczenia otwiera katalog magazynu. */
  const openCatalog = useSearchParams()?.get('pozycje') === '1';
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [rental, setRental] = useState<RentalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [busy, setBusy] = useState(false);
  const [warehouseNote, setWarehouseNoteText] = useState('');
  const [uploading, setUploading] = useState<string | null>(null);
  /** Ostatnio zapisany protokół — link do PDF do podpisu (bez otwierania okna po zapisie, które blokuje przeglądarka). */
  const [printProtocol, setPrintProtocol] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isRentalId(id)) {
      setError('Nieprawidłowy adres wypożyczenia.');
      setLoading(false);
      return;
    }
    try {
      const data = await getRental(supabase, id);
      setRental(data);
      setWarehouseNoteText(data.warehouse_note || '');
      setError(null);
    } catch (failure) {
      setError(rentalErrorMessage(failure, 'Nie udało się pobrać wypożyczenia.'));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openCatalog || !rental || rental.id !== id) return;
    router.replace(`/crm/rental/${id}`, { scroll: false });
    if (rental.access.sales_manage && ['draft', 'reserved', 'issued'].includes(rental.status)) setModal({ kind: 'items', catalog: true });
  }, [id, openCatalog, rental, router]);

  const applied = (data: RentalDetail | null) => {
    setModal(null);
    if (data) {
      setRental(data);
      setWarehouseNoteText(data.warehouse_note || '');
    } else void load();
  };

  const changeStatus = async (status: RentalStatus, question: string, title: string, askReason = false) => {
    let note: string | null = null;
    if (askReason) {
      note = window.prompt(question, '');
      if (note === null) return;
      if (note.trim().length < 3) {
        showSnackbar('Podaj powód (co najmniej 3 znaki).', 'warning');
        return;
      }
    } else if (!(await showConfirm(question, title))) return;
    setBusy(true);
    try {
      await setRentalStatus(supabase, id, status, note?.trim() || null);
      showSnackbar('Zmieniono status wypożyczenia', 'success');
      await load();
    } catch (failure) {
      showSnackbar(rentalErrorMessage(failure), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openFile = async (file: RentalFile) => {
    try {
      window.open(await rentalFileUrl(supabase, file.storage_path), '_blank', 'noopener');
    } catch (failure) {
      showSnackbar(rentalErrorMessage(failure, 'Nie udało się otworzyć pliku.'), 'error');
    }
  };

  const openPhoto = async (path: string) => {
    try {
      window.open(await rentalFileUrl(supabase, path), '_blank', 'noopener');
    } catch (failure) {
      showSnackbar(rentalErrorMessage(failure, 'Nie udało się otworzyć zdjęcia.'), 'error');
    }
  };

  const upload = async (files: FileList | null, area: 'sales' | 'warehouse', kind: 'scan' | 'photo' | 'document', protocolId: string | null, token: string) => {
    if (!files?.length || !rental) return;
    setUploading(token);
    try {
      for (const file of Array.from(files)) {
        await uploadRentalFile(supabase, rental.id, { body: file, name: file.name, type: file.type, size: file.size }, area, kind, protocolId);
      }
      showSnackbar(files.length === 1 ? 'Dodano plik' : `Dodano pliki (${files.length})`, 'success');
      await load();
    } catch (failure) {
      showSnackbar(rentalErrorMessage(failure, 'Nie udało się przesłać pliku.'), 'error');
    } finally {
      setUploading(null);
    }
  };

  const removeFile = async (file: RentalFile) => {
    if (!(await showConfirm(`Usunąć plik „${file.file_name}”? Tej operacji nie można cofnąć.`, 'Usuń plik'))) return;
    try {
      await removeRentalFile(supabase, file.id);
      showSnackbar('Usunięto plik', 'success');
      await load();
    } catch (failure) {
      showSnackbar(rentalErrorMessage(failure, 'Nie udało się usunąć pliku.'), 'error');
    }
  };

  const saveWarehouseNote = async () => {
    setBusy(true);
    try {
      await setRentalWarehouseNote(supabase, id, warehouseNote);
      showSnackbar('Zapisano uwagi magazynu', 'success');
      await load();
    } catch (failure) {
      showSnackbar(rentalErrorMessage(failure), 'error');
    } finally {
      setBusy(false);
    }
  };

  const issues = useMemo(() => (rental?.items || []).filter((item) => item.open_damaged + item.open_missing > 0), [rental]);

  if (loading) return <div className="p-6 text-[#e5e4e2]/60">Wczytywanie wypożyczenia…</div>;
  if (error || !rental) {
    return (
      <div className="space-y-4 p-6">
        <Link href="/crm/rental" className="inline-flex items-center gap-2 text-sm text-[#d3bb73] hover:underline"><ArrowLeft className="h-4 w-4" />Wypożyczenia</Link>
        <RentalError message={error || 'Nie znaleziono wypożyczenia.'} />
      </div>
    );
  }

  const access = rental.access;
  const sales = access.sales_manage;
  const warehouse = access.warehouse_act;
  const editable = sales && ['draft', 'reserved', 'issued', 'returned'].includes(rental.status);
  const itemsEditable = sales && ['draft', 'reserved', 'issued'].includes(rental.status);
  const canFiles = sales || warehouse;
  const canIssue = warehouse && ['reserved', 'issued'].includes(rental.status) && rental.items.some((item) => item.kind === 'equipment' && item.issued_qty < item.quantity);
  const canReturn = warehouse && rental.status === 'issued' && rental.items.some((item) => rentalOutQty(item) > 0);
  const showPrices = access.sales_view;
  const equipment = rental.items.filter((item) => item.kind === 'equipment');
  const services = rental.items.filter((item) => item.kind === 'service');
  const generalFiles = rental.files.filter((file) => !file.protocol_id);

  return (
    <div className="min-h-screen space-y-4 bg-[#0a0d1a] p-4 sm:p-6">
      <Link href="/crm/rental" className="inline-flex items-center gap-2 text-sm text-[#d3bb73] hover:underline"><ArrowLeft className="h-4 w-4" />Wypożyczenia</Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-light uppercase tracking-wide text-[#e5e4e2]">{rental.number}</h1>
            <RentalStatusBadge status={rental.status} />
            {rental.overdue && <span className="inline-flex items-center gap-1 rounded-full bg-red-400/15 px-2.5 py-0.5 text-xs text-red-200"><AlertTriangle className="h-3 w-3" />Po terminie zwrotu</span>}
            {issues.length > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs text-amber-100"><Wrench className="h-3 w-3" />Rozbieżności do rozstrzygnięcia</span>}
          </div>
          {rental.title && <p className="text-lg text-[#e5e4e2]">{rental.title}</p>}
          <p className="text-sm text-[#e5e4e2]/70">{rental.client_name} · wydanie {rentalDateTime(rental.starts_at)} · zwrot {rentalDateTime(rental.ends_at)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canIssue && (
            <button type="button" className={rentalPrimaryButton} onClick={() => setModal({ kind: 'protocol', protocol: 'issue' })}>
              <ClipboardList className="h-4 w-4" />{rental.status === 'issued' ? 'Dowydanie' : 'Protokół wydania'}
            </button>
          )}
          {canReturn && (
            <button type="button" className={rentalPrimaryButton} onClick={() => setModal({ kind: 'protocol', protocol: 'return' })}>
              <ClipboardCheck className="h-4 w-4" />Protokół odbioru
            </button>
          )}
          {sales && rental.status === 'draft' && (
            <button type="button" className={rentalPrimaryButton} disabled={busy}
              onClick={() => void changeStatus('reserved', 'Zarezerwować sprzęt? Pozycje zajmą stan magazynu w terminie wypożyczenia, a magazyn dostanie powiadomienie.', 'Rezerwacja')}>
              Zarezerwuj
            </button>
          )}
          {sales && rental.status === 'reserved' && (
            <button type="button" className={rentalButton} disabled={busy}
              onClick={() => void changeStatus('draft', 'Cofnąć rezerwację? Sprzęt wróci do dostępnych, a magazyn dostanie powiadomienie.', 'Cofnij rezerwację')}>
              <RotateCcw className="h-4 w-4" />Cofnij rezerwację
            </button>
          )}
          {sales && rental.status === 'returned' && (
            <button type="button" className={rentalPrimaryButton} disabled={busy}
              onClick={() => void changeStatus('settled', 'Oznaczyć wypożyczenie jako rozliczone? Zmiany danych i naliczeń zostaną zablokowane.', 'Rozliczenie')}>
              <Wallet className="h-4 w-4" />Rozlicz
            </button>
          )}
          {access.admin && rental.status === 'settled' && (
            <button type="button" className={rentalButton} disabled={busy}
              onClick={() => void changeStatus('returned', 'Cofnąć rozliczenie? Wypożyczenie wróci do statusu „Zwrócone”.', 'Cofnij rozliczenie')}>
              <RotateCcw className="h-4 w-4" />Cofnij rozliczenie
            </button>
          )}
          {editable && (
            <button type="button" className={rentalButton} onClick={() => setModal({ kind: 'form' })}><Pencil className="h-4 w-4" />Edytuj dane</button>
          )}
          {sales && ['draft', 'reserved'].includes(rental.status) && (
            <button type="button" className={rentalDangerButton} disabled={busy}
              onClick={() => void (rental.status === 'reserved'
                ? changeStatus('cancelled', 'Podaj powód anulowania (magazyn dostanie powiadomienie):', 'Anuluj', true)
                : changeStatus('cancelled', 'Anulować szkic wypożyczenia?', 'Anuluj'))}>
              <Ban className="h-4 w-4" />Anuluj
            </button>
          )}
        </div>
      </header>

      {printProtocol && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-400/30 bg-emerald-400/10 p-3 text-sm text-emerald-100">
          <span>Protokół zapisany. Wydrukuj go do podpisu, a skan podpisanego dodaj przy protokole.</span>
          <span className="flex gap-2">
            <a href={`/bridge/rental/${rental.id}/protocols/${printProtocol}`} target="_blank" rel="noopener" className={rentalPrimaryButton} onClick={() => setPrintProtocol(null)}>
              <Printer className="h-4 w-4" />PDF do podpisu
            </a>
            <button type="button" className={rentalButton} onClick={() => setPrintProtocol(null)}>Zamknij</button>
          </span>
        </div>
      )}

      {rental.status === 'cancelled' && rental.cancel_reason && (
        <p className="rounded-lg border border-red-400/20 bg-red-400/5 p-3 text-sm text-red-200">Powód anulowania: {rental.cancel_reason}</p>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <RentalSection
            title="Pozycje"
            actions={itemsEditable ? <button type="button" className={rentalButton} onClick={() => setModal({ kind: 'items' })}><Pencil className="h-4 w-4" />Edytuj pozycje</button> : undefined}
          >
            {rental.items.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/60">{itemsEditable ? 'Wybierz sprzęt z katalogu magazynu — „Edytuj pozycje”.' : 'Brak pozycji.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-[#e5e4e2]/50">
                    <tr>
                      <th className="py-2 pr-2 font-normal">Pozycja</th>
                      <th className="py-2 pr-2 text-right font-normal">Ilość</th>
                      <th className="py-2 pr-2 font-normal">Wydano / zwrot</th>
                      {showPrices && <th className="py-2 pr-2 text-right font-normal">Cena</th>}
                      {showPrices && <th className="py-2 text-right font-normal">Netto</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {[...equipment, ...services].map((item) => (
                      <tr key={item.id} className="border-t border-white/5 align-top">
                        <td className="py-2 pr-2">
                          <p className="text-[#e5e4e2]">{item.name}</p>
                          <p className="text-xs text-[#e5e4e2]/50">
                            {[item.kind === 'service' ? 'Usługa' : item.storage_location ? `Magazyn: ${item.storage_location}` : null, item.kit_name ? `z zestawu ${item.kit_name}` : null, item.note]
                              .filter(Boolean).join(' · ')}
                          </p>
                        </td>
                        <td className="py-2 pr-2 text-right text-[#e5e4e2]">{item.quantity} {item.unit}</td>
                        <td className="py-2 pr-2 text-xs text-[#e5e4e2]/70">
                          {item.kind === 'service' ? '—' : (
                            <>
                              <span>wydano {item.issued_qty}</span>
                              {item.issued_qty > 0 && <span> · u klienta {item.out_qty}</span>}
                              {item.returned_ok_qty > 0 && <span> · sprawne {item.returned_ok_qty}</span>}
                              {item.returned_damaged_qty > 0 && <span className="text-amber-200"> · uszk. {item.returned_damaged_qty}</span>}
                              {item.returned_missing_qty > 0 && <span className="text-red-200"> · brak {item.returned_missing_qty}</span>}
                            </>
                          )}
                        </td>
                        {showPrices && (
                          <td className="py-2 pr-2 text-right text-xs text-[#e5e4e2]/70">
                            {rentalMoney(item.unit_price)}{item.price_mode === 'per_day' ? ` × ${item.days ?? rental.default_days} dob.` : ' ryczałt'}
                            {Number(item.discount_percent) > 0 ? ` −${item.discount_percent}%` : ''}
                          </td>
                        )}
                        {showPrices && <td className="py-2 text-right text-[#e5e4e2]">{rentalMoney(item.line_net)}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </RentalSection>

          {issues.length > 0 && (
            <RentalSection title="Rozbieżności po zwrocie">
              <p className="mb-2 text-xs text-[#e5e4e2]/55">Do rozstrzygnięcia te sztuki zajmują stan magazynu (eventy i wypożyczenia ich nie dostaną).</p>
              <ul className="space-y-2">
                {issues.map((item) => (
                  <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-400/5 px-3 py-2 text-sm">
                    <span className="text-[#e5e4e2]">
                      {item.name}
                      <span className="text-xs text-[#e5e4e2]/60">
                        {item.open_damaged > 0 ? ` · uszkodzone ${item.open_damaged}` : ''}{item.open_missing > 0 ? ` · brak ${item.open_missing}` : ''}
                      </span>
                    </span>
                    {warehouse && <button type="button" className={rentalButton} onClick={() => setModal({ kind: 'resolve', item })}><Wrench className="h-4 w-4" />Rozstrzygnij</button>}
                  </li>
                ))}
              </ul>
            </RentalSection>
          )}

          <RentalSection title="Wydanie i zwrot">
            {rental.protocols.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/60">
                {rental.status === 'draft' ? 'Po rezerwacji magazyn wyda sprzęt z protokołem wydania.' : 'Brak protokołów.'}
              </p>
            ) : (
              <ul className="space-y-3">
                {rental.protocols.map((protocol) => {
                  const scans = rental.files.filter((file) => file.protocol_id === protocol.id);
                  const token = `scan-${protocol.id}`;
                  return (
                    <li key={protocol.id} className="rounded-lg border border-white/10 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-[#e5e4e2]">{protocol.kind === 'issue' ? 'Wydanie' : 'Odbiór'} · {protocol.number}</p>
                          <p className="text-xs text-[#e5e4e2]/55">
                            {rentalDateTime(protocol.created_at)} · {protocol.kind === 'issue' ? 'odebrał(a)' : 'zwrócił(a)'} {protocol.person_name}
                            {protocol.created_by_name ? ` · magazyn: ${protocol.created_by_name}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <a href={`/bridge/rental/${rental.id}/protocols/${protocol.id}`} target="_blank" rel="noopener" className={rentalButton}>
                            <Printer className="h-4 w-4" />PDF do podpisu
                          </a>
                          {canFiles && (
                            <label className={`${rentalButton} cursor-pointer`}>
                              <Upload className="h-4 w-4" />{uploading === token ? 'Przesyłanie…' : 'Dodaj skan'}
                              <input type="file" accept="application/pdf,image/*" className="hidden" disabled={uploading !== null}
                                onChange={(event) => { void upload(event.target.files, 'warehouse', 'scan', protocol.id, token); event.target.value = ''; }} />
                            </label>
                          )}
                        </div>
                      </div>
                      <ul className="mt-2 space-y-0.5 text-sm text-[#e5e4e2]/80">
                        {protocol.lines.map((line) => (
                          <li key={line.item_id}>
                            {line.name}: {protocol.kind === 'issue' ? `${line.qty} ${line.unit}` : [
                              line.qty ? `sprawne ${line.qty}` : null, line.damaged ? `uszkodzone ${line.damaged}` : null, line.missing ? `brak ${line.missing}` : null,
                            ].filter(Boolean).join(', ')}
                            {line.note ? <span className="text-xs text-[#e5e4e2]/55"> — {line.note}</span> : null}
                            {line.photos.map((path, index) => (
                              <button key={path} type="button" className="ml-2 text-xs text-[#d3bb73] hover:underline" onClick={() => void openPhoto(path)}>zdjęcie {index + 1}</button>
                            ))}
                          </li>
                        ))}
                      </ul>
                      {protocol.note && <p className="mt-1 text-xs text-[#e5e4e2]/55">Uwagi: {protocol.note}</p>}
                      {scans.length > 0 ? (
                        <ul className="mt-2 flex flex-wrap gap-2">
                          {scans.map((file) => (
                            <li key={file.id} className="inline-flex items-center gap-1 rounded-full bg-emerald-400/10 px-2.5 py-1 text-xs text-emerald-100">
                              <button type="button" className="inline-flex items-center gap-1 hover:underline" onClick={() => void openFile(file)}><FileText className="h-3 w-3" />{file.file_name}</button>
                              {canFiles && <button type="button" aria-label="Usuń skan" onClick={() => void removeFile(file)}><Trash2 className="h-3 w-3" /></button>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-2 text-xs text-amber-200/80">Brak skanu podpisanego protokołu.</p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </RentalSection>

          {rental.sales && <RentalSettlement rental={rental} onChanged={applied} />}
        </div>

        <div className="space-y-4">
          <RentalSection title="Klient i termin">
            <dl className="space-y-2 text-sm">
              <div><dt className="text-xs text-[#e5e4e2]/50">Klient</dt><dd className="text-[#e5e4e2]">{rental.client_name}</dd></div>
              {(rental.recipient_name || rental.recipient_phone) && (
                <div>
                  <dt className="text-xs text-[#e5e4e2]/50">Odbierający</dt>
                  <dd className="flex items-center gap-2 text-[#e5e4e2]"><User className="h-4 w-4 text-[#d3bb73]" />{[rental.recipient_name, rental.recipient_phone].filter(Boolean).join(' · ')}</dd>
                </div>
              )}
              <div><dt className="text-xs text-[#e5e4e2]/50">Wydanie</dt><dd className="text-[#e5e4e2]">{rentalDateTime(rental.starts_at)}</dd></div>
              <div><dt className="text-xs text-[#e5e4e2]/50">Planowany zwrot</dt><dd className={rental.overdue ? 'text-red-200' : 'text-[#e5e4e2]'}>{rentalDateTime(rental.ends_at)}</dd></div>
              <div>
                <dt className="text-xs text-[#e5e4e2]/50">Przekazanie</dt>
                <dd className="flex items-start gap-2 text-[#e5e4e2]">
                  {rental.handover === 'delivery' ? <Truck className="mt-0.5 h-4 w-4 text-[#d3bb73]" /> : <MapPin className="mt-0.5 h-4 w-4 text-[#d3bb73]" />}
                  <span>{RENTAL_HANDOVER_LABELS[rental.handover]}{rental.delivery_address ? ` — ${rental.delivery_address}` : ''}</span>
                </dd>
              </div>
              <div><dt className="text-xs text-[#e5e4e2]/50">Opiekun</dt><dd className="text-[#e5e4e2]">{rental.seller_name || '—'}</dd></div>
              {rental.my_company_name && <div><dt className="text-xs text-[#e5e4e2]/50">Firma</dt><dd className="text-[#e5e4e2]">{rental.my_company_name}</dd></div>}
              {rental.sales?.sales_note && <div><dt className="text-xs text-[#e5e4e2]/50">Uwagi sprzedaży</dt><dd className="whitespace-pre-wrap text-[#e5e4e2]/80">{rental.sales.sales_note}</dd></div>}
            </dl>
          </RentalSection>

          {(rental.handover === 'delivery' || rental.trips.length > 0) && (
            <RentalSection
              title="Dostawa i odbiór"
              actions={(sales || warehouse) && ['draft', 'reserved', 'issued'].includes(rental.status)
                ? <button type="button" className={rentalButton} onClick={() => setModal({ kind: 'trips' })}><Truck className="h-4 w-4" />Zaplanuj</button> : undefined}
            >
              {rental.trips.length === 0 ? (
                <p className="text-sm text-[#e5e4e2]/60">Nie zaplanowano pojazdu i kierowcy.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {rental.trips.map((trip) => (
                    <li key={trip.id}>
                      <p className="text-[#e5e4e2]">{RENTAL_TRIP_LABELS[trip.kind]}</p>
                      <p className="text-xs text-[#e5e4e2]/60">
                        {rentalDateTime(trip.starts_at)} – {rentalDateTime(trip.ends_at)} · {trip.vehicle_name || 'bez pojazdu z floty'}{trip.driver_name ? ` · ${trip.driver_name}` : ''}
                      </p>
                      {trip.note && <p className="text-xs text-[#e5e4e2]/50">{trip.note}</p>}
                    </li>
                  ))}
                </ul>
              )}
            </RentalSection>
          )}

          <RentalSection title="Uwagi magazynu">
            {warehouse || sales ? (
              <div className="space-y-2">
                <textarea value={warehouseNote} onChange={(event) => setWarehouseNoteText(event.target.value)} rows={3} className={rentalInput} placeholder="Np. delikatne elementy, miejsce odbioru" />
                {warehouseNote !== (rental.warehouse_note || '') && (
                  <button type="button" className={rentalButton} disabled={busy} onClick={() => void saveWarehouseNote()}>Zapisz uwagi</button>
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/80">{rental.warehouse_note || 'Brak uwag.'}</p>
            )}
          </RentalSection>

          <RentalSection
            title="Pliki"
            actions={canFiles ? (
              <label className={`${rentalButton} cursor-pointer`}>
                <Paperclip className="h-4 w-4" />{uploading === 'general' ? 'Przesyłanie…' : 'Dodaj'}
                <input type="file" multiple accept="application/pdf,image/*" className="hidden" disabled={uploading !== null}
                  onChange={(event) => {
                    const area = sales && !warehouse ? 'sales' : 'warehouse';
                    void upload(event.target.files, area, area === 'sales' ? 'document' : 'photo', null, 'general');
                    event.target.value = '';
                  }} />
              </label>
            ) : undefined}
          >
            {generalFiles.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/60">Brak plików. Skany protokołów dodajesz przy protokole.</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {generalFiles.map((file) => (
                  <li key={file.id} className="flex items-center justify-between gap-2">
                    <button type="button" className="min-w-0 truncate text-left text-[#e5e4e2] hover:text-[#d3bb73]" onClick={() => void openFile(file)}>{file.file_name}</button>
                    <span className="flex shrink-0 items-center gap-2 text-xs text-[#e5e4e2]/50">
                      {file.area === 'sales' ? 'sprzedaż' : 'magazyn'} · {size(file.size_bytes)}
                      {canFiles && <button type="button" aria-label="Usuń plik" className="text-red-300" onClick={() => void removeFile(file)}><Trash2 className="h-3.5 w-3.5" /></button>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </RentalSection>

          <RentalSection title="Historia">
            <ul className="max-h-96 space-y-2 overflow-y-auto text-sm">
              {rental.log.map((entry, index) => (
                <li key={`${entry.created_at}-${index}`} className="flex gap-2">
                  <History className="mt-0.5 h-4 w-4 shrink-0 text-[#e5e4e2]/40" />
                  <div className="min-w-0">
                    <p className="text-[#e5e4e2]">{RENTAL_LOG_LABELS[entry.action] || entry.action}{entry.details?.protocol ? ` · ${entry.details.protocol}` : ''}</p>
                    <p className="text-xs text-[#e5e4e2]/50">{rentalDateTime(entry.created_at)}{entry.actor_name ? ` · ${entry.actor_name}` : ''}</p>
                    {entry.note && <p className="text-xs text-[#e5e4e2]/60">{entry.note}</p>}
                  </div>
                </li>
              ))}
            </ul>
          </RentalSection>
        </div>
      </div>

      {modal?.kind === 'form' && (
        <RentalFormModal rental={rental} access={access} onClose={() => setModal(null)} onSaved={() => applied(null)} />
      )}
      {modal?.kind === 'items' && <RentalItemsModal rental={rental} startInCatalog={modal.catalog} onClose={() => setModal(null)} onSaved={applied} />}
      {modal?.kind === 'trips' && <RentalTripsModal rental={rental} onClose={() => setModal(null)} onSaved={applied} />}
      {modal?.kind === 'protocol' && (
        <RentalProtocolModal rental={rental} kind={modal.protocol} onClose={() => setModal(null)}
          onSaved={(protocolId) => {
            applied(null);
            setPrintProtocol(protocolId);
          }} />
      )}
      {modal?.kind === 'resolve' && <RentalResolveModal rental={rental} item={modal.item} onClose={() => setModal(null)} onSaved={applied} />}
    </div>
  );
}
