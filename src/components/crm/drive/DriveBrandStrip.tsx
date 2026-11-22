'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, Download, ExternalLink, Eye, Loader2, Palette } from 'lucide-react';
import { driveRecordPath, type DriveFile, type DriveListing } from '@/lib/drive/driveShared';
import type { MaterialKind } from '@/lib/materials/materialsShared';
import { MaterialThumb, cardClass, errorMessage } from '../materials/materialsUi';
import type { PreviewItem } from '../materials/MaterialsPreview';
import { downloadDriveFile, driveGet } from './driveApi';
import { drivePreviewItem } from './DriveBrowser';

/*
 * Materiały → marka → „Logotypy i księga znaku”: logotypy, fonty i kolory z księgi znaku (Ustawienia → Moje firmy) —
 * jedno źródło, bez kopiowania plików. Zmiana w księdze znaku od razu widać tutaj, w Finderze, na Macu i w telefonie.
 */

type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;

export default function DriveBrandStrip({ companyId, onPreview, notify }: {
  companyId: string;
  onPreview: (items: PreviewItem[], index: number) => void;
  notify: Notify;
}) {
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setListing(null);
    setError('');
    driveGet<DriveListing>('list', { node: `brand:${companyId}` })
      .then((data) => { if (active) setListing(data); })
      .catch((cause) => { if (active) setError(errorMessage(cause, 'Nie udało się wczytać księgi znaku.')); });
    return () => { active = false; };
  }, [companyId]);

  const editPath = driveRecordPath({ type: 'company', id: companyId });
  const logos = (listing?.files || []).filter((file) => file.kind === 'image');
  const fonts = (listing?.files || []).filter((file) => file.kind !== 'image');

  const preview = (file: DriveFile) => {
    const index = logos.findIndex((entry) => entry.id === file.id);
    if (index >= 0) onPreview(logos.map(drivePreviewItem), index);
  };
  const download = async (file: DriveFile) => {
    try {
      await downloadDriveFile(file.id);
    } catch (cause) {
      notify(errorMessage(cause, 'Nie udało się pobrać pliku.'), 'error');
    }
  };
  const copy = async (hex: string) => {
    try {
      await navigator.clipboard.writeText(hex);
      notify(`Skopiowano kolor ${hex}`, 'success');
    } catch {
      notify('Nie udało się skopiować koloru.', 'error');
    }
  };

  return (
    <section className={`${cardClass} space-y-3 p-4`} aria-label="Z księgi znaku">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 text-sm text-[#d3bb73]"><Palette className="h-4 w-4" />Z księgi znaku</h3>
          <p className="mt-0.5 text-xs text-[#e5e4e2]/50">Logotypy, fonty i kolory z Ustawienia → Moje firmy → Księga znaku — zawsze aktualne, bez kopii.</p>
        </div>
        {editPath && <Link href={editPath} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"><ExternalLink className="h-3.5 w-3.5" />Edytuj księgę znaku</Link>}
      </div>
      {!listing && !error && <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50"><Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />Wczytuję księgę znaku…</div>}
      {error && <p className="text-xs text-red-300">{error}</p>}
      {listing && !listing.files.length && !listing.colors.length && (
        <p className="text-xs text-[#e5e4e2]/50">Księga znaku tej marki jest pusta — dodaj logotypy, kolory i fonty w Ustawieniach → Moje firmy.</p>
      )}
      {!!logos.length && (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {logos.map((file) => (
            <div key={file.id} className="group overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119]" onDoubleClick={() => preview(file)}>
              <div className="relative" style={{ backgroundImage: 'repeating-conic-gradient(rgba(255,255,255,0.06) 0% 25%, transparent 0% 50%)', backgroundSize: '16px 16px' }}>
                <MaterialThumb url={file.thumbnailUrl} kind={file.kind as MaterialKind} name={file.name} className="aspect-[4/3] w-full !bg-transparent" contain />
                <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <button type="button" onClick={() => preview(file)} aria-label={`Podgląd: ${file.name}`} className="rounded-md bg-[#0f1119]/85 p-1.5 text-[#e5e4e2]/80 hover:text-[#d3bb73]"><Eye className="h-4 w-4" /></button>
                  <button type="button" onClick={() => void download(file)} aria-label={`Pobierz: ${file.name}`} className="rounded-md bg-[#0f1119]/85 p-1.5 text-[#e5e4e2]/80 hover:text-[#d3bb73]"><Download className="h-4 w-4" /></button>
                </div>
              </div>
              <div className="p-2">
                <p className="truncate text-[13px]" title={file.name}>{file.name}</p>
                <p className="truncate text-[11px] text-[#e5e4e2]/40">{file.detail}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      {!!fonts.length && (
        <div className="flex flex-wrap gap-2">
          {fonts.map((file) => (
            <button key={file.id} type="button" onClick={() => void download(file)} title={`Pobierz: ${file.name}`}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-3 py-2 text-left text-sm hover:border-[#d3bb73]/30">
              <MaterialThumb url={null} kind="font" name={file.name} className="h-8 w-8 rounded-md" />
              <span className="min-w-0">
                <span className="block truncate">{file.name}</span>
                <span className="block truncate text-[11px] text-[#e5e4e2]/40">{file.detail}</span>
              </span>
              <Download className="h-4 w-4 text-[#d3bb73]/70" />
            </button>
          ))}
        </div>
      )}
      {!!listing?.colors.length && (
        <div className="flex flex-wrap gap-2">
          {listing.colors.map((color, index) => (
            <button key={`${color.hex}-${index}`} type="button" onClick={() => void copy(color.hex)} title={`Kopiuj ${color.hex}`}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] py-1.5 pl-1.5 pr-3 text-left text-xs hover:border-[#d3bb73]/30">
              <span data-theme-preserve="" className="h-7 w-7 rounded-md ring-1 ring-white/15" style={{ background: color.hex }} />
              <span>
                <span className="block font-mono uppercase">{color.hex}</span>
                <span className="block text-[10px] text-[#e5e4e2]/40">{[color.label, color.role].filter(Boolean).join(' · ')}</span>
              </span>
              <Copy className="h-3.5 w-3.5 text-[#e5e4e2]/30" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
