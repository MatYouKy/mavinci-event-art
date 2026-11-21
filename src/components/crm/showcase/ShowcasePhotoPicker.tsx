'use client';

import { useEffect, useState } from 'react';
import { Award, CalendarDays, Check, FolderOpen, Images, Package, Search, Sparkles } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { ShowcasePickPhoto } from '@/lib/showcase/showcaseShared';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import {
  errorMessage, showcaseGet, showcasePost, type ShowcaseEventOption, type ShowcasePhotoResult, type ShowcasePhotoSource,
  type ShowcaseProductOption, type ShowcaseRealizationOption,
} from './showcaseApi';

/*
 * Wybór zdjęć do prezentacji: zdjęcia produktów z katalogu i realizacji ze strony (bez kopiowania — odwołanie), Materiały,
 * pliki wydarzenia i biblioteka social media (kopia WebP na serwerze). Zaznaczone zdjęcia trafiają do bloku albo jako
 * zdjęcie główne / okładka działu; zapis karty — „Zapisz”.
 */

const SOURCES: Array<[ShowcasePhotoSource, string, typeof Images]> = [
  ['product', 'Produkty z katalogu', Package],
  ['site', 'Realizacje ze strony', Award],
  ['material', 'Materiały', Images],
  ['event', 'Pliki wydarzenia', FolderOpen],
  ['social', 'Biblioteka social media', Sparkles],
];

type Owner = { id: string; name: string };

