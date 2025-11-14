// hooks/useGalleryField.ts
'use client';

import { useCallback, useMemo } from 'react';
import { useField, useFormikContext } from 'formik';

export type GalleryItem = {
  src: string;
  alt?: string;
  is_main?: boolean;
  order?: number;
  file?: File | null;
  preview_url?: string | null;
  _tempId?: string;
};

type Opts = {
  name: string;          // np. "gallery"
  maxFiles?: number;
  editable?: boolean;    // zwykle: canManage && isEditing
  thumbnailFieldName?: string; // np. 'thumbnail_url' (opcjonalnie)
};

const norm = (arr?: GalleryItem[]) =>
  Array.isArray(arr)
    ? arr.map((g, i) => ({
        src: g?.src ?? '',
        alt: g?.alt ?? '',
        is_main: !!g?.is_main,
        order: Number.isFinite(g?.order as number) ? (g.order as number) : i,
        file: (g as any)?.file ?? null,
        preview_url: (g as any)?.preview_url ?? null,
        _tempId:
          (g as any)?._tempId ??
          `gi-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
      }))
    : [];

/** Przestaw main na początek oraz znormalizuj order */
const makeMainFirst = (arr: GalleryItem[]) => {
  if (!arr.length) return arr;
  // 1) zagwarantuj pojedyncze is_main
  const firstMainIdx = arr.findIndex((x) => x.is_main);
  let a = arr.slice();
  if (firstMainIdx === -1) {
    a[0] = { ...a[0], is_main: true };
  } else {
    // wygaszamy pozostałe
    a = a.map((x, i) => ({ ...x, is_main: i === firstMainIdx }));
  }
  // 2) ustaw main na index 0 (jeśli nie jest)
  const idx = a.findIndex((x) => x.is_main);
  if (idx > 0) {
    const copy = a.slice();
    const [main] = copy.splice(idx, 1);
    a = [main, ...copy];
  }
  // 3) przelicz order
  a = a.map((x, i) => ({ ...x, order: i }));
  return a;
};

const moveIdx = (arr: GalleryItem[], from: number, to: number) => {
  if (from === to) return arr;
  const copy = arr.slice();
  const [el] = copy.splice(from, 1);
  copy.splice(to, 0, el);
  return copy.map((x, i) => ({ ...x, order: i }));
};

export function useGalleryField({ name, maxFiles, editable, thumbnailFieldName }: Opts) {
  const { setFieldValue, values } = useFormikContext<any>();
  const [field] = useField<GalleryItem[]>({ name });

  const images = useMemo(() => norm(field.value), [field.value]);

  const setImages = useCallback(
    (next: GalleryItem[], { keepMainPosition = false }: { keepMainPosition?: boolean } = {}) => {
      // Jeśli to nie był reorder plików, to main ma być pierwszy.
      const normalized = keepMainPosition ? next.map((x, i) => ({ ...x, order: i })) : makeMainFirst(next);
      setFieldValue(name, normalized);

      // opcjonalnie: aktualizuj miniature
      if (thumbnailFieldName) {
        const m = normalized[0];
        const url = m?.preview_url || m?.src || '';
        setFieldValue(thumbnailFieldName, url);
      }
    },
    [name, setFieldValue, thumbnailFieldName]
  );

  const setPrimary = useCallback(
    (index: number) => {
      if (!editable) return;
      const next = images.map((g, i) => ({ ...g, is_main: i === index }));
      setImages(next); // main-first
    },
    [editable, images, setImages]
  );

  const removeAt = useCallback(
    (index: number) => {
      if (!editable) return;
      const next = images.filter((_, i) => i !== index);
      // po usunięciu: main-first (zabezpiecza main)
      setImages(next);
    },
    [editable, images, setImages]
  );

  const addFiles = useCallback(
    (files: File[]) => {
      if (!editable || !files?.length) return;
      const curr = images.slice();
      const room = maxFiles ? Math.max(0, maxFiles - curr.length) : files.length;
      const take = maxFiles ? files.slice(0, room) : files;

      const appended: GalleryItem[] = take.map((file, i) => ({
        src: '',
        alt: file.name,
        is_main: false,
        order: curr.length + i,
        file,
        preview_url: URL.createObjectURL(file),
        _tempId: `nf-${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
      }));

      // dodanie plików -> main-first
      setImages([...curr, ...appended]);
    },
    [editable, images, maxFiles, setImages]
  );

  /** Reorder DnD – tu NIE przestawiamy main na początek, bo user świadomie układa kolejność.
   *  Ale i tak normalizujemy order. */
  const move = useCallback(
    (from: number, to: number) => {
      if (!editable) return;
      const next = moveIdx(images, from, to);
      setImages(next, { keepMainPosition: true });
    },
    [editable, images, setImages]
  );

  return {
    images,
    setImages,     // raczej nie używaj bezpośrednio; są niżej gotowe helpersy:
    setPrimary,    // przestawia main i daje go na początek
    removeAt,      // usuwa i pilnuje maina
    addFiles,      // dodaje i pilnuje maina
    move,          // DnD: nie rusza maina, ale normalizuje order
  };
}