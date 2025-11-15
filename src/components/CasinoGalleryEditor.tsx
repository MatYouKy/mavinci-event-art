'use client';

import { useState } from 'react';
import { Plus, Trash2, Image as ImageIcon, ArrowUp, ArrowDown } from 'lucide-react';
import { SimpleImageUploader } from './SimpleImageUploader';
import { IUploadImage } from '@/types/image';

interface GalleryImage {
  id: string;
  image: string;
  alt: string;
  caption: string;
  image_metadata?: {
    desktop?: { src: string; position: { posX: number; posY: number; scale: number } };
    mobile?: { src: string; position: { posX: number; posY: number; scale: number } };
  };
  order_index?: number;
  is_visible?: boolean;
}

interface CasinoGalleryEditorProps {
  gallery: GalleryImage[];
  onChange: (gallery: GalleryImage[]) => void;
  onImageUpload?: (imageId: string, imageData: IUploadImage) => void;
}

export default function CasinoGalleryEditor({ gallery, onChange, onImageUpload }: CasinoGalleryEditorProps) {
  const [editingImages, setEditingImages] = useState<{ [key: string]: IUploadImage }>({});

  const addImage = () => {
    const defaultImage = 'https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920';
    const newImage: GalleryImage = {
      id: crypto.randomUUID(),
      image: defaultImage,
      alt: 'Nowe zdjęcie',
      caption: '',
      image_metadata: {
        desktop: { src: defaultImage, position: { posX: 0, posY: 0, scale: 1 } },
        mobile: { src: defaultImage, position: { posX: 0, posY: 0, scale: 1 } },
      },
    };
    onChange([...gallery, newImage]);
  };

  const removeImage = (id: string) => {
    onChange(gallery.filter(img => img.id !== id));
  };

  const updateImage = (id: string, field: keyof GalleryImage, value: any) => {
    onChange(gallery.map(img => img.id === id ? { ...img, [field]: value } : img));
  };

  const moveImage = (index: number, direction: 'up' | 'down') => {
    const newGallery = [...gallery];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newGallery.length) return;

    [newGallery[index], newGallery[targetIndex]] = [newGallery[targetIndex], newGallery[index]];
    onChange(newGallery);
  };

  const handleImageSelect = (imageId: string, imageData: IUploadImage) => {
    setEditingImages({ ...editingImages, [imageId]: imageData });

    if (onImageUpload) {
      onImageUpload(imageId, imageData);
    }

    const updatedGallery = gallery.map(img => {
      if (img.id === imageId) {
        let imageUrl = img.image;
        if (imageData.file) {
          imageUrl = URL.createObjectURL(imageData.file);
        }

        return {
          ...img,
          image: imageUrl,
          alt: imageData.alt || img.alt,
          image_metadata: {
            desktop: imageData.desktop || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
            mobile: imageData.mobile || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
          },
        };
      }
      return img;
    });

    onChange(updatedGallery);
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-light text-[#e5e4e2]">Galeria</h3>
        <button
          onClick={addImage}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Dodaj zdjęcie
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {gallery.map((image, index) => (
          <div key={image.id} className="bg-[#1c1f33]/60 border border-[#d3bb73]/20 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-[#e5e4e2]/70">Zdjęcie #{index + 1}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => moveImage(index, 'up')}
                  disabled={index === 0}
                  className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <button
                  onClick={() => moveImage(index, 'down')}
                  disabled={index === gallery.length - 1}
                  className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
                <button
                  onClick={() => removeImage(image.id)}
                  className="text-red-400 hover:text-red-300"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            <SimpleImageUploader
              onImageSelect={(data) => handleImageSelect(image.id, data)}
              initialImage={{
                src: image.image_metadata?.desktop?.src || image.image,
                alt: image.alt,
                desktop: image.image_metadata?.desktop,
                mobile: image.image_metadata?.mobile,
              }}
              showPreview={true}
            />

            <div>
              <label className="block text-[#e5e4e2]/70 text-xs mb-1">Tekst alternatywny</label>
              <input
                type="text"
                value={image.alt}
                onChange={(e) => updateImage(image.id, 'alt', e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                placeholder="Opis zdjęcia"
              />
            </div>

            <div>
              <label className="block text-[#e5e4e2]/70 text-xs mb-1">Podpis (opcjonalnie)</label>
              <input
                type="text"
                value={image.caption}
                onChange={(e) => updateImage(image.id, 'caption', e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-1.5 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                placeholder="Podpis pod zdjęciem"
              />
            </div>
          </div>
        ))}
      </div>

      {gallery.length === 0 && (
        <div className="text-center py-12 text-[#e5e4e2]/50">
          <p>Brak zdjęć w galerii. Kliknij "Dodaj zdjęcie" aby rozpocząć.</p>
        </div>
      )}
    </div>
  );
}
