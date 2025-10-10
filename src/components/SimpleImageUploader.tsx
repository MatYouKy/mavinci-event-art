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
  showPreview = true
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
          position: { posX: 0, posY: 0, scale: 1 }
        },
        mobile: {
          src: '',
          position: { posX: 0, posY: 0, scale: 1 }
        }
      }
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
            position: { posX: 0, posY: 0, scale: 1 }
          },
          mobile: {
            src: '',
            position: { posX: 0, posY: 0, scale: 1 }
          }
        }
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
            <img
              src={preview}
              alt={alt || 'Podgląd'}
              className="w-full h-full object-cover"
            />
            <button
              type="button"
              onClick={handleRemove}
              className="absolute top-2 right-2 p-2 bg-[#800020] text-[#e5e4e2] rounded-lg hover:bg-[#800020]/90 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="w-full aspect-[4/3] border-2 border-dashed border-[#d3bb73]/30 rounded-lg hover:border-[#d3bb73]/50 transition-colors flex flex-col items-center justify-center gap-2 text-[#e5e4e2]/70 hover:text-[#e5e4e2]"
          >
            <Upload className="w-8 h-8" />
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
