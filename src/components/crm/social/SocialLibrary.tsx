'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, CalendarDays, Check, FolderOpen, ImagePlus, Images, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useDialog } from '@/contexts/DialogContext';
import {
  SOCIAL_ASSET_SOURCE_LABELS, SOCIAL_ASSET_STATUS_LABELS, SOCIAL_CONSENT_LABELS, SOCIAL_CONSENT_PLATFORMS, SOCIAL_CONSENT_PLATFORM_LABELS,
  SOCIAL_CONSENT_SOURCE_LABELS, SOCIAL_CONSENT_STATUSES, SOCIAL_LIMITS, SOCIAL_UPLOAD_TYPES, type SocialAccess, type SocialConsentStatus,
} from '@/lib/social/socialShared';
import {
  socialGet, socialPost, uploadSocialPhoto, type SocialAsset, type SocialAssetDetail, type SocialEventOption, type SocialLibrary as LibraryData,
} from './socialApi';
import { ConsentBadge, cardClass, dangerButton, errorMessage, inputClass, primaryButton, secondaryButton, shortDate } from './socialUi';

/*
 * Biblioteka zdjęć marki: filtry (status, zgoda klienta, użycie, wydarzenie, wyszukiwanie), wgrywanie z dysku
 * (także przeciąganie), import z plików wydarzenia i z realizacji na stronie, karta zdjęcia (opis, powiązania, zgoda
 * klienta na poziomie zdjęcia, wydarzenia i klienta, archiwum, usunięcie, nowy post z tego zdjęcia).
 * W trybie wyboru (kreator posta) też można wgrać zdjęcie z dysku lub przeciągnąć je z pulpitu — jedno wgrane zdjęcie
 * od razu trafia do posta.
 */

type Props = { companyId: string; access: SocialAccess; onCreatePost: (assetId: string) => void; onChanged: () => void; pickMode?: { onPick: (asset: SocialAsset) => void } };

