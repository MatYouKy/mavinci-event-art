import type { MaterialFolder } from './materialsApi';

/* Drzewo folderów marki po stronie przeglądarki (lista z `home` → poziomy, ścieżki, potomkowie). */

/** Kolejność: domyślne foldery marki (wg `sortOrder`), potem alfabetycznie (jak na serwerze). */
export const folderOrder = (a: MaterialFolder, b: MaterialFolder) =>
  Number(!a.systemKey) - Number(!b.systemKey) || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'pl', { numeric: true });

export const childrenOf = (folders: MaterialFolder[], parentId: string | null) =>
  folders.filter((f) => f.parentId === parentId).sort(folderOrder);

/** Folder i wszystkie jego podfoldery. */
export function descendantIds(folders: MaterialFolder[], rootId: string): Set<string> {
  const result = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders) {
      if (f.parentId && result.has(f.parentId) && !result.has(f.id)) {
        result.add(f.id);
        added = true;
      }
    }
  }
  return result;
}

/** Ścieżka od głównego folderu marki do `folderId` (bez marki). */
export function pathOf(folders: MaterialFolder[], folderId: string | null): MaterialFolder[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: MaterialFolder[] = [];
  let current = folderId ? byId.get(folderId) : undefined;
  for (let depth = 0; current && depth < 40; depth++) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}
