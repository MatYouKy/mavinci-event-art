'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Home, Loader2, Search, X } from 'lucide-react';
import {
  materialsGet, type MaterialFile, type MaterialFolder, type MaterialSearchHit, type MaterialsHome, type MaterialsListing, type MaterialsSearch,
} from './materialsApi';
import { MaterialThumb, errorMessage, folderIcon, ghostButton, inputClass, primaryButton, secondaryButton } from './materialsUi';

/*
 * Wybór zdjęcia z Dysku (Materiały), np. zdjęcia produktu do oferty: marka, foldery jak w Dysku (start — „Zdjęcia”), wyszukiwanie
 * po nazwie, opisie i tagach, miniatury; tylko zdjęcia JPG, PNG i WebP. Klik zaznacza, dwuklik albo „Użyj zdjęcia” — wybiera.
 * Zwraca plik i jego miejsce („Marka / folder / …”). Uprawnienia jak w Dysku (RLS). Okno to natywny `<dialog>` (warstwa wierzchnia),
 * więc otwiera się także nad innym oknem `<dialog>` (np. grafiką produktu). Mac — `MaterialPhotoPicker.swift`.
 */

export type PickedMaterialPhoto = { file: MaterialFile; place: string };

const PHOTO_MIME = ['image/jpeg', 'image/png', 'image/webp'];
const PAGE = 120;
const isPhoto = (file: MaterialFile) => file.kind === 'image' && PHOTO_MIME.includes(file.mime.toLowerCase());

