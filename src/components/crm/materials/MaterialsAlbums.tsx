'use client';

import { useCallback, useEffect, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from 'react';
import { ArrowLeft, Download, Eye, FolderOpen, ImageIcon, Library, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { MATERIAL_ALBUM_LIMITS, formatMaterialBytes } from '@/lib/materials/materialsShared';
import {
  downloadMaterial, materialsGet, materialsPost, materialsPostInBatches, type MaterialAccess, type MaterialAlbum, type MaterialFile, type MaterialItemRef,
} from './materialsApi';
import {
  ITEM_DRAG_TYPE, MaterialThumb, cardClass, dateLabel, errorMessage, ghostButton, inputClass, primaryButton, secondaryButton,
} from './materialsUi';

/*
 * Materiały → Albumy (główna baza zdjęć): album to uporządkowany zbiór odnośników do plików marki — bez kopiowania. Plik
 * przeciągnięty na album trafia do niego (ten sam plik może być w wielu albumach), usunięcie z albumu nie usuwa pliku.
 * Kolejność albumów i plików w albumie — przeciąganiem. Te same albumy widać na Macu, w telefonie i w oknie wyboru zdjęć
 * Prezentacji.
 */

type Run = <T>(title: string, action: () => Promise<T>, success?: string) => Promise<T | null>;
type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;
const ALBUM_DRAG = 'application/x-mavinci-material-album';
const ALBUM_FILE_DRAG = 'application/x-mavinci-album-file';

/** Pliki z przeciągnięcia elementów Materiałów (foldery pomijane). */
export function draggedFileIds(event: { dataTransfer: DataTransfer }): string[] {
  const raw = event.dataTransfer.getData(ITEM_DRAG_TYPE);
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as MaterialItemRef[]).filter((ref) => ref.kind === 'file').map((ref) => ref.id);
  } catch {
    return [];
  }
}

