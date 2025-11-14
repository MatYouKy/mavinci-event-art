// src/app/crm/equipment/new/MainInfoCard.tsx
'use client';
import { useFormikContext } from 'formik';
import { Upload, Loader2 } from 'lucide-react';
import { CategorySelectorBar } from './CategorySelectorBar';
import { useState, useCallback, useMemo } from 'react';
import { useDropzone } from 'react-dropzone';
import { Field, ErrorMessage } from 'formik';

import { ISingleImage } from '@/types/image';
import { toAbsoluteUrl } from '@/components/UI/Image/helpers/toAbsoluteUrl';
import { FormikInput } from '@/components/UI/Formik/FormikInput';
import { FormikTextarea } from '@/components/UI/Formik/FormikTextarea';

type GalleryItem = ISingleImage & {
  // tylko na froncie, pomocniczo:
  file?: File | null;
  preview_url?: string | null;
};

export function MainInfoCard() {
  const { values, setFieldValue, touched, errors } = useFormikContext<any>();
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);

  const err = (k: string) =>
    touched?.[k] && errors?.[k] ? (
      <p className="mt-1 text-xs text-red-400">{String(errors[k] as string)}</p>
    ) : null;

  const normalizeGallery = (arr?: GalleryItem[] | null): GalleryItem[] =>
    Array.isArray(arr) ? arr : [];

  // miniaturę do wyświetlenia licz z priorytetem:
  // 1) thumbnail_url (blob lub względny → absolutny)
  // 2) obraz oznaczony is_main w galerii
  // 3) pierwszy obraz z galerii
  const currentImage: string | null = useMemo(() => {
    if (values?.thumbnail_url) return toAbsoluteUrl(values.thumbnail_url);
    const gallery = normalizeGallery(values?.gallery);
    const main = gallery.find((g) => g.is_main) ?? gallery[0];
    if (main?.preview_url) return main.preview_url; // jeśli jest lokalny preview
    return toAbsoluteUrl(main?.src ?? null);
  }, [values?.thumbnail_url, values?.gallery]);

  const ensureOnePrimary = (items: GalleryItem[]): GalleryItem[] => {
    if (!items.length) return items;
    if (items.some((g) => g.is_main)) return items;
    return [{ ...items[0], is_main: true }, ...items.slice(1)];
  };

  const setThumbnailLocal = async (file: File) => {
    setIsUploading(true);
    try {
      const preview = URL.createObjectURL(file);
      // tylko do UI: pokażemy miniaturę z blob
      await setFieldValue('thumbnail_file', file);
      await setFieldValue('thumbnail_url', preview);

      // opcjonalnie: odśwież 'is_main' w galerii (nie zmieniamy src — backend i tak dostanie plik)
      const gallery = normalizeGallery(values.gallery);
      const newGallery = ensureOnePrimary(
        [
          // nie duplikuj tego samego preview
          ...gallery.filter((g) => g.preview_url !== preview),
          { src: '', alt: 'Miniaturka', is_main: true, order: 0, file, preview_url: preview },
        ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)),
      );
      await setFieldValue('gallery', newGallery);
    } finally {
      setIsUploading(false);
    }
  };

  const clearThumbnail = async () => {
    const prev = values?.thumbnail_url as string | undefined;
    if (prev?.startsWith('blob:')) URL.revokeObjectURL(prev);
    await setFieldValue('thumbnail_file', null);
    await setFieldValue('thumbnail_url', '');

    // nie musisz tykać galerii, zostaw jak jest
  };

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted?.length) void setThumbnailLocal(accepted[0]);
  }, []);

  const { getRootProps, getInputProps } = useDropzone({
    onDrop,
    accept: { 'image/*': [] },
    multiple: false,
    onDragEnter: () => setIsDragging(true),
    onDragLeave: () => setIsDragging(false),
  });

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <CategorySelectorBar />
      <hr className="my-6 border-t border-[#d3bb73]/20" />

      {/* Nazwa / Marka / Model */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-1">
        <div
          className="grid grid-cols-1 gap-4 md:grid-cols-[2fr,1fr,1fr] xs:grid-cols-2
"
        >
          <FormikInput
            name="name"
            label="Nazwa sprzętu"
            required
            placeholder="np. Kolumna RCF ART932a"
          />
          <FormikInput name="brand" label="Marka" placeholder="np. RCF" />
          <FormikInput name="model" label="Model" placeholder="np. ART932a" />
        </div>
      </div>

      <hr className="my-6 border-t border-[#d3bb73]/20" />

      {/* Miniaturka + Opis */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[160px_1fr]">
        <div className="flex flex-col items-center justify-center">
          <label className="mb-2 block text-sm text-[#e5e4e2]/60">Miniaturka</label>

          {currentImage ? (
            <div className="relative group">
              <img
                src={currentImage}
                alt="Miniaturka"
                className="h-34 w-34 rounded-lg object-cover border border-[#d3bb73]/20 shadow-md"
              />
              {isUploading && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/60 rounded-lg">
                  <Loader2 className="h-8 w-8 animate-spin text-[#d3bb73]" />
                </div>
              )}
              <button
                type="button"
                onClick={clearThumbnail}
                className="absolute -right-2 -top-2 rounded-full bg-black/60 px-2 py-1 text-xs text-red-400 hover:text-red-300"
                title="Usuń miniaturkę"
              >
                ✕
              </button>
            </div>
          ) : (
            <div
              {...getRootProps()}
              className={`w-36 h-36 flex flex-col items-center justify-center rounded-lg border-2 border-dashed transition-all duration-200 cursor-pointer
                ${
                  isDragging
                    ? 'border-[#d3bb73] bg-[#0f1119]/60'
                    : 'border-[#d3bb73]/20 bg-[#0f1119] hover:border-[#d3bb73]/40'
                }`}
              title="Przeciągnij i upuść lub kliknij"
            >
              <input {...getInputProps()} />
              {isUploading ? (
                <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]/70" />
              ) : (
                <>
                  <Upload className="h-6 w-6 text-[#d3bb73]/70 mb-2" />
                  <p className="text-xs text-[#e5e4e2]/70 text-center px-2">
                    Przeciągnij i upuść lub kliknij, aby dodać
                  </p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Opis */}
        <FormikTextarea
          name="details.description"
          label="Opis sprzętu"
          placeholder="Krótki opis urządzenia..."
          rows={5}
        />
        {/* ...twoje textarea itd. */}
      </div>
    </div>
  );
}
