'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { Loader2, Save, Upload } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { optimizeOfferImage } from '@/lib/optimizeOfferImage';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { brochureAssetKey, type BrochureImageAsset, type BrochureImageBucket } from '@/lib/brochures/decorativePages';

type Props = {
  emptyLabel?: string; brochureId: string; path: string; bucket: BrochureImageBucket; assets: BrochureImageAsset[];
  imageUrls: Record<string, string>; disabled: boolean; inputClass: string;
  onChange: (path: string, bucket: BrochureImageBucket) => void; onBusy: (busy: boolean) => void;
  onSave: () => void; hasChanges: boolean;
};
export default function BrochureImagePicker({ emptyLabel = 'Bez zdjęcia', brochureId, path, bucket, assets, imageUrls, disabled, inputClass, onChange, onBusy, onSave, hasChanges }: Props) {
  const { showSnackbar } = useSnackbar();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadButton = useRef<HTMLButtonElement>(null);
  const uploadInProgress = useRef(false);
  const helpId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadName, setUploadName] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [uploaded, setUploaded] = useState<{ path: string; name: string; url: string } | null>(null);
  useEffect(() => () => { if (uploaded) URL.revokeObjectURL(uploaded.url); }, [uploaded]);
  const options = [...new Map([...assets, ...(path ? [{ key: brochureAssetKey(bucket, path), path, bucket, label: 'Aktualny plik' }] : [])].map((a) => [a.key, a])).values()];
  const upload = async (file: File) => {
    if (disabled || uploadInProgress.current) return;
    setUploadError('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
      const message = 'Wybierz JPG, PNG lub WebP do 10 MB.';
      setUploadError(message); showSnackbar(message, 'error'); return;
    }
    uploadInProgress.current = true;
    setUploadName(file.name); setUploading(true); onBusy(true);
    try {
      const optimized = await optimizeOfferImage(file, { maxWidth: 2200, maxHeight: 3000, quality: .9 });
      const extension = optimized.type === 'image/png' ? 'png' : optimized.type === 'image/webp' ? 'webp' : 'jpg';
      const nextPath = `assets/brochures/${brochureId}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage.from('offer-product-pages').upload(nextPath, optimized, { contentType: optimized.type });
      if (error) throw error;
      setUploaded({ path: nextPath, name: file.name, url: URL.createObjectURL(optimized) });
      onChange(nextPath, 'offer-product-pages');
      showSnackbar('Dodano zdjęcie do podglądu. Kliknij „Zapisz broszurę”, aby zachować zmianę.', 'success');
    } catch (e: any) {
      const message = e.message || 'Nie udało się wgrać zdjęcia. Spróbuj ponownie.';
      setUploadError(message); showSnackbar(message, 'error');
    } finally { uploadInProgress.current = false; setUploading(false); onBusy(false); }
  };
  const currentUpload = bucket === 'offer-product-pages' && uploaded?.path === path ? uploaded : null;
  const preview = currentUpload?.url || imageUrls[brochureAssetKey(bucket, path)] || (/^https?:\/\//.test(path) ? path : '');
  return <div className="min-w-0 space-y-3">
    <label className="block text-xs text-white/55">Zdjęcie lub grafika<select value={path ? brochureAssetKey(bucket, path) : ''} disabled={disabled || uploading} className={`${inputClass} mt-1.5`} onChange={(e) => { const asset = options.find((a) => a.key === e.target.value); setUploadError(''); onChange(asset?.path || '', asset?.bucket || 'offer-product-pages'); }}><option value="">{emptyLabel}</option>{options.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}</select></label>
    {preview && <img src={preview} alt="Wybrane zdjęcie lub grafika" className="h-36 w-full rounded-lg bg-black/10 object-contain" />}
    <button ref={uploadButton} type="button" disabled={disabled || uploading} aria-describedby={helpId} onClick={() => fileInput.current?.click()} className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/50 disabled:opacity-40">
      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
      {uploading ? 'Wgrywanie zdjęcia…' : path ? 'Zmień zdjęcie' : 'Dodaj swoje zdjęcie'}
    </button>
    {/* A clipped, absolutely positioned input can scroll the fixed CRM shell out
        of view when a label focuses it. Keep it outside layout and tab order. */}
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" hidden style={{ display: 'none' }} tabIndex={-1} disabled={disabled || uploading} onChange={(e) => {
      const file = e.target.files?.[0]; e.target.value = '';
      uploadButton.current?.focus({ preventScroll: true });
      if (file) void upload(file);
    }} />
    <p id={helpId} className="text-xs leading-5 text-white/55">Wybierz zdjęcie z komputera (JPG, PNG lub WebP, do 10 MB). Po wybraniu wgra się automatycznie. Anulowanie wyboru pozostawia obecne zdjęcie bez zmian.</p>
    <div role="status" aria-live="polite" className="break-words text-xs leading-5 text-white/70">
      {uploading ? `Przygotowywanie i wgrywanie: ${uploadName}. Poczekaj na podgląd.` : currentUpload ? `${currentUpload.name} — ${hasChanges ? 'zdjęcie dodane do podglądu. Zapisz broszurę poniżej, aby zachować zmianę.' : 'zmiany zapisane.'}` : hasChanges ? 'Masz niezapisane zmiany w broszurze.' : null}
    </div>
    {uploadError && <p role="alert" className="break-words rounded-lg bg-red-500/10 p-3 text-xs text-red-200">{uploadError}</p>}
    <div className="space-y-2">
      <button type="button" disabled={disabled || uploading || !hasChanges} onClick={onSave} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-[#d3bb73] hover:bg-white/15 disabled:opacity-40"><Save className="h-4 w-4" />Zapisz broszurę</button>
      <p className="text-[11px] leading-5 text-white/45">Zapis obejmuje wszystkie zmiany w edytorze. Aby zaktualizować dokument do pobrania, użyj później „Generuj PDF” u góry strony.</p>
    </div>
  </div>;
}
