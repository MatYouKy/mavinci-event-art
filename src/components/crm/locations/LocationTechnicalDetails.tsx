'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { ImageDropzone } from '@/components/UI/ImageDropzone';
import { hasLocationPowerDetails, LocationPowerDetailsFields, LocationPowerDetailsView, type LocationPowerDetails } from './LocationPowerDetails';

export type LocationAsset = { path: string; name: string; kind: 'plan' | 'photo' };
export type TechnicalDetails = LocationPowerDetails & {
  description?: string;
  restrictions?: string;
  difficulties?: string;
  length_m?: number;
  width_m?: number;
  height_m?: number;
  area_m2?: number;
  capacity?: number;
  assets?: LocationAsset[];
};
const bucket = 'location-materials';
const inputClass =
  'mt-1 w-full rounded-lg border border-white/10 bg-[#250914] px-3 py-2 text-sm text-[#e5e4e2]';
const labels = {
  description: 'Dodatkowe informacje',
  restrictions: 'Ograniczenia',
  difficulties: 'Utrudnienia logistyczne',
} as const;
const dimensions = [
  { key: 'length_m', label: 'Długość', unit: 'm', step: 0.01 },
  { key: 'width_m', label: 'Szerokość', unit: 'm', step: 0.01 },
  { key: 'height_m', label: 'Wysokość użytkowa', unit: 'm', step: 0.01 },
  { key: 'area_m2', label: 'Powierzchnia', unit: 'm²', step: 0.01 },
  { key: 'capacity', label: 'Maksymalna liczba osób', unit: 'os.', step: 1 },
] as const;
const fileFormats: Record<string, { extension: string; contentType: string }> = {
  jpg: { extension: 'jpg', contentType: 'image/jpeg' },
  jpeg: { extension: 'jpg', contentType: 'image/jpeg' },
  png: { extension: 'png', contentType: 'image/png' },
  webp: { extension: 'webp', contentType: 'image/webp' },
  pdf: { extension: 'pdf', contentType: 'application/pdf' },
  dxf: { extension: 'dxf', contentType: 'image/vnd.dxf' },
  dwg: { extension: 'dwg', contentType: 'image/vnd.dwg' },
};
const photoAccept = '.jpg,.jpeg,.png,.webp';
const planAccept = `${photoAccept},.pdf,.dxf,.dwg`;
const materialFormatError = 'Dodaj JPG, PNG lub WebP, a dla rzutu także PDF, DXF lub DWG.';
const isCad = (path: string) => /\.(dxf|dwg)$/i.test(path);
const isImage = (path: string) => /\.(jpg|png|webp)$/i.test(path);
function fileFormat(file: File, kind: LocationAsset['kind']) {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  if (!Object.prototype.hasOwnProperty.call(fileFormats, extension)) return undefined;
  const format = fileFormats[extension];
  if (kind === 'photo' && !isImage(`file.${format.extension}`)) return undefined;
  // CAD files may be reported as text/plain, octet-stream or without a MIME type.
  if (!isCad(file.name) && file.type && file.type !== 'application/octet-stream' && file.type !== format.contentType)
    return undefined;
  return format;
}

