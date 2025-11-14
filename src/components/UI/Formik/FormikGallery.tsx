// components/UI/Formik/FormikGallery.tsx
'use client';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Upload,
  Image as ImageIcon,
  Trash2,
  Star,
  StarOff,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { ResponsiveActionBar } from '@/components/crm/ResponsiveActionBar';
import { useGalleryField } from './hooks/useGalleryField';
import { resolveUrl } from '../Image/helpers/resolveUrl';

type Props = {
  name: string; // nazwa pola w Formiku, np. "gallery"
  editMode?: boolean;
  canManage?: boolean;
  maxFiles?: number;
  title?: string;
  thumbnailFieldName?: string; // np. 'thumbnail_url'
};

export default function FormikGallery({
  name,
  editMode = false,
  canManage = true,
  maxFiles,
  title = 'Galeria',
  thumbnailFieldName = 'thumbnail_url',
}: Props) {
  const editable = !!editMode && !!canManage;

  const { images, addFiles, setPrimary, removeAt, move } = useGalleryField({
    name,
    maxFiles,
    editable,
    thumbnailFieldName,
  });

  const isEmpty = images.length === 0;

  // --- DnD UI, lightbox, dropzone ---
  const dragFrom = useRef<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const startDrag = (i: number) => editable && (dragFrom.current = i);
  const dragEnter = (i: number) => editable && setDragOverIndex(i);
  const dragOver = (e: React.DragEvent) => editable && e.preventDefault();
  const drop = (i: number) => {
    if (!editable || dragFrom.current == null || dragFrom.current === i) return;
    move(dragFrom.current, i);
    dragFrom.current = null;
    setDragOverIndex(null);
  };
  const endDrag = () => {
    dragFrom.current = null;
    setDragOverIndex(null);
  };

  const onDrop = useCallback((accepted: File[]) => addFiles(accepted), [addFiles]);

  const { getRootProps, getInputProps, open, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: true,
    disabled: !editable,
    noClick: !(editable && isEmpty),
    noKeyboard: true,

  });

  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const close = () => setSelectedIndex(null);
  const nav = (dir: 'prev' | 'next') => {
    if (selectedIndex == null) return;
    const n = images.length;
    setSelectedIndex(dir === 'prev' ? (selectedIndex - 1 + n) % n : (selectedIndex + 1) % n);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-[#e5e4e2]">{title}</h3>
        {editable && (
          <ResponsiveActionBar
            actions={[
              {
                label: 'Dodaj zdjęcia',
                onClick: () => open(),
                icon: <Upload className="h-4 w-4" />,
              },
            ]}
          />
        )}
      </div>

      <div
        {...(editable ? getRootProps() : {})}
        className={[
          'relative rounded-lg p-3 transition-all',
          editable
            ? 'bg-[#1c1f33]'
            : 'bg-[#1c1f33]/60',
          editable && isDragActive ? 'ring-2 ring-[#d3bb73] ring-offset-2 ring-offset-[#0f1119]' : '',
          isEmpty
            ? editable ? 'border-2 border-dashed border-[#d3bb73]/30 hover:border-[#d3bb73]/50 cursor-pointer' : ''
            : 'border border-[#d3bb73]/10 hover:border-[#d3bb73]/30',
        ].join(' ')}
        onClick={(e) => {
          e.stopPropagation();
          if (editable && isEmpty) open();
        }}
      >
        <input {...getInputProps()} className="hidden" />

        {images.length === 0 ? (
          <div className="p-12 text-center">
            <ImageIcon className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak zdjęć</p>
            {editable && (
              <p className="mt-2 text-xs text-[#e5e4e2]/40">
                Użyj „Dodaj zdjęcia” lub przeciągnij pliki tutaj
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {images.map((img, i) => {
              const url = img.preview_url || resolveUrl(img.src);
              const dragTarget = dragOverIndex === i && editable;

              return (
                <div
                  key={img._tempId ?? `${img.src}-${i}`}
                  className={`group relative overflow-hidden rounded-lg border bg-[#0f1119] ${
                    dragTarget ? 'border-[#d3bb73]' : 'border-[#d3bb73]/10'
                  } hover:border-[#d3bb73]/30`}
                  draggable={editable}
                  onDragStart={() => startDrag(i)}
                  onDragEnter={() => dragEnter(i)}
                  onDragOver={dragOver}
                  onDrop={() => drop(i)}
                  onDragEnd={endDrag}
                >
                  <img
                    src={url}
                    alt={img.alt || 'image'}
                    className="h-full w-full aspect-square object-cover cursor-pointer"
                    onClick={() => setSelectedIndex(i)}
                  />

                  {/* Główne / akcje */}
                  {img.is_main && (
                    <div className="absolute left-2 top-2 rounded bg-[#d3bb73] px-2 py-1 text-xs font-semibold text-[#1c1f33]">
                      Główne
                    </div>
                  )}

                  {editMode && canManage && (
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {img.is_main ? (
                        <button
                          type="button"
                          className="rounded bg-[#d3bb73] p-2 text-[#1c1f33]"
                          disabled
                        >
                          <Star className="h-4 w-4" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPrimary(i);
                          }}
                          className="rounded bg-[#1c1f33]/90 p-2 text-[#e5e4e2] hover:bg-[#d3bb73] hover:text-[#1c1f33]"
                          title="Ustaw jako główne"
                          disabled={!editable}
                        >
                          <StarOff className="h-4 w-4" />
                        </button>
                      )}

                      {editable && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeAt(i);
                          }}
                          className="rounded bg-[#1c1f33]/90 p-2 text-[#e5e4e2] hover:bg-red-500"
                          title="Usuń"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Lightbox */}
      {selectedIndex != null && images[selectedIndex] && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={close}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={close}
              className="absolute right-4 top-4 rounded-full bg-black/50 p-2 text-white"
              title="Zamknij"
            >
              <X className="h-6 w-6" />
            </button>

            {images.length > 1 && (
              <>
                <button
                  onClick={() => nav('prev')}
                  className="absolute left-4 rounded-full bg-black/50 p-3 text-white"
                  title="Poprzednie"
                >
                  <ChevronLeft className="h-8 w-8" />
                </button>
                <button
                  onClick={() => nav('next')}
                  className="absolute right-4 rounded-full bg-black/50 p-3 text-white"
                  title="Następne"
                >
                  <ChevronRight className="h-8 w-8" />
                </button>
              </>
            )}

            <img
              src={images[selectedIndex].preview_url || resolveUrl(images[selectedIndex].src)}
              alt={images[selectedIndex].alt || 'image'}
              className="max-h-[80vh] max-w-full rounded-lg object-contain"
            />

            {editable && !images[selectedIndex].is_main && !editMode && canManage && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
                <button
                  onClick={() => setPrimary(selectedIndex)}
                  className="flex items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-2 text-[#1c1f33]"
                >
                  <Star className="h-4 w-4" />
                  Ustaw jako główne
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
