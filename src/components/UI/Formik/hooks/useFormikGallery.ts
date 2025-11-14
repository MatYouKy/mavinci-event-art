'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { useField, useFormikContext, getIn } from 'formik';
import type { ISingleImage } from '@/types/image';

export type FormGalleryItem = ISingleImage & {
  file?: File | null;
  preview_url?: string | null;
  _tempId?: string;
};

type Options = {
  name: string;
  editMode?: boolean;
  canManage?: boolean;
  maxFiles?: number;
};

export function useFormikGallery({
  name,
  editMode = false,
  canManage = true,
  maxFiles,
}: Options) {
  const { values, setFieldValue } = useFormikContext<any>();
  const [field] = useField<FormGalleryItem[]>({ name });

  // UI
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const dragFrom = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const isEditable = !!editMode && !!canManage;

  const normalize = (arr?: FormGalleryItem[]) =>
    Array.isArray(arr)
      ? arr.map((g, i) => ({
          src: g.src ?? '',
          alt: g.alt ?? '',
          is_main: !!g.is_main,
          order: typeof g.order === 'number' ? g.order : i,
          file: (g as any).file ?? null,
          preview_url: (g as any).preview_url ?? null,
          _tempId: (g as any)._tempId ?? `k-${i}-${g.src ?? ''}`,
        }))
      : [];

  const images = useMemo<FormGalleryItem[]>(() => normalize(field.value), [field.value]);

  const ensureOneMain = (arr: FormGalleryItem[]) => {
    if (!arr.length) return arr;
    const firstIdx = arr.findIndex((g) => g.is_main);
    if (firstIdx >= 0) return arr.map((g, i) => ({ ...g, is_main: i === firstIdx }));
    const [f, ...r] = arr;
    return [{ ...f, is_main: true }, ...r];
  };

  // --- NAJWAŻNIEJSZE: zawsze operuj na świeżej wartości z Formika
  const updateByDraft = (mutator: (draft: FormGalleryItem[]) => FormGalleryItem[]) => {
    const current = normalize(getIn(values, name) as FormGalleryItem[]);
    const next = mutator(current).map((x, i) => ({ ...x, order: i }));
    setFieldValue(name, next);           // 1) najpierw pole 'gallery'
    return next;                         //    zwróć żeby móc ustawić thumbnail_url
  };

  const updateThumbIfPresent = (main?: FormGalleryItem) => {
    if (main && 'thumbnail_url' in (values ?? {})) {
      const url = main.preview_url || main.src || '';
      setFieldValue('thumbnail_url', url); // 2) dopiero potem miniatura
    }
  };

  const setPrimary = (index: number) => {
    if (!isEditable) return;
    const next = updateByDraft((draft) => draft.map((g, i) => ({ ...g, is_main: i === index })));
    updateThumbIfPresent(next[index]);
  };

  const removeAt = (index: number) => {
    if (!isEditable) return;
    const next = updateByDraft((draft) => ensureOneMain(draft.filter((_, i) => i !== index)));
    updateThumbIfPresent(next.find((g) => g.is_main));
  };

  const addFiles = async (files: File[]) => {
    if (!isEditable || !files.length) return;
    setUploading(true);
    try {
      const next = updateByDraft((draft) => {
        const space = maxFiles ? Math.max(0, maxFiles - draft.length) : files.length;
        const slice = maxFiles ? files.slice(0, space) : files;
        const appended: FormGalleryItem[] = slice.map((file, i) => ({
          src: '',
          alt: file.name,
          is_main: false,
          order: draft.length + i,
          file,
          preview_url: URL.createObjectURL(file),
          _tempId: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`,
        }));
        return ensureOneMain([...draft, ...appended]);
      });
      updateThumbIfPresent(next.find((g) => g.is_main));
    } finally {
      setUploading(false);
    }
  };

  // DnD reorder (też przez updateByDraft)
  const moveItem = (arr: FormGalleryItem[], from: number, to: number) => {
    const copy = [...arr];
    const [el] = copy.splice(from, 1);
    copy.splice(to, 0, el);
    return copy;
  };
  const startDrag = (i: number) => isEditable && (dragFrom.current = i);
  const dragEnter = (i: number) => isEditable && setDragOverIndex(i);
  const dragOver = (e: React.DragEvent) => isEditable && e.preventDefault();
  const drop = (i: number) => {
    if (!isEditable || dragFrom.current == null || dragFrom.current === i) return;
    updateByDraft((draft) => moveItem(draft, dragFrom.current!, i));
    dragFrom.current = null;
    setDragOverIndex(null);
  };
  const endDrag = () => {
    dragFrom.current = null;
    setDragOverIndex(null);
  };

  // Lightbox
  const close = () => setSelectedIndex(null);
  const nav = (dir: 'prev' | 'next') => {
    if (selectedIndex == null) return;
    const n = images.length;
    setSelectedIndex(dir === 'prev' ? (selectedIndex - 1 + n) % n : (selectedIndex + 1) % n);
  };

  // Dropzone
  const onDrop = useCallback((accepted: File[]) => addFiles(accepted), [isEditable, maxFiles]);
  const { open, getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
    disabled: !isEditable,
    noClick: true,
    noKeyboard: true,
    onDragEnter: () => isEditable && setDragging(true),
    onDragLeave: () => isEditable && setDragging(false),
  });

  return {
    images,
    uploading,
    dragging,
    dragOverIndex,
    selectedIndex,
    isEditable,

    setPrimary,
    removeAt,
    addFiles,

    startDrag,
    dragEnter,
    dragOver,
    drop,
    endDrag,

    close,
    nav,

    openFileDialog: open,
    getRootProps,
    getInputProps,
    isDragActive,
  };
}