export function TechnicalDetailsView({ value }: { value?: TechnicalDetails }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [loadingAssets, setLoadingAssets] = useState(false);
  // Context polling can return new objects without changing the actual files.
  const assetKey = JSON.stringify((value?.assets || []).map(({ path, name }) => ({ path, name })));
  const hasDimensions = dimensions.some(({ key }) => value?.[key] != null);
  const hasPower = hasLocationPowerDetails(value);
  useEffect(() => {
    let active = true;
    setUrls({});
    setError('');
    const assets: Pick<LocationAsset, 'path' | 'name'>[] = JSON.parse(assetKey);
    setLoadingAssets(assets.length > 0);
    if (assets.length)
      Promise.all(assets.map(async (asset) => {
        const { data, error } = await supabase.storage.from(bucket).createSignedUrl(
          asset.path, 3600, isCad(asset.path) ? { download: asset.name } : undefined,
        );
        return { path: asset.path, url: data?.signedUrl, error };
      }))
        .then((results) => {
          if (!active) return;
          if (results.some((item) => item.error || !item.url))
            setError(
              'Nie udało się otworzyć części materiałów. Odśwież stronę, aby spróbować ponownie.',
            );
          setUrls(
            Object.fromEntries(
              results.filter((item) => item.url).map((item) => [item.path, item.url!]),
            ),
          );
        })
        .catch(() => {
          if (active) setError('Nie udało się otworzyć materiałów. Odśwież stronę, aby spróbować ponownie.');
        })
        .finally(() => { if (active) setLoadingAssets(false); });
    return () => {
      active = false;
    };
  }, [assetKey]);
  return (
    <div className="space-y-4 text-sm">
      {hasDimensions && <section className="space-y-2">
        <h3 className="font-medium uppercase text-[#d3bb73]">Wymiary i pojemność</h3>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {dimensions.map(({ key, label, unit }) => value?.[key] != null && <div key={key} className="rounded-lg bg-white/[0.035] p-3">
            <dt className="text-xs text-white/50">{label}</dt>
            <dd className="mt-1 text-white/85">{value[key]!.toLocaleString('pl-PL')} {unit}</dd>
          </div>)}
        </dl>
      </section>}
      <LocationPowerDetailsView value={value}/>
      {Object.entries(labels).map(([key, label]) =>
        value?.[key as keyof typeof labels] ? (
          <div key={key}>
            <h3 className="font-medium uppercase text-[#d3bb73]">{label}</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-white/75">
              {value[key as keyof typeof labels]}
            </p>
          </div>
        ) : null,
      )}
      {!Object.keys(labels).some((key) => value?.[key as keyof typeof labels]) &&
        !hasDimensions && !hasPower &&
        !value?.assets?.length && (
          <p className="text-white/50">Brak dodatkowych informacji i materiałów.</p>
        )}
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {(['plan', 'photo'] as const).map((kind) => {
        const assets = value?.assets?.filter((a) => a.kind === kind) || [];
        return assets.length ? (
          <div key={kind}>
            <h3 className="mb-2 font-medium uppercase text-[#d3bb73]">
              {kind === 'plan' ? 'Rzuty i plany' : 'Galeria'}
            </h3>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {assets.map((asset) =>
                urls[asset.path] ? (
                  <a
                    key={asset.path}
                    href={urls[asset.path]}
                    target="_blank"
                    rel="noopener noreferrer"
                    download={isCad(asset.path) ? asset.name : undefined}
                    className="overflow-hidden rounded-lg bg-white/5 p-2 text-[#d3bb73] hover:bg-white/10"
                  >
                    {isImage(asset.path) && (
                      <img
                        src={urls[asset.path]}
                        alt={asset.name}
                        className="mb-2 h-28 w-full rounded object-cover"
                        loading="lazy"
                      />
                    )}
                    <span className="break-words">{asset.name}</span>
                    <span className="mt-1 block text-xs text-white/55">
                      {isCad(asset.path) ? 'Pobierz plik CAD · DXF/DWG' : isImage(asset.path) ? 'Powiększ zdjęcie' : 'Otwórz PDF'}
                    </span>
                  </a>
                ) : (
                  <span key={asset.path} className="break-words text-white/50">
                    {asset.name} — {loadingAssets ? 'wczytywanie…' : 'plik niedostępny'}
                  </span>
                ),
              )}
            </div>
            {kind === 'plan' && assets.some((asset) => isCad(asset.path)) && <p className="mt-2 text-xs text-white/50">Pliki CAD otworzysz w odpowiednim programie. Do szybkiego podglądu poproś również o wersję PDF lub zdjęcie rzutu.</p>}
          </div>
        ) : null;
      })}
    </div>
  );
}

