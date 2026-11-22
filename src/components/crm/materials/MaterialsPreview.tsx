'use client';

/* eslint-disable @next/next/no-img-element */

import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Loader2, X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import { MATERIAL_KIND_LABELS, formatMaterialBytes, materialPreviewable, type MaterialKind } from '@/lib/materials/materialsShared';
import { downloadMaterial, materialsGet, type MaterialUrl } from './materialsApi';
import { MaterialThumb, errorMessage, ghostButton, secondaryButton } from './materialsUi';
import type { DriveDownload } from '@/lib/drive/driveShared';
import { downloadDriveFile, driveGet } from '../drive/driveApi';

/*
 * Podgląd pliku na całym ekranie: zdjęcie, PDF, wideo, dźwięk (podpisany adres z serwera, 1 h). Strzałki — poprzedni /
 * następny plik w bieżącym widoku, Esc — zamknięcie. Pliki bez podglądu w przeglądarce: miniatura i „Pobierz”.
 * `drive` — pliki Dysku (Oferty, Kalkulacje, Umowy, Magazyn, księga znaku; `/bridge/native/v1/drive`).
 */

export type PreviewItem = {
  source: 'material' | 'event' | 'trash' | 'drive';
  id: string;
  name: string;
  kind: MaterialKind;
  mime: string;
  size: number;
  thumbnailUrl: string | null;
  subtitle?: string;
};

export default function MaterialsPreview({ items, index, onIndex, onClose, onError }: {
  items: PreviewItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const item = items[index];
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState('');
  const previewable = item ? materialPreviewable(item.kind, item.mime, item.name) : false;
  const source = item?.source;
  const id = item?.id;

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed('');
    if (!source || !id || !previewable) return;
    setLoading(true);
    (source === 'drive'
      ? driveGet<DriveDownload>('download', { id, mode: 'preview' })
      : materialsGet<MaterialUrl>('url', { kind: source, id, mode: 'preview' }))
      .then((result) => { if (!cancelled) setUrl(result.url); })
      .catch((error) => { if (!cancelled) setFailed(errorMessage(error, 'Nie udało się otworzyć podglądu.')); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [source, id, previewable]);

  const go = useCallback((delta: number) => {
    if (!items.length) return;
    onIndex((index + delta + items.length) % items.length);
  }, [index, items.length, onIndex]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      else if (event.key === 'ArrowLeft') go(-1);
      else if (event.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  if (!item) return null;

  const download = async () => {
    try {
      if (item.source === 'drive') await downloadDriveFile(item.id);
      else await downloadMaterial(item.source, item.id);
    } catch (error) {
      onError(errorMessage(error, 'Nie udało się pobrać pliku.'));
    }
  };

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[90] flex flex-col bg-black/90 text-[#e5e4e2]" role="dialog" aria-modal="true" aria-label={item.name}>
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{item.name}</p>
            <p className="truncate text-xs text-[#e5e4e2]/50">
              {[MATERIAL_KIND_LABELS[item.kind] || 'Plik', item.size ? formatMaterialBytes(item.size) : '', item.subtitle, items.length > 1 ? `${index + 1} z ${items.length}` : '']
                .filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" className={secondaryButton} onClick={() => void download()}><Download className="h-4 w-4" />Pobierz</button>
          <button type="button" className={ghostButton} onClick={onClose} aria-label="Zamknij podgląd"><X className="h-5 w-5" /></button>
        </div>
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
          {items.length > 1 && (
            <button type="button" onClick={() => go(-1)} aria-label="Poprzedni plik"
              className="absolute left-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20">
              <ChevronLeft className="h-6 w-6" />
            </button>
          )}
          {loading && <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />}
          {!loading && failed && <p className="text-sm text-red-300">{failed}</p>}
          {!loading && !failed && previewable && url && item.kind === 'image' && (
            <img src={url} alt={item.name} className="max-h-full max-w-full object-contain" />
          )}
          {!loading && !failed && previewable && url && item.kind === 'pdf' && (
            <iframe title={item.name} src={url} className="h-full w-full max-w-6xl rounded-lg bg-white" />
          )}
          {!loading && !failed && previewable && url && item.kind === 'video' && (
            <video key={url} src={url} controls autoPlay className="max-h-full max-w-full" />
          )}
          {!loading && !failed && previewable && url && item.kind === 'audio' && (
            <audio key={url} src={url} controls autoPlay className="w-full max-w-xl" />
          )}
          {!previewable && (
            <div className="flex flex-col items-center gap-4 text-center">
              <MaterialThumb url={item.thumbnailUrl} kind={item.kind} name={item.name} className="h-56 w-56 rounded-xl" contain />
              <p className="max-w-md text-sm text-[#e5e4e2]/60">Tego rodzaju pliku przeglądarka nie pokaże. Pobierz go i otwórz w programie na komputerze.</p>
              <button type="button" className={secondaryButton} onClick={() => void download()}><Download className="h-4 w-4" />Pobierz</button>
            </div>
          )}
          {items.length > 1 && (
            <button type="button" onClick={() => go(1)} aria-label="Następny plik"
              className="absolute right-3 top-1/2 z-10 -translate-y-1/2 rounded-full bg-white/10 p-2 hover:bg-white/20">
              <ChevronRight className="h-6 w-6" />
            </button>
          )}
        </div>
      </div>
    </OverlayPortal>
  );
}
