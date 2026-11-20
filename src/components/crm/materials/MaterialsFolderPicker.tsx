'use client';

import { useMemo, useState, type ReactElement } from 'react';
import { ChevronDown, ChevronRight, Home, X } from 'lucide-react';
import OverlayPortal from '@/components/UI/OverlayPortal';
import type { MaterialFolder } from './materialsApi';
import { folderIcon, ghostButton, primaryButton, secondaryButton } from './materialsUi';
import { childrenOf, descendantIds } from './materialsTree';

/* Wybór folderu docelowego (przenoszenie, zapis pliku wydarzenia w Materiałach). Foldery przenoszone i ich podfoldery są wyłączone. */

export default function MaterialsFolderPicker({ title, confirmText, companyName, folders, initialFolderId, excludeIds = [], onPick, onClose }: {
  title: string;
  confirmText: string;
  companyName: string;
  folders: MaterialFolder[];
  initialFolderId: string | null;
  excludeIds?: string[];
  onPick: (folderId: string | null) => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string | null>(initialFolderId);
  const blocked = useMemo(() => {
    const set = new Set<string>();
    for (const id of excludeIds) for (const d of descendantIds(folders, id)) set.add(d);
    return set;
  }, [excludeIds, folders]);
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>();
    const byId = new Map(folders.map((f) => [f.id, f]));
    let current = initialFolderId ? byId.get(initialFolderId) : undefined;
    while (current?.parentId) {
      open.add(current.parentId);
      current = byId.get(current.parentId);
    }
    return open;
  });

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const renderLevel = (parentId: string | null, depth: number): ReactElement[] =>
    childrenOf(folders, parentId).flatMap((folder) => {
      const Icon = folderIcon(folder.systemKey);
      const disabled = blocked.has(folder.id);
      const kids = childrenOf(folders, folder.id);
      const open = expanded.has(folder.id);
      const row = (
        <div key={folder.id} className="flex items-center" style={{ paddingLeft: depth * 16 }}>
          <button type="button" className="flex h-7 w-6 items-center justify-center text-[#e5e4e2]/40 hover:text-[#e5e4e2]"
            onClick={() => toggle(folder.id)} disabled={!kids.length} aria-label={open ? 'Zwiń' : 'Rozwiń'}>
            {kids.length ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
          </button>
          <button type="button" disabled={disabled} onClick={() => setSelected(folder.id)}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
              selected === folder.id ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/80 hover:bg-[#e5e4e2]/5'
            } disabled:cursor-not-allowed disabled:opacity-30`}>
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{folder.name}</span>
          </button>
        </div>
      );
      return open ? [row, ...renderLevel(folder.id, depth + 1)] : [row];
    });

  return (
    <OverlayPortal>
      <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={title}
        onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <div className="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-[#d3bb73]/15 bg-[#1c1f33] text-[#e5e4e2] shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#d3bb73]/10 px-5 py-4">
            <h2 className="text-lg font-light">{title}</h2>
            <button type="button" className={ghostButton} onClick={onClose} aria-label="Zamknij"><X className="h-5 w-5" /></button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <button type="button" onClick={() => setSelected(null)}
              className={`mb-1 flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm ${
                selected === null ? 'bg-[#d3bb73]/20 text-[#d3bb73]' : 'text-[#e5e4e2]/80 hover:bg-[#e5e4e2]/5'
              }`}>
              <Home className="h-4 w-4" />{companyName} — główny folder
            </button>
            {renderLevel(null, 0)}
          </div>
          <div className="flex justify-end gap-2 border-t border-[#d3bb73]/10 px-5 py-4">
            <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
            <button type="button" className={primaryButton} onClick={() => onPick(selected)}>{confirmText}</button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  );
}
