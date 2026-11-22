'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { Modal } from '@/components/UI/Modal';
import {
  ASSET_DOCUMENT_LABELS, ASSET_LIMITS, ASSET_OWNERSHIPS,
  type AssetDocument, type AssetDocumentList, type AssetOwnership, type EquipmentAcquisition, type EquipmentAssets,
} from '@/lib/assets/assetsShared';

/*
 * Własność sprzętu i dokumenty zakupu (sprzęt → „Zakup”; to samo API co Mac — `/bridge/native/v1/assets`). Partie sztuk:
 * środek trwały, wyposażenie, leasing lub najem, prywatne (można sprzedać bez faktury); dokument zakupu — faktura kosztowa
 * z KSeF, dokument spoza KSeF albo umowa stała. Karta jest tylko dla osób z dostępem do finansów firmy (inni jej nie widzą),
 * zmienia „Finanse — zarządzanie”.
 */

const ENDPOINT = '/bridge/native/v1/assets';
const card = 'rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6';
const field = 'w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/50';
const label = 'mb-1 block text-xs text-[#e5e4e2]/60';
const ghost = 'inline-flex items-center gap-1.5 rounded-lg border border-[#d3bb73]/25 px-3 py-1.5 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50';
const primary = 'inline-flex items-center gap-1.5 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50';

type ApiError = Error & { status?: number; code?: string };
type Draft = {
  id?: string;
  quantity: string;
  ownership: AssetOwnership;
  companyId: string;
  acquiredOn: string;
  netAmount: string;
  grossAmount: string;
  currency: string;
  document: AssetDocument | null;
  documentNote: string;
  notes: string;
};

async function headers(json: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesja wygasła. Zaloguj się ponownie.'), { status: 401 });
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error || 'Operacja nie powiodła się.'), { status: response.status, code: body?.code }) as ApiError;
  return body as T;
}

async function assetsGet<T>(op: string, params: Record<string, string>): Promise<T> {
  const search = new URLSearchParams({ op, ...params });
  return parse<T>(await fetch(`${ENDPOINT}?${search.toString()}`, { headers: await headers(false), cache: 'no-store' }));
}

async function assetsPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  return parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) }));
}

const message = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const money = (value: number | null, currency: string) => (value === null ? '—'
  : `${value.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency === 'PLN' ? 'zł' : currency}`);
const plDate = (value: string | null) => (value ? value.split('-').reverse().join('.') : '—');
const ownershipLabel = (key: AssetOwnership) => ASSET_OWNERSHIPS.find((entry) => entry.key === key)?.label || key;
const pieces = (count: number) => `${count} szt.`;

function draftOf(entry: EquipmentAcquisition | null, assets: EquipmentAssets): Draft {
  if (entry) {
    return {
      id: entry.id, quantity: String(entry.quantity), ownership: entry.ownership, companyId: entry.companyId || '', acquiredOn: entry.acquiredOn || '',
      netAmount: entry.netAmount === null ? '' : String(entry.netAmount), grossAmount: entry.grossAmount === null ? '' : String(entry.grossAmount),
      currency: entry.currency, document: entry.document, documentNote: entry.documentNote, notes: entry.notes,
    };
  }
  const editable = assets.companies.filter((company) => company.canEdit);
  return {
    quantity: String(Math.max(1, assets.unassigned || 1)), ownership: editable.length ? 'asset' : 'private', companyId: editable.length === 1 ? editable[0].id : '',
    acquiredOn: '', netAmount: '', grossAmount: '', currency: 'PLN', document: null, documentNote: '', notes: '',
  };
}

