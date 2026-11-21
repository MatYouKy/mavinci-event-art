'use client';

import { useEffect, useState } from 'react';
import { Check, FolderOpen, Images, Search, Sparkles } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { cardClass, inputClass, primaryButton, secondaryButton } from '../social/socialUi';
import { errorMessage, portfolioGet, type PortfolioPhotoOption, type PortfolioPhotoSource } from './portfolioApi';

/*
 * Wybór zdjęć do realizacji: pliki powiązanego wydarzenia, Materiały (wyszukiwanie po nazwie) albo biblioteka social media.
 * Zaznaczone zdjęcia serwer zamienia na wersje strony (WebP) — kreator dodaje je do galerii.
 */

const SOURCES: Array<[PortfolioPhotoSource, string, typeof Images]> = [
  ['event', 'Pliki wydarzenia', FolderOpen],
  ['material', 'Materiały', Images],
  ['social', 'Biblioteka social media', Sparkles],
];

export default function PortfolioPhotoPicker({ eventId, eventName, initialSource, onClose, onPick }: {
  eventId: string | null;
  eventName: string | null;
  initialSource: PortfolioPhotoSource;
  onClose: () => void;
  onPick: (source: PortfolioPhotoSource, photos: PortfolioPhotoOption[]) => void;
}) {
  const [source, setSource] = useState<PortfolioPhotoSource>(initialSource);
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<PortfolioPhotoOption[]>([]);
  const [problem, setProblem] = useState('');
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (source === 'event' && !eventId) { setPhotos([]); setProblem('Powiąż realizację z wydarzeniem, żeby wybrać zdjęcia z jego plików.'); return; }
    let active = true;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const data = await portfolioGet<{ photos: PortfolioPhotoOption[]; problem?: string }>('photos', { source, event: eventId, q: source === 'event' ? null : query });
        if (!active) return;
        setPhotos(data.photos);
        setProblem(data.problem || (data.photos.length ? '' : source === 'event' ? 'Wydarzenie nie ma zdjęć w plikach (JPEG, PNG, WebP).' : 'Brak zdjęć.'));
      } catch (cause) {
        if (active) { setPhotos([]); setProblem(errorMessage(cause, 'Nie udało się pobrać zdjęć.')); }
      } finally {
        if (active) setLoading(false);
      }
    }, source === 'event' ? 0 : 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [source, query, eventId]);

  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  return (
    <Modal open onClose={onClose} title="Dodaj zdjęcia do realizacji" scrollBody>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {SOURCES.map(([key, label, Icon]) => (
            <button key={key} type="button" onClick={() => { setSource(key); setSelected([]); }}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm ${source === key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
          {source !== 'event' && (
            <label className="relative ml-auto min-w-[220px] flex-1 sm:flex-none">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#e5e4e2]/40" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Szukaj po nazwie" className={`${inputClass} pl-8`} />
            </label>
          )}
        </div>
        {source === 'event' && eventName && <p className="text-xs text-[#e5e4e2]/50">Wydarzenie: {eventName}</p>}
        {problem && !loading && <p className={`${cardClass} p-4 text-sm text-[#e5e4e2]/60`}>{problem}</p>}
        {loading && <p className="p-4 text-sm text-[#e5e4e2]/50">Ładowanie zdjęć…</p>}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {photos.map((photo) => {
            const active = selected.includes(photo.id);
            return (
              <button key={photo.id} type="button" onClick={() => toggle(photo.id)} title={photo.name}
                className={`group relative aspect-square overflow-hidden rounded-lg border-2 ${active ? 'border-[#d3bb73]' : 'border-transparent hover:border-[#d3bb73]/40'}`}>
                {photo.thumbnailUrl ? <img src={photo.thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center bg-[#0f1119]"><Images className="h-6 w-6 text-[#d3bb73]/30" /></div>}
                {active && <span className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-[#d3bb73] text-[#1c1f33]"><Check className="h-4 w-4" /></span>}
                <span className="absolute inset-x-0 bottom-0 truncate bg-black/60 px-1 py-0.5 text-[10px] text-white/80 opacity-0 group-hover:opacity-100">{photo.name}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#d3bb73]/10 pt-3">
          <span className="mr-auto text-xs text-[#e5e4e2]/45">Zdjęcia trafią na stronę w trzech rozmiarach (WebP). Oryginały zostają w źródle.</span>
          <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
          <button type="button" className={primaryButton} disabled={!selected.length}
            onClick={() => onPick(source, selected.map((id) => photos.find((photo) => photo.id === id)).filter((photo): photo is PortfolioPhotoOption => Boolean(photo)))}>
            Dodaj zaznaczone ({selected.length})
          </button>
        </div>
      </div>
    </Modal>
  );
}
