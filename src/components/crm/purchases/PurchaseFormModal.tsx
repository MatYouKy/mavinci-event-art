'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, FileText, Loader2, Search, Sparkles, Upload, X } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { purchasesApi } from '@/lib/purchases/purchasesClient';
import {
  PURCHASE_COST_STATUS_LABELS,
  PURCHASE_KINDS,
  PURCHASE_MAX_PAGES,
  PURCHASE_METHODS,
  purchaseDay,
  purchaseDraftErrors,
  purchaseDraftFrom,
  purchaseDraftWithReading,
  purchaseEmptyDraft,
  purchaseErrorMessage,
  purchaseEventCategoryFor,
  purchaseMoney,
  purchaseNumber,
  purchasePayload,
  purchaseToday,
  type PurchaseCategories,
  type PurchaseCompanyRef,
  type PurchaseDocument,
  type PurchaseDraft,
  type PurchaseEventCosts,
  type PurchaseEventOption,
  type PurchaseKind,
  type PurchaseMethod,
  type PurchaseUpload,
} from '@/lib/purchases/purchaseShared';
import {
  PurchaseErrorBox,
  PurchaseField,
  PurchaseModal,
  purchaseButton,
  purchaseInput,
  purchasePrimaryButton,
} from './purchasesUi';

/*
 * Okno „Dodaj zakup” / „Popraw zakup” (Zakupy → Moje wydatki): plik dokumentu (zdjęcie paragonu, kilka zdjęć stron albo PDF —
 * serwer zapisuje go i odczytuje AI), dane dokumentu do sprawdzenia, sposób zapłaty (domyślnie firmowa karta), kategoria
 * kosztów i opcjonalnie event — koszt eventu (całość albo część dokumentu) z listą wszystkich kosztów tego eventu.
 */

