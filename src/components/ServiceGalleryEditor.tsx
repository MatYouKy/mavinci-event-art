'use client';

import { useState } from 'react';
import { Plus, Trash2, Image as ImageIcon, Edit, GripVertical } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { uploadOptimizedImage } from '@/lib/storage';
import { SimpleImageUploader } from './SimpleImageUploader';
import { IUploadImage } from '@/types/image';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface GalleryImage {
  id?: string;
  service_id?: string;
  image_url: string;
  alt_text?: string;
  caption?: string;
  display_order: number;
  is_active?: boolean;
}

interface ServiceGalleryEditorProps {
  serviceId: string;
  gallery: GalleryImage[];
}

export function ServiceGalleryEditor({ serviceId, gallery = [] }: ServiceGalleryEditorProps) {
  const { showSnackbar } = useSnackbar();
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newImageData, setNewImageData] = useState<IUploadImage | null>(null);
  const [editImageData, setEditImageData] = useState<IUploadImage | null>(null);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const handleAddImage = async () => {
    if (!newImageData?.file) {
      showSnackbar('Wybierz zdjęcie', 'error');
      return;
    }

    setUploading(true);
    try {
      const result = await uploadOptimizedImage(newImageData.file, 'services/gallery');

      const maxOrder = gallery.length > 0 ? Math.max(...gallery.map((g) => g.display_order)) : 0;

      const { error } = await supabase.from('conferences_service_gallery').insert({
        service_id: serviceId,
        image_url: result.desktop,
        alt_text: newImageData.alt || '',
        display_order: maxOrder + 1,
        is_active: true,
      });

      if (error) throw error;

      showSnackbar('Zdjęcie dodane', 'success');
      setIsAdding(false);
      setNewImageData(null);
    } catch (error) {
      console.error('Error uploading image:', error);
      showSnackbar('Błąd podczas wgrywania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleUpdateImage = async (index: number) => {
    const image = gallery[index];
    if (!image.id) return;

    setUploading(true);
    try {
      let imageUrl = image.image_url;

      if (editImageData?.file) {
        const result = await uploadOptimizedImage(editImageData.file, 'services/gallery');
        imageUrl = result.desktop;
      }

      const { error } = await supabase
        .from('conferences_service_gallery')
        .update({
          image_url: imageUrl,
          alt_text: editImageData?.alt || image.alt_text || '',
          updated_at: new Date().toISOString(),
        })
        .eq('id', image.id);

      if (error) throw error;

      showSnackbar('Zdjęcie zaktualizowane', 'success');
      setEditingIndex(null);
      setEditImageData(null);
    } catch (error) {
      console.error('Error updating image:', error);
      showSnackbar('Błąd podczas aktualizacji zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (index: number) => {
    const image = gallery[index];
    if (!image.id) return;

    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      const { error } = await supabase
        .from('conferences_service_gallery')
        .delete()
        .eq('id', image.id);

      if (error) throw error;

      showSnackbar('Zdjęcie usunięte', 'success');
    } catch (error) {
      console.error('Error deleting image:', error);
      showSnackbar('Błąd podczas usuwania zdjęcia', 'error');
    }
  };

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === index) return;

    const newGallery = [...gallery];
    const draggedItem = newGallery[draggedIndex];
    newGallery.splice(draggedIndex, 1);
    newGallery.splice(index, 0, draggedItem);

    setDraggedIndex(index);
  };

  const handleDragEnd = async () => {
    if (draggedIndex === null) return;

    try {
      const updates = gallery.map((image, index) => ({
        id: image.id,
        display_order: index + 1,
      }));

      for (const update of updates) {
        await supabase
          .from('conferences_service_gallery')
          .update({ display_order: update.display_order })
          .eq('id', update.id);
      }

      showSnackbar('Kolejność zaktualizowana', 'success');
    } catch (error) {
      console.error('Error updating order:', error);
      showSnackbar('Błąd podczas aktualizacji kolejności', 'error');
    } finally {
      setDraggedIndex(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-lg font-medium text-[#e5e4e2]">Galeria usługi</h4>
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
          <div
            key={image.id || index}
            draggable={editingIndex === null && !isAdding}
            onDragStart={() => handleDragStart(index)}
            onDragOver={(e) => handleDragOver(e, index)}
            onDragEnd={handleDragEnd}
            className="group relative cursor-move"
          >
            {editingIndex === index ? (
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-4">
                <SimpleImageUploader
                  onImageSelect={(imageData) => setEditImageData(imageData)}
                  initialImage={{
                    src: image.image_url,
                    alt: image.alt_text,
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
                    src={image.image_url}
                    alt={image.alt_text || 'Zdjęcie z galerii'}
                    className="h-full w-full object-cover"
                  />
                  <div className="absolute left-2 top-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <GripVertical className="h-5 w-5 text-white drop-shadow-lg" />
                  </div>
                </div>
                <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingIndex(index);
                      setEditImageData({
                        alt: image.alt_text || '',
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
