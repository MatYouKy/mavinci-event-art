'use client';

import { useState, useRef, useEffect } from 'react';
import { Upload, X } from 'lucide-react';
import { IUploadImage } from '@/types/image';

interface SimpleImageUploaderProps {
  onImageSelect: (imageData: IUploadImage) => void;
  initialImage?: {
    src?: string;
    alt?: string;
  };
  showPreview?: boolean;
}

export function SimpleImageUploader({
  onImageSelect,
  initialImage,
  showPreview = true,
}: SimpleImageUploaderProps) {
  const getValidInitialSrc = () => {
    if (!initialImage?.src) return null;
    const src = initialImage.src.trim();
    if (!src || src === 'null' || src === 'undefined') return null;
    return src;
  };

  const [preview, setPreview] = useState<string | null>(getValidInitialSrc());
  const [alt, setAlt] = useState(initialImage?.alt || '');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastBlobUrlRef = useRef<string | null>(null);

  /* =========================
     initialImage validation
     ========================= */
  useEffect(() => {
    const validSrc = getValidInitialSrc();
    if (!validSrc) {
      setPreview(null);
      setImageLoadError(false);
      return;
    }

    const img = new Image();
    const timeout = setTimeout(() => {
      setPreview(null);
      setImageLoadError(true);
    }, 10000);

    img.onload = () => {
      clearTimeout(timeout);
      setPreview(validSrc);
      setImageLoadError(false);
    };

    img.onerror = () => {
      clearTimeout(timeout);
      setPreview(null);
      setImageLoadError(true);
    };

    img.src = validSrc.includes('?')
      ? `${validSrc}&t=${Date.now()}`
      : `${validSrc}?t=${Date.now()}`;

    return () => clearTimeout(timeout);
  }, [initialImage?.src]);

  /* =========================
     cleanup ONLY on unmount
     ========================= */
  useEffect(() => {
    return () => {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
    };
  }, []);

  /* =========================
     core file handling
     ========================= */
  const processFile = (selectedFile: File) => {
    setImageLoadError(false);

    const name = selectedFile.name.toLowerCase();
    const isHeic =
      selectedFile.type === 'image/heic' ||
      selectedFile.type === 'image/heif' ||
      name.endsWith('.heic') ||
      name.endsWith('.heif');

    if (isHeic) {
      alert('Pliki HEIC/HEIF (iPhone) nie są obsługiwane. Zapisz jako JPG lub PNG.');
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      alert('Proszę wybrać plik graficzny');
      return;
    }

    setFile(selectedFile);

    const objectUrl = URL.createObjectURL(selectedFile);
    const previousBlob = lastBlobUrlRef.current;
    lastBlobUrlRef.current = objectUrl;

    const testImg = new Image();
    testImg.onload = () => {
      if (previousBlob) URL.revokeObjectURL(previousBlob);
      setPreview(objectUrl);
    };

    testImg.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      lastBlobUrlRef.current = previousBlob;
      setPreview(null);
      setImageLoadError(true);
      setFile(null);
    };

    testImg.src = objectUrl;

    onImageSelect({
      file: selectedFile,
      alt,
      desktop: {
        src: objectUrl,
        position: { posX: 0, posY: 0, scale: 1 },
      },
      mobile: {
        src: objectUrl,
        position: { posX: 0, posY: 0, scale: 1 },
      },
      image_metadata: {
        desktop: {
          position: { posX: 0, posY: 0, scale: 1 },
          objectFit: '',
        },
        mobile: {
          position: { posX: 0, posY: 0, scale: 1 },
          objectFit: '',
        },
      },
    });
  };

  /* =========================
     handlers
     ========================= */
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  const handleRemove = () => {
    if (lastBlobUrlRef.current) {
      URL.revokeObjectURL(lastBlobUrlRef.current);
      lastBlobUrlRef.current = null;
    }
    setPreview(null);
    setFile(null);
    setImageLoadError(false);
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files?.[0];
    if (droppedFile) processFile(droppedFile);
  };

  /* =========================
     render
     ========================= */
  return (
    <div className="space-y-4">
      <div className="relative">
        {preview && showPreview && !imageLoadError ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#d3bb73]/20">
            <img
              src={preview}
              alt={alt || 'Podgląd'}
              className="h-full w-full object-cover"
              onError={() => {
                setPreview(null);
                setImageLoadError(true);
                setFile(null);
              }}
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute right-2 top-2 rounded-lg bg-[#800020] p-2 text-[#e5e4e2]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`flex aspect-[4/3] w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed transition-all ${
              isDragging
                ? 'scale-[1.02] border-[#d3bb73] bg-[#d3bb73]/10'
                : 'border-[#d3bb73]/30 hover:border-[#d3bb73]/50 hover:bg-[#d3bb73]/5'
            }`}
          >
            <Upload

              className={`h-10 w-10 transition-all ${
                isDragging ? 'scale-110 text-[#d3bb73]' : 'text-[#e5e4e2]/70'
              }`}
            />
            <div className="text-center">
              <p
                className={`text-sm font-medium transition-colors ${
                  isDragging ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
                }`}
              >
                {isDragging ? 'Upuść zdjęcie tutaj' : 'Przeciągnij zdjęcie lub kliknij'}
              </p>
              {!isDragging && (
                <p className="mt-1 text-xs text-[#e5e4e2]/50">PNG, JPG, WEBP do 10MB</p>
              )}
            </div>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
      </div>
    </div>
  );
}
