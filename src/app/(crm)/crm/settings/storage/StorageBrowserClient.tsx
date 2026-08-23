'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Database, Download, Eye, File, Folder, RefreshCw, Search, X } from 'lucide-react';
import { useRouter } from 'next/navigation';

type Bucket = { id: string; name: string; public: boolean };
type StorageItem = { id: string | null; name: string; fullPath: string; isFolder: boolean; signedUrl: string | null; metadata?: { size?: number; mimetype?: string } };

const formatSize = (size = 0) => size < 1024 ? `${size} B` : size < 1024 ** 2 ? `${(size / 1024).toFixed(1)} KB` : `${(size / 1024 ** 2).toFixed(1)} MB`;

const BUCKET_LABELS: Record<string, string> = {
  'bank-statements': 'Wyciągi bankowe',
  'company-logos': 'Logotypy i księga marki',
  'conferences-gallery': 'Galeria konferencji',
  'connector-thumbnails': 'Miniatury integracji',
  'email-attachments': 'Załączniki wiadomości e-mail',
  'employee-assets': 'Pliki pracowników',
  'equipment-files': 'Dokumenty sprzętu',
  'equipment-images': 'Zdjęcia sprzętu',
  'event-files': 'Pliki wydarzeń',
  'fuel-receipts': 'Paragony i faktury za paliwo',
  'generated-offers': 'Wygenerowane oferty',
  'offer-product-pages': 'Strony produktów ofertowych',
  'offer-template-pages': 'Szablony ofert',
  'rental-equipment-images': 'Zdjęcia sprzętu zewnętrznego',
  'service-catalog-images': 'Zdjęcia katalogu usług',
  'site-images': 'Zdjęcia stron internetowych',
  'task-files': 'Załączniki zadań',
  'vehicle-images': 'Zdjęcia pojazdów',
};

const bucketLabel = (name: string) =>
  BUCKET_LABELS[name] || name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');

const isImage = (item: StorageItem) =>
  item.metadata?.mimetype?.startsWith('image/') || /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(item.name);

const isPdf = (item: StorageItem) =>
  item.metadata?.mimetype === 'application/pdf' || /\.pdf$/i.test(item.name);

