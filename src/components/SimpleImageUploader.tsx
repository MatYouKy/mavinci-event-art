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
  showPreview = true
}: SimpleImageUploaderProps) {
  // Validate initialImage.src before using it
  const getValidInitialSrc = () => {
    if (!initialImage?.src) return null;
    const src = initialImage.src.trim();
    if (src === '' || src === 'null' || src === 'undefined') return null;
    return src;
  };

  const [preview, setPreview] = useState<string | null>(getValidInitialSrc());
  const [alt, setAlt] = useState(initialImage?.alt || '');
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [imageLoadError, setImageLoadError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Validate preview URL when component mounts or initialImage changes
  useEffect(() => {
    // Inline validation to avoid dependency warning
    const getValidSrc = () => {
      if (!initialImage?.src) return null;
      const src = initialImage.src.trim();
      if (src === '' || src === 'null' || src === 'undefined') return null;
      return src;
    };

    const validSrc = getValidSrc();

    console.log('[SimpleImageUploader] Validating initial image:', validSrc);

    // If no valid src, clear everything
    if (!validSrc) {
      setPreview(null);
      setImageLoadError(false);
      return;
    }

    // Test if the URL is valid by creating a test image
    const testImg = new Image();
    const timeout = setTimeout(() => {
      console.warn('Initial image load timeout, clearing preview');
      setPreview(null);
      setImageLoadError(true);
    }, 10000); // 10 seconds timeout

    testImg.onload = () => {
      clearTimeout(timeout);
      setPreview(validSrc);
      setImageLoadError(false);
    };

    testImg.onerror = (err) => {
      clearTimeout(timeout);
      console.error('Initial image failed to load:', validSrc, err);
      setPreview(null);
      setImageLoadError(true);
    };

    // Prevent caching issues by adding timestamp
    const urlWithCacheBuster = validSrc.includes('?')
      ? `${validSrc}&t=${Date.now()}`
      : `${validSrc}?t=${Date.now()}`;

    testImg.src = urlWithCacheBuster;

    // Cleanup function
    return () => {
      clearTimeout(timeout);
      testImg.onload = null;
      testImg.onerror = null;
    };
  }, [initialImage?.src]);

  // Cleanup Object URLs on unmount
  useEffect(() => {
    return () => {
      if (preview && preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const processFile = (selectedFile: File) => {
    // Reset error state when selecting new file
    setImageLoadError(false);

    // Validate file type
    if (!selectedFile.type.startsWith('image/')) {
      alert('Proszę wybrać plik graficzny (JPG, PNG, WEBP, GIF)');
      return;
    }

    setFile(selectedFile);

    // CRITICAL FIX: Use Object URL instead of base64 data URL
    // Object URLs are memory-efficient and don't crash browser
    // Clean up previous Object URL if exists
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }

    const objectUrl = URL.createObjectURL(selectedFile);
    setPreview(objectUrl);

    onImageSelect({
      file: selectedFile,
      alt,
      desktop: {
        src: objectUrl,
        position: { posX: 0, posY: 0, scale: 1 }
      },
      mobile: {
        src: objectUrl,
        position: { posX: 0, posY: 0, scale: 1 }
      },
      image_metadata: {
        desktop: {
          position: { posX: 0, posY: 0, scale: 1 }
        },
        mobile: {
          position: { posX: 0, posY: 0, scale: 1 }
        }
      }
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    processFile(selectedFile);
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

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      processFile(droppedFile);
    }
  };

  const handleAltChange = (newAlt: string) => {
    setAlt(newAlt);
    if (file && preview) {
      onImageSelect({
        file,
        alt: newAlt,
        desktop: {
          src: preview,
          position: { posX: 0, posY: 0, scale: 1 }
        },
        mobile: {
          src: preview,
          position: { posX: 0, posY: 0, scale: 1 }
        },
        image_metadata: {
          desktop: {
            position: { posX: 0, posY: 0, scale: 1 }
          },
          mobile: {
            position: { posX: 0, posY: 0, scale: 1 }
          }
        }
      });
    }
  };

  const handleRemove = () => {
    // Clean up Object URL to prevent memory leaks
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setFile(null);
    setImageLoadError(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        {preview && showPreview && !imageLoadError ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#d3bb73]/20">
            <img
              src={preview}
              alt={alt || 'Podgląd'}
              className="w-full h-full object-cover"
              onError={(e) => {
                // CRITICAL FIX: Don't log the URL if it's base64 - causes browser crash
                const urlPreview = preview?.startsWith('data:')
                  ? '[base64 data URL - too large to display]'
                  : preview?.substring(0, 100);
                console.error('Preview image load error for URL:', urlPreview);
                setPreview(null);
                setImageLoadError(true);
                setFile(null);
              }}
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute top-2 right-2 p-2 bg-[#800020] text-[#e5e4e2] rounded-lg hover:bg-[#800020]/90 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : imageLoadError && showPreview ? (
          <div className="w-full aspect-[4/3] border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-3 border-red-500/30 bg-red-500/5">
            <div className="text-center">
              <p className="text-sm font-medium text-red-400">
                Nie udało się załadować istniejącego obrazu
              </p>
              <p className="text-xs text-red-400/70 mt-1">
                Wgraj nowy obraz poniżej
              </p>
            </div>
          </div>
        ) : (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`w-full aspect-[4/3] border-2 border-dashed rounded-lg transition-all cursor-pointer flex flex-col items-center justify-center gap-3 ${
              isDragging
                ? 'border-[#d3bb73] bg-[#d3bb73]/10 scale-[1.02]'
                : 'border-[#d3bb73]/30 hover:border-[#d3bb73]/50 hover:bg-[#d3bb73]/5'
            }`}
          >
            <Upload className={`w-10 h-10 transition-all ${
              isDragging ? 'text-[#d3bb73] scale-110' : 'text-[#e5e4e2]/70'
            }`} />
            <div className="text-center">
              <p className={`text-sm font-medium transition-colors ${
                isDragging ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'
              }`}>
                {isDragging ? 'Upuść zdjęcie tutaj' : 'Przeciągnij zdjęcie lub kliknij'}
              </p>
              {!isDragging && (
                <p className="text-xs text-[#e5e4e2]/50 mt-1">PNG, JPG, WEBP do 10MB</p>
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

      <div>
        <label className="block text-[#e5e4e2] text-sm font-medium mb-2">
          Opis zdjęcia (ALT)
        </label>
        <input
          type="text"
          value={alt}
          onChange={(e) => handleAltChange(e.target.value)}
          placeholder="Np. Zdjęcie z konferencji"
          className="w-full px-4 py-2 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:outline-none focus:border-[#d3bb73]/50"
        />
      </div>
    </div>
  );
}