export function TechnicalDetailsEditor({
  locationId,
  initial,
  room,
  onSave,
  onCancel,
}: {
  locationId: string;
  initial?: TechnicalDetails;
  room?: { name: string; notes?: string };
  onSave: (details: TechnicalDetails, room: { name: string; notes: string }) => Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState<TechnicalDetails>(initial || {});
  const [name, setName] = useState(room?.name || '');
  const [notes, setNotes] = useState(room?.notes || '');
  const [pending, setPending] = useState<{ file: File; kind: 'plan' | 'photo' }[]>([]);
  const uploadedFiles = useRef(new Map<File, LocationAsset>());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const addFiles = (files: FileList | File[] | null, kind: 'plan' | 'photo') => {
    if (!files) return;
    const list = Array.from(files);
    if (list.some((file) => !fileFormat(file, kind))) {
      setError(materialFormatError);
      return;
    }
    if (list.some((file) => !file.size || file.size > 20 * 1024 * 1024 || file.name.length > 255)) {
      setError('Plik musi mieć od 1 bajta do 20 MB, a jego nazwa maksymalnie 255 znaków.');
      return;
    }
    if ((value.assets?.length || 0) + pending.length + list.length > 30) {
      setError('Możesz dodać maksymalnie 30 materiałów.');
      return;
    }
    setError('');
    setPending((prev) => [...prev, ...list.map((file) => ({ file, kind }))]);
  };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setError('');
    if (room && !name.trim()) {
      setError('Uzupełnij nazwę sali.');
      return;
    }
    setSaving(true);
    const uploaded: LocationAsset[] = [];
    try {
      for (const item of pending) {
        const cached = uploadedFiles.current.get(item.file);
        if (cached) {
          uploaded.push({ ...cached, kind: item.kind });
          continue;
        }
        const format = fileFormat(item.file, item.kind);
        if (!format) throw new Error(materialFormatError);
        const path = `${locationId}/${crypto.randomUUID()}.${format.extension}`;
        const { error } = await supabase.storage
          .from(bucket)
          .upload(path, item.file, { contentType: format.contentType, upsert: false });
        if (error) throw error;
        const asset = { path, name: item.file.name, kind: item.kind };
        uploadedFiles.current.set(item.file, asset);
        uploaded.push(asset);
      }
      await onSave(
        { ...value, assets: [...(value.assets || []), ...uploaded] },
        { name: name.trim(), notes: notes.trim() },
      );
    } catch (e: any) {
      // A failed response can still follow a committed save. Keep those files
      // and reuse successful uploads on retry instead of deleting shared assets.
      setError(e.message || 'Nie udało się zapisać. Spróbuj ponownie.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <form onSubmit={save} className="mt-4 rounded-lg bg-[#46172b] p-4">
      <fieldset disabled={saving} className="space-y-4 disabled:opacity-70">
        {room && (
          <>
            <label className="block text-sm">
              Nazwa sali *
              <input
                autoFocus
                required
                maxLength={150}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className={inputClass}
              />
            </label>
            <label className="block text-sm">
              Wskazówki wejścia / piętro
              <input
                maxLength={1000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className={inputClass}
              />
            </label>
          </>
        )}
        <section className="space-y-3 rounded-lg bg-black/10 p-3">
          <h3 className="text-sm uppercase text-[#d3bb73]">Wymiary i pojemność</h3>
          <p className="text-xs text-white/55">Pola są opcjonalne. Wpisz dane z dokumentacji obiektu; pozostaw puste, jeśli wymagają potwierdzenia.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dimensions.map(({ key, label, unit, step }) => <label key={key} className="block text-sm">
              {label} ({unit})
              <input type="number" min={step} max={100000} step={step} value={value[key] ?? ''} placeholder="Nie podano" className={inputClass}
                onChange={(event) => setValue({ ...value, [key]: event.target.value === '' ? undefined : event.target.valueAsNumber })}/>
            </label>)}
          </div>
          <p className="text-xs text-white/50">Powierzchnia nie jest wyliczana automatycznie — sala może mieć nieregularny kształt. Układ i liczbę miejsc dla konkretnej aranżacji opisz w dodatkowych informacjach.</p>
        </section>
        <LocationPowerDetailsFields value={value} onChange={(patch) => setValue((current) => ({ ...current, ...patch }))}/>
        {Object.entries(labels).map(([key, label]) => (
          <label key={key} className="block text-sm">
            {label}
            <textarea
              rows={3}
              maxLength={4000}
              value={value[key as keyof typeof labels] || ''}
              onChange={(e) => setValue({ ...value, [key]: e.target.value })}
              className={inputClass}
              placeholder={
                key === 'restrictions'
                  ? 'Np. limit głośności, zakaz dymu, godziny dostępu'
                  : key === 'difficulties'
                    ? 'Np. schody, brak windy, szerokość drzwi, odległość od rozładunku'
                    : 'Np. wyposażenie, układy stołów, liczba miejsc, możliwość zaciemnienia i dostęp do internetu'
              }
            />
          </label>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          {(['plan', 'photo'] as const).map((kind) => (
            <ImageDropzone key={kind} multiple allowPdf={kind === 'plan'} disabled={saving}
              accept={kind === 'plan' ? planAccept : photoAccept}
              invalidFileMessage={kind === 'plan' ? materialFormatError : 'Dodaj zdjęcia w formacie JPG, PNG lub WebP.'}
              label={kind === 'plan' ? 'Przeciągnij rzuty i plany' : 'Przeciągnij zdjęcia przestrzeni'}
              hint={kind === 'plan' ? 'lub kliknij · PDF, DXF, DWG, JPG, PNG, WEBP · do 20 MB' : 'lub kliknij · JPG, PNG, WEBP · do 20 MB'}
              onFiles={(files) => addFiles(files, kind)} />
          ))}
        </div>
        <p className="text-xs text-white/60">
          Do 20 MB na plik, maksymalnie 30 materiałów. Pliki zostaną przesłane przy zapisie.
          Plany CAD są udostępniane do pobrania — dodaj też PDF lub obraz rzutu do szybkiego podglądu.
          Zdjęcia mogą przedstawiać pustą salę i przykładowe aranżacje.
        </p>
        {value.assets?.map((asset) => (
          <div key={asset.path} className="flex justify-between gap-3 text-sm">
            <span className="break-all">{asset.name}</span>
            <button
              type="button"
              className="text-red-300"
              onClick={() =>
                setValue({ ...value, assets: value.assets?.filter((a) => a.path !== asset.path) })
              }
            >
              Usuń z listy
            </button>
          </div>
        ))}
        {pending.map((item, i) => (
          <div key={i} className="flex justify-between gap-3 text-sm">
            <span className="break-all">{item.file.name} (nowy)</span>
            <button
              type="button"
              className="text-red-300"
              onClick={() => setPending(pending.filter((_, index) => index !== i))}
            >
              Usuń
            </button>
          </div>
        ))}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="flex gap-3">
          <button type="submit" className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]">
            {saving ? 'Zapisywanie…' : 'Zapisz'}
          </button>
          <button type="button" onClick={onCancel} className="rounded-lg bg-white/5 px-4 py-2">
            Anuluj
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function LocationTechnicalDetails({ locationId, readOnly = false }: { locationId: string; readOnly?: boolean }) {
  const [value, setValue] = useState<TechnicalDetails | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setValue(null);
    setEditing(false);
    setError('');
    supabase
      .from('locations')
      .select('technical_details')
      .eq('id', locationId)
      .single()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setError('Nie udało się pobrać informacji technicznych.');
        else setValue(data.technical_details || {});
      });
    return () => {
      active = false;
    };
  }, [locationId]);
  const save = async (details: TechnicalDetails) => {
    if (readOnly) throw new Error('Nie masz uprawnień do edycji informacji lokalizacji.');
    const { data, error } = await supabase
      .from('locations')
      .update({ technical_details: details })
      .eq('id', locationId)
      .eq('technical_details', JSON.stringify(value))
      .select('technical_details')
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Dane zmieniły się lub nie masz uprawnień. Odśwież stronę.');
    setValue(data.technical_details);
    setEditing(false);
  };
  return (
    <section className="mt-6 rounded-xl bg-[#351020] p-4 text-[#e5e4e2] sm:p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg uppercase">Informacje techniczne obiektu</h2>
        {!readOnly && value && !editing && (
          <button
            className="rounded-lg bg-white/5 px-3 py-2 text-sm text-[#d3bb73]"
            onClick={() => setEditing(true)}
          >
            Edytuj informacje i materiały
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {value ? (
        editing && !readOnly ? (
          <TechnicalDetailsEditor
            locationId={locationId}
            initial={value}
            onSave={save}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <TechnicalDetailsView value={value} />
        )
      ) : (
        !error && <p>Ładowanie…</p>
      )}
    </section>
  );
}
