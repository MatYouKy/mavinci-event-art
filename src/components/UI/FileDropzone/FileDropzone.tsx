/* eslint-disable @next/next/no-img-element */

import { Upload, X, FileText } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import * as pdfjsLib from 'pdfjs-dist';
import { GlobalWorkerOptions } from 'pdfjs-dist';
import dynamic from 'next/dynamic';

const TransformWrapper = dynamic(
  () => import('react-zoom-pan-pinch').then((m) => m.TransformWrapper),
  {
    ssr: false,
  },
);

const TransformComponent = dynamic(
  () => import('react-zoom-pan-pinch').then((m) => m.TransformComponent),
  {
    ssr: false,
  },
);

GlobalWorkerOptions.workerSrc =
  'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

interface FileDropzoneProps {
  file: File | null;

  existingFile?: {
    url?: string | null;
    name?: string | null;
  };

  onChange: (file: File | null) => void;

  onRemoveExisting?: () => void;
}

export function FileDropzone({
  file,
  existingFile,
  onChange,
  onRemoveExisting,
}: FileDropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [usingExisting, setUsingExisting] = useState(false);

  const generatePdfPreview = async (source: ArrayBuffer) => {
    const pdf = await pdfjsLib.getDocument({
      data: source,
    }).promise;

    const page = await pdf.getPage(1);

    const viewport = page.getViewport({
      scale: 1.5,
    });

    const canvas = document.createElement('canvas');

    const ctx = canvas.getContext('2d');

    if (!ctx) return null;

    canvas.width = viewport.width;
    canvas.height = viewport.height;

    await page.render({
      canvasContext: ctx,
      viewport,
    }).promise;

    return canvas.toDataURL('image/png');
  };

  useEffect(() => {
    let objectUrl: string | null = null;


    if (!file && !existingFile?.url) {
      setUsingExisting(false);
      setPreviewUrl(null);
      return;
    }
    
    const loadPreview = async () => {
      setPreviewUrl(null);

      // NOWY PLIK
      if (file) {
        setUsingExisting(false);

        if (file.type.startsWith('image/')) {
          objectUrl = URL.createObjectURL(file);

          setPreviewUrl(objectUrl);

          return;
        }

        if (file.type === 'application/pdf') {
          setLoadingPreview(true);

          try {
            const buffer = await file.arrayBuffer();

            const image = await generatePdfPreview(buffer);

            setPreviewUrl(image);
          } catch (error) {
            console.error('PDF preview error', error);
          } finally {
            setLoadingPreview(false);
          }
        }

        return;
      }

      // ISTNIEJĄCY PLIK Z SUPABASE
      if (existingFile?.url) {
        setUsingExisting(true);

        setLoadingPreview(true);

        try {
          const { data, error } = await supabase.storage
            .from('external-invoices')
            .createSignedUrl(existingFile.url, 3600);

          if (error || !data?.signedUrl) {
            return;
          }

          if (existingFile.url.toLowerCase().endsWith('.pdf')) {
            const response = await fetch(data.signedUrl);

            const buffer = await response.arrayBuffer();

            const image = await generatePdfPreview(buffer);

            setPreviewUrl(image);
          } else {
            setPreviewUrl(data.signedUrl);
          }
        } catch (error) {
          console.error('Existing file preview error', error);
        } finally {
          setLoadingPreview(false);
        }
      }
    };

    loadPreview();

    return () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [file, existingFile?.url]);

  const handleFile = (selected?: File) => {
    if (!selected) return;

    const allowed = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];

    if (!allowed.includes(selected.type)) {
      return;
    }

    onChange(selected);
  };

  const removeFile = () => {
    setPreviewUrl(null);
    setUsingExisting(false);
  
    if (existingFile?.url) {
      onRemoveExisting?.();
    }
  
    onChange(null);
  };

  return (
    <div>
      {!file && !usingExisting ? (
        <div
          onDragEnter={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => {
            setDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();

            setDragActive(false);

            handleFile(e.dataTransfer.files?.[0]);
          }}
          onClick={() => inputRef.current?.click()}
          className={`flex h-44 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed transition-all ${
            dragActive
              ? 'scale-[1.02] border-[#d3bb73] bg-[#d3bb73]/20'
              : 'border-[#d3bb73]/40 bg-[#1c1f33]'
          } `}
        >
          <Upload className="mb-3 h-8 w-8 text-[#d3bb73]" />

          <p className="text-sm text-[#e5e4e2]">
            {dragActive ? 'Upuść plik tutaj' : 'Przeciągnij plik tutaj'}
          </p>

          <p className="mt-1 text-xs text-[#e5e4e2]/50">lub kliknij aby wybrać</p>

          <p className="mt-2 text-xs text-[#e5e4e2]/40">JPG PNG WEBP PDF</p>

          <input
            ref={inputRef}
            hidden
            type="file"
            accept="image/jpeg,image/png,image/jpg,image/webp,application/pdf"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      ) : (
        <div className="relative w-full overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-3">
          <button
            type="button"
            onClick={removeFile}
            className="absolute right-2 top-2 z-20 rounded-full bg-black/50 p-1 text-white hover:bg-red-500"
          >
            <X className="h-4 w-4" />
          </button>

          {loadingPreview ? (
            <div className="flex h-[420px] items-center justify-center text-sm text-[#e5e4e2]/60">
              Generowanie podglądu...
            </div>
          ) : previewUrl ? (
            <TransformWrapper initialScale={1} minScale={1} maxScale={5}>
              {({ zoomIn, zoomOut, resetTransform }) => (
                <>
                  <div className="mb-3 flex justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => zoomIn()}
                      className="rounded bg-[#d3bb73]/20 px-3 py-1 text-[#d3bb73]"
                    >
                      +
                    </button>

                    <button
                      type="button"
                      onClick={() => zoomOut()}
                      className="rounded bg-[#d3bb73]/20 px-3 py-1 text-[#d3bb73]"
                    >
                      -
                    </button>

                    <button
                      type="button"
                      onClick={() => resetTransform()}
                      className="rounded bg-[#d3bb73]/20 px-3 py-1 text-[#d3bb73]"
                    >
                      Reset
                    </button>
                  </div>

                  <div className="flex h-[420px] w-full cursor-grab items-center justify-center overflow-hidden rounded-lg bg-black/20 active:cursor-grabbing">
                    <TransformComponent>
                      <img
                        src={previewUrl}
                        alt={file?.name ?? existingFile?.name ?? 'Podgląd'}
                        className="max-h-[420px] max-w-full object-contain"
                      />
                    </TransformComponent>
                  </div>
                </>
              )}
            </TransformWrapper>
          ) : (
            <div className="flex h-[420px] flex-col items-center justify-center">
              <FileText className="mb-3 h-12 w-12 text-[#d3bb73]" />

              <p className="text-[#e5e4e2]">PDF</p>
            </div>
          )}

          <div className="mt-3 truncate text-xs text-[#e5e4e2]/60">
            {file?.name ?? existingFile?.name}
          </div>
        </div>
      )}
    </div>
  );
}
