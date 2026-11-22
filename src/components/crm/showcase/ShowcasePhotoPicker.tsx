'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, Award, Check, Images, Library, Loader2, Package, Plus, Search, Sparkles, Upload, X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SHOWCASE_LIMITS, showcaseMediaKey, type ShowcaseAlbumOption, type ShowcasePickPhoto } from '@/lib/showcase/showcaseShared';
import { materialsPost } from '../materials/materialsApi';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import {
  errorMessage, showcaseGet, showcasePost, showcaseUploadPhoto, showcaseUploadSummary, type ShowcasePhotoBaseReply, type ShowcasePhotoSource,
  type ShowcaseProductOption, type ShowcaseRealizationOption, type ShowcaseUploadResult,
} from './showcaseApi';
import { hasFiles, imageFiles } from './showcaseUi';

/*
 * Wybór zdjęć do prezentacji (okładka działu, zdjęcie główne, blok zdjęć) — pełna szerokość ekranu:
 * • Baza zdjęć — Materiały (wszystkie zdjęcia marek z dostępem) i albumy. „Wgraj z dysku” i przeciągnięcie plików zapisują
 *   zdjęcia w Materiałach → marka → Zdjęcia (ten sam plik drugi raz się nie zapisze). Karta trzyma odnośnik do pliku, a do
 *   pokazu serwer przygotowuje jedną wspólną wersję WebP. Kafelek przeciągnięty na album trafia do albumu (odnośnik).
 * • Produkty i Realizacje — lista z miniaturą zdjęcia głównego, po kliknięciu zdjęcia produktu / realizacji (bez kopiowania).
 * • Social media — kopia zdjęcia z biblioteki (tylko gdy jest już karta albo dział).
 * Zaznaczenie zostaje przy zmianie zakładki; zapis karty — „Zapisz”.
 */

type Owner = { id: string; name: string };
type ListOwner = { id: string; name: string; detail: string; thumb: string | null; inCard: boolean };
type Entry = { key: string; source: ShowcasePhotoSource; photo: ShowcasePickPhoto; ready?: ShowcaseUploadResult };
const FILE_DRAG = 'application/x-mavinci-material-file';

const TABS: Array<[ShowcasePhotoSource, string, typeof Images]> = [
  ['material', 'Baza zdjęć', Images],
  ['product', 'Produkty', Package],
  ['site', 'Realizacje', Award],
  ['social', 'Social media', Sparkles],
];

const baseName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '');

