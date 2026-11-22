'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Download, Eye, FolderInput, Loader2, Pencil, RefreshCw, Trash2, X } from 'lucide-react';
import {
  MATERIAL_KIND_LABELS, cleanMaterialTags, formatMaterialBytes, formatMaterialDuration,
} from '@/lib/materials/materialsShared';
import { downloadMaterial, materialsGet, materialsPost, type MaterialFile, type MaterialFileDetail } from './materialsApi';
import { MaterialThumb, dangerButton, dateLabel, dateTimeLabel, errorMessage, ghostButton, inputClass, secondaryButton } from './materialsUi';

/*
 * Panel pliku (prawa kolumna): miniatura, dane, opis i tagi (zarządzający), poprzednie wersje, akcje.
 * Opis i tagi zapisują się po wyjściu z pola; „Podmień plik” wgrywa nową treść, poprzednia zostaje jako wersja na 30 dni.
 */

type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;

export default function MaterialsDetails({ file, canManage, onClose, onPreview, onRename, onMove, onDelete, onReplace, onUpdated, notify }: {
  file: MaterialFile;
  canManage: boolean;
  onClose: () => void;
  onPreview: () => void;
  onRename: () => void;
  onMove: () => void;
  onDelete: () => void;
  onReplace: (input: File) => void;
  onUpdated: (file: MaterialFile) => void;
  notify: Notify;
}) {
  const [detail, setDetail] = useState<MaterialFileDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [description, setDescription] = useState(file.description);
  const [tags, setTags] = useState(file.tags.join(', '));
  const [saving, setSaving] = useState(false);
  const replaceInput = useRef<HTMLInputElement>(null);

  // Wartości z serwera po zmianie pliku (także przez inną osobę) — nie przy każdym odświeżeniu listy.
  const serverDescription = file.description;
  const serverTags = file.tags.join(', ');
  useEffect(() => {
    setDescription(serverDescription);
    setTags(serverTags);
  }, [file.id, file.updatedAt, serverDescription, serverTags]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    materialsGet<MaterialFileDetail>('file', { id: file.id })
      .then((data) => { if (!cancelled) setDetail(data); })
      .catch(() => { if (!cancelled) setDetail(null); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [file.id, file.contentVersion, file.metaVersion]);

  const save = async (patch: { description?: string; tags?: string[] }) => {
    const sameDescription = patch.description === undefined || patch.description.trim() === file.description;
    const sameTags = patch.tags === undefined || patch.tags.join('\u0000') === file.tags.join('\u0000');
    if (sameDescription && sameTags) return;
    setSaving(true);
    try {
      const result = await materialsPost<{ file: MaterialFile }>('updateFile', { id: file.id, ...patch });
      onUpdated(result.file);
      notify('Zapisano opis pliku', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Nie udało się zapisać opisu.'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const download = async (kind: 'material' | 'version', id: string) => {
    try {
      await downloadMaterial(kind, id);
    } catch (error) {
      notify(errorMessage(error, 'Nie udało się pobrać pliku.'), 'error');
    }
  };

  const rows: Array<[string, string]> = [
    ['Rodzaj', MATERIAL_KIND_LABELS[file.kind]],
    ['Rozmiar', formatMaterialBytes(file.size)],
    ...(file.width && file.height ? [['Wymiary', `${file.width} × ${file.height} px`] as [string, string]] : []),
    ...(file.duration ? [['Czas trwania', formatMaterialDuration(file.duration)] as [string, string]] : []),
    ['Wersja', String(file.contentVersion)],
    ['Dodano', [dateTimeLabel(file.createdAt), file.createdBy].filter(Boolean).join(' · ')],
    ['Zmieniono', [dateTimeLabel(file.updatedAt), file.updatedBy].filter(Boolean).join(' · ')],
  ];
  const location = detail?.path.length ? detail.path.map((f) => f.name).join(' / ') : 'Główny folder marki';

  return (
    <aside className="flex h-full min-h-0 flex-col border-l border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="flex items-center gap-2 border-b border-[#d3bb73]/10 px-4 py-3">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" title={file.name}>{file.name}</p>
        <button type="button" className={ghostButton} onClick={onClose} aria-label="Zamknij panel pliku"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <button type="button" onClick={onPreview} className="block w-full overflow-hidden rounded-lg border border-[#d3bb73]/10" title="Podgląd">
          <MaterialThumb url={file.thumbnailUrl} kind={file.kind} name={file.name} className="aspect-[4/3] w-full" contain={file.kind !== 'image'} />
        </button>

        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={secondaryButton} onClick={onPreview}><Eye className="h-4 w-4" />Podgląd</button>
          <button type="button" className={secondaryButton} onClick={() => void download('material', file.id)}><Download className="h-4 w-4" />Pobierz</button>
          {canManage && (
            <>
              <button type="button" className={secondaryButton} onClick={onRename}><Pencil className="h-4 w-4" />Zmień nazwę</button>
              <button type="button" className={secondaryButton} onClick={onMove}><FolderInput className="h-4 w-4" />Przenieś</button>
              <button type="button" className={secondaryButton} onClick={() => replaceInput.current?.click()}><RefreshCw className="h-4 w-4" />Podmień plik</button>
              <button type="button" className={dangerButton} onClick={onDelete}><Trash2 className="h-4 w-4" />Usuń</button>
              <input ref={replaceInput} type="file" className="hidden"
                onChange={(event) => {
                  const input = event.target.files?.[0];
                  event.target.value = '';
                  if (input) onReplace(input);
                }} />
            </>
          )}
        </div>

        <dl className="space-y-1.5 text-sm">
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-[#e5e4e2]/40">Miejsce</dt><dd className="min-w-0 break-words text-[#e5e4e2]/80">{location}</dd></div>
          {rows.map(([label, value]) => (
            <div key={label} className="flex gap-3"><dt className="w-24 shrink-0 text-[#e5e4e2]/40">{label}</dt><dd className="min-w-0 break-words text-[#e5e4e2]/80">{value || '—'}</dd></div>
          ))}
          {detail?.event && (
            <div className="flex gap-3">
              <dt className="w-24 shrink-0 text-[#e5e4e2]/40">Event</dt>
              <dd className="min-w-0">
                <Link href={`/crm/events/${detail.event.id}?tab=files`} className="inline-flex items-center gap-1 text-[#d3bb73] hover:underline">
                  <CalendarDays className="h-3.5 w-3.5" />{detail.event.name}{detail.event.date ? ` (${dateLabel(detail.event.date)})` : ''}
                </Link>
              </dd>
            </div>
          )}
        </dl>

        <div className="space-y-2">
          <label className="block text-xs uppercase tracking-wide text-[#e5e4e2]/40" htmlFor="material-description">Opis</label>
          {canManage ? (
            <textarea id="material-description" className={`${inputClass} min-h-[84px]`} maxLength={2000} value={description} disabled={saving}
              placeholder="Np. do czego służy plik, prawa do zdjęć, autor"
              onChange={(event) => setDescription(event.target.value)}
              onBlur={() => void save({ description })} />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-[#e5e4e2]/70">{file.description || '—'}</p>
          )}
          <label className="block text-xs uppercase tracking-wide text-[#e5e4e2]/40" htmlFor="material-tags">Tagi</label>
          {canManage ? (
            <input id="material-tags" className={inputClass} value={tags} disabled={saving} placeholder="np. gala, scena, 2026"
              onChange={(event) => setTags(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') (event.target as HTMLInputElement).blur(); }}
              onBlur={() => void save({ tags: cleanMaterialTags(tags) })} />
          ) : (
            <div className="flex flex-wrap gap-1">
              {file.tags.length ? file.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">{tag}</span>
              )) : <span className="text-sm text-[#e5e4e2]/50">—</span>}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-[#e5e4e2]/40">Poprzednie wersje</p>
          {loading && !detail ? (
            <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />
          ) : detail?.versions.length ? (
            <ul className="space-y-1">
              {detail.versions.map((version) => (
                <li key={version.id} className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <p className="text-[#e5e4e2]/80">Wersja {version.contentVersion} · {formatMaterialBytes(version.size)}</p>
                    <p className="truncate text-[#e5e4e2]/40">Zastąpiona {dateTimeLabel(version.replacedAt)}{version.replacedBy ? ` · ${version.replacedBy}` : ''}</p>
                  </div>
                  <button type="button" className={ghostButton} onClick={() => void download('version', version.id)} title="Pobierz wersję">
                    <Download className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[#e5e4e2]/50">Brak — poprzednie wersje są przechowywane 30 dni po podmianie pliku.</p>
          )}
        </div>
      </div>
    </aside>
  );
}
