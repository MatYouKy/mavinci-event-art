// src/app/crm/equipment/new/tabs/GalleryTabForm.tsx
'use client';

import { useFormikContext, FieldArray } from 'formik';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Star, Upload } from 'lucide-react';

export type GalleryItem = {
  id?: string;
  tempId?: string;
  image_url: string;            // pusty dla nowych do momentu uploadu
  caption?: string | null;
  is_primary: boolean;
  order_index: number;
  file?: File | null;           // <— plik do uploadu przy submit
  preview_url?: string | null;  // <— lokalny preview
};

export function GalleryTabForm() {
  const { values, setFieldValue } = useFormikContext<any>();
  const rawGallery: any[] = values.gallery ?? [];

  const toStrict = (arr: any[]): GalleryItem[] =>
    (arr ?? []).map((g: any, i: number) => ({
      id: g.id,
      tempId: g.tempId,
      image_url: String(g.image_url ?? ''),
      caption: (g.caption ?? null) as string | null,
      is_primary: Boolean(g.is_primary),
      order_index: typeof g.order_index === 'number' ? g.order_index : i,
      file: g.file ?? null,
      preview_url: g.preview_url ?? null,
    }));

  const gallery = useMemo(() => toStrict(rawGallery), [rawGallery]);

  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);

  const dragFromIdx = useRef<number | null>(null);

  const ensureOrder = (arr: GalleryItem[]) => arr.map((g, i) => ({ ...g, order_index: i }));
  const setPrimaryAt = (arr: GalleryItem[], idx: number) => arr.map((g, i) => ({ ...g, is_primary: i === idx }));
  const moveItem = (arr: GalleryItem[], from: number, to: number) => {
    const next = [...arr]; const [moved] = next.splice(from, 1); next.splice(to, 0, moved); return next;
  };
  const syncThumbnailFromPrimary = async (arr: GalleryItem[]) => {
    const primary = arr.find((g) => g.is_primary && (g.preview_url || g.image_url));
    await setFieldValue('thumbnail_url', primary?.preview_url || primary?.image_url || '');
    // NIE ustawiamy 'thumbnail_file' tutaj automatycznie, bo miniaturkę kontrolujesz w MainInfoCard
  };

  const addEmpty = () => {
    const base = toStrict(gallery);
    const next = ensureOrder([
      ...base,
      {
        tempId: crypto.randomUUID(),
        image_url: '',
        caption: '',
        is_primary: base.length === 0,
        order_index: base.length,
        file: null,
        preview_url: null,
      } as GalleryItem,
    ]);
    setFieldValue('gallery', next);
  };

  const removeAt = async (idx: number) => {
    const base = toStrict(gallery);
    const removedWasPrimary = base[idx]?.is_primary;
    let next = ensureOrder(base.filter((_, i) => i !== idx));
    if (removedWasPrimary && next.length > 0) next = setPrimaryAt(next, 0);
    await setFieldValue('gallery', next);
    await syncThumbnailFromPrimary(next);
  };

  const move = async (from: number, to: number) => {
    const base = toStrict(gallery);
    if (to < 0 || to >= base.length) return;
    const next = ensureOrder(moveItem(base, from, to));
    await setFieldValue('gallery', next);
    await syncThumbnailFromPrimary(next);
  };

  const makePrimaryAndBringToFront = async (idx: number) => {
    let next = setPrimaryAt(gallery, idx);
    next = moveItem(next, idx, 0);
    next = ensureOrder(next);
    await setFieldValue('gallery', next);
    await syncThumbnailFromPrimary(next);
  };

  // zamiast uploadu do Supabase — tylko lokalny preview i odkładamy plik
  const handleUploadAt = async (file: File, idx: number) => {
    if (!file) return;
    setUploadingIndex(idx);
    try {
      const preview = URL.createObjectURL(file);
      let base = toStrict(gallery).map((g, i) =>
        i === idx ? { ...g, file, preview_url: preview, image_url: g.image_url || '' } : g,
      );

      if (!values.thumbnail_url) {
        base = setPrimaryAt(base, idx);
        base = moveItem(base, idx, 0);
      }
      const next = ensureOrder(base);
      await setFieldValue('gallery', next);
      await syncThumbnailFromPrimary(next);
    } finally {
      setUploadingIndex(null);
    }
  };

  // Bulk – również tylko lokalny preview i pliki
  const addFromFiles = async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setBulkUploading(true);
    try {
      let base = toStrict(gallery);
      for (const file of list) {
        const preview = URL.createObjectURL(file);
        base = [
          ...base,
          {
            tempId: crypto.randomUUID(),
            image_url: '',
            caption: '',
            is_primary: false,
            order_index: base.length,
            file,
            preview_url: preview,
          } as GalleryItem,
        ];
      }

      if (!values.thumbnail_url && base.length > 0) {
        const firstNewIdx = base.length - list.length;
        base = setPrimaryAt(base, firstNewIdx);
        base = moveItem(base, firstNewIdx, 0);
      }

      const next = ensureOrder(base);
      await setFieldValue('gallery', next);
      await syncThumbnailFromPrimary(next);
    } finally {
      setBulkUploading(false);
      setDropActive(false);
    }
  };

  // auto-primary dla 1. obrazka (jeśli brak thumbnail_url)
  useEffect(() => {
    if (values.thumbnail_url) return;
    const firstWithImg = gallery.findIndex((g) => !!(g.preview_url || g.image_url));
    if (firstWithImg >= 0) {
      (async () => {
        let next = setPrimaryAt(gallery, firstWithImg);
        next = moveItem(next, firstWithImg, 0);
        next = ensureOrder(next);
        await setFieldValue('gallery', next);
        await syncThumbnailFromPrimary(next);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gallery.length]);

  // DnD listy
  const onDragStart = (idx: number) => (e: React.DragEvent) => {
    dragFromIdx.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const onDrop = (toIdx: number) => async (e: React.DragEvent) => {
    e.preventDefault();
    const fromIdx = dragFromIdx.current;
    dragFromIdx.current = null;
    if (fromIdx == null || fromIdx === toIdx) return;
    await move(fromIdx, toIdx);
  };

  // Dropzone (pusty stan)
  const onEmptyDragOver = (e: React.DragEvent) => { e.preventDefault(); setDropActive(true); };
  const onEmptyDragLeave = () => setDropActive(false);
  const onEmptyDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDropActive(false);
    const files = e.dataTransfer.files;
    if (files?.length) await addFromFiles(files);
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">Galeria</h3>
        <button
          type="button"
          onClick={addEmpty}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj pozycję
        </button>
      </div>

      {gallery.length === 0 ? (
        <div
          onDragOver={onEmptyDragOver}
          onDragLeave={onEmptyDragLeave}
          onDrop={onEmptyDrop}
          className={`rounded-lg border border-dashed p-10 text-center transition-colors
          ${dropActive ? 'border-[#d3bb73]/60 bg-[#0f1119]/60' : 'border-[#d3bb73]/20'}
          ${bulkUploading ? 'opacity-70' : ''}`}
        >
          <div className="mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-[#d3bb73]/30 text-[#d3bb73]">
            <Upload className="h-4 w-4" />
          </div>
          <p className="text-sm text-[#e5e4e2]/70">
            Upuść tutaj pliki lub kliknij „Dodaj pozycję”.
          </p>
          <p className="mt-1 text-xs text-[#e5e4e2]/40">Obsługiwane: przeciągnij i upuść wiele obrazów.</p>
        </div>
      ) : (
        <FieldArray
          name="gallery"
          render={() => (
            <div className="space-y-3">
              {gallery.map((item, idx) => {
                const previewSrc = item.preview_url || item.image_url || '';
                return (
                  <div
                    key={item.id ?? item.tempId ?? idx}
                    className="flex items-start gap-4 rounded-lg bg-[#0f1119] p-3"
                    draggable
                    onDragStart={onDragStart(idx)}
                    onDragOver={onDragOver}
                    onDrop={onDrop(idx)}
                  >
                    {/* miniaturka + lokalny upload */}
                    <div className="w-28 shrink-0">
                      {previewSrc ? (
                        <img
                          src={previewSrc}
                          alt="img"
                          className="h-24 w-28 rounded-lg border border-[#d3bb73]/20 object-cover"
                        />
                      ) : (
                        <div className="flex h-24 w-28 items-center justify-center rounded-lg border border-dashed border-[#d3bb73]/20 text-xs text-[#e5e4e2]/40">
                          Brak zdjęcia
                        </div>
                      )}

                      <label className="mt-2 flex cursor-pointer items-center justify-center gap-1 rounded bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2]/80 hover:bg-[#1a2033]">
                        <Upload className="h-3 w-3" />
                        {uploadingIndex === idx ? 'Wybór…' : 'Wgraj'}
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleUploadAt(file, idx);
                          }}
                        />
                      </label>
                    </div>

                    {/* pola */}
                    <div className="grid flex-1 grid-cols-1 gap-3 md:grid-cols-3">
                      <div className="md:col-span-2">
                        <label className="mb-1 block text-xs text-[#e5e4e2]/60">Podpis</label>
                        <input
                          value={item.caption ?? ''}
                          onChange={(e) => {
                            const next = toStrict(gallery);
                            next[idx] = { ...item, caption: e.target.value };
                            setFieldValue('gallery', ensureOrder(next));
                          }}
                          className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2]"
                          placeholder="np. Widok tyłu / panel"
                        />
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => makePrimaryAndBringToFront(idx)}
                          title="Ustaw jako główne i przenieś na początek"
                          className={`rounded-lg p-2 transition-colors ${
                            item.is_primary ? 'text-[#1c1f33] bg-[#d3bb73]' : 'text-[#d3bb73] hover:bg-[#d3bb73]/20'
                          }`}
                        >
                          <Star className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => move(idx, idx - 1)}
                          className="rounded-lg p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#e5e4e2]/10"
                          title="Przesuń w górę"
                        >
                          <ArrowUp className="h-4 w-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => move(idx, idx + 1)}
                          className="rounded-lg p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#e5e4e2]/10"
                          title="Przesuń w dół"
                        >
                          <ArrowDown className="h-4 w-4" />
                        </button>

                        <button
                          type="button"
                          onClick={() => removeAt(idx)}
                          className="rounded-lg p-2 text-red-400 transition-colors hover:bg-red-500/10"
                          title="Usuń"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        />
      )}
    </div>
  );
}