export default function PurchaseFormModal({ companies, defaultCompany, document, categories, onClose, onSaved }: {
  companies: PurchaseCompanyRef[];
  defaultCompany: string;
  document: PurchaseDocument | null;
  categories: PurchaseCategories;
  onClose: () => void;
  onSaved: (document: PurchaseDocument) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const [draft, setDraft] = useState<PurchaseDraft>(() => (document ? purchaseDraftFrom(document) : purchaseEmptyDraft(defaultCompany)));
  const [upload, setUpload] = useState<PurchaseUpload | null>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventQuery, setEventQuery] = useState('');
  const [eventOptions, setEventOptions] = useState<PurchaseEventOption[] | null>(null);
  const [eventLoading, setEventLoading] = useState(false);
  const [eventName, setEventName] = useState<string>(document?.event ? `${document.event.name} · ${purchaseDay(document.event.date)}` : '');
  const [costs, setCosts] = useState<PurchaseEventCosts | null>(null);
  const [picking, setPicking] = useState(false);
  const saved = useRef(false);
  const uploadRef = useRef<PurchaseUpload | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  uploadRef.current = upload;

  const set = <K extends keyof PurchaseDraft>(key: K, value: PurchaseDraft[K]) => setDraft((current) => ({ ...current, [key]: value }));

  // Plik wysłany, a zakup niezapisany — znika z serwera przy zamknięciu okna.
  useEffect(() => () => {
    const pending = uploadRef.current;
    if (pending && !saved.current) void purchasesApi.discard(pending.file.path).catch(() => undefined);
  }, []);

  const chooseFiles = async (list: FileList | null) => {
    const files = Array.from(list || []);
    if (!files.length) return;
    if (files.length > PURCHASE_MAX_PAGES) {
      showSnackbar(`Dokument może mieć najwyżej ${PURCHASE_MAX_PAGES} stron.`, 'warning');
      return;
    }
    if (!draft.company_id) {
      showSnackbar('Najpierw wybierz działalność.', 'warning');
      return;
    }
    setBusy(files.length > 1 ? `Składanie ${files.length} stron i odczytywanie dokumentu…` : 'Zapisywanie pliku i odczytywanie dokumentu…');
    setError(null);
    try {
      const previous = upload;
      const result = await purchasesApi.upload(draft.company_id, files);
      if (previous) void purchasesApi.discard(previous.file.path).catch(() => undefined);
      setUpload(result);
      setFileNames(files.map((file) => file.name));
      if (!document) setDraft((current) => purchaseDraftWithReading(current, result.reading));
      if (result.reading) showSnackbar(document ? 'Plik dodany. Odczyt AI możesz wstawić do formularza.' : 'Dokument odczytany — sprawdź dane przed zapisem.', 'success');
      else showSnackbar(result.readingError || 'Plik dodany — uzupełnij dane ręcznie.', 'warning');
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się dodać pliku.'), 'error');
    } finally {
      setBusy(null);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const openFile = async () => {
    if (!document) return;
    try {
      const { url } = await purchasesApi.fileUrl(document.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się otworzyć pliku.'), 'error');
    }
  };

  // Eventy do wyboru: najbliższe dziś, z wyszukiwaniem (z krótkim opóźnieniem przy pisaniu).
  const loadEvents = useCallback(async (query: string) => {
    if (!draft.company_id) return;
    setEventLoading(true);
    try {
      setEventOptions(await purchasesApi.events(draft.company_id, query));
    } catch (failure) {
      showSnackbar(purchaseErrorMessage(failure, 'Nie udało się wczytać eventów.'), 'error');
      setEventOptions([]);
    } finally {
      setEventLoading(false);
    }
  }, [draft.company_id, showSnackbar]);

  useEffect(() => {
    if (!picking) return undefined;
    const handle = setTimeout(() => void loadEvents(eventQuery.trim()), 300);
    return () => clearTimeout(handle);
  }, [eventQuery, loadEvents, picking]);

  useEffect(() => {
    if (!draft.event_id) {
      setCosts(null);
      return undefined;
    }
    let cancelled = false;
    purchasesApi.costs(draft.event_id)
      .then((data) => { if (!cancelled) setCosts(data); })
      .catch((failure) => { if (!cancelled) showSnackbar(purchaseErrorMessage(failure, 'Nie udało się wczytać kosztów eventu.'), 'error'); });
    return () => { cancelled = true; };
  }, [draft.event_id, showSnackbar]);

  const pickEvent = (event: PurchaseEventOption) => {
    const financeName = categories.finance.find((category) => category.id === draft.category_id)?.name;
    setDraft((current) => ({
      ...current,
      event_id: event.id,
      event_amount: '',
      event_category_id: current.event_category_id || purchaseEventCategoryFor(financeName, categories.event),
    }));
    setEventName(`${event.name} · ${purchaseDay(event.date)}`);
    setPicking(false);
  };

  const clearEvent = () => {
    setDraft((current) => ({ ...current, event_id: '', event_amount: '', event_category_id: '' }));
    setEventName('');
  };

  const errors = useMemo(() => purchaseDraftErrors(draft, purchaseToday()), [draft]);
  const gross = purchaseNumber(draft.gross);
  const warnings = upload?.reading?.warnings || [];
  const hasFile = Boolean(upload) || Boolean(document?.has_file);

  const save = async () => {
    if (errors.length) {
      setError(errors.join(' '));
      return;
    }
    setBusy('Zapisywanie zakupu…');
    setError(null);
    try {
      const result = await purchasesApi.save(document?.id ?? null, purchasePayload(draft, upload?.file.path));
      saved.current = true;
      showSnackbar(document ? 'Zakup poprawiony.' : 'Zakup zapisany.', 'success');
      onSaved(result);
    } catch (failure) {
      const message = purchaseErrorMessage(failure, 'Nie udało się zapisać zakupu.');
      setError(message);
      showSnackbar(message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PurchaseModal
        wide
        title={document ? 'Popraw zakup' : 'Dodaj zakup'}
        subtitle="Zdjęcie paragonu albo faktura — dane odczyta AI, sprawdź je przed zapisem."
        onClose={onClose}
        footer={(
          <>
            {!hasFile && <span className="mr-auto text-xs text-amber-200">Bez pliku zakupu nie da się wysłać w rozliczeniu miesiąca.</span>}
            <button type="button" className={purchaseButton} onClick={onClose}>Anuluj</button>
            <button type="button" className={purchasePrimaryButton} onClick={() => void save()} disabled={Boolean(busy)}>
              {document ? 'Zapisz zmiany' : 'Zapisz zakup'}
            </button>
          </>
        )}
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-4">
            <section className="space-y-2 rounded-xl border border-dashed border-[#d3bb73]/30 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-[#e5e4e2]">
                  {upload ? `Nowy plik: ${fileNames.length > 1 ? `PDF z ${fileNames.length} zdjęć` : fileNames[0] || 'dokument'}`
                    : document?.has_file ? 'Dokument ma zapisany plik.' : 'Dodaj zdjęcie paragonu, zdjęcia stron albo PDF faktury.'}
                </p>
                <div className="flex gap-2">
                  {document?.has_file && !upload && (
                    <button type="button" className={purchaseButton} onClick={() => void openFile()}><FileText className="h-4 w-4" />Podgląd</button>
                  )}
                  <button type="button" className={purchaseButton} onClick={() => fileInput.current?.click()} disabled={Boolean(busy)}>
                    <Upload className="h-4 w-4" />{hasFile ? 'Zamień plik' : 'Dodaj plik'}
                  </button>
                </div>
              </div>
              <input ref={fileInput} type="file" multiple accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden"
                onChange={(event) => void chooseFiles(event.target.files)} />
              <p className="text-xs text-[#e5e4e2]/45">Kilka zdjęć to strony jednego dokumentu (do {PURCHASE_MAX_PAGES}). Każdy paragon dodaj osobno.</p>
              {upload?.readingError && <p className="text-xs text-amber-200">{upload.readingError}</p>}
              {warnings.length > 0 && (
                <ul className="space-y-1 rounded-lg bg-amber-400/10 p-3 text-xs text-amber-100">
                  {warnings.map((warning) => <li key={warning} className="flex gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{warning}</li>)}
                </ul>
              )}
              {document && upload?.reading && (
                <button type="button" className={purchaseButton} onClick={() => setDraft((current) => purchaseDraftWithReading(current, upload.reading))}>
                  <Sparkles className="h-4 w-4" />Wstaw odczytane dane
                </button>
              )}
            </section>

            <div className="grid gap-3 sm:grid-cols-2">
              {companies.length > 1 && (
                <PurchaseField label="Działalność">
                  <select className={purchaseInput} value={draft.company_id} disabled={Boolean(draft.event_id)} title={draft.event_id ? 'Najpierw usuń event — event należy do działalności.' : undefined}
                    onChange={(event) => set('company_id', event.target.value)}>
                    {companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
                  </select>
                </PurchaseField>
              )}
              <PurchaseField label="Rodzaj dokumentu">
                <select className={purchaseInput} value={draft.kind} onChange={(event) => set('kind', event.target.value as PurchaseKind)}>
                  {PURCHASE_KINDS.map((kind) => <option key={kind.value} value={kind.value}>{kind.label}</option>)}
                </select>
              </PurchaseField>
              <PurchaseField label="Sprzedawca">
                <input className={purchaseInput} value={draft.seller_name} maxLength={200} onChange={(event) => set('seller_name', event.target.value)} placeholder="np. Leroy Merlin" />
              </PurchaseField>
              <PurchaseField label="NIP sprzedawcy">
                <input className={purchaseInput} value={draft.seller_nip} maxLength={30} onChange={(event) => set('seller_nip', event.target.value)} placeholder="z nagłówka paragonu" />
              </PurchaseField>
              <PurchaseField label={draft.kind === 'invoice' ? 'Numer faktury' : 'Numer paragonu / dokumentu'}>
                <input className={purchaseInput} value={draft.number} maxLength={120} onChange={(event) => set('number', event.target.value)} />
              </PurchaseField>
              <PurchaseField label="Data zakupu">
                <input type="date" className={purchaseInput} value={draft.date} max={purchaseToday()} onChange={(event) => set('date', event.target.value)} />
              </PurchaseField>
              <div className="sm:col-span-2">
                <PurchaseField label="Co kupiono">
                  <input className={purchaseInput} value={draft.label} maxLength={200} onChange={(event) => set('label', event.target.value)} placeholder="np. gadżety na wesele, taśmy, baterie" />
                </PurchaseField>
              </div>
              <PurchaseField label="Kwota brutto">
                <input className={purchaseInput} inputMode="decimal" value={draft.gross} onChange={(event) => set('gross', event.target.value)} />
              </PurchaseField>
              <PurchaseField label="Kwota netto" hint="Jeśli podana na dokumencie.">
                <input className={purchaseInput} inputMode="decimal" value={draft.net} onChange={(event) => set('net', event.target.value)} />
              </PurchaseField>
              <PurchaseField label="Waluta">
                <input className={purchaseInput} value={draft.currency} maxLength={3} onChange={(event) => set('currency', event.target.value.toUpperCase())} />
              </PurchaseField>
              <PurchaseField label="Zapłacono">
                <select className={purchaseInput} value={draft.payment_method} onChange={(event) => set('payment_method', event.target.value as PurchaseMethod)}>
                  {PURCHASE_METHODS.map((method) => <option key={method.value} value={method.value}>{method.label}</option>)}
                </select>
              </PurchaseField>
              <div className="sm:col-span-2">
                <PurchaseField label="Kategoria kosztów">
                  <select className={purchaseInput} value={draft.category_id} onChange={(event) => set('category_id', event.target.value)}>
                    <option value="">Bez kategorii (ustali księgowość)</option>
                    {categories.finance.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                  </select>
                </PurchaseField>
              </div>
              <div className="sm:col-span-2">
                <PurchaseField label="Uwagi">
                  <textarea className={`${purchaseInput} min-h-[72px]`} value={draft.notes} maxLength={2000} onChange={(event) => set('notes', event.target.value)} />
                </PurchaseField>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <section className="space-y-3 rounded-xl border border-white/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-base font-light uppercase tracking-wide text-[#e5e4e2]">Koszt eventu</h3>
                {draft.event_id && <button type="button" className={purchaseButton} onClick={clearEvent}><X className="h-4 w-4" />Bez eventu</button>}
              </div>
              {draft.event_id ? (
                <>
                  <p className="flex items-center gap-2 text-sm text-[#e5e4e2]"><CalendarDays className="h-4 w-4 text-[#d3bb73]" />{eventName || costs?.event.name || 'Event'}</p>
                  {draft.currency.toUpperCase() !== 'PLN' && <p className="text-xs text-amber-200">Do eventu można przypisać zakup w PLN.</p>}
                  {costs && !costs.settlement_open && (
                    <p className="text-xs text-amber-200">Podsumowanie tego eventu jest już wysłane albo zatwierdzone — koszt dopisze osoba z finansów.</p>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <PurchaseField label="Kwota dla eventu (brutto)" hint={gross ? `Puste — cały dokument (${purchaseMoney(gross)}).` : 'Puste — cały dokument.'}>
                      <input className={purchaseInput} inputMode="decimal" value={draft.event_amount} onChange={(event) => set('event_amount', event.target.value)} />
                    </PurchaseField>
                    <PurchaseField label="Kategoria kosztu eventu">
                      <select className={purchaseInput} value={draft.event_category_id} onChange={(event) => set('event_category_id', event.target.value)}>
                        <option value="">Bez kategorii</option>
                        {categories.event.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                      </select>
                    </PurchaseField>
                  </div>
                  <div className="rounded-lg bg-white/[0.03] p-3">
                    <p className="mb-2 text-xs uppercase tracking-wide text-[#e5e4e2]/50">Koszty tego eventu {costs ? `· razem ${purchaseMoney(costs.total)}` : ''}</p>
                    {!costs ? (
                      <p className="text-xs text-[#e5e4e2]/50"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Wczytywanie…</p>
                    ) : costs.costs.length === 0 ? (
                      <p className="text-xs text-[#e5e4e2]/50">Ten event nie ma jeszcze kosztów.</p>
                    ) : (
                      <ul className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                        {costs.costs.map((cost) => (
                          <li key={cost.id} className="flex items-start justify-between gap-3 text-xs">
                            <span className="min-w-0">
                              <span className="block truncate text-[#e5e4e2]">{cost.name}</span>
                              <span className="text-[#e5e4e2]/45">
                                {[purchaseDay(cost.date), cost.category_name, cost.created_by_name, PURCHASE_COST_STATUS_LABELS[cost.status || ''] || cost.status]
                                  .filter(Boolean).join(' · ')}
                              </span>
                            </span>
                            <span className={`shrink-0 ${cost.mine ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>{purchaseMoney(cost.amount, cost.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : picking ? (
                <div className="space-y-2">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" aria-hidden />
                    <input autoFocus className={`${purchaseInput} pl-9`} value={eventQuery} onChange={(event) => setEventQuery(event.target.value)} placeholder="Szukaj eventu po nazwie…" />
                  </label>
                  {eventLoading && !eventOptions ? (
                    <p className="text-xs text-[#e5e4e2]/50"><Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />Wczytywanie eventów…</p>
                  ) : (eventOptions || []).length === 0 ? (
                    <p className="text-xs text-[#e5e4e2]/50">{eventQuery ? 'Nie znaleziono eventu.' : 'Brak eventów w najbliższym czasie — wyszukaj po nazwie.'}</p>
                  ) : (
                    <ul className="max-h-72 space-y-1 overflow-y-auto pr-1">
                      {(eventOptions || []).map((event) => (
                        <li key={event.id}>
                          <button type="button" onClick={() => pickEvent(event)} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-white/5">
                            <span className="block text-[#e5e4e2]">{event.name}</span>
                            <span className="text-xs text-[#e5e4e2]/50">{[purchaseDay(event.date), event.location].filter(Boolean).join(' · ')}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <button type="button" className={purchaseButton} onClick={() => setPicking(false)}>Anuluj wybór</button>
                </div>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm text-[#e5e4e2]/60">Zakup dla konkretnego eventu (np. gadżety na wesele) dopisz do jego kosztów — zobaczysz wszystkie koszty tego eventu.</p>
                  <button type="button" className={purchaseButton} onClick={() => setPicking(true)} disabled={!draft.company_id}>
                    <CalendarDays className="h-4 w-4" />Przypisz do eventu
                  </button>
                </div>
              )}
            </section>
            <PurchaseErrorBox message={error} />
          </div>
        </div>
      </PurchaseModal>
      <FullScreenLoader show={Boolean(busy)} title={busy || ''} description="Proszę poczekać..." />
    </>
  );
}