export default function ShowcasePhotoPicker({ target, products, single = false, title = 'Dodaj zdjęcia', onClose, onPick }: {
  /** Karta albo dział (nowy dział — bez identyfikatora: tylko baza zdjęć, produkty i realizacje). */
  target: { itemId?: string; sectionId?: string };
  /** Produkty karty — pierwsze na liście „Produkty”. */
  products: Owner[];
  single?: boolean;
  title?: string;
  onClose: () => void;
  onPick: (results: ShowcaseUploadResult[]) => void;
}) {
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showSnackbar } = useSnackbar();
  const canCopy = Boolean(target.itemId || target.sectionId);
  const tabs = TABS.filter(([key]) => key !== 'social' || canCopy);
  const [source, setSource] = useState<ShowcasePhotoSource>('material');
  const [query, setQuery] = useState('');
  const [base, setBase] = useState<ShowcasePhotoBaseReply | null>(null);
  const [album, setAlbum] = useState<string | null>(null);
  const [owners, setOwners] = useState<ListOwner[]>([]);
  const [owner, setOwner] = useState<Owner | null>(null);
  const [photos, setPhotos] = useState<ShowcasePickPhoto[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Entry[]>([]);
  const [dropOver, setDropOver] = useState(false);
  const [albumDrop, setAlbumDrop] = useState<string | null>(null);
  const [newAlbum, setNewAlbum] = useState<string | null>(null);
  const dragDepth = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);

  const loadBase = useCallback(async () => {
    try {
      setBase(await showcaseGet<ShowcasePhotoBaseReply>('photoBase'));
    } catch (cause) {
      setBase({ base: null, albums: [], canView: false, problem: errorMessage(cause, 'Nie udało się wczytać bazy zdjęć.') });
    }
  }, []);
  useEffect(() => { void loadBase(); }, [loadBase]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Listy produktów i realizacji (z miniaturą zdjęcia głównego); produkty karty — pierwsze.
  useEffect(() => {
    if ((source !== 'product' && source !== 'site') || owner) { setOwners([]); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        if (source === 'product') {
          const data = await showcaseGet<{ products: ShowcaseProductOption[] }>('products', { q: query });
          const inCard = new Set(products.map((item) => item.id));
          const list = data.products.map((item) => ({
            id: item.id, name: item.name, detail: item.category, thumb: item.thumbnailUrl, inCard: inCard.has(item.id),
          }));
          if (active) setOwners([...list.filter((item) => item.inCard), ...list.filter((item) => !item.inCard)]);
        } else {
          const data = await showcaseGet<{ realizations: ShowcaseRealizationOption[] }>('realizations', { q: query });
          if (active) {
            setOwners(data.realizations.map((item) => ({
              id: item.id, name: item.title, inCard: false, thumb: item.thumbnailUrl,
              detail: [item.location, item.date?.slice(0, 4), `${item.photos} zdj.`].filter(Boolean).join(' · '),
            })));
          }
        }
        if (active) setProblem('');
      } catch (cause) {
        if (active) { setOwners([]); setProblem(errorMessage(cause, 'Nie udało się pobrać listy.')); }
      } finally {
        if (active) setLoading(false);
      }
    }, query ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source, query, owner, products]);

  // Zdjęcia: baza (wszystkie / album), produkt, realizacja, social media.
  const loadPhotos = useCallback(async (offset: number) => {
    const params: Record<string, string | number | null> = { source };
    if (source === 'product') params.product = owner?.id || null;
    if (source === 'site') params.realization = owner?.id || null;
    if (source === 'material') { params.album = album; params.offset = offset; }
    if (source === 'material' || source === 'social') params.q = query;
    return showcaseGet<{ photos: ShowcasePickPhoto[]; problem?: string; hasMore?: boolean }>('photos', params);
  }, [source, owner, album, query]);

  useEffect(() => {
    if ((source === 'product' || source === 'site') && !owner) { setPhotos([]); setHasMore(false); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await loadPhotos(0);
        if (!active) return;
        setPhotos(data.photos);
        setHasMore(Boolean(data.hasMore));
        setProblem(data.problem || (data.photos.length ? '' : source === 'material' && !query && !album
          ? 'Baza zdjęć jest pusta — wgraj zdjęcia z dysku albo przeciągnij je tutaj.' : 'Brak zdjęć (JPEG, PNG, WebP).'));
      } catch (cause) {
        if (active) { setPhotos([]); setProblem(errorMessage(cause, 'Nie udało się pobrać zdjęć.')); }
      } finally {
        if (active) setLoading(false);
      }
    }, query && (source === 'material' || source === 'social') ? 300 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source, owner, album, query, loadPhotos]);

  const loadMore = async () => {
    setLoading(true);
    try {
      const data = await loadPhotos(photos.length);
      setPhotos((current) => [...current, ...data.photos.filter((photo) => !current.some((item) => item.id === photo.id))]);
      setHasMore(Boolean(data.hasMore));
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się pobrać zdjęć.'), 'error');
    } finally {
      setLoading(false);
    }
  };

  const entryKey = (kind: ShowcasePhotoSource, photo: ShowcasePickPhoto) => `${kind}:${photo.media ? showcaseMediaKey(photo.media) : photo.id}`;
  const isSelected = (key: string) => selected.some((entry) => entry.key === key);
  const toggle = (photo: ShowcasePickPhoto) => {
    const key = entryKey(source, photo);
    const entry: Entry = { key, source, photo };
    setSelected((current) => {
      if (current.some((item) => item.key === key)) return current.filter((item) => item.key !== key);
      return single ? [entry] : [...current, entry];
    });
  };

  const switchSource = (next: ShowcasePhotoSource) => {
    if (next === source) return;
    setSource(next); setQuery(''); setOwner(null); setPhotos([]); setProblem(''); setHasMore(false);
  };

  // Wgrywanie z dysku → baza zdjęć (Materiały → Zdjęcia).
  const canUpload = Boolean(base?.base) || canCopy;
  const upload = async (list: FileList | File[]) => {
    const { images, heic, other } = imageFiles(list);
    if (heic) showSnackbar('Zdjęcia HEIC: zapisz je jako JPEG albo dodaj z aplikacji na Maca (zamienia HEIC sama).', 'warning');
    if (!images.length) { if (!heic) showSnackbar(other ? 'Wybierz zdjęcia JPEG, PNG albo WebP.' : 'Brak zdjęć do dodania.', 'warning'); return; }
    if (!canUpload) { showSnackbar('Do wgrywania potrzebne jest uprawnienie „Materiały — zarządzanie”.', 'warning'); return; }
    const files = single ? images.slice(0, 1) : images.slice(0, 40);
    const results: ShowcaseUploadResult[] = [];
    showLoader('Wgrywam zdjęcia do bazy', `0 z ${files.length}`);
    try {
      for (const [index, file] of files.entries()) {
        showLoader('Wgrywam zdjęcia do bazy', `${index + 1} z ${files.length}: ${file.name}`);
        if (file.size > SHOWCASE_LIMITS.uploadBytes) { showSnackbar(`${file.name}: zdjęcie może mieć najwyżej 40 MB.`, 'warning'); continue; }
        results.push(await showcaseUploadPhoto(target, file));
      }
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się wgrać zdjęcia.'), 'error');
    } finally {
      hideLoader();
    }
    if (!results.length) return;
    if (single) { showSnackbar(showcaseUploadSummary(results, ''), 'success'); onPick(results); return; }
    const entries: Entry[] = results.map((result) => {
      const key = `upload:${showcaseMediaKey(result.photo)}`;
      return {
        key, source: 'material', ready: result,
        photo: {
          id: result.file?.id || key, name: result.file?.name || result.photo.caption || 'Zdjęcie',
          thumbnailUrl: result.urls[showcaseMediaKey(result.photo)]?.thumb || null, url: result.urls[showcaseMediaKey(result.photo)]?.url || null,
          width: result.photo.width, height: result.photo.height, media: result.photo,
        },
      };
    });
    setSelected((current) => [...current.filter((item) => !entries.some((entry) => entry.key === item.key)), ...entries]);
    showSnackbar(`${showcaseUploadSummary(results, '')}. Zaznaczone — kliknij „Dodaj”.`, 'success');
    void loadBase();
  };

  const panelDrop = {
    onDragEnter: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; event.preventDefault(); dragDepth.current += 1; setDropOver(true); },
    onDragOver: (event: DragEvent<HTMLElement>) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (event: DragEvent<HTMLElement>) => { if (!hasFiles(event)) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDropOver(false); },
    onDrop: (event: DragEvent<HTMLElement>) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDropOver(false);
      void upload(event.dataTransfer.files);
    },
  };

  // Albumy: kafelek z bazy przeciągnięty na album → odnośnik w albumie (bez kopiowania pliku).
  const addToAlbum = async (target: ShowcaseAlbumOption, fileIds: string[]) => {
    if (!fileIds.length) return;
    showLoader('Dodaję do albumu', target.name);
    try {
      const result = await materialsPost<{ added: number; skipped: number }>('albumAdd', { id: target.id, fileIds });
      showSnackbar(result.added
        ? `Dodano do albumu „${target.name}”: ${result.added}`
        : `Album „${target.name}” ma już to zdjęcie albo zdjęcie należy do innej marki.`, result.added ? 'success' : 'info');
      void loadBase();
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się dodać do albumu.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const materialIds = (entries: Entry[]) => Array.from(new Set(entries.filter((entry) => entry.source === 'material')
    .map((entry) => entry.ready?.file?.id || (entry.ready ? '' : entry.photo.id)).filter(Boolean)));

  const createAlbum = async () => {
    const name = (newAlbum || '').trim();
    if (!name || !base?.base) return;
    showLoader('Tworzę album', name);
    try {
      const result = await materialsPost<{ album: { id: string }; added: number }>('createAlbum', {
        companyId: base.base.companyId, name, fileIds: materialIds(selected),
      });
      showSnackbar(result.added ? `Utworzono album „${name}” (${result.added} zdj.)` : `Utworzono album „${name}”`, 'success');
      setNewAlbum(null);
      await loadBase();
      setSource('material');
      setAlbum(result.album.id);
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się utworzyć albumu.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const confirm = async () => {
    if (!selected.length) return;
    const results: ShowcaseUploadResult[] = [];
    showLoader('Dodaję zdjęcia', `0 z ${selected.length}`);
    try {
      for (const [index, entry] of selected.entries()) {
        showLoader('Dodaję zdjęcia', `${index + 1} z ${selected.length}: ${entry.photo.name}`);
        if (entry.ready) { results.push(entry.ready); continue; }
        const media = entry.photo.media;
        if (media) {
          // Zdjęcie produktu albo realizacji — bez kopiowania (adresy z listy).
          const thumb = entry.photo.thumbnailUrl || (media.source === 'site' ? media.thumb || media.path : null);
          const url = entry.photo.url || (media.source === 'site' ? media.path : thumb);
          results.push({ photo: media, urls: { [showcaseMediaKey(media)]: { url, thumb: thumb || url } } });
        } else if (entry.source === 'material') {
          results.push(await showcasePost<ShowcaseUploadResult>('import', {
            ...target, source: 'material', reference: true, fileId: entry.photo.id, caption: baseName(entry.photo.name),
          }));
        } else {
          results.push(await showcasePost<ShowcaseUploadResult>('import', { ...target, source: entry.source, fileId: entry.photo.id, caption: baseName(entry.photo.name) }));
        }
      }
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się dodać zdjęcia.'), 'error');
    } finally {
      hideLoader();
    }
    if (results.length) onPick(results);
  };

  const albums = base?.albums || [];
  const currentAlbum = albums.find((item) => item.id === album) || null;
  const placeholder = source === 'product' ? 'Szukaj produktu w katalogu' : source === 'site' ? 'Szukaj realizacji'
    : source === 'material' ? (currentAlbum ? `Szukaj w albumie „${currentAlbum.name}”` : 'Szukaj w bazie zdjęć po nazwie pliku') : 'Szukaj po nazwie';
  const showOwners = (source === 'product' || source === 'site') && !owner;
  const selectedNow = useMemo(() => new Set(selected.map((entry) => entry.key)), [selected]);

  const tile = (photo: ShowcasePickPhoto) => {
    const key = entryKey(source, photo);
    const active = selectedNow.has(key);
    const draggable = source === 'material' && albums.length > 0;
    return (
      <button key={key} type="button" onClick={() => toggle(photo)} title={photo.name} draggable={draggable}
        onDragStart={draggable ? (event) => { event.dataTransfer.setData(FILE_DRAG, photo.id); event.dataTransfer.effectAllowed = 'copy'; } : undefined}
        className={`${cardClass} group relative aspect-[4/3] overflow-hidden text-left ${active ? 'ring-2 ring-[#d3bb73]' : 'hover:border-[#d3bb73]/40'}`}>
        {photo.thumbnailUrl ? <img src={photo.thumbnailUrl} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" />
          : <span className="flex h-full w-full items-center justify-center"><Images className="h-6 w-6 text-[#d3bb73]/30" /></span>}
        <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-2 py-1 text-[11px] text-white/85 opacity-0 transition-opacity group-hover:opacity-100">{photo.name}</span>
        {active && <span className="absolute right-1.5 top-1.5 rounded-full bg-[#d3bb73] p-0.5 text-[#1c1f33]"><Check className="h-4 w-4" /></span>}
      </button>
    );
  };

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm sm:p-6" role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div {...panelDrop} className="relative flex h-full max-h-[920px] w-full max-w-[1500px] flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/15 bg-[#1c1f33] text-[#e5e4e2] shadow-2xl">
          <header className="flex flex-wrap items-center gap-3 border-b border-[#d3bb73]/10 px-5 py-4">
            <h2 className="mr-auto text-xl font-light">{title}</h2>
            <div className="flex flex-wrap gap-1">
              {tabs.map(([key, label, Icon]) => (
                <button key={key} type="button" onClick={() => switchSource(key)}
                  className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-sm ${source === key ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'}`}>
                  <Icon className="h-4 w-4" />{label}
                </button>
              ))}
            </div>
            <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded-lg p-2 text-[#e5e4e2]/60 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]"><X className="h-5 w-5" /></button>
          </header>

          <div className="flex min-h-0 flex-1">
            {source === 'material' && (
              <aside className="hidden w-64 shrink-0 space-y-1 overflow-y-auto border-r border-[#d3bb73]/10 p-3 md:block">
                <button type="button" onClick={() => { setAlbum(null); setQuery(''); }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm ${!album ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/75 hover:bg-[#e5e4e2]/5'}`}>
                  <Images className="h-4 w-4 shrink-0" /><span className="truncate">Wszystkie zdjęcia</span>
                </button>
                <div className="flex items-center justify-between px-2 pb-1 pt-3 text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
                  <span>Albumy</span>
                  {base?.base && <button type="button" onClick={() => setNewAlbum(newAlbum === null ? '' : null)} className="rounded p-0.5 text-[#d3bb73] hover:bg-[#d3bb73]/10" aria-label="Nowy album" title="Nowy album (z zaznaczonych zdjęć)"><Plus className="h-4 w-4" /></button>}
                </div>
                {newAlbum !== null && (
                  <form className="space-y-1.5 px-1 pb-2" onSubmit={(event) => { event.preventDefault(); void createAlbum(); }}>
                    <input autoFocus value={newAlbum} maxLength={120} onChange={(event) => setNewAlbum(event.target.value)} placeholder="Nazwa albumu" className={inputClass} />
                    <button type="submit" className={`${primaryButton} w-full`} disabled={!newAlbum.trim()}>
                      Utwórz{materialIds(selected).length ? ` z zaznaczonych (${materialIds(selected).length})` : ''}
                    </button>
                  </form>
                )}
                {albums.map((item) => (
                  <button key={item.id} type="button" onClick={() => { setAlbum(item.id); setQuery(''); }}
                    onDragOver={(event) => { if (Array.from(event.dataTransfer.types).includes(FILE_DRAG)) { event.preventDefault(); setAlbumDrop(item.id); } }}
                    onDragLeave={() => setAlbumDrop((current) => (current === item.id ? null : current))}
                    onDrop={(event) => {
                      const id = event.dataTransfer.getData(FILE_DRAG);
                      setAlbumDrop(null);
                      if (!id) return;
                      event.preventDefault();
                      const many = selected.some((entry) => entry.source === 'material' && entry.photo.id === id) ? materialIds(selected) : [id];
                      void addToAlbum(item, many);
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${album === item.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/75 hover:bg-[#e5e4e2]/5'} ${albumDrop === item.id ? 'ring-2 ring-[#d3bb73]' : ''}`}>
                    {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" className="h-8 w-8 shrink-0 rounded object-cover" />
                      : <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-[#0f1119]"><Library className="h-4 w-4 text-[#d3bb73]/40" /></span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{item.name}</span>
                      <span className="block truncate text-[11px] text-[#e5e4e2]/40">{item.count} zdj.{albums.some((other) => other.companyId !== item.companyId) ? ` · ${item.companyName}` : ''}</span>
                    </span>
                  </button>
                ))}
                {base?.canView && !albums.length && <p className="px-2 text-xs text-[#e5e4e2]/40">Brak albumów. Utwórz album („+”) i przeciągaj na niego zdjęcia — trafią tam jako odnośniki, bez kopii.</p>}
                {base && !base.canView && <p className="px-2 text-xs text-[#e5e4e2]/50">{base.problem}</p>}
              </aside>
            )}

            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex flex-wrap items-center gap-2 px-5 pb-3 pt-4">
                {owner && (
                  <button type="button" className={secondaryButton} onClick={() => { setOwner(null); setPhotos([]); }}>
                    <ArrowLeft className="h-4 w-4" />{source === 'product' ? 'Produkty' : 'Realizacje'}
                  </button>
                )}
                {owner && <span className="min-w-0 truncate text-sm text-[#d3bb73]">{owner.name}</span>}
                {!owner && (
                  <label className="relative min-w-[220px] flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/40" />
                    <input value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} pl-8`} placeholder={placeholder} />
                  </label>
                )}
                {source === 'material' && (
                  <>
                    <button type="button" className={secondaryButton} disabled={!canUpload} onClick={() => fileInput.current?.click()}
                      title={base?.base ? `Zdjęcia trafią do: Materiały → ${base.base.companyName} → ${base.base.folderName}` : canCopy ? 'Bez uprawnień do Materiałów zdjęcie zostanie tylko w prezentacji' : 'Potrzebne uprawnienie „Materiały — zarządzanie”'}>
                      <Upload className="h-4 w-4" />Wgraj z dysku
                    </button>
                    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple={!single} className="hidden"
                      onChange={(event) => { if (event.target.files?.length) void upload(Array.from(event.target.files)); event.target.value = ''; }} />
                  </>
                )}
              </div>
              {source === 'material' && albums.length > 0 && (
                <div className="flex gap-1.5 overflow-x-auto px-5 pb-2 md:hidden">
                  <button type="button" onClick={() => setAlbum(null)} className={`shrink-0 rounded-full border px-3 py-1 text-xs ${!album ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-[#d3bb73]/20 text-[#e5e4e2]/70'}`}>Wszystkie</button>
                  {albums.map((item) => (
                    <button key={item.id} type="button" onClick={() => setAlbum(item.id)} className={`shrink-0 rounded-full border px-3 py-1 text-xs ${album === item.id ? 'border-[#d3bb73] text-[#d3bb73]' : 'border-[#d3bb73]/20 text-[#e5e4e2]/70'}`}>{item.name}</button>
                  ))}
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4">
                {showOwners ? (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                    {owners.map((item) => (
                      <button key={item.id} type="button" onClick={() => setOwner({ id: item.id, name: item.name })}
                        className={`${cardClass} group overflow-hidden text-left hover:border-[#d3bb73]/40`}>
                        <span className="block aspect-[4/3] w-full overflow-hidden bg-[#0f1119]">
                          {item.thumb ? <img src={item.thumb} alt="" className="h-full w-full object-cover transition-transform group-hover:scale-[1.03]" loading="lazy" />
                            : <span className="flex h-full w-full items-center justify-center">{source === 'product' ? <Package className="h-7 w-7 text-[#d3bb73]/30" /> : <Award className="h-7 w-7 text-[#d3bb73]/30" />}</span>}
                        </span>
                        <span className="block space-y-0.5 px-3 py-2">
                          <span className="block truncate text-sm">{item.name}</span>
                          <span className="block truncate text-[11px] text-[#e5e4e2]/45">{item.inCard ? 'W tej karcie' : item.detail || ' '}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-[repeat(auto-fill,minmax(170px,1fr))] gap-2.5">
                    {source === 'material' && !album && !query && selected.filter((entry) => entry.ready).map((entry) => (
                      <button key={entry.key} type="button" onClick={() => setSelected((current) => current.filter((item) => item.key !== entry.key))} title={`${entry.photo.name} — wgrane teraz`}
                        className={`${cardClass} relative aspect-[4/3] overflow-hidden ring-2 ring-[#d3bb73]`}>
                        {entry.photo.thumbnailUrl ? <img src={entry.photo.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : null}
                        <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/85">Wgrane teraz</span>
                        <span className="absolute right-1.5 top-1.5 rounded-full bg-[#d3bb73] p-0.5 text-[#1c1f33]"><Check className="h-4 w-4" /></span>
                      </button>
                    ))}
                    {photos.map(tile)}
                  </div>
                )}
                {hasMore && !showOwners && (
                  <div className="mt-4 flex justify-center"><button type="button" className={secondaryButton} disabled={loading} onClick={() => void loadMore()}>Wczytaj więcej</button></div>
                )}
                {(loading || problem) && (
                  <p className="mt-4 flex items-center gap-2 text-sm text-[#e5e4e2]/50">{loading ? <><Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />Wczytuję…</> : problem}</p>
                )}
              </div>
            </section>
          </div>

          <footer className="flex flex-wrap items-center gap-3 border-t border-[#d3bb73]/10 px-5 py-3">
            <p className="mr-auto text-xs text-[#e5e4e2]/45">
              {source === 'material'
                ? (base?.base ? `Zdjęcia z dysku trafiają do bazy: Materiały → ${base.base.companyName} → ${base.base.folderName}. Karta trzyma odnośnik, bez kopii.` : 'Baza zdjęć — Materiały i albumy.')
                : source === 'social' ? 'Zdjęcie z biblioteki social media zapisze się w prezentacji.' : 'Zdjęcia produktów i realizacji pokazujemy bez kopiowania.'}
            </p>
            {selected.length > 0 && !single && (
              <button type="button" className="text-xs text-[#e5e4e2]/50 hover:text-[#e5e4e2]" onClick={() => setSelected([])}>Wyczyść zaznaczenie</button>
            )}
            <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
            <button type="button" className={primaryButton} disabled={!selected.length} onClick={() => void confirm()}>
              {single ? 'Wybierz' : `Dodaj (${selected.length})`}
            </button>
          </footer>

          {dropOver && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-[#0f1119]/75">
              <p className="rounded-xl border border-[#d3bb73]/40 bg-[#1c1f33] px-5 py-4 text-sm text-[#d3bb73]">
                {canUpload ? (base?.base ? `Upuść, aby wgrać do bazy zdjęć (Materiały → ${base.base.folderName})` : 'Upuść, aby dodać zdjęcia') : 'Wgrywanie wymaga uprawnienia „Materiały — zarządzanie”'}
              </p>
            </div>
          )}
        </div>
      </div>
    </OverlayPortal>
  );
}
