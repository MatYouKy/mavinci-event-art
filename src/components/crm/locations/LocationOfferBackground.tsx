'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Image as ImageIcon, Loader2, Trash2, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { isLocationBackgroundPath, LOCATION_BACKGROUND_BUCKET } from '@/lib/CRM/Offers/offerVenueBackground';

/*
 * „Tło ofert” lokalizacji (`locations.offer_background_path`): zdjęcie miejsca na okładkę ofert wydarzeń w tej lokalizacji —
 * także gdy klientem jest inna firma (np. impreza firmowa w hotelu Marina: oferta dla firmy, w tle Marina). Nowe zdjęcie (trafia
 * też do galerii obiektu — jeden zapis z kontrolą zmian, jak informacje techniczne) albo zdjęcie z galerii obiektu i sal
 * (`location-materials`). Okładka: własna grafika oferty → tło miejsca → grafika szablonu. `onGalleryChange` — nowe zdjęcie
 * w galerii (strona odświeża „Informacje techniczne”).
 */

type Row = Record<string, any>;
type Photo = { path: string; name: string; place: string };

const FORMATS: Record<string, { extension: string; contentType: string }> = {
  jpg: { extension: 'jpg', contentType: 'image/jpeg' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  png: { extension: 'png', contentType: 'image/png' },
  webp: { extension: 'webp', contentType: 'image/webp' },
};
const FULL_GALLERY = 'Galeria obiektu ma już 30 materiałów — usuń któryś w „Informacjach technicznych obiektu” albo wybierz zdjęcie z galerii.';
const assetsOf = (details: unknown): Row[] =>
  details && typeof details === 'object' && Array.isArray((details as Row).assets) ? (details as Row).assets as Row[] : [];
/** Błąd zapisu lokalizacji po polsku (walidacja bazy — jej komunikat). */
function updateMessage(error: { code?: string; message?: string }) {
  if (error.code === '23514') return 'Wybierz zdjęcie JPG, PNG lub WebP z materiałów tej lokalizacji.';
  if (error.code === 'P0001' && error.message) return error.message;
  if (error.code === '42501' || /permission|row.level security/i.test(error.message || '')) return 'Nie masz uprawnień do edycji lokalizacji.';
  return 'Nie udało się zapisać tła ofert.';
}
const buttonClass = 'inline-flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-white/10 disabled:opacity-50';

/** Zdjęcia z galerii obiektu i sal (rzuty i pliki CAD pomijamy). */
function galleryPhotos(locationId: string, row: Row | null): Photo[] {
  const photos: Photo[] = [];
  const collect = (details: unknown, place: string) => {
    for (const asset of assetsOf(details)) {
      const path = String(asset?.path || '');
      if (asset?.kind === 'photo' && isLocationBackgroundPath(locationId, path) && !photos.some((item) => item.path === path)) {
        photos.push({ path, name: String(asset.name || 'Zdjęcie'), place });
      }
    }
  };
  collect(row?.technical_details, 'Obiekt');
  for (const room of Array.isArray(row?.rooms) ? row!.rooms as Row[] : []) collect(room?.technical, String(room?.name || 'Sala'));
  return photos;
}

export function LocationOfferBackground({ locationId, readOnly = false, onGalleryChange }: {
  locationId: string;
  readOnly?: boolean;
  onGalleryChange?: () => void;
}) {
  const [path, setPath] = useState<string | null>(null);
  const [ready, setReady] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [objectAssets, setObjectAssets] = useState(0);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileInput = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    setError('');
    const [background, details] = await Promise.all([
      supabase.from('locations').select('offer_background_path').eq('id', locationId).maybeSingle(),
      supabase.from('locations').select('technical_details, rooms').eq('id', locationId).maybeSingle(),
    ]);
    // Baza bez migracji „Tła ofert” — sekcja informuje, reszta strony działa jak dotąd.
    setReady(!background.error);
    const current = background.error ? null : ((background.data as Row | null)?.offer_background_path as string | null) || null;
    const gallery = galleryPhotos(locationId, (details.data as Row | null) ?? null);
    setPath(current);
    setPhotos(gallery);
    setObjectAssets(assetsOf((details.data as Row | null)?.technical_details).length);
    const paths = Array.from(new Set([...(current ? [current] : []), ...gallery.map((photo) => photo.path)]));
    if (paths.length) {
      const { data } = await supabase.storage.from(LOCATION_BACKGROUND_BUCKET).createSignedUrls(paths, 3600);
      const next: Record<string, string> = {};
      for (const item of data || []) if (item?.path && item?.signedUrl) next[item.path] = item.signedUrl;
      setUrls(next);
    } else {
      setUrls({});
    }
    setLoaded(true);
  }, [locationId]);

  useEffect(() => {
    setLoaded(false);
    setPicking(false);
    setNotice('');
    void load();
  }, [load]);

  const save = async (next: string | null, message: string) => {
    if (readOnly || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data, error: updateError } = await supabase
        .from('locations')
        .update({ offer_background_path: next })
        .eq('id', locationId)
        .select('offer_background_path')
        .maybeSingle();
      if (updateError) throw new Error(updateMessage(updateError));
      if (!data) throw new Error('Nie masz uprawnień do edycji lokalizacji albo została usunięta.');
      setPicking(false);
      setNotice(message);
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się zapisać tła ofert.');
    } finally {
      setBusy(false);
    }
  };

  /** Nowe zdjęcie: plik do materiałów lokalizacji, potem jednym zapisem wpis w galerii obiektu i tło — tylko gdy lokalizacja nie
   * zmieniła się od odczytu (równoległa zmiana — jedna ponowna próba na świeżych danych). */
  const upload = async (file: File | undefined) => {
    if (!file || readOnly || busy) return;
    const format = FORMATS[(file.name.split('.').pop() || '').toLowerCase()];
    if (!format) { setError('Dodaj zdjęcie w formacie JPG, PNG lub WebP.'); return; }
    if (!file.size || file.size > 20 * 1024 * 1024) { setError('Zdjęcie może mieć najwyżej 20 MB.'); return; }
    if (file.name.length > 255) { setError('Nazwa pliku może mieć najwyżej 255 znaków.'); return; }
    if (objectAssets >= 30) { setError(FULL_GALLERY); return; }
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const target = `${locationId.toLowerCase()}/${crypto.randomUUID()}.${format.extension}`;
      const { error: uploadError } = await supabase.storage
        .from(LOCATION_BACKGROUND_BUCKET)
        .upload(target, file, { contentType: format.contentType, upsert: false });
      if (uploadError) {
        throw new Error(/row.level security|permission denied/i.test(uploadError.message || '')
          ? 'Nie udało się przesłać zdjęcia: brak uprawnień do materiałów lokalizacji.'
          : `Nie udało się przesłać zdjęcia „${file.name}”.`);
      }
      for (let attempt = 0; ; attempt += 1) {
        const { data: row, error: readError } = await supabase
          .from('locations')
          .select('technical_details, updated_at')
          .eq('id', locationId)
          .maybeSingle();
        if (readError || !row) throw new Error('Nie udało się pobrać lokalizacji.');
        const details = (row as Row).technical_details && typeof (row as Row).technical_details === 'object' && !Array.isArray((row as Row).technical_details)
          ? (row as Row).technical_details as Row
          : {};
        const assets = assetsOf(details);
        if (assets.length >= 30) throw new Error(FULL_GALLERY);
        const { data, error: updateError } = await supabase
          .from('locations')
          .update({
            offer_background_path: target,
            technical_details: { ...details, assets: [...assets, { path: target, name: file.name.trim() || 'Tło ofert', kind: 'photo' }] },
          })
          .eq('id', locationId)
          .eq('updated_at', (row as Row).updated_at)
          .select('id')
          .maybeSingle();
        if (updateError) throw new Error(updateMessage(updateError));
        if (data) break;
        if (attempt >= 1) throw new Error('Nie masz uprawnień do edycji lokalizacji albo zmieniła się w międzyczasie — odśwież stronę i spróbuj ponownie.');
      }
      setPicking(false);
      setNotice('Tło ofert zapisane i dodane do galerii obiektu — nowe PDF ofert z tego miejsca dostaną to zdjęcie na okładce.');
      onGalleryChange?.();
      await load();
    } catch (cause: any) {
      setError(cause?.message || 'Nie udało się zapisać tła ofert.');
    } finally {
      setBusy(false);
    }
  };

  const previewUrl = path ? urls[path] : '';
  return (
    <section className="mt-6 rounded-xl bg-[#351020] p-4 text-[#e5e4e2] sm:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg uppercase">
          <ImageIcon className="h-5 w-5 text-[#d3bb73]" />
          Tło ofert
        </h2>
        {!readOnly && ready && loaded && (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={buttonClass} disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              {path ? 'Zmień zdjęcie' : 'Wgraj zdjęcie'}
            </button>
            {photos.length > 0 && (
              <button type="button" className={buttonClass} disabled={busy} onClick={() => setPicking((value) => !value)}>
                <ImageIcon className="h-4 w-4" />
                {picking ? 'Zamknij galerię' : 'Wybierz z galerii obiektu'}
              </button>
            )}
            {path && (
              <button type="button" className={buttonClass} disabled={busy} onClick={() => void save(null, 'Usunięto tło ofert — zdjęcie zostaje w galerii.')}>
                <Trash2 className="h-4 w-4" />
                Usuń tło
              </button>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".jpg,.jpeg,.png,.webp"
              className="hidden"
              onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = ''; }}
            />
          </div>
        )}
      </div>
      <p className="mb-4 text-sm leading-6 text-[#e5e4e2]/60">
        Zdjęcie miejsca na okładkę ofert eventów w tej lokalizacji — także gdy klientem jest inna firma (np. impreza firmowa
        w hotelu: oferta dla firmy, w tle zdjęcie hotelu). Wgrane zdjęcie trafia też do galerii obiektu. Po zmianie tła wcześniej
        wygenerowane PDF ofert z tego miejsca są oznaczone jako nieaktualne. Oferta z własną grafiką hero zachowuje swoją, oferty
        sprzedawców hotelowych — okładkę z profilu sprzedawcy.
      </p>
      {!ready && (
        <p className="rounded-lg bg-amber-400/10 p-3 text-sm text-amber-100">
          Tło ofert wymaga aktualizacji bazy (migracja 20261119150000_location_offer_background.sql).
        </p>
      )}
      {ready && !loaded && <p className="text-sm text-[#e5e4e2]/60">Ładowanie…</p>}
      {ready && loaded && (path ? (
        <div className="overflow-hidden rounded-xl border border-[#d3bb73]/15 bg-[#0f1118]">
          {previewUrl
            ? <img src={previewUrl} alt="Tło ofert" className="h-56 w-full object-cover" />
            : <p className="p-6 text-sm text-[#e5e4e2]/60">Nie udało się wczytać podglądu zdjęcia.</p>}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-[#d3bb73]/20 p-6 text-center text-sm text-[#e5e4e2]/50">
          Brak tła — okładka oferty użyje grafiki szablonu.
        </p>
      ))}
      {picking && (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {photos.map((photo) => (
            <button
              key={photo.path}
              type="button"
              disabled={busy}
              onClick={() => void save(photo.path, 'Tło ofert zapisane — nowe PDF ofert z tego miejsca dostaną to zdjęcie na okładce.')}
              className={`relative overflow-hidden rounded-lg border text-left transition-colors ${photo.path === path ? 'border-[#d3bb73]' : 'border-white/10 hover:border-[#d3bb73]/50'}`}
            >
              {urls[photo.path]
                ? <img src={urls[photo.path]} alt={photo.name} className="h-28 w-full object-cover" />
                : <span className="flex h-28 items-center justify-center text-xs text-[#e5e4e2]/40">Brak podglądu</span>}
              <span className="block truncate px-2 py-1 text-xs text-[#e5e4e2]/70">{photo.place} · {photo.name}</span>
              {photo.path === path && <Check className="absolute right-2 top-2 h-5 w-5 rounded-full bg-[#d3bb73] p-0.5 text-[#1c1f33]" />}
            </button>
          ))}
        </div>
      )}
      {notice && <p className="mt-3 text-sm text-emerald-200">{notice}</p>}
      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
    </section>
  );
}