export function EquipmentAssetsCard({ equipmentId }: { equipmentId: string }) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [assets, setAssets] = useState<EquipmentAssets | null>(null);
  const [hidden, setHidden] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      setAssets(await assetsGet<EquipmentAssets>('equipment', { id: equipmentId }));
      setError('');
    } catch (cause) {
      if ((cause as ApiError)?.status === 403) setHidden(true);
      else setError(message(cause, 'Nie udało się pobrać własności sprzętu.'));
    }
  }, [equipmentId]);

  useEffect(() => { void load(); }, [load]);

  if (hidden) return null;

  const canAdd = !!assets && (assets.canEditPrivate || assets.companies.some((company) => company.canEdit));

  const remove = async (entry: EquipmentAcquisition) => {
    const confirmed = await showConfirm({
      title: 'Usuń partię', message: `Usunąć partię „${ownershipLabel(entry.ownership)} — ${pieces(entry.quantity)}”? Sprzęt zostaje w Magazynie, znika tylko opis własności i dokumentu.`,
      confirmText: 'Usuń', cancelText: 'Anuluj',
    });
    if (!confirmed) return;
    showLoader('Usuwam partię', 'Proszę chwilę poczekać...');
    try {
      setAssets(await assetsPost<EquipmentAssets>('delete', { id: entry.id }));
      showSnackbar('Usunięto partię sprzętu.', 'success');
    } catch (cause) {
      showSnackbar(message(cause, 'Nie udało się usunąć partii.'), 'error');
    } finally {
      hideLoader();
    }
  };

  return (
    <div className={card}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-lg font-medium text-[#e5e4e2]">Własność i dokumenty zakupu</h3>
          <p className="text-xs text-[#e5e4e2]/50">Czyje są sztuki tego sprzętu: majątek firmy (sprzedaż tylko na fakturę) czy prywatne (można sprzedać za gotówkę).</p>
        </div>
        {canAdd && assets && (
          <button type="button" className={ghost} onClick={() => setDraft(draftOf(null, assets))}><Plus className="h-4 w-4" />Dodaj partię</button>
        )}
      </div>

      {error ? (
        <p className="text-sm text-[#e5e4e2]/70">{error}</p>
      ) : !assets ? (
        <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/50"><Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />Ładowanie…</div>
      ) : (
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <div><dt className="text-xs text-[#e5e4e2]/50">W Magazynie</dt><dd className="text-[#e5e4e2]">{pieces(assets.quantity)}</dd></div>
            {ASSET_OWNERSHIPS.map((entry) => (
              <div key={entry.key}><dt className="text-xs text-[#e5e4e2]/50">{entry.plural}</dt><dd className="text-[#e5e4e2]">{pieces(assets.counts[entry.key])}</dd></div>
            ))}
            <div>
              <dt className="text-xs text-[#e5e4e2]/50">Nieustalona własność</dt>
              <dd className={assets.unassigned ? 'text-amber-300' : 'text-[#e5e4e2]'}>{pieces(assets.unassigned)}</dd>
            </div>
            <div>
              <dt className="text-xs text-[#e5e4e2]/50">Firmowe bez dokumentu</dt>
              <dd className={assets.undocumented ? 'text-amber-300' : 'text-[#e5e4e2]'}>{pieces(assets.undocumented)}</dd>
            </div>
          </dl>

          {assets.acquisitions.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
                <thead className="text-xs text-[#e5e4e2]/50">
                  <tr className="border-b border-[#d3bb73]/10">
                    <th className="py-2 pr-3 font-normal">Własność</th><th className="py-2 pr-3 font-normal">Firma</th><th className="py-2 pr-3 text-right font-normal">Szt.</th>
                    <th className="py-2 pr-3 font-normal">Data zakupu</th><th className="py-2 pr-3 text-right font-normal">Brutto</th>
                    <th className="py-2 pr-3 font-normal">Dokument zakupu</th><th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {assets.acquisitions.map((entry) => (
                    <tr key={entry.id} className="border-b border-[#d3bb73]/5 align-top">
                      <td className="py-2 pr-3 text-[#e5e4e2]">{ownershipLabel(entry.ownership)}{entry.notes && <div className="text-xs text-[#e5e4e2]/50">{entry.notes}</div>}</td>
                      <td className="py-2 pr-3 text-[#e5e4e2]/80">{entry.companyName || '—'}</td>
                      <td className="py-2 pr-3 text-right text-[#e5e4e2]">{entry.quantity}</td>
                      <td className="py-2 pr-3 text-[#e5e4e2]/80">{plDate(entry.acquiredOn)}</td>
                      <td className="py-2 pr-3 text-right text-[#e5e4e2]/80">{money(entry.grossAmount, entry.currency)}</td>
                      <td className="py-2 pr-3">
                        {entry.document ? (
                          <span className="text-[#e5e4e2]"><FileText className="mr-1 inline h-3.5 w-3.5 text-[#d3bb73]" />{entry.document.label}
                            <span className="block text-xs text-[#e5e4e2]/50">{ASSET_DOCUMENT_LABELS[entry.document.type]}{entry.document.detail ? ` · ${entry.document.detail}` : ''}</span>
                          </span>
                        ) : entry.ownership === 'private' ? (
                          <span className="text-[#e5e4e2]/50">nie dotyczy</span>
                        ) : (
                          <span className="text-amber-300">brak dokumentu{entry.documentNote && <span className="block text-xs text-[#e5e4e2]/50">{entry.documentNote}</span>}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap py-2 text-right">
                        {entry.canEdit && (
                          <>
                            <button type="button" className="p-1 text-[#e5e4e2]/50 hover:text-[#d3bb73]" title="Zmień" aria-label="Zmień partię"
                              onClick={() => setDraft(draftOf(entry, assets))}><Pencil className="h-4 w-4" /></button>
                            <button type="button" className="p-1 text-[#e5e4e2]/50 hover:text-red-300" title="Usuń" aria-label="Usuń partię"
                              onClick={() => void remove(entry)}><Trash2 className="h-4 w-4" /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-[#e5e4e2]/50">Nie opisano jeszcze własności tego sprzętu{canAdd ? ' — dodaj partię: ile sztuk, czyje i na podstawie jakiego dokumentu.' : '.'}</p>
          )}
        </div>
      )}

      {draft && assets && (
        <AcquisitionModal draft={draft} assets={assets} equipmentId={equipmentId} onClose={() => setDraft(null)}
          onSaved={(next) => { setAssets(next); setDraft(null); }} />
      )}
    </div>
  );
}

function AcquisitionModal({ draft: initial, assets, equipmentId, onClose, onSaved }: {
  draft: Draft; assets: EquipmentAssets; equipmentId: string; onClose: () => void; onSaved: (assets: EquipmentAssets) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [draft, setDraft] = useState<Draft>(initial);
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<AssetDocument[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const request = useRef(0);
  const editable = assets.companies.filter((company) => company.canEdit || company.id === initial.companyId);
  const update = (patch: Partial<Draft>) => setDraft((current) => ({ ...current, ...patch }));
  const company = draft.ownership === 'private' ? '' : draft.companyId;

  // Dokumenty firmy do wyboru (po wpisaniu frazy — po chwili).
  useEffect(() => {
    if (!company || draft.ownership === 'private') { setDocuments(null); return; }
    const id = ++request.current;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await assetsGet<AssetDocumentList>('documents', { company, q: query.trim(), contracts: draft.ownership === 'leased' ? '1' : '' });
        if (id === request.current) { setDocuments(data.documents); setSearchError(''); }
      } catch (cause) {
        if (id === request.current) setSearchError(message(cause, 'Nie udało się pobrać dokumentów.'));
      } finally {
        if (id === request.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [company, draft.ownership, query]);

  const choose = (document: AssetDocument) => update({
    document, acquiredOn: draft.acquiredOn || document.date || '', currency: document.type === 'contract' ? draft.currency : document.currency || draft.currency,
  });

  const save = async () => {
    const quantity = Number(draft.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > ASSET_LIMITS.quantity) { showSnackbar(`Ilość musi być liczbą od 1 do ${ASSET_LIMITS.quantity}.`, 'error'); return; }
    if (draft.ownership !== 'private' && !draft.companyId) { showSnackbar('Wybierz firmę, do której należy sprzęt.', 'error'); return; }
    if (draft.document?.type === 'contract' && draft.ownership !== 'leased') { showSnackbar('Umowę stałą wskazuje się tylko dla leasingu i najmu.', 'error'); return; }
    showLoader('Zapisuję partię', 'Proszę chwilę poczekać...');
    try {
      const next = await assetsPost<EquipmentAssets>('save', {
        id: draft.id, equipmentId, quantity, ownership: draft.ownership, companyId: draft.ownership === 'private' ? null : draft.companyId,
        acquiredOn: draft.acquiredOn || null, netAmount: draft.netAmount.trim() || null, grossAmount: draft.grossAmount.trim() || null,
        currency: draft.currency.trim().toUpperCase() || 'PLN',
        document: draft.ownership === 'private' || !draft.document ? null : { type: draft.document.type, id: draft.document.id },
        documentNote: draft.ownership === 'private' ? '' : draft.documentNote, notes: draft.notes,
      });
      showSnackbar(draft.id ? 'Zapisano partię sprzętu.' : 'Dodano partię sprzętu.', 'success');
      onSaved(next);
    } catch (cause) {
      showSnackbar(message(cause, 'Nie udało się zapisać partii.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const ownershipOptions = ASSET_OWNERSHIPS.filter((entry) => (entry.key === 'private' ? assets.canEditPrivate : editable.length > 0));

  return (
    <Modal open onClose={onClose} title={draft.id ? 'Partia sprzętu' : 'Nowa partia sprzętu'}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <label className="md:col-span-1"><span className={label}>Ilość (szt.)</span>
            <input className={field} type="number" min={1} max={ASSET_LIMITS.quantity} value={draft.quantity} onChange={(event) => update({ quantity: event.target.value })} />
          </label>
          <label className="md:col-span-2"><span className={label}>Własność</span>
            <select className={field} value={draft.ownership}
              onChange={(event) => {
                const ownership = event.target.value as AssetOwnership;
                update({ ownership, document: ownership === 'private' || (draft.document?.type === 'contract' && ownership !== 'leased') ? null : draft.document });
              }}>
              {ownershipOptions.map((entry) => <option key={entry.key} value={entry.key}>{entry.label}</option>)}
            </select>
            <span className="mt-1 block text-xs text-[#e5e4e2]/50">{ASSET_OWNERSHIPS.find((entry) => entry.key === draft.ownership)?.description}</span>
          </label>
        </div>

        {draft.ownership !== 'private' && (
          <label className="block"><span className={label}>Firma</span>
            <select className={field} value={draft.companyId} onChange={(event) => update({ companyId: event.target.value, document: null })}>
              <option value="">Wybierz firmę…</option>
              {editable.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>
          </label>
        )}

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <label><span className={label}>Data zakupu</span>
            <input className={field} type="date" value={draft.acquiredOn} onChange={(event) => update({ acquiredOn: event.target.value })} />
          </label>
          <label><span className={label}>Netto (cała partia)</span>
            <input className={field} inputMode="decimal" value={draft.netAmount} onChange={(event) => update({ netAmount: event.target.value })} placeholder="0,00" />
          </label>
          <label><span className={label}>Brutto (cała partia)</span>
            <input className={field} inputMode="decimal" value={draft.grossAmount} onChange={(event) => update({ grossAmount: event.target.value })} placeholder="0,00" />
          </label>
          <label><span className={label}>Waluta</span>
            <input className={field} maxLength={3} value={draft.currency} onChange={(event) => update({ currency: event.target.value.toUpperCase() })} />
          </label>
        </div>

        {draft.ownership !== 'private' && (
          <div className="space-y-2 rounded-xl border border-[#d3bb73]/10 bg-[#0f1119]/60 p-4">
            <span className={label}>Dokument zakupu</span>
            {draft.document ? (
              <div className="flex items-start gap-3 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] p-3">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="text-[#e5e4e2]">{draft.document.label}</div>
                  <div className="text-xs text-[#e5e4e2]/50">{ASSET_DOCUMENT_LABELS[draft.document.type]}{draft.document.detail ? ` · ${draft.document.detail}` : ''}{draft.document.date ? ` · ${plDate(draft.document.date)}` : ''}</div>
                </div>
                <button type="button" className="p-1 text-[#e5e4e2]/50 hover:text-[#e5e4e2]" onClick={() => update({ document: null })} aria-label="Usuń dokument"><X className="h-4 w-4" /></button>
              </div>
            ) : !company ? (
              <p className="text-xs text-[#e5e4e2]/50">Najpierw wybierz firmę — pokażą się jej faktury kosztowe z KSeF, dokumenty spoza KSeF{draft.ownership === 'leased' ? ' i umowy stałe' : ''}.</p>
            ) : (
              <>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/30" />
                  <input className={`${field} pl-9`} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Numer dokumentu, sprzedawca albo tytuł umowy" />
                </div>
                <div className="max-h-56 space-y-1 overflow-y-auto">
                  {searching && <div className="flex items-center gap-2 p-2 text-xs text-[#e5e4e2]/50"><Loader2 className="h-3.5 w-3.5 animate-spin" />Szukam…</div>}
                  {searchError && <p className="p-2 text-xs text-red-300">{searchError}</p>}
                  {!searching && documents && !documents.length && <p className="p-2 text-xs text-[#e5e4e2]/50">Nic nie znaleziono.</p>}
                  {documents?.map((document) => (
                    <button key={`${document.type}:${document.id}`} type="button" onClick={() => choose(document)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-[#d3bb73]/10">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[#d3bb73]/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[#e5e4e2]">{document.label}</span>
                        <span className="block truncate text-xs text-[#e5e4e2]/50">{ASSET_DOCUMENT_LABELS[document.type]}{document.detail ? ` · ${document.detail}` : ''}{document.date ? ` · ${plDate(document.date)}` : ''}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
            {!draft.document && (
              <label className="block"><span className={label}>Gdy dokumentu nie ma w CRM — gdzie jest (opcjonalnie)</span>
                <input className={field} maxLength={ASSET_LIMITS.documentNote} value={draft.documentNote} onChange={(event) => update({ documentNote: event.target.value })}
                  placeholder="np. faktura papierowa w segregatorze 2024" />
              </label>
            )}
          </div>
        )}

        <label className="block"><span className={label}>Uwagi (opcjonalnie)</span>
          <textarea className={`${field} min-h-[64px]`} maxLength={ASSET_LIMITS.notes} value={draft.notes} onChange={(event) => update({ notes: event.target.value })}
            placeholder="np. numery seryjne, od kogo kupione" />
        </label>

        <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 pt-4">
          <button type="button" className={ghost} onClick={onClose}>Anuluj</button>
          <button type="button" className={primary} onClick={() => void save()}>{draft.id ? 'Zapisz' : 'Dodaj partię'}</button>
        </div>
      </div>
    </Modal>
  );
}
