'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, X, CheckCircle, AlertCircle } from 'lucide-react';
import { IUploadImage } from '@/types/image';

interface SimpleImageUploaderProps {
  onImageSelect: (imageData: IUploadImage) => void;
  initialImage?: {
    src?: string;
    alt?: string;
  };
  showPreview?: boolean;
  onUploadProgress?: (progress: number) => void;
  uploadStatus?: 'idle' | 'uploading' | 'success' | 'error';
  uploadProgress?: number;
}

export function SimpleImageUploader({
  onImageSelect,
  initialImage,
  showPreview = true,
  uploadStatus = 'idle',
  uploadProgress = 0,
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
  const [localProgress, setLocalProgress] = useState(0);
  const [localStatus, setLocalStatus] = useState<'idle' | 'processing' | 'ready'>('idle');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastBlobUrlRef = useRef<string | null>(null);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialImage?.src]);

  useEffect(() => {
    return () => {
      if (lastBlobUrlRef.current) {
        URL.revokeObjectURL(lastBlobUrlRef.current);
        lastBlobUrlRef.current = null;
      }
    };
  }, []);

  const processFile = useCallback((selectedFile: File) => {
    setImageLoadError(false);
    setLocalStatus('processing');
    setLocalProgress(10);

    const name = selectedFile.name.toLowerCase();
    const isHeic =
      selectedFile.type === 'image/heic' ||
      selectedFile.type === 'image/heif' ||
      name.endsWith('.heic') ||
      name.endsWith('.heif');

    if (isHeic) {
      setLocalStatus('idle');
      setLocalProgress(0);
      return;
    }

    if (!selectedFile.type.startsWith('image/')) {
      setLocalStatus('idle');
      setLocalProgress(0);
      return;
    }

    setLocalProgress(30);
    setFile(selectedFile);

    const objectUrl = URL.createObjectURL(selectedFile);
    const previousBlob = lastBlobUrlRef.current;
    lastBlobUrlRef.current = objectUrl;

    setLocalProgress(50);

    const testImg = new Image();
    testImg.onload = () => {
      if (previousBlob) URL.revokeObjectURL(previousBlob);
      setPreview(objectUrl);
      setLocalProgress(100);
      setLocalStatus('ready');

      setTimeout(() => {
        setLocalProgress(0);
        setLocalStatus('idle');
      }, 1500);
    };

    testImg.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      lastBlobUrlRef.current = previousBlob;
      setPreview(null);
      setImageLoadError(true);
      setFile(null);
      setLocalStatus('idle');
      setLocalProgress(0);
    };

    testImg.src = objectUrl;

    onImageSelect({
      file: selectedFile,
      alt,
      image_metadata: {
        desktop: {
          position: { posX: 0, posY: 0, scale: 1 },
          objectFit: 'cover',
        },
        mobile: {
          position: { posX: 0, posY: 0, scale: 1 },
          objectFit: 'cover',
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alt, onImageSelect]);

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
    setLocalProgress(0);
    setLocalStatus('idle');
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

  const activeProgress = uploadStatus === 'uploading' ? uploadProgress : localProgress;
  const showProgress = activeProgress > 0 && activeProgress < 100;
  const isUploading = uploadStatus === 'uploading' || localStatus === 'processing';

  return (
    <div className="relative h-full w-full">
      {preview && showPreview && !imageLoadError ? (
        <div className="relative h-full w-full overflow-hidden rounded-lg border border-[#d3bb73]/20">
          <img
            src={preview}
            alt={alt || 'Podglad'}
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
            className="absolute right-2 top-2 rounded-lg bg-[#800020]/90 p-1.5 text-[#e5e4e2] backdrop-blur-sm transition-all hover:scale-110 hover:bg-[#800020]"
          >
            <X className="h-4 w-4" />
          </button>

          {/* Upload overlay with progress */}
          {isUploading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm">
              <div className="mb-3 h-8 w-8 animate-spin rounded-full border-2 border-[#d3bb73]/30 border-t-[#d3bb73]" />
              <p className="text-sm font-medium text-[#e5e4e2]">
                {uploadStatus === 'uploading' ? 'Uploadowanie...' : 'Przetwarzanie...'}
              </p>
            </div>
          )}

          {/* Success indicator */}
          {(uploadStatus === 'success' || (localStatus === 'ready' && uploadStatus !== 'uploading')) && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-green-600/90 px-2 py-1 backdrop-blur-sm">
              <CheckCircle className="h-3.5 w-3.5 text-white" />
              <span className="text-xs font-medium text-white">Gotowe</span>
            </div>
          )}

          {/* Error indicator */}
          {uploadStatus === 'error' && (
            <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-red-600/90 px-2 py-1 backdrop-blur-sm">
              <AlertCircle className="h-3.5 w-3.5 text-white" />
              <span className="text-xs font-medium text-white">Blad uploadu</span>
            </div>
          )}

          {/* Progress bar */}
          {showProgress && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/30">
              <div
                className="h-full bg-[#d3bb73] transition-all duration-300 ease-out"
                style={{ width: `${activeProgress}%` }}
              />
            </div>
          )}
        </div>
      ) : (
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex h-full w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed transition-all ${
            isDragging
              ? 'scale-[1.01] border-[#d3bb73] bg-[#d3bb73]/10'
              : 'border-[#d3bb73]/30 hover:border-[#d3bb73]/50 hover:bg-[#d3bb73]/5'
          }`}
        >
          <Upload
            className={`h-8 w-8 transition-all ${
              isDragging ? 'scale-110 text-[#d3bb73]' : 'text-[#e5e4e2]/50'
            }`}
          />
          <div className="text-center px-2">
            <p
              className={`text-xs font-medium transition-colors ${
                isDragging ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/80'
              }`}
            >
              {isDragging ? 'Upusc tutaj' : 'Przeciagnij lub kliknij'}
            </p>
            {!isDragging && (
              <p className="mt-0.5 text-[10px] text-[#e5e4e2]/40">PNG, JPG, WEBP</p>
            )}
          </div>

          {/* Progress bar in empty state */}
          {showProgress && (
            <div className="absolute inset-x-3 bottom-3 h-1.5 overflow-hidden rounded-full bg-[#1c1f33]">
              <div
                className="h-full rounded-full bg-[#d3bb73] transition-all duration-300 ease-out"
                style={{ width: `${activeProgress}%` }}
              />
            </div>
          )}
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
  );
}