/** Lista albumów marki w pasku bocznym: otwarcie, upuszczanie plików (odnośniki), kolejność przeciąganiem, nowy album. */
export function MaterialsAlbumsSidebar({ albums, activeId, canManage, run, notify, onOpen, onChanged, onCreate }: {
  albums: MaterialAlbum[];
  activeId: string | null;
  canManage: boolean;
  run: Run;
  notify: Notify;
  onOpen: (album: MaterialAlbum) => void;
  onChanged: () => void;
  onCreate: () => void;
}) {
  const [over, setOver] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);

  const reorder = async (targetId: string) => {
    if (!dragged || dragged === targetId) return;
    const ids = albums.map((album) => album.id);
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    const companyId = albums[0]?.companyId;
    if (!companyId) return;
    const done = await run('Zmieniam kolejność albumów', () => materialsPost('albumsReorder', { companyId, ids }), 'Zmieniono kolejność albumów');
    if (done) onChanged();
  };

  const drop = async (event: DragEvent, album: MaterialAlbum) => {
    event.preventDefault();
    event.stopPropagation();
    setOver(null);
    if (Array.from(event.dataTransfer.types).includes(ALBUM_DRAG)) { await reorder(album.id); setDragged(null); return; }
    const ids = draggedFileIds(event);
    if (!ids.length) return;
    const result = await run('Dodaję do albumu', () => materialsPostInBatches<{ added: number; skipped: number }>('albumAdd', 'fileIds', ids, { id: album.id }));
    if (!result) return;
    if (result.interrupted) {
      notify(`Dodano do albumu „${album.name}”: ${result.added || 0}. Nie dodano reszty: ${result.interrupted}`, 'warning');
    } else {
      notify(result.added
        ? `Dodano do albumu „${album.name}”: ${result.added}${result.skipped ? ` (pominięto: ${result.skipped})` : ''} — bez kopiowania plików`
        : `Album „${album.name}” ma już te pliki.`, result.added ? 'success' : 'info');
    }
    onChanged();
  };

  return (
    <div className="mt-3 border-t border-[#d3bb73]/10 pt-3">
      <div className="mb-1 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-[#e5e4e2]/40">
        <span>Albumy</span>
        {canManage && <button type="button" onClick={onCreate} className="rounded p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10" aria-label="Nowy album" title="Nowy album"><Plus className="h-4 w-4" /></button>}
      </div>
      {albums.map((album) => (
        <div key={album.id} draggable={canManage}
          onDragStart={(event) => { event.dataTransfer.setData(ALBUM_DRAG, album.id); event.dataTransfer.effectAllowed = 'move'; setDragged(album.id); }}
          onDragEnd={() => { setDragged(null); setOver(null); }}
          onDragOver={(event) => {
            const types = Array.from(event.dataTransfer.types);
            if (!canManage || (!types.includes(ITEM_DRAG_TYPE) && !types.includes(ALBUM_DRAG))) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = types.includes(ALBUM_DRAG) ? 'move' : 'copy';
            if (over !== album.id) setOver(album.id);
          }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver((current) => (current === album.id ? null : current)); }}
          onDrop={(event) => void drop(event, album)}
          className={`rounded-lg ${over === album.id ? 'bg-[#d3bb73]/20 ring-1 ring-[#d3bb73]/50' : ''} ${dragged === album.id ? 'opacity-40' : ''}`}>
          <button type="button" onClick={() => onOpen(album)} title={canManage ? `${album.name} — przeciągnij tu pliki (odnośniki, bez kopii)` : album.name}
            className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${activeId === album.id ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/75 hover:bg-[#e5e4e2]/5 hover:text-[#e5e4e2]'}`}>
            {album.coverUrl ? <img src={album.coverUrl} alt="" className="h-7 w-7 shrink-0 rounded object-cover" draggable={false} />
              : <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-[#0f1119]"><Library className="h-4 w-4 text-[#d3bb73]/50" /></span>}
            <span className="min-w-0 flex-1 truncate">{album.name}</span>
            <span className="text-[11px] text-[#e5e4e2]/40">{album.count}</span>
          </button>
        </div>
      ))}
      {!albums.length && (
        <p className="px-2 text-xs leading-5 text-[#e5e4e2]/40">
          {canManage ? 'Album zbiera zdjęcia z różnych folderów bez kopiowania. Utwórz album („+”) i przeciągaj na niego pliki.' : 'Ta marka nie ma albumów.'}
        </p>
      )}
    </div>
  );
}

/** Zawartość albumu: siatka plików w kolejności albumu (przeciąganie), podgląd, okładka, usunięcie z albumu, edycja albumu. */
export function MaterialsAlbumView({ albumId, access, run, notify, onBack, onChanged, onDeleted, onPreview, onShowInFolder }: {
  albumId: string;
  access: MaterialAccess | undefined;
  run: Run;
  notify: Notify;
  onBack: () => void;
  onChanged: () => void;
  onDeleted: () => void;
  onPreview: (files: MaterialFile[], index: number) => void;
  onShowInFolder: (file: MaterialFile) => void;
}) {
  const [album, setAlbum] = useState<MaterialAlbum | null>(null);
  const [files, setFiles] = useState<MaterialFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<{ name: string; description: string } | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const request = useRef(0);
  const canManage = access?.manage === true;

  const load = useCallback(async () => {
    const id = ++request.current;
    try {
      const data = await materialsGet<{ album: MaterialAlbum; files: MaterialFile[] }>('album', { id: albumId });
      if (id !== request.current) return;
      setAlbum(data.album);
      setFiles(data.files);
      setSelection((current) => new Set(Array.from(current).filter((key) => data.files.some((file) => file.id === key))));
    } catch (error) {
      if (id === request.current) notify(errorMessage(error, 'Nie udało się otworzyć albumu.'), 'error');
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, [albumId, notify]);
  useEffect(() => { setLoading(true); setSelection(new Set()); void load(); }, [load]);

  const select = (id: string, event: ReactMouseEvent) => {
    setSelection((current) => {
      if (event.metaKey || event.ctrlKey) {
        const next = new Set(current);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      }
      return new Set([id]);
    });
  };

  const removeSelected = async () => {
    const ids = Array.from(selection);
    if (!ids.length || !album) return;
    const result = await run('Usuwam z albumu', () => materialsPostInBatches<{ removed: number }>('albumRemove', 'fileIds', ids, { id: album.id }));
    if (!result) return;
    if (result.interrupted) {
      notify(`Usunięto z albumu: ${result.removed || 0}. Nie usunięto reszty: ${result.interrupted}`, 'warning');
    } else {
      notify(result.removed === 1 ? 'Usunięto z albumu — plik został w Materiałach' : `Usunięto z albumu: ${result.removed} — pliki zostały w Materiałach`, 'success');
    }
    setSelection(new Set());
    await load();
    onChanged();
  };

  const setCover = async (file: MaterialFile) => {
    if (!album) return;
    const result = await run('Ustawiam okładkę', () => materialsPost('updateAlbum', { id: album.id, coverFileId: file.id }), 'Ustawiono okładkę albumu');
    if (!result) return;
    await load();
    onChanged();
  };

  const saveEdit = async () => {
    if (!album || !editing) return;
    const result = await run('Zapisuję album', () => materialsPost('updateAlbum', { id: album.id, name: editing.name, description: editing.description }), 'Zapisano album');
    if (!result) return;
    setEditing(null);
    await load();
    onChanged();
  };

  const deleteAlbum = async () => {
    if (!album) return;
    const result = await run('Usuwam album', () => materialsPost('deleteAlbum', { id: album.id }), 'Usunięto album — pliki zostały w Materiałach');
    if (result) onDeleted();
  };

  const reorder = async (targetId: string) => {
    if (!album || !dragged || dragged === targetId) return;
    const ids = files.map((file) => file.id);
    const from = ids.indexOf(dragged);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setFiles(ids.map((id) => files.find((file) => file.id === id)!).filter(Boolean));
    try {
      await materialsPost('albumReorder', { id: album.id, fileIds: ids });
      notify('Zmieniono kolejność w albumie', 'success');
    } catch (error) {
      notify(errorMessage(error, 'Nie udało się zmienić kolejności.'), 'error');
      void load();
    }
  };

  if (loading && !album) return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>;
  if (!album) return <div className={`${cardClass} p-8 text-center text-sm text-[#e5e4e2]/60`}>Nie znaleziono albumu. <button type="button" className={ghostButton} onClick={onBack}>Wróć</button></div>;
  const single = selection.size === 1 ? files.find((file) => selection.has(file.id)) || null : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={ghostButton} onClick={onBack}><ArrowLeft className="h-4 w-4" />Pliki</button>
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 truncate text-lg font-light"><Library className="h-5 w-5 shrink-0 text-[#d3bb73]" />{album.name}</h2>
          <p className="truncate text-xs text-[#e5e4e2]/45">{album.count} {album.count === 1 ? 'plik' : 'plików'} · odnośniki do Materiałów, bez kopii{album.description ? ` · ${album.description}` : ''}</p>
        </div>
        {canManage && <button type="button" className={ghostButton} onClick={() => setEditing({ name: album.name, description: album.description })}><Pencil className="h-4 w-4" />Edytuj</button>}
        {canManage && <button type="button" className={ghostButton} onClick={() => void deleteAlbum()}><Trash2 className="h-4 w-4 text-red-300" />Usuń album</button>}
      </div>

      {editing && (
        <form className={`${cardClass} grid gap-2 p-3 md:grid-cols-[1fr_2fr_auto]`} onSubmit={(event) => { event.preventDefault(); void saveEdit(); }}>
          <input autoFocus className={inputClass} value={editing.name} maxLength={MATERIAL_ALBUM_LIMITS.name} placeholder="Nazwa albumu"
            onChange={(event) => setEditing({ ...editing, name: event.target.value })} />
          <input className={inputClass} value={editing.description} maxLength={MATERIAL_ALBUM_LIMITS.description} placeholder="Opis (opcjonalnie)"
            onChange={(event) => setEditing({ ...editing, description: event.target.value })} />
          <div className="flex gap-2">
            <button type="button" className={secondaryButton} onClick={() => setEditing(null)}>Anuluj</button>
            <button type="submit" className={primaryButton} disabled={!editing.name.trim()}>Zapisz</button>
          </div>
        </form>
      )}

      {selection.size > 0 && (
        <div className={`${cardClass} flex flex-wrap items-center gap-2 px-3 py-2 text-sm`}>
          <span className="mr-auto text-[#e5e4e2]/70">Zaznaczono: {selection.size}</span>
          {single && (
            <>
              <button type="button" className={ghostButton} onClick={() => onPreview(files, files.indexOf(single))}><Eye className="h-4 w-4" />Podgląd</button>
              <button type="button" className={ghostButton}
                onClick={() => void downloadMaterial('material', single.id).catch((error) => notify(errorMessage(error, 'Nie udało się pobrać pliku.'), 'error'))}>
                <Download className="h-4 w-4" />Pobierz
              </button>
              <button type="button" className={ghostButton} onClick={() => onShowInFolder(single)}><FolderOpen className="h-4 w-4" />Pokaż w folderze</button>
              {canManage && single.kind === 'image' && <button type="button" className={ghostButton} onClick={() => void setCover(single)}><ImageIcon className="h-4 w-4" />Okładka albumu</button>}
            </>
          )}
          {canManage && <button type="button" className={ghostButton} onClick={() => void removeSelected()}><X className="h-4 w-4 text-red-300" />Usuń z albumu</button>}
          <button type="button" className={ghostButton} onClick={() => setSelection(new Set())}>Wyczyść</button>
        </div>
      )}

      {!files.length ? (
        <div className={`${cardClass} py-20 text-center text-sm text-[#e5e4e2]/50`}>
          {canManage ? 'Album jest pusty. Przeciągnij pliki z folderów na nazwę albumu w pasku bocznym albo użyj „Dodaj do albumu”.' : 'Album jest pusty.'}
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {files.map((file, index) => (
            <div key={file.id} role="button" tabIndex={0} draggable={canManage}
              onDragStart={(event) => {
                event.dataTransfer.setData(ALBUM_FILE_DRAG, file.id);
                event.dataTransfer.setData(ITEM_DRAG_TYPE, JSON.stringify([{ kind: 'file', id: file.id, name: file.name }]));
                event.dataTransfer.effectAllowed = 'copyMove';
                setDragged(file.id);
              }}
              onDragEnd={() => { setDragged(null); setOver(null); }}
              onDragOver={(event) => { if (dragged && Array.from(event.dataTransfer.types).includes(ALBUM_FILE_DRAG)) { event.preventDefault(); setOver(file.id); } }}
              onDragLeave={() => setOver((current) => (current === file.id ? null : current))}
              onDrop={(event) => { if (!Array.from(event.dataTransfer.types).includes(ALBUM_FILE_DRAG)) return; event.preventDefault(); setOver(null); void reorder(file.id); setDragged(null); }}
              onClick={(event) => select(file.id, event)}
              onDoubleClick={() => onPreview(files, index)}
              className={`group flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-[#1c1f33] transition-colors ${
                over === file.id ? 'border-[#d3bb73] ring-2 ring-[#d3bb73]/50' : selection.has(file.id) ? 'border-[#d3bb73]/70 ring-1 ring-[#d3bb73]/40' : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30'
              } ${dragged === file.id ? 'opacity-40' : ''}`}>
              <div className="relative">
                <MaterialThumb url={file.thumbnailUrl} kind={file.kind} name={file.name} className="aspect-square w-full" />
                {album.coverFileId === file.id && <span className="absolute left-1.5 top-1.5 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-white/85">Okładka</span>}
              </div>
              <div className="space-y-0.5 px-2.5 py-2">
                <p className="truncate text-xs text-[#e5e4e2]" title={file.name}>{file.name}</p>
                <p className="truncate text-[11px] text-[#e5e4e2]/40">{formatMaterialBytes(file.size)} · {dateLabel(file.updatedAt)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
