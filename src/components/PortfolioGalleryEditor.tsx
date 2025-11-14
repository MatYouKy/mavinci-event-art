'use client';

import { useState } from 'react';
import { Plus, Trash2, Image as ImageIcon, Edit } from 'lucide-react';
import { GalleryImage } from '@/lib/supabase';
import { uploadImage } from '@/lib/storage';
import { SimpleImageUploader } from './SimpleImageUploader';
import { IUploadImage } from '@/types/image';

interface PortfolioGalleryEditorProps {
  gallery: GalleryImage[];
  onChange: (gallery: GalleryImage[]) => void;
}

export function PortfolioGalleryEditor({ gallery = [], onChange }: PortfolioGalleryEditorProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newImageData, setNewImageData] = useState<IUploadImage | null>(null);
  const [editImageData, setEditImageData] = useState<IUploadImage | null>(null);

  const handleAddImage = async () => {
    if (!newImageData?.file) {
      alert('Wybierz zdjęcie');
      return;
    }

    setUploading(true);
    try {
      const imageUrl = await uploadImage(newImageData.file, 'portfolio-gallery');

      const newImage: GalleryImage = {
        src: imageUrl,
        alt: newImageData.alt || '',
        image_metadata: {
          desktop: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
        },
      };

      onChange([...gallery, newImage]);
      setIsAdding(false);
      setNewImageData(null);
    } catch (error) {
      console.error('Error uploading image:', error);
      alert('Błąd podczas wgrywania zdjęcia');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateImage = async (index: number) => {
    setUploading(true);
    try {
      let imageUrl = gallery[index].src;

      if (editImageData?.file) {
        imageUrl = await uploadImage(editImageData.file, 'portfolio-gallery');
      }

      const updatedImage: GalleryImage = {
        src: imageUrl,
        alt: editImageData?.alt || gallery[index].alt || '',
        image_metadata: {
          desktop: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
        },
      };

      const newGallery = [...gallery];
      newGallery[index] = updatedImage;
      onChange(newGallery);
      setEditingIndex(null);
      setEditImageData(null);
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
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj zdjęcie
        </button>
      </div>

      {isAdding && (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
          <h5 className="mb-4 text-[#e5e4e2]">Nowe zdjęcie</h5>
          <SimpleImageUploader
            onImageSelect={(imageData) => setNewImageData(imageData)}
            showPreview={true}
          />
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={handleAddImage}
              disabled={uploading || !newImageData?.file}
              className="rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {uploading ? 'Wgrywanie...' : 'Dodaj zdjęcie'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsAdding(false);
                setNewImageData(null);
              }}
              className="rounded-lg bg-[#800020]/20 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
        {gallery.map((image, index) => (
          <div key={index} className="group relative">
            {editingIndex === index ? (
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-4">
                <SimpleImageUploader
                  onImageSelect={(imageData) => setEditImageData(imageData)}
                  initialImage={{
                    src: image.image_metadata?.desktop?.src || image.src,
                    alt: image.alt,
                  }}
                  showPreview={true}
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => handleUpdateImage(index)}
                    disabled={uploading}
                    className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                  >
                    {uploading ? 'Zapisywanie...' : 'Zapisz'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(null);
                      setEditImageData(null);
                    }}
                    className="flex-1 rounded-lg bg-[#800020]/20 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="relative aspect-[4/3] overflow-hidden rounded-lg border border-[#d3bb73]/10">
                  <img
                    src={image.image_metadata?.desktop?.src || image.src}
                    alt={image.alt || 'Zdjęcie z galerii'}
                    className="h-full w-full object-cover"
                  />
                </div>
                <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(index);
                      setEditImageData({
                        alt: image.alt || '',
                        image_metadata: image.image_metadata,
                      } as IUploadImage);
                    }}
                    className="rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    <Edit className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteImage(index)}
                    className="rounded-lg bg-[#800020] p-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/90"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {gallery.length === 0 && !isAdding && (
        <div className="rounded-xl border border-dashed border-[#d3bb73]/20 py-12 text-center">
          <ImageIcon className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]/50" />
          <p className="text-[#e5e4e2]/50">Brak zdjęć w galerii</p>
          <p className="mt-2 text-sm text-[#e5e4e2]/30">Kliknij "Dodaj zdjęcie" aby rozpocząć</p>
        </div>
      )}
    </div>
  );
}
