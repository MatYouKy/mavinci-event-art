'use client';

import { useState } from 'react';
import { Plus, Trash2, Image as ImageIcon } from 'lucide-react';
import { GalleryImage } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';
import { ImageEditorField } from './ImageEditorField';
import { IUploadImage } from '@/types/image';

interface PortfolioGalleryEditorProps {
  gallery: GalleryImage[];
  onChange: (gallery: GalleryImage[]) => void;
}

export function PortfolioGalleryEditor({ gallery = [], onChange }: PortfolioGalleryEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleAddImage = async (imageData: IUploadImage) => {
    setUploading(true);
    try {
      if (!imageData.file) {
        alert('Wybierz zdjęcie');
        return;
      }

      const imageUrl = await uploadImage(imageData.file, 'portfolio-gallery');

      const newImage: GalleryImage = {
        src: imageUrl,
        alt: imageData.alt || '',
        image_metadata: {
          desktop: {
            src: imageUrl,
            position: imageData.image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: imageData.image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
          },
        },
      };

      onChange([...gallery, newImage]);
      setIsAdding(false);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Błąd podczas wgrywania zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateImage = async (index: number, imageData: IUploadImage) => {
    setUploading(true);
    try {
      let imageUrl = gallery[index].src;

      if (imageData.file) {
        imageUrl = await uploadImage(imageData.file, 'portfolio-gallery');
      }

      const updatedImage: GalleryImage = {
        src: imageUrl,
        alt: imageData.alt || '',
        image_metadata: {
          desktop: {
            src: imageUrl,
            position: imageData.image_metadata?.desktop?.position || gallery[index].image_metadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: imageData.image_metadata?.mobile?.position || gallery[index].image_metadata?.mobile?.position || { posX: 0, posY: 0, scale: 1 },
          },
        },
      };

      const newGallery = [...gallery];
      newGallery[index] = updatedImage;
      onChange(newGallery);
      setEditingIndex(null);
    } catch (error) {
      console.error('Error updating image:', error);
      alert('Błąd podczas aktualizacji zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = (index: number) => {
    if (confirm('Czy na pewno chcesz usunąć to zdjęcie?')) {
      const newGallery = gallery.filter((_, i) => i !== index);
      onChange(newGallery);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-light text-[#e5e4e2]">Galeria wydarzenia</h4>
        <button
          type="button"
          onClick={() => setIsAdding(true)}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj zdjęcie
        </button>
      </div>

      {isAdding && (
        <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6">
          <h5 className="text-[#e5e4e2] mb-4">Nowe zdjęcie</h5>
          <ImageEditorField
            fieldName="newImage"
            isAdmin={true}
            mode="horizontal"
            multiplier={1.5}
            onSave={async (imageData) => {
              await handleAddImage(imageData as IUploadImage);
            }}
          />
          <div className="flex gap-3 mt-4">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {gallery.map((image, index) => (
          <div key={index} className="relative group">
            {editingIndex === index ? (
              <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-4">
                <ImageEditorField
                  fieldName={`gallery-${index}`}
                  isAdmin={true}
                  mode="horizontal"
                  multiplier={1.5}
                  image={{
                    alt: image.alt,
                    image_metadata: image.image_metadata,
                  }}
                  onSave={async (imageData) => {
                    await handleUpdateImage(index, imageData as IUploadImage);
                  }}
                />
                <button
                  type="button"
                  onClick={() => setEditingIndex(null)}
                  className="w-full mt-2 px-4 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                >
                  Anuluj
                </button>
              </div>
            ) : (
              <>
                <div className="aspect-[4/3] relative overflow-hidden rounded-lg border border-[#d3bb73]/10">
                  <img
                    src={image.image_metadata?.desktop?.src || image.src}
                    alt={image.alt || 'Zdjęcie z galerii'}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="absolute top-2 right-2 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => setEditingIndex(index)}
                    className="p-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteImage(index)}
                    className="p-2 bg-[#800020] text-[#e5e4e2] rounded-lg hover:bg-[#800020]/90 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {gallery.length === 0 && !isAdding && (
        <div className="text-center py-12 border border-dashed border-[#d3bb73]/20 rounded-xl">
          <ImageIcon className="w-12 h-12 text-[#d3bb73]/50 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/50">Brak zdjęć w galerii</p>
          <p className="text-[#e5e4e2]/30 text-sm mt-2">Kliknij "Dodaj zdjęcie" aby rozpocząć</p>
        </div>
      )}
    </div>
  );
}
