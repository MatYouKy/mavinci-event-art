'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import {
  Archive,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Loader,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface StorageFileThumbnailProps {
  storagePath?: string | null;
  bucket?: string;
  directUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  alt?: string;
  className?: string;
}

const IMAGE_EXTENSIONS = new Set([
  'avif',
  'bmp',
  'gif',
  'heic',
  'heif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
]);

const getExtension = (fileName?: string | null) =>
  fileName?.toLowerCase().split('.').pop()?.replace(/[^a-z0-9]/g, '') || '';

const isImageFile = (mimeType?: string | null, fileName?: string | null) =>
  Boolean(mimeType?.toLowerCase().startsWith('image/')) ||
  IMAGE_EXTENSIONS.has(getExtension(fileName));

const isPdfFile = (mimeType?: string | null, fileName?: string | null) =>
  mimeType?.toLowerCase() === 'application/pdf' || getExtension(fileName) === 'pdf';

const renderPdfFirstPage = async (source: ArrayBuffer) => {
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';

  const loadingTask = pdfjsLib.getDocument({ data: source });
  const pdf = await loadingTask.promise;

  try {
    const page = await pdf.getPage(1);
    const initialViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(2, 420 / Math.max(initialViewport.width, 1));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) return null;

    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));

    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    await pdf.destroy();
  }
};

const FileTypeIcon = ({
  mimeType,
  fileName,
}: Pick<StorageFileThumbnailProps, 'mimeType' | 'fileName'>) => {
  const normalizedMime = mimeType?.toLowerCase() || '';
  const iconClassName = 'h-[32%] min-h-5 w-[32%] min-w-5 max-h-10 max-w-10';

  if (isImageFile(mimeType, fileName)) return <ImageIcon className={iconClassName} />;
  if (normalizedMime.startsWith('video/')) return <FileVideo className={iconClassName} />;
  if (normalizedMime.startsWith('audio/')) return <FileAudio className={iconClassName} />;
  if (normalizedMime.includes('zip') || normalizedMime.includes('rar')) {
    return <Archive className={iconClassName} />;
  }
  return <FileText className={iconClassName} />;
};

export default function StorageFileThumbnail({
  storagePath,
  bucket = 'event-files',
  directUrl,
  mimeType,
  fileName,
  alt,
  className = '',
}: StorageFileThumbnailProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nearViewport, setNearViewport] = useState(false);
  const imageFile = isImageFile(mimeType, fileName);
  const pdfFile = isPdfFile(mimeType, fileName);
  const previewable = imageFile || pdfFile;

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin: '160px' },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const abortController = new AbortController();

    const loadThumbnail = async () => {
      setThumbnailUrl(null);
      if (!nearViewport || !previewable || (!directUrl && !storagePath)) return;

      setLoading(true);
      try {
        let sourceUrl = directUrl || '';
        if (!sourceUrl && storagePath) {
          const { data, error } = await supabase.storage
            .from(bucket)
            .createSignedUrl(storagePath, 900);

          if (error || !data?.signedUrl) throw error || new Error('Brak adresu podglądu');
          sourceUrl = data.signedUrl;
        }

        if (imageFile) {
          if (!cancelled) setThumbnailUrl(sourceUrl);
          return;
        }

        const response = await fetch(sourceUrl, { signal: abortController.signal });
        if (!response.ok) throw new Error(`Nie udało się pobrać PDF (${response.status})`);
        const renderedUrl = await renderPdfFirstPage(await response.arrayBuffer());
        if (!cancelled) setThumbnailUrl(renderedUrl);
      } catch (error) {
        if (!cancelled && !(error instanceof DOMException && error.name === 'AbortError')) {
          console.error('File thumbnail error:', error);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadThumbnail();

    return () => {
      cancelled = true;
      abortController.abort();
    };
  }, [bucket, directUrl, imageFile, nearViewport, pdfFile, previewable, storagePath]);

  return (
    <div
      ref={containerRef}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden bg-[#1c1f33] text-[#d3bb73] ${className}`}
      title={fileName || alt || 'Plik'}
    >
      {thumbnailUrl ? (
        <img
          src={thumbnailUrl}
          alt={alt || fileName || 'Miniatura pliku'}
          loading="lazy"
          decoding="async"
          onError={() => setThumbnailUrl(null)}
          className={`h-full w-full ${pdfFile ? 'bg-white object-contain' : 'object-cover'}`}
        />
      ) : loading ? (
        <Loader className="h-5 w-5 animate-spin text-[#d3bb73]/70" />
      ) : (
        <FileTypeIcon mimeType={mimeType} fileName={fileName} />
      )}

      {pdfFile && thumbnailUrl && (
        <span className="absolute bottom-1 right-1 rounded bg-red-700/90 px-1 py-0.5 text-[8px] font-bold leading-none text-white shadow">
          PDF
        </span>
      )}
    </div>
  );
}