export default function SocialLibrary({ companyId, access, onCreatePost, onChanged, pickMode }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [status, setStatus] = useState<'ready' | 'proposed' | 'archived'>('ready');
  const [consent, setConsent] = useState('');
  const [used, setUsed] = useState('');
  const [query, setQuery] = useState('');
  const [event, setEvent] = useState<SocialEventOption | null>(null);
  const [data, setData] = useState<LibraryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [importer, setImporter] = useState<'event' | 'portfolio' | null>(null);
  const [eventPicker, setEventPicker] = useState(false);
  const [dropping, setDropping] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await socialGet<LibraryData>('library', {
        company: companyId, status, consent, used, q: query.trim(), event: event?.id, offset, limit: 60,
      }));
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się pobrać biblioteki.'), 'error');
    } finally {
      setLoading(false);
    }
  }, [companyId, status, consent, used, query, event?.id, offset, showSnackbar]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, query ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [load, query]);

  const upload = async (files: File[]) => {
    const images = files.filter((file) => (SOCIAL_UPLOAD_TYPES as readonly string[]).includes(file.type));
    const skipped = files.length - images.length;
    if (!images.length) {
      showSnackbar('Dodaj zdjęcia JPEG, PNG albo WebP (HEIC zapisz najpierw jako JPEG).', 'warning');
      return;
    }
    let added = 0;
    let duplicates = 0;
    const errors: string[] = [];
    const uploaded: SocialAsset[] = [];
    for (const [index, file] of images.entries()) {
      showLoader(`Wgrywam zdjęcia (${index + 1}/${images.length})`, 'Zdjęcie jest analizowane — wymiary, miniatura i propozycje kadrów.');
      try {
        if (file.size > SOCIAL_LIMITS.uploadBytes) throw new Error(`„${file.name}” ma więcej niż 40 MB.`);
        const result = await uploadSocialPhoto(file, { companyId, eventId: event?.id || null });
        if (result.duplicateOf) duplicates += 1; else added += 1;
        if (result.asset) uploaded.push(result.asset);
      } catch (cause) {
        errors.push(errorMessage(cause, `Nie udało się wgrać „${file.name}”.`));
      }
    }
    hideLoader();
    if (added) showSnackbar(`Dodano do biblioteki: ${added}${duplicates ? ` · już były: ${duplicates}` : ''}${skipped ? ` · pominięte (format): ${skipped}` : ''}`, 'success');
    else if (duplicates) showSnackbar('Te zdjęcia są już w bibliotece.', 'info');
    if (errors.length) showSnackbar(errors[0], 'error');
    setOffset(0);
    void load();
    onChanged();
    // Kreator posta: jedno zdjęcie (nowe albo już będące w bibliotece) od razu w poście.
    if (pickMode && uploaded.length === 1 && images.length === 1) pickMode.onPick(uploaded[0]);
  };

  const assets = data?.assets || [];
  const pageCount = data ? Math.ceil(data.total / data.limit) : 0;

  return (
    <section
      className={`${cardClass} p-4 ${dropping ? 'ring-2 ring-[#d3bb73]/50' : ''}`}
      onDragOver={(e) => { if (access.create && e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => { if (!access.create) return; e.preventDefault(); setDropping(false); void upload(Array.from(e.dataTransfer.files)); }}>
      <div className="mb-4 flex flex-col gap-3 2xl:flex-row 2xl:items-center 2xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {(['ready', 'proposed', 'archived'] as const).map((value) => (
            <button key={value} type="button" onClick={() => { setStatus(value); setOffset(0); }}
              className={`rounded-lg border px-3 py-1.5 text-sm ${status === value ? 'border-[#d3bb73]/50 bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/10 text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
              {SOCIAL_ASSET_STATUS_LABELS[value]}{value === 'proposed' && data?.proposals ? ` (${data.proposals})` : ''}
            </button>
          ))}
          <select value={consent} onChange={(e) => { setConsent(e.target.value); setOffset(0); }} className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-1.5 text-sm" aria-label="Zgoda klienta">
            <option value="">Zgoda: wszystkie</option>
            <option value="ok">Zgoda: jest / niepotrzebna</option>
            <option value="missing">Zgoda: brak / nieustalona</option>
          </select>
          <select value={used} onChange={(e) => { setUsed(e.target.value); setOffset(0); }} className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-1.5 text-sm" aria-label="Użycie">
            <option value="">Użyte i nieużyte</option>
            <option value="unused">Nieużyte</option>
            <option value="used">Użyte w postach</option>
          </select>
          <button type="button" className={secondaryButton} onClick={() => setEventPicker(true)}>
            <CalendarDays className="h-4 w-4" />{event ? event.name : 'Wydarzenie'}
          </button>
          {event && <button type="button" className={secondaryButton} aria-label="Wyczyść wydarzenie" onClick={() => { setEvent(null); setOffset(0); }}><X className="h-4 w-4" /></button>}
          <label className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/30" />
            <input value={query} onChange={(e) => { setQuery(e.target.value); setOffset(0); }} placeholder="Szukaj w opisach i nazwach" className={`${inputClass} w-64 pl-8`} />
          </label>
        </div>
        {access.create && (
          <div className="flex flex-wrap gap-2">
            <input ref={fileInput} type="file" multiple accept={SOCIAL_UPLOAD_TYPES.join(',')} className="hidden"
              onChange={(e) => { const files = Array.from(e.target.files || []); e.target.value = ''; void upload(files); }} />
            <button type="button" className={primaryButton} onClick={() => fileInput.current?.click()}><Upload className="h-4 w-4" />Wgraj z dysku</button>
            <button type="button" className={secondaryButton} onClick={() => setImporter('event')}><FolderOpen className="h-4 w-4" />Z plików wydarzenia</button>
            <button type="button" className={secondaryButton} onClick={() => setImporter('portfolio')}><ImagePlus className="h-4 w-4" />Z realizacji na stronie</button>
          </div>
        )}
      </div>
      {access.create && (
        <p className="mb-3 text-xs text-[#e5e4e2]/40">
          {pickMode
            ? 'Wybierz zdjęcie z biblioteki albo wgraj nowe z dysku (także przeciągając je tutaj) — jedno wgrane zdjęcie od razu trafi do posta.'
            : 'Możesz też przeciągnąć zdjęcia z dysku na tę sekcję.'}
          {event ? ` Nowe zdjęcia zostaną powiązane z „${event.name}”.` : ''}
        </p>
      )}

      {loading && !data ? <p className="p-8 text-center text-sm text-[#e5e4e2]/45">Ładowanie biblioteki…</p> : (
        <>
          {assets.length === 0 && <div className="p-10 text-center text-sm text-[#e5e4e2]/45"><Images className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]/40" />Brak zdjęć w tym widoku.</div>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
            {assets.map((asset) => (
              <button key={asset.id} type="button" onClick={() => (pickMode ? pickMode.onPick(asset) : setSelected(asset.id))}
                className="group overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 text-left hover:border-[#d3bb73]/40">
                <div className="relative aspect-[4/5] bg-[#0f1119]">
                  {asset.thumbnailUrl && <img src={asset.thumbnailUrl} alt={asset.title || asset.originalName} className="h-full w-full object-cover" loading="lazy" />}
                  <span className="absolute left-1.5 top-1.5"><ConsentBadge consent={asset.consent} compact /></span>
                  {asset.usedIn > 0 && <span className="absolute right-1.5 top-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px]">w postach: {asset.usedIn}</span>}
                  {asset.status === 'proposed' && <span className="absolute bottom-1.5 left-1.5 rounded-full bg-sky-500/80 px-2 py-0.5 text-[10px] text-white">Propozycja</span>}
                </div>
                <div className="space-y-0.5 p-2">
                  <div className="truncate text-xs text-[#e5e4e2]">{asset.title || asset.originalName || 'Zdjęcie'}</div>
                  <div className="truncate text-[11px] text-[#e5e4e2]/45">{asset.eventName || asset.portfolioTitle || SOCIAL_ASSET_SOURCE_LABELS[asset.source]}</div>
                </div>
              </button>
            ))}
          </div>
          {pageCount > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <button type="button" className={secondaryButton} disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - (data?.limit || 60)))}>Poprzednie</button>
              <span className="text-[#e5e4e2]/50">{Math.floor(offset / (data?.limit || 60)) + 1} / {pageCount}</span>
              <button type="button" className={secondaryButton} disabled={offset + (data?.limit || 60) >= (data?.total || 0)} onClick={() => setOffset(offset + (data?.limit || 60))}>Następne</button>
            </div>
          )}
        </>
      )}

      {selected && <AssetModal id={selected} onClose={() => setSelected(null)} onCreatePost={onCreatePost}
        onChanged={() => { void load(); onChanged(); }} />}
      {importer && <ImportModal kind={importer} companyId={companyId} onClose={() => setImporter(null)}
        onImported={() => { void load(); onChanged(); }} />}
      {eventPicker && <EventPicker companyId={companyId} onClose={() => setEventPicker(false)} onPick={(item) => { setEvent(item); setOffset(0); setEventPicker(false); }} />}
    </section>
  );
}

/** Wybór wydarzenia (wyszukiwanie, dostęp jak w CRM). */
export function EventPicker({ companyId, onClose, onPick }: { companyId: string; onClose: () => void; onPick: (event: SocialEventOption) => void }) {
  const [query, setQuery] = useState('');
  const [events, setEvents] = useState<SocialEventOption[] | null>(null);
  const { showSnackbar } = useSnackbar();
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const result = await socialGet<{ events: SocialEventOption[] }>('events', { company: companyId, q: query.trim() });
        setEvents(result.events);
      } catch (cause) {
        showSnackbar(errorMessage(cause, 'Nie udało się pobrać wydarzeń.'), 'error');
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [companyId, query, showSnackbar]);
  return (
    <Modal open onClose={onClose} title="Wybierz wydarzenie" scrollBody>
      <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Nazwa wydarzenia" className={`${inputClass} mb-3`} />
      {!events ? <p className="text-sm text-[#e5e4e2]/50">Ładowanie…</p> : events.length === 0 ? <p className="text-sm text-[#e5e4e2]/50">Brak wydarzeń.</p> : (
        <div className="space-y-1.5">
          {events.map((item) => (
            <button key={item.id} type="button" onClick={() => onPick(item)} className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 p-3 text-left hover:border-[#d3bb73]/40">
              <div className="font-medium">{item.name}</div>
              <div className="text-xs text-[#e5e4e2]/50">{[shortDate(item.date), item.location, item.organizationName].filter(Boolean).join(' · ')}</div>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ImportModal({ kind, companyId, onClose, onImported }: { kind: 'event' | 'portfolio'; companyId: string; onClose: () => void; onImported: () => void }) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [event, setEvent] = useState<SocialEventOption | null>(null);
  const [files, setFiles] = useState<Array<{ id: string; name: string; url: string | null; imported: boolean }> | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; title: string; location: string; images: string[] }> | null>(null);
  const [project, setProject] = useState<string | null>(null);

  useEffect(() => {
    if (kind === 'portfolio') {
      socialGet<{ projects: Array<{ id: string; title: string; location: string; images: string[] }> }>('portfolio', {})
        .then((result) => setProjects(result.projects))
        .catch((cause) => showSnackbar(errorMessage(cause, 'Nie udało się pobrać realizacji.'), 'error'));
    }
  }, [kind, showSnackbar]);
  useEffect(() => {
    if (!event) return;
    setFiles(null);
    socialGet<{ files: Array<{ id: string; name: string; url: string | null; imported: boolean }> }>('eventImages', { event: event.id })
      .then((result) => setFiles(result.files))
      .catch((cause) => showSnackbar(errorMessage(cause, 'Nie udało się pobrać plików wydarzenia.'), 'error'));
  }, [event, showSnackbar]);

  const importOne = async (payload: Record<string, unknown>, label: string) => {
    showLoader('Dodaję zdjęcie do biblioteki', 'Kopiowanie i analiza zdjęcia…');
    try {
      const result = await socialPost<SocialAssetDetail>('assetImport', { companyId, ...payload });
      showSnackbar(result.duplicateOf ? `„${label}” jest już w bibliotece` : `Dodano „${label}” do biblioteki`, result.duplicateOf ? 'info' : 'success');
      onImported();
      return true;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się dodać zdjęcia.'), 'error');
      return false;
    } finally {
      hideLoader();
    }
  };

  if (kind === 'event' && !event) return <EventPicker companyId={companyId} onClose={onClose} onPick={setEvent} />;
  const current = projects?.find((item) => item.id === project);
  return (
    <Modal open onClose={onClose} title={kind === 'event' ? `Zdjęcia z wydarzenia „${event?.name || ''}”` : current ? current.title : 'Realizacje na stronie'} scrollBody>
      {kind === 'event' && (!files ? <p className="text-sm text-[#e5e4e2]/50">Ładowanie…</p> : files.length === 0 ? <p className="text-sm text-[#e5e4e2]/50">To wydarzenie nie ma zdjęć w plikach.</p> : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {files.map((file) => (
            <button key={file.id} type="button" disabled={file.imported}
              onClick={async () => { if (await importOne({ eventFileId: file.id }, file.name)) setFiles((list) => list?.map((item) => item.id === file.id ? { ...item, imported: true } : item) || null); }}
              className="relative overflow-hidden rounded-lg border border-[#d3bb73]/10 text-left disabled:opacity-50">
              {file.url ? <img src={file.url} alt={file.name} className="aspect-square w-full object-cover" loading="lazy" /> : <div className="aspect-square bg-[#0f1119]" />}
              <span className="block truncate p-1.5 text-[11px]">{file.name}</span>
              {file.imported && <span className="absolute right-1 top-1 rounded-full bg-emerald-500/80 p-1"><Check className="h-3 w-3" /></span>}
            </button>
          ))}
        </div>
      ))}
      {kind === 'portfolio' && !current && (!projects ? <p className="text-sm text-[#e5e4e2]/50">Ładowanie…</p> : (
        <div className="space-y-1.5">
          {projects.map((item) => (
            <button key={item.id} type="button" onClick={() => setProject(item.id)} className="flex w-full items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 p-2 text-left hover:border-[#d3bb73]/40">
              {item.images[0] ? <img src={item.images[0]} alt="" className="h-12 w-12 rounded object-cover" /> : <span className="h-12 w-12 rounded bg-[#1c1f33]" />}
              <span><span className="block text-sm">{item.title}</span><span className="text-xs text-[#e5e4e2]/50">{item.location} · {item.images.length} zdjęć</span></span>
            </button>
          ))}
        </div>
      ))}
      {kind === 'portfolio' && current && (
        <div>
          <button type="button" className={`${secondaryButton} mb-3`} onClick={() => setProject(null)}>Wszystkie realizacje</button>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {current.images.map((url) => (
              <button key={url} type="button" onClick={() => void importOne({ portfolioProjectId: current.id, imageUrl: url }, current.title)}
                className="overflow-hidden rounded-lg border border-[#d3bb73]/10 hover:border-[#d3bb73]/40">
                <img src={url} alt="" className="aspect-square w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}

function AssetModal({ id, onClose, onCreatePost, onChanged }: { id: string; onClose: () => void; onCreatePost: (assetId: string) => void; onChanged: () => void }) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showConfirm } = useDialog();
  const [detail, setDetail] = useState<SocialAssetDetail | null>(null);
  const [form, setForm] = useState({ title: '', note: '', visibleBrands: '', consentStatus: 'inherit' as SocialConsentStatus, consentChannels: [] as string[], consentNote: '' });
  const [eventPicker, setEventPicker] = useState(false);
  const [levelConsent, setLevelConsent] = useState<{ eventId?: string; organizationId?: string; label: string } | null>(null);

  const apply = (value: SocialAssetDetail) => {
    setDetail(value);
    setForm({
      title: value.asset.title, note: value.asset.note, visibleBrands: value.asset.visibleBrands.join(', '),
      consentStatus: value.asset.consentStatus, consentChannels: value.asset.consentChannels, consentNote: value.asset.consentNote,
    });
  };
  useEffect(() => {
    socialGet<SocialAssetDetail>('asset', { id }).then(apply).catch((cause) => showSnackbar(errorMessage(cause, 'Nie udało się pobrać zdjęcia.'), 'error'));
  }, [id, showSnackbar]);

  const update = async (patch: Record<string, unknown>, success: string) => {
    if (!detail) return;
    showLoader('Zapisuję zdjęcie');
    try {
      apply(await socialPost<SocialAssetDetail>('assetUpdate', { id, updatedAt: detail.asset.updatedAt, ...patch }));
      showSnackbar(success, 'success');
      onChanged();
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się zapisać zdjęcia.'), 'error');
    } finally {
      hideLoader();
    }
  };

  if (!detail) return <Modal open onClose={onClose} title="Zdjęcie"><p className="text-sm text-[#e5e4e2]/50">Ładowanie…</p></Modal>;
  const { asset, access, posts } = detail;
  const canEdit = access.create;
  const consentEditable = access.consent;
  return (
    <Modal open onClose={onClose} title={asset.title || asset.originalName || 'Zdjęcie'} scrollBody>
      <div className="space-y-4">
        {asset.workUrl || asset.thumbnailUrl ? <img src={asset.workUrl || asset.thumbnailUrl || ''} alt="" className="max-h-[50vh] w-full rounded-lg object-contain" /> : null}
        <div className="flex flex-wrap items-center gap-2 text-xs text-[#e5e4e2]/55">
          <span>{SOCIAL_ASSET_STATUS_LABELS[asset.status]}</span>·<span>{SOCIAL_ASSET_SOURCE_LABELS[asset.source]}</span>
          {asset.width && asset.height && <>·<span>{asset.width}×{asset.height} px</span></>}
          {asset.createdByName && <>·<span>dodał(a): {asset.createdByName}</span></>}
          <ConsentBadge consent={asset.consent} />
        </div>
        {canEdit && (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="text-sm">Opis zdjęcia<input value={form.title} maxLength={SOCIAL_LIMITS.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={`${inputClass} mt-1`} /></label>
            <label className="text-sm">Marki widoczne na zdjęciu (po przecinku)<input value={form.visibleBrands} onChange={(e) => setForm({ ...form, visibleBrands: e.target.value })} className={`${inputClass} mt-1`} /></label>
            <label className="text-sm md:col-span-2">Notatka<textarea value={form.note} maxLength={SOCIAL_LIMITS.note} rows={2} onChange={(e) => setForm({ ...form, note: e.target.value })} className={`${inputClass} mt-1`} /></label>
            <div className="md:col-span-2 flex flex-wrap gap-2">
              <button type="button" className={secondaryButton} onClick={() => setEventPicker(true)}><CalendarDays className="h-4 w-4" />{asset.eventName ? `Wydarzenie: ${asset.eventName}` : 'Powiąż z wydarzeniem'}</button>
              {asset.eventId && <button type="button" className={secondaryButton} onClick={() => void update({ eventId: null }, 'Usunięto powiązanie z wydarzeniem')}><X className="h-4 w-4" />Bez wydarzenia</button>}
              <button type="button" className={primaryButton} onClick={() => void update({
                title: form.title, note: form.note, visibleBrands: form.visibleBrands.split(',').map((item) => item.trim()).filter(Boolean),
              }, 'Zapisano opis zdjęcia')}>Zapisz opis</button>
            </div>
          </div>
        )}
        <div className="rounded-lg border border-[#d3bb73]/10 p-3">
          <h3 className="mb-1 text-sm font-medium">Zgoda klienta na publikację</h3>
          <p className="mb-3 text-xs text-[#e5e4e2]/50">Obowiązuje: {SOCIAL_CONSENT_LABELS[(asset.consent.status in SOCIAL_CONSENT_LABELS ? asset.consent.status : 'unknown') as SocialConsentStatus]} ({SOCIAL_CONSENT_SOURCE_LABELS[asset.consent.source]}). Kolejność: zdjęcie → wydarzenie → klient.</p>
          {consentEditable ? (
            <div className="space-y-2">
              <select value={form.consentStatus} onChange={(e) => setForm({ ...form, consentStatus: e.target.value as SocialConsentStatus })} className={inputClass}>
                {SOCIAL_CONSENT_STATUSES.map((value) => <option key={value} value={value}>{value === 'inherit' ? 'Dla zdjęcia: jak wydarzenie i klient' : `Dla zdjęcia: ${SOCIAL_CONSENT_LABELS[value]}`}</option>)}
              </select>
              {form.consentStatus === 'granted' && (
                <div className="flex flex-wrap gap-3 text-sm">
                  {SOCIAL_CONSENT_PLATFORMS.map((platform) => (
                    <label key={platform} className="flex items-center gap-1.5"><input type="checkbox" checked={form.consentChannels.includes(platform)}
                      onChange={(e) => setForm({ ...form, consentChannels: e.target.checked ? [...form.consentChannels, platform] : form.consentChannels.filter((item) => item !== platform) })} />{SOCIAL_CONSENT_PLATFORM_LABELS[platform]}</label>
                  ))}
                  <span className="text-xs text-[#e5e4e2]/40">Bez zaznaczenia — wszystkie platformy.</span>
                </div>
              )}
              <input value={form.consentNote} onChange={(e) => setForm({ ...form, consentNote: e.target.value })} placeholder="Notatka (np. mail klienta z 12.11)" className={inputClass} />
              <div className="flex flex-wrap gap-2">
                <button type="button" className={primaryButton} onClick={() => void update({ consentStatus: form.consentStatus, consentChannels: form.consentStatus === 'granted' ? form.consentChannels : [], consentNote: form.consentNote }, 'Zapisano zgodę dla zdjęcia')}>Zapisz zgodę zdjęcia</button>
                {asset.eventId && <button type="button" className={secondaryButton} onClick={() => setLevelConsent({ eventId: asset.eventId!, label: `wydarzenia „${asset.eventName || ''}”` })}>Zgoda dla całego wydarzenia</button>}
                {asset.organizationId && <button type="button" className={secondaryButton} onClick={() => setLevelConsent({ organizationId: asset.organizationId!, label: `klienta „${asset.organizationName || ''}”` })}>Zgoda dla klienta</button>}
              </div>
            </div>
          ) : <p className="text-xs text-[#e5e4e2]/45">Status zgody ustawia twórca treści albo akceptujący.</p>}
        </div>
        {posts.length > 0 && (
          <div className="text-sm"><h3 className="mb-1 font-medium">Użyte w postach</h3>
            <ul className="space-y-1 text-[#e5e4e2]/70">{posts.map((post) => <li key={post.id}>{post.title || 'Post bez tytułu'} · {post.status}</li>)}</ul>
          </div>
        )}
        {canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-[#d3bb73]/10 pt-4">
            {asset.status !== 'archived' && <button type="button" className={primaryButton} onClick={() => { onCreatePost(asset.id); onClose(); }}><Plus className="h-4 w-4" />Nowy post z tego zdjęcia</button>}
            {asset.status === 'proposed' && <button type="button" className={secondaryButton} onClick={() => void update({ status: 'ready' }, 'Zdjęcie przyjęte do biblioteki')}><Check className="h-4 w-4" />Przyjmij do biblioteki</button>}
            {asset.status !== 'archived'
              ? <button type="button" className={secondaryButton} onClick={() => void update({ status: 'archived' }, 'Zdjęcie przeniesione do archiwum')}><Archive className="h-4 w-4" />Do archiwum</button>
              : <button type="button" className={secondaryButton} onClick={() => void update({ status: 'ready' }, 'Zdjęcie przywrócone do biblioteki')}>Przywróć z archiwum</button>}
            {asset.usedIn === 0 && <button type="button" className={dangerButton} onClick={async () => {
              const ok = await showConfirm({ title: 'Usunąć zdjęcie?', message: 'Zdjęcie i jego wersje zostaną trwale usunięte z biblioteki. Tej operacji nie można cofnąć.', confirmText: 'Usuń trwale' });
              if (!ok) return;
              showLoader('Usuwam zdjęcie');
              try {
                await socialPost('assetDelete', { id });
                showSnackbar('Usunięto zdjęcie z biblioteki', 'success');
                onChanged();
                onClose();
              } catch (cause) {
                showSnackbar(errorMessage(cause, 'Nie udało się usunąć zdjęcia.'), 'error');
              } finally {
                hideLoader();
              }
            }}><Trash2 className="h-4 w-4" />Usuń</button>}
          </div>
        )}
      </div>
      {eventPicker && <EventPicker companyId={asset.companyId} onClose={() => setEventPicker(false)} onPick={(item) => { setEventPicker(false); void update({ eventId: item.id }, 'Powiązano zdjęcie z wydarzeniem'); }} />}
      {levelConsent && <LevelConsentModal target={levelConsent} onClose={() => setLevelConsent(null)} onSaved={() => { setLevelConsent(null); socialGet<SocialAssetDetail>('asset', { id }).then(apply).catch(() => undefined); onChanged(); }} />}
    </Modal>
  );
}

/** Zgoda dla całego wydarzenia albo klienta (domyślna dla zdjęć bez własnej zgody). */
export function LevelConsentModal({ target, onClose, onSaved }: { target: { eventId?: string; organizationId?: string; label: string }; onClose: () => void; onSaved: () => void }) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [status, setStatus] = useState('granted');
  const [channels, setChannels] = useState<string[]>([]);
  const [note, setNote] = useState('');
  return (
    <Modal open onClose={onClose} title={`Zgoda ${target.label}`}>
      <div className="space-y-3">
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
          {(['unknown', 'requested', 'granted', 'denied', 'not_required'] as const).map((value) => <option key={value} value={value}>{SOCIAL_CONSENT_LABELS[value]}</option>)}
        </select>
        {status === 'granted' && (
          <div className="flex flex-wrap gap-3 text-sm">
            {SOCIAL_CONSENT_PLATFORMS.map((platform) => (
              <label key={platform} className="flex items-center gap-1.5"><input type="checkbox" checked={channels.includes(platform)}
                onChange={(e) => setChannels(e.target.checked ? [...channels, platform] : channels.filter((item) => item !== platform))} />{SOCIAL_CONSENT_PLATFORM_LABELS[platform]}</label>
            ))}
          </div>
        )}
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Notatka (np. zgoda w umowie, mail klienta)" className={inputClass} />
        <button type="button" className={primaryButton} onClick={async () => {
          showLoader('Zapisuję zgodę');
          try {
            await socialPost('consent', { eventId: target.eventId, organizationId: target.organizationId, status, channels: status === 'granted' ? channels : [], note });
            showSnackbar('Zapisano zgodę klienta', 'success');
            onSaved();
          } catch (cause) {
            showSnackbar(errorMessage(cause, 'Nie udało się zapisać zgody.'), 'error');
          } finally {
            hideLoader();
          }
        }}>Zapisz zgodę</button>
      </div>
    </Modal>
  );
}
