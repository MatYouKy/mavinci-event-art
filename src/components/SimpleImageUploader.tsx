'use client';

import { useState, useRef } from 'react';
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
  const [preview, setPreview] = useState<string | null>(initialImage?.src || null);
  const [alt, setAlt] = useState(initialImage?.alt || '');
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (!selectedFile.type.startsWith('image/')) {
      alert('Proszę wybrać plik graficzny');
      return;
    }

    setFile(selectedFile);
    const reader = new FileReader();
    reader.onloadend = () => {
      setPreview(reader.result as string);
    };
    reader.readAsDataURL(selectedFile);

    onImageSelect({
      file: selectedFile,
      alt,
      image_metadata: {
        desktop: {
          src: '',
          position: { posX: 0, posY: 0, scale: 1 },
        },
        mobile: {
          src: '',
          position: { posX: 0, posY: 0, scale: 1 },
        },
      },
    });
  };

  const handleAltChange = (newAlt: string) => {
    setAlt(newAlt);
    if (file) {
      onImageSelect({
        file,
        alt: newAlt,
        image_metadata: {
          desktop: {
            src: '',
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: '',
            position: { posX: 0, posY: 0, scale: 1 },
          },
        },
      });
    }
  };

  const handleRemove = () => {
    setPreview(null);
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        {preview && showPreview ? (
          <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#d3bb73]/20">
            <img src={preview} alt={alt || 'Podgląd'} className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute right-2 top-2 rounded-lg bg-[#800020] p-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/90"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-[#d3bb73]/30 text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/50 hover:text-[#e5e4e2]"
          >
            <Upload className="h-8 w-8" />
            <span className="text-sm">Wybierz zdjęcie</span>
          </button>
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
        <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Opis zdjęcia (ALT)</label>
        <input
          type="text"
          value={alt}
          onChange={(e) => handleAltChange(e.target.value)}
          placeholder="Np. Zdjęcie z konferencji"
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/30 focus:border-[#d3bb73]/50 focus:outline-none"
        />
      </div>
    </div>
  );
}
