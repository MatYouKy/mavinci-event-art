'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eye, FolderOpen, Loader2, RotateCcw, Trash2 } from 'lucide-react';
import { useDialog } from '@/contexts/DialogContext';
import { MATERIALS_TRASH_DAYS, formatMaterialBytes } from '@/lib/materials/materialsShared';
import { materialsGet, materialsPost, type MaterialTrashItem } from './materialsApi';
import { MaterialThumb, cardClass, dangerButton, dateTimeLabel, errorMessage, ghostButton, purgeLabel, secondaryButton } from './materialsUi';
import type { PreviewItem } from './MaterialsPreview';

/*
 * Kosz marki (zarządzający Materiałami): elementy usunięte w ostatnich 30 dniach. Folder wraca razem z zawartością usuniętą
 * w tej samej operacji; „Usuń na zawsze” i „Opróżnij kosz” usuwają też pliki z magazynu (tylko nieużywane gdzie indziej).
 */

type Run = <T>(title: string, action: () => Promise<T>, success?: string) => Promise<T | null>;
type Notify = (message: string, type: 'success' | 'error' | 'info' | 'warning') => void;

export default function MaterialsTrash({ companyId, run, onChanged, onPreview, notify }: {
  companyId: string;
  run: Run;
  onChanged: () => void;
  onPreview: (items: PreviewItem[], index: number) => void;
  notify: Notify;
}) {
  const { showConfirm } = useDialog();
  const [items, setItems] = useState<MaterialTrashItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await materialsGet<{ items: MaterialTrashItem[] }>('trash', { company: companyId });
      setItems(data.items);
      setSelected(new Set());
    } catch (error) {
      notify(errorMessage(error, 'Nie udało się pobrać kosza.'), 'error');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, notify]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => (items || []).filter((item) => !item.insideFolder), [items]);
  const allSelected = visible.length > 0 && visible.every((item) => selected.has(item.id));

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const restore = async (ids: string[]) => {
    if (!ids.length) return;
    const result = await run('Przywracam z kosza', () => materialsPost<{ restored: number; skipped: number }>('restore', { ids }));
    if (!result) return;
    if (result.skipped) notify(`Przywrócono: ${result.restored}. Pominięto: ${result.skipped}.`, 'warning');
    else notify(result.restored === 1 ? 'Przywrócono z kosza' : `Przywrócono z kosza: ${result.restored}`, 'success');
    onChanged();
    await load();
  };

  const deleteForever = async (ids: string[], all = false) => {
    if (!all && !ids.length) return;
    const ok = await showConfirm({
      title: all ? 'Opróżnić kosz?' : ids.length === 1 ? 'Usunąć na zawsze?' : `Usunąć na zawsze (${ids.length})?`,
      message: all
        ? 'Wszystkie elementy z kosza tej marki zostaną usunięte na zawsze razem z plikami w magazynie. Tej operacji nie można cofnąć.'
        : 'Zaznaczone elementy (a folder razem z zawartością) zostaną usunięte na zawsze razem z plikami w magazynie. Tej operacji nie można cofnąć.',
      confirmText: all ? 'Opróżnij kosz' : 'Usuń na zawsze',
    });
    if (!ok) return;
    const result = await run(all ? 'Opróżniam kosz' : 'Usuwam na zawsze',
      () => materialsPost<{ removed: number }>('deleteForever', all ? { companyId, all: true } : { ids }),
      all ? 'Kosz opróżniony' : 'Usunięto na zawsze');
    if (!result) return;
    onChanged();
    await load();
  };

  const preview = (item: MaterialTrashItem) => {
    const files = visible.filter((x) => x.kind === 'file');
    const list: PreviewItem[] = files.map((x) => ({
      source: 'trash', id: x.id, name: x.name, kind: x.fileKind, mime: x.mime, size: x.size, thumbnailUrl: x.thumbnailUrl,
      subtitle: 'w koszu',
    }));
    onPreview(list, Math.max(0, files.findIndex((x) => x.id === item.id)));
  };

  if (loading && !items) {
    return <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-sm text-[#e5e4e2]/60">
          Elementy usunięte w ostatnich {MATERIALS_TRASH_DAYS} dniach. Folder wraca razem ze swoją zawartością.
        </p>
        <button type="button" className={secondaryButton} disabled={!selected.size}
          onClick={() => void restore(Array.from(selected))}>
          <RotateCcw className="h-4 w-4" />Przywróć zaznaczone
        </button>
        <button type="button" className={dangerButton} disabled={!selected.size} onClick={() => void deleteForever(Array.from(selected))}>
          <Trash2 className="h-4 w-4" />Usuń na zawsze
        </button>
        <button type="button" className={dangerButton} disabled={!visible.length} onClick={() => void deleteForever([], true)}>
          Opróżnij kosz
        </button>
      </div>

      {!visible.length ? (
        <div className={`${cardClass} py-20 text-center text-sm text-[#e5e4e2]/50`}>Kosz jest pusty.</div>
      ) : (
        <div className={`${cardClass} overflow-hidden`}>
          <table className="w-full text-sm">
            <thead className="border-b border-[#d3bb73]/10 text-left text-xs uppercase tracking-wide text-[#e5e4e2]/40">
              <tr>
                <th className="w-10 px-3 py-2">
                  <input type="checkbox" checked={allSelected} aria-label="Zaznacz wszystko"
                    onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((item) => item.id)))} />
                </th>
                <th className="px-3 py-2">Nazwa</th>
                <th className="hidden px-3 py-2 lg:table-cell">Było w</th>
                <th className="hidden px-3 py-2 md:table-cell">Usunięto</th>
                <th className="hidden px-3 py-2 xl:table-cell">Zniknie</th>
                <th className="px-3 py-2 text-right">Akcje</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className="border-b border-[#d3bb73]/5 last:border-0 hover:bg-[#e5e4e2]/[0.03]">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} aria-label={`Zaznacz ${item.name}`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex min-w-0 items-center gap-3">
                      {item.kind === 'folder' ? (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#0f1119] text-[#d3bb73]/70"><FolderOpen className="h-5 w-5" /></div>
                      ) : (
                        <MaterialThumb url={item.thumbnailUrl} kind={item.fileKind} name={item.name} className="h-10 w-10 shrink-0 rounded-lg" />
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-[#e5e4e2]">{item.name}</p>
                        <p className="truncate text-xs text-[#e5e4e2]/40">
                          {item.kind === 'folder'
                            ? (item.contains ? `Folder · elementów w środku: ${item.contains}` : 'Pusty folder')
                            : formatMaterialBytes(item.size)}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-3 py-2 text-[#e5e4e2]/60 lg:table-cell">{item.location || 'Główny folder marki'}</td>
                  <td className="hidden px-3 py-2 text-[#e5e4e2]/60 md:table-cell">
                    {dateTimeLabel(item.deletedAt)}{item.deletedBy ? ` · ${item.deletedBy}` : ''}
                  </td>
                  <td className="hidden px-3 py-2 text-[#e5e4e2]/60 xl:table-cell">{purgeLabel(item.purgeAfter)}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      {item.kind === 'file' && (
                        <button type="button" className={ghostButton} onClick={() => preview(item)} title="Podgląd"><Eye className="h-4 w-4" /></button>
                      )}
                      <button type="button" className={ghostButton} title="Przywróć"
                        onClick={() => void restore([item.id])}>
                        <RotateCcw className="h-4 w-4" />
                      </button>
                      <button type="button" className={ghostButton} onClick={() => void deleteForever([item.id])} title="Usuń na zawsze">
                        <Trash2 className="h-4 w-4 text-red-300" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