export default function ShowcasePhotoPicker({ target, products, single = false, title = 'Dodaj zdjęcia', onClose, onPick }: {
  target: { itemId?: string; sectionId?: string };
  /** Produkty karty — pierwsze na liście źródła „Produkty z katalogu”. */
  products: Owner[];
  single?: boolean;
  title?: string;
  onClose: () => void;
  onPick: (results: ShowcasePhotoResult[]) => void;
}) {
  const { showLoader, hideLoader } = useGlobalLoader();
  const { showSnackbar } = useSnackbar();
  const [source, setSource] = useState<ShowcasePhotoSource>(products.length ? 'product' : 'site');
  const [query, setQuery] = useState('');
  const [owners, setOwners] = useState<Owner[]>([]);
  const [owner, setOwner] = useState<Owner | null>(products[0] || null);
  const [photos, setPhotos] = useState<ShowcasePickPhoto[]>([]);
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const needsOwner = source === 'product' || source === 'site' || source === 'event';

  // Lista „właścicieli” zdjęć: produkty, realizacje albo wydarzenia (wyszukiwanie).
  useEffect(() => {
    if (!needsOwner) { setOwners([]); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        if (source === 'product') {
          if (!query.trim()) { setOwners(products); return; }
          const data = await showcaseGet<{ products: ShowcaseProductOption[] }>('products', { q: query });
          if (active) setOwners(data.products.map((item) => ({ id: item.id, name: item.name })));
        } else if (source === 'site') {
          const data = await showcaseGet<{ realizations: ShowcaseRealizationOption[] }>('realizations', { q: query });
          if (active) setOwners(data.realizations.map((item) => ({ id: item.id, name: [item.title, item.location, item.date?.slice(0, 4)].filter(Boolean).join(' · ') })));
        } else {
          const data = await showcaseGet<{ events: ShowcaseEventOption[] }>('events', { q: query });
          if (active) setOwners(data.events.map((item) => ({ id: item.id, name: [item.name, item.date?.slice(0, 10)].filter(Boolean).join(' · ') })));
        }
      } catch (cause) {
        if (active) { setOwners([]); setProblem(errorMessage(cause, 'Nie udało się pobrać listy.')); }
      }
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source, query, needsOwner, products]);

  // Zdjęcia wybranego źródła.
  useEffect(() => {
    if (needsOwner && !owner) { setPhotos([]); setProblem(source === 'product' ? 'Wybierz produkt.' : source === 'site' ? 'Wybierz realizację.' : 'Wybierz wydarzenie.'); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const params: Record<string, string | null> = { source };
        if (source === 'product') params.product = owner?.id || null;
        if (source === 'site') params.realization = owner?.id || null;
        if (source === 'event') params.event = owner?.id || null;
        if (!needsOwner) params.q = query;
        const data = await showcaseGet<{ photos: ShowcasePickPhoto[]; problem?: string }>('photos', params);
        if (!active) return;
        setPhotos(data.photos);
        setProblem(data.problem || (data.photos.length ? '' : 'Brak zdjęć w tym źródle (JPEG, PNG, WebP).'));
      } catch (cause) {
        if (active) { setPhotos([]); setProblem(errorMessage(cause, 'Nie udało się pobrać zdjęć.')); }
      } finally {
        if (active) setLoading(false);
      }
    }, needsOwner ? 0 : 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source, owner, needsOwner, query]);

  const toggle = (id: string) => setSelected((current) => (single ? (current[0] === id ? [] : [id]) : current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const confirm = async () => {
    const chosen = photos.filter((photo) => selected.includes(photo.id));
    if (!chosen.length) return;
    const results: ShowcasePhotoResult[] = [];
    showLoader('Dodaję zdjęcia', `0 z ${chosen.length}`);
    try {
      for (const [index, photo] of chosen.entries()) {
        showLoader('Dodaję zdjęcia', `${index + 1} z ${chosen.length}: ${photo.name}`);
        if (photo.media) {
          // Zdjęcie produktu albo realizacji — bez kopiowania (adresy z listy).
          const media = photo.media;
          const url = media.source === 'site' ? media.path : photo.thumbnailUrl;
          results.push({ photo: media, urls: { [`${media.source}:${media.path}`]: { url, thumb: media.source === 'site' ? media.thumb || media.path : photo.thumbnailUrl } } });
        } else {
          results.push(await showcasePost<ShowcasePhotoResult>('import', { ...target, source, fileId: photo.id, caption: photo.name.replace(/\.[a-z0-9]{2,5}$/i, '') }));
        }
      }
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się dodać zdjęcia.'), 'error');
    } finally {
      hideLoader();
    }
    if (results.length) onPick(results);
  };

  return (
    <Modal open onClose={onClose} title={title} scrollBody>
      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {SOURCES.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => { setSource(key); setSelected([]); setQuery(''); setOwner(key === 'product' ? products[0] || null : null); setPhotos([]); }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs ${source === key ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/40" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} className={`${inputClass} pl-8`}
            placeholder={source === 'product' ? 'Szukaj produktu w katalogu' : source === 'site' ? 'Szukaj realizacji' : source === 'event' ? 'Szukaj wydarzenia' : 'Szukaj po nazwie'} />
        </label>
        {needsOwner && (
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
            {owners.map((item) => (
              <button key={item.id} type="button" onClick={() => { setOwner(item); setSelected([]); }}
                className={`inline-flex max-w-full items-center gap-1 truncate rounded-full border px-2.5 py-1 text-xs ${owner?.id === item.id ? 'border-[#d3bb73]/70 bg-[#d3bb73]/20 text-[#d3bb73]' : 'border-[#d3bb73]/15 text-[#e5e4e2]/70 hover:text-[#e5e4e2]'}`}>
                {source === 'event' && <CalendarDays className="h-3 w-3 shrink-0" />}
                <span className="truncate">{item.name}</span>
              </button>
            ))}
            {!owners.length && <span className="text-xs text-[#e5e4e2]/40">{source === 'product' && !query ? 'Karta nie ma jeszcze produktów — wyszukaj produkt w katalogu.' : 'Brak wyników.'}</span>}
          </div>
        )}
        <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto sm:grid-cols-4">
          {photos.map((photo) => {
            const active = selected.includes(photo.id);
            return (
              <button key={photo.id} type="button" onClick={() => toggle(photo.id)} title={photo.name}
                className={`${cardClass} relative aspect-[4/3] overflow-hidden ${active ? 'ring-2 ring-[#d3bb73]' : ''}`}>
                {photo.thumbnailUrl ? <img src={photo.thumbnailUrl} alt="" className="h-full w-full object-cover" /> : <Images className="m-auto h-6 w-6 text-[#d3bb73]/30" />}
                {active && <span className="absolute right-1 top-1 rounded-full bg-[#d3bb73] p-0.5 text-[#1c1f33]"><Check className="h-3.5 w-3.5" /></span>}
              </button>
            );
          })}
        </div>
        {(loading || problem) && <p className="text-xs text-[#e5e4e2]/50">{loading ? 'Wczytuję zdjęcia…' : problem}</p>}
        <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
          <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
          <button type="button" className={primaryButton} disabled={!selected.length} onClick={() => void confirm()}>
            {single ? 'Wybierz' : `Dodaj (${selected.length})`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