export default function MaterialPhotoPicker({ title, onPick, onClose }: {
  title: string;
  onPick: (photo: PickedMaterialPhoto) => void;
  onClose: () => void;
}) {
  const [home, setHome] = useState<MaterialsHome | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [listing, setListing] = useState<MaterialsListing | null>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<MaterialSearchHit[] | null>(null);
  const [selected, setSelected] = useState<PickedMaterialPhoto | null>(null);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);

  const openCompany = useCallback(async (company?: string) => {
    setLoading(true);
    setProblem('');
    try {
      const next = await materialsGet<MaterialsHome>('home', { company });
      setHome(next);
      setListing(null);
      setSelected(null);
      // Start w folderze „Zdjęcia” marki (baza zdjęć), gdy jest.
      setFolderId(next.folders.find((folder) => folder.systemKey === 'photos' && !folder.parentId)?.id ?? null);
    } catch (cause) {
      setProblem(errorMessage(cause, 'Nie udało się otworzyć Dysku.'));
      setLoading(false);
    }
  }, []);

  useEffect(() => { void openCompany(); }, [openCompany]);

  useEffect(() => {
    if (!home) return;
    let active = true;
    setLoading(true);
    materialsGet<MaterialsListing>('list', { company: home.company.id, folder: folderId, sort: 'date', limit: PAGE })
      .then((next) => { if (active) { setListing(next); setProblem(''); } })
      .catch((cause) => { if (active) setProblem(errorMessage(cause, 'Nie udało się pobrać folderu.')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [home, folderId]);

  useEffect(() => {
    const q = query.trim();
    if (!home || q.length < 2) { setHits(null); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const result = await materialsGet<MaterialsSearch>('search', { q, company: home.company.id });
        if (active) { setHits(result.materials.filter(isPhoto)); setProblem(''); }
      } catch (cause) {
        if (active) setProblem(errorMessage(cause, 'Nie udało się przeszukać Dysku.'));
      } finally {
        if (active) setLoading(false);
      }
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [home, query]);

  const loadMore = async () => {
    if (!home || !listing) return;
    setLoading(true);
    try {
      const next = await materialsGet<MaterialsListing>('list', {
        company: home.company.id, folder: folderId, sort: 'date', limit: PAGE, offset: listing.files.length,
      });
      setListing({ ...next, files: [...listing.files, ...next.files.filter((file) => !listing.files.some((item) => item.id === file.id))] });
    } catch (cause) {
      setProblem(errorMessage(cause, 'Nie udało się pobrać kolejnych plików.'));
    } finally {
      setLoading(false);
    }
  };

  const folderPlace = useMemo(
    () => [home?.company.name || 'Marka', ...(listing?.path || []).map((folder) => folder.name)].join(' / '),
    [home, listing],
  );
  const photos: PickedMaterialPhoto[] = hits
    ? hits.map((hit) => ({ file: hit, place: [hit.companyName, ...hit.path.map((entry) => entry.name)].join(' / ') }))
    : (listing?.files || []).filter(isPhoto).map((file) => ({ file, place: folderPlace }));
  const folders: MaterialFolder[] = hits ? [] : listing?.folders || [];
  const hidden = hits ? 0 : (listing?.files.length || 0) - photos.length;

  return (
    <dialog ref={dialog} aria-label={title} onCancel={(event) => { event.preventDefault(); onClose(); }}
      className="m-auto h-[min(760px,90dvh)] w-[calc(100%_-_2rem)] max-w-4xl overflow-hidden rounded-2xl border border-[#d3bb73]/15 bg-[#1c1f33] p-0 text-[#e5e4e2] shadow-2xl backdrop:bg-black/70">
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 px-5 py-4">
            <h2 className="min-w-0 flex-1 truncate text-lg font-light">{title}</h2>
            <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg p-2 hover:bg-white/5"><X className="h-5 w-5" /></button>
          </header>
          <div className="flex flex-wrap items-center gap-2 border-b border-[#d3bb73]/10 px-5 pb-3">
            {home && home.companies.length > 1 && (
              <select value={home.company.id} onChange={(event) => void openCompany(event.target.value)} aria-label="Marka"
                className="rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33] px-2 py-1.5 text-sm">
                {home.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}
              </select>
            )}
            <label className="relative min-w-[200px] flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj zdjęcia w Dysku (nazwa, opis, tagi)"
                className={`${inputClass} pl-8`} />
            </label>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />}
          </div>
          {!hits && home && (
            <nav className="flex flex-wrap items-center gap-1 px-5 pt-3 text-sm" aria-label="Ścieżka">
              <button type="button" onClick={() => setFolderId(null)} className="flex items-center gap-1 text-[#d3bb73] hover:underline">
                <Home className="h-3.5 w-3.5" />{home.company.name}
              </button>
              {(listing?.path || []).map((folder) => (
                <span key={folder.id} className="flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
                  <button type="button" onClick={() => setFolderId(folder.id)} className="text-[#d3bb73] hover:underline">{folder.name}</button>
                </span>
              ))}
            </nav>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">
            {problem && <p role="alert" className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{problem}</p>}
            <div className="grid grid-cols-[repeat(auto-fill,minmax(128px,1fr))] gap-3">
              {folders.map((folder) => {
                const Icon = folderIcon(folder.systemKey);
                return (
                  <button key={folder.id} type="button" onClick={() => setFolderId(folder.id)}
                    className="flex flex-col items-center gap-2 rounded-lg border border-[#d3bb73]/10 p-3 text-center text-xs hover:border-[#d3bb73]/30">
                    <Icon className="h-10 w-10 text-[#d3bb73]/80" strokeWidth={1.3} />
                    <span className="line-clamp-2 break-words">{folder.name}</span>
                  </button>
                );
              })}
              {photos.map((photo) => {
                const active = selected?.file.id === photo.file.id;
                return (
                  <button key={photo.file.id} type="button" title={`${photo.place} / ${photo.file.name}`}
                    onClick={() => setSelected(photo)} onDoubleClick={() => onPick(photo)}
                    className={`overflow-hidden rounded-lg border text-left text-xs ${active ? 'border-[#d3bb73] ring-2 ring-[#d3bb73]/40' : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'}`}>
                    <MaterialThumb url={photo.file.thumbnailUrl} kind={photo.file.kind} name={photo.file.name} className="aspect-square w-full" />
                    <span className="block truncate px-2 py-1.5">{photo.file.name}</span>
                  </button>
                );
              })}
            </div>
            {!loading && !problem && !folders.length && !photos.length && (
              <p className="py-10 text-center text-sm text-[#e5e4e2]/50">
                {hits ? 'Nie znaleziono zdjęć (JPG, PNG, WebP).' : 'W tym folderze nie ma zdjęć (JPG, PNG, WebP).'}
              </p>
            )}
            {!hits && hidden > 0 && <p className="mt-3 text-xs text-[#e5e4e2]/40">Pozostałe pliki w tym folderze to nie zdjęcia ({hidden}).</p>}
            {!hits && listing && listing.files.length < listing.total && (
              <button type="button" disabled={loading} onClick={() => void loadMore()} className={`${secondaryButton} mt-4`}>
                Pokaż kolejne pliki ({listing.total - listing.files.length})
              </button>
            )}
          </div>
          <footer className="flex flex-wrap items-center gap-3 border-t border-[#d3bb73]/10 px-5 py-4">
            <p className="min-w-0 flex-1 truncate text-xs text-[#e5e4e2]/55" title={selected ? `${selected.place} / ${selected.file.name}` : undefined}>
              {selected ? `${selected.place} / ${selected.file.name}` : 'Wybierz zdjęcie — oryginał zostaje w Dysku, produkt dostaje lekką wersję WebP.'}
            </p>
            <button type="button" onClick={onClose} className={ghostButton}>Anuluj</button>
            <button type="button" disabled={!selected} onClick={() => selected && onPick(selected)} className={`${primaryButton} disabled:opacity-40`}>Użyj zdjęcia</button>
          </footer>
        </div>
    </dialog>
  );
}