export default function StorageBrowserClient() {
  const router = useRouter();
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [bucket, setBucket] = useState<string | null>(null);
  const [path, setPath] = useState('');
  const [items, setItems] = useState<StorageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [preview, setPreview] = useState<StorageItem | null>(null);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (bucket) {
        params.set('bucket', bucket);
        params.set('path', path);
        params.set('offset', String(offset));
        if (search.trim()) params.set('search', search.trim());
      }
      const response = await fetch(`/bridge/admin/storage?${params}`, { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Nie udało się pobrać plików');
      if (bucket) {
        setItems(result.items || []);
        setHasMore(Boolean(result.hasMore));
      } else setBuckets(result.buckets || []);
    } catch (requestError: any) {
      setError(requestError.message || 'Nie udało się pobrać danych');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [bucket, path, offset]);

  useEffect(() => {
    if (!preview) return;
    const closeOnEscape = (event: KeyboardEvent) => event.key === 'Escape' && setPreview(null);
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [preview]);

  const breadcrumbs = path ? path.split('/') : [];
  const resetPath = (nextPath: string) => { setPath(nextPath); setOffset(0); };

  return (
    <div className="min-h-full bg-[#0f1119] p-4 text-[#e5e4e2] sm:p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <button onClick={() => bucket ? (setBucket(null), setPath('')) : router.push('/crm/settings')} className="mb-2 flex items-center gap-2 text-sm text-[#e5e4e2]/60 hover:text-white">
              <ArrowLeft className="h-4 w-4" /> {bucket ? 'Wszystkie buckety' : 'Ustawienia'}
            </button>
            <h1 className="text-2xl font-semibold">Pliki Supabase</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/55">Administracyjny podgląd całej zawartości Storage</p>
          </div>
          <button onClick={load} className="rounded-lg border border-[#d3bb73]/20 p-2 hover:bg-[#d3bb73]/10" title="Odśwież"><RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} /></button>
        </div>

        {bucket && <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
            <button onClick={() => resetPath('')} className="text-[#d3bb73] hover:underline">{bucketLabel(bucket)}</button>
            {breadcrumbs.map((part, index) => <span key={`${part}-${index}`} className="flex items-center gap-1"><ChevronRight className="h-3 w-3 text-[#e5e4e2]/30" /><button onClick={() => resetPath(breadcrumbs.slice(0, index + 1).join('/'))} className="hover:text-[#d3bb73]">{part}</button></span>)}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); setOffset(0); load(); }} className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3"><Search className="h-4 w-4 text-[#e5e4e2]/40" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj w tym katalogu" className="w-full bg-transparent py-2 text-sm outline-none" /></form>
        </div>}

        {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
        {loading ? <div className="flex h-48 items-center justify-center"><RefreshCw className="h-8 w-8 animate-spin text-[#d3bb73]" /></div> : !bucket ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{buckets.map((item) => <button key={item.id} onClick={() => { setBucket(item.id); resetPath(''); setSearch(''); }} className="flex items-center gap-4 rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] p-4 text-left hover:border-[#d3bb73]/40"><Database className="h-8 w-8 shrink-0 text-[#d3bb73]" /><div className="min-w-0"><div className="truncate font-medium">{bucketLabel(item.name)}</div><div className="mt-1 flex items-center gap-2 text-xs text-[#e5e4e2]/50"><span>{item.public ? 'Publiczny' : 'Prywatny'}</span><span aria-hidden="true">•</span><span className="truncate font-mono">{item.name}</span></div></div></button>)}</div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33]">
            {items.length === 0 ? <div className="p-10 text-center text-sm text-[#e5e4e2]/50">Ten katalog jest pusty</div> : items.map((item) => <div key={item.fullPath} className="flex items-center gap-3 border-b border-[#d3bb73]/10 px-4 py-3 last:border-b-0 hover:bg-[#d3bb73]/5">{item.isFolder ? <Folder className="h-5 w-5 shrink-0 text-[#d3bb73]" /> : isImage(item) && item.signedUrl ? <button onClick={() => setPreview(item)} className="h-11 w-11 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/20" title="Pokaż podgląd"><img src={item.signedUrl} alt="" className="h-full w-full object-cover" loading="lazy" /></button> : <File className="h-5 w-5 shrink-0 text-[#e5e4e2]/55" />}<button disabled={!item.isFolder && !item.signedUrl} onClick={() => item.isFolder ? resetPath(item.fullPath) : item.signedUrl && setPreview(item)} className={`min-w-0 flex-1 truncate text-left text-sm ${(item.isFolder || item.signedUrl) ? 'hover:text-[#d3bb73]' : ''}`}>{item.name}</button>{!item.isFolder && <><span className="hidden text-xs text-[#e5e4e2]/40 sm:block">{item.metadata?.mimetype || 'plik'}</span><span className="w-20 text-right text-xs text-[#e5e4e2]/50">{formatSize(item.metadata?.size)}</span>{item.signedUrl && <button onClick={() => setPreview(item)} className="rounded p-2 text-[#e5e4e2]/65 hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]" title="Podgląd"><Eye className="h-4 w-4" /></button>}{item.signedUrl && <a href={item.signedUrl} target="_blank" rel="noreferrer" className="rounded p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10" title="Pobierz"><Download className="h-4 w-4" /></a>}</>}</div>)}
            <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 p-3"><button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 100))} className="rounded border border-[#d3bb73]/20 px-3 py-1.5 text-sm disabled:opacity-30">Poprzednie</button><button disabled={!hasMore} onClick={() => setOffset(offset + 100)} className="rounded border border-[#d3bb73]/20 px-3 py-1.5 text-sm disabled:opacity-30">Następne</button></div>
          </div>
        )}
      </div>

      {preview?.signedUrl && <div role="dialog" aria-modal="true" aria-label={`Podgląd pliku ${preview.name}`} onMouseDown={(event) => event.target === event.currentTarget && setPreview(null)} className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"><div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-[#d3bb73]/25 bg-[#111420] shadow-2xl"><div className="flex items-center gap-3 border-b border-white/10 px-4 py-3"><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{preview.name}</div><div className="mt-0.5 text-xs text-[#e5e4e2]/45">{preview.metadata?.mimetype || 'Plik'} · {formatSize(preview.metadata?.size)}</div></div><a href={preview.signedUrl} target="_blank" rel="noreferrer" className="rounded-lg p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10" title="Pobierz plik"><Download className="h-5 w-5" /></a><button onClick={() => setPreview(null)} className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-white/10 hover:text-white" title="Zamknij"><X className="h-5 w-5" /></button></div><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-black/25 p-3 sm:p-5">{isImage(preview) ? <img src={preview.signedUrl} alt={preview.name} className="max-h-[78vh] max-w-full rounded object-contain" /> : isPdf(preview) ? <iframe src={preview.signedUrl} title={preview.name} className="h-[78vh] w-full rounded bg-white" /> : <div className="py-16 text-center"><File className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]/60" /><p className="text-sm text-[#e5e4e2]/65">Ten format nie ma podglądu w przeglądarce.</p><a href={preview.signedUrl} target="_blank" rel="noreferrer" className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#111420]"><Download className="h-4 w-4" /> Otwórz lub pobierz</a></div>}</div></div></div>}
    </div>
  );
}
