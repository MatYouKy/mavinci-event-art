'use client';

import { useState, useEffect } from 'react';
import { X, Upload, Trash2, Star, StarOff, Loader2, Image as ImageIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface VehicleImage {
  id: string;
  vehicle_id: string;
  image_url: string;
  title: string | null;
  description: string | null;
  is_primary: boolean;
  sort_order: number;
  created_at: string;
}

interface VehicleGalleryProps {
  vehicleId: string;
  canManage: boolean;
}

export default function VehicleGallery({ vehicleId, canManage }: VehicleGalleryProps) {
  const { showSnackbar } = useSnackbar();
  const { employee } = useCurrentEmployee();
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<VehicleImage | null>(null);

  useEffect(() => {
    fetchImages();
    console.log('[VehicleGallery] Props:', { vehicleId, canManage, employeeId: employee?.id });
  }, [vehicleId, canManage, employee]);

  const fetchImages = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('vehicle_images')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .order('sort_order', { ascending: true });

      if (error) throw error;
      setImages(data || []);
    } catch (error: any) {
      console.error('Error fetching images:', error);
      showSnackbar('Błąd podczas ładowania galerii', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);

    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          showSnackbar(`${file.name} nie jest obrazem`, 'error');
          continue;
        }

        if (file.size > 10 * 1024 * 1024) {
          showSnackbar(`${file.name} przekracza 10MB`, 'error');
          continue;
        }

        const fileExt = file.name.split('.').pop();
        const fileName = `${vehicleId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('vehicle-images')
          .getPublicUrl(fileName);

        const { error: dbError } = await supabase.from('vehicle_images').insert({
          vehicle_id: vehicleId,
          image_url: publicUrl,
          title: file.name,
          is_primary: images.length === 0,
          sort_order: images.length,
          uploaded_by: employee?.id,
        });

        if (dbError) throw dbError;
      }

      showSnackbar('Zdjęcia zostały dodane', 'success');
      fetchImages();
    } catch (error: any) {
      console.error('Error uploading images:', error);
      showSnackbar(error.message || 'Błąd podczas uploadu zdjęć', 'error');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      if (error) throw error;

      showSnackbar('Zdjęcie główne zostało ustawione', 'success');
      fetchImages();
    } catch (error: any) {
      console.error('Error setting primary image:', error);
      showSnackbar('Błąd podczas ustawiania zdjęcia głównego', 'error');
    }
  };

  const handleDelete = async (image: VehicleImage) => {
    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      const pathParts = image.image_url.split('/vehicle-images/');
      if (pathParts.length > 1) {
        const filePath = pathParts[1];
        await supabase.storage.from('vehicle-images').remove([filePath]);
      }

      const { error } = await supabase
        .from('vehicle_images')
        .delete()
        .eq('id', image.id);

      if (error) throw error;

      showSnackbar('Zdjęcie zostało usunięte', 'success');
      fetchImages();
      if (selectedImage?.id === image.id) {
        setSelectedImage(null);
      }
    } catch (error: any) {
      console.error('Error deleting image:', error);
      showSnackbar('Błąd podczas usuwania zdjęcia', 'error');
    }
  };

  const handleUpdateTitle = async (imageId: string, title: string) => {
    try {
      const { error } = await supabase
        .from('vehicle_images')
        .update({ title })
        .eq('id', imageId);

      if (error) throw error;

      setImages((prev) =>
        prev.map((img) => (img.id === imageId ? { ...img, title } : img))
      );
      showSnackbar('Tytuł został zaktualizowany', 'success');
    } catch (error: any) {
      console.error('Error updating title:', error);
      showSnackbar('Błąd podczas aktualizacji tytułu', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Debug info */}
      <div className="bg-yellow-500/10 border border-yellow-500/20 rounded p-2 text-xs text-yellow-500">
        Debug: canManage = {canManage ? 'TRUE' : 'FALSE'}, employee id = {employee?.id || 'NULL'}
      </div>

      {/* Upload section */}
      {canManage && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#e5e4e2]">Galeria zdjęć</h2>
          <label className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors cursor-pointer">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleUpload}
              disabled={uploading}
              className="hidden"
            />
            {uploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" />
                Dodaj zdjęcia
              </>
            )}
          </label>
        </div>
      )}

      {/* Gallery grid */}
      {images.length === 0 ? (
        <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
          <ImageIcon className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60">Brak zdjęć</p>
          {canManage && (
            <p className="text-sm text-[#e5e4e2]/40 mt-2">
              Kliknij "Dodaj zdjęcia" aby rozpocząć
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {images.map((image) => (
            <div
              key={image.id}
              className="relative group bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden cursor-pointer hover:border-[#d3bb73]/30 transition-colors"
              onClick={() => setSelectedImage(image)}
            >
              <div className="aspect-square relative">
                <img
                  src={image.image_url}
                  alt={image.title || 'Vehicle image'}
                  className="w-full h-full object-cover"
                />
                {image.is_primary && (
                  <div className="absolute top-2 left-2 bg-[#d3bb73] text-[#1c1f33] px-2 py-1 rounded text-xs font-semibold flex items-center gap-1">
                    <Star className="w-3 h-3 fill-current" />
                    Główne
                  </div>
                )}
                {canManage && (
                  <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                    {!image.is_primary && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleSetPrimary(image.id);
                        }}
                        className="bg-[#1c1f33]/90 hover:bg-[#d3bb73] text-[#e5e4e2] hover:text-[#1c1f33] p-2 rounded transition-colors"
                        title="Ustaw jako główne"
                      >
                        <StarOff className="w-4 h-4" />
                      </button>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(image);
                      }}
                      className="bg-[#1c1f33]/90 hover:bg-red-500 text-[#e5e4e2] p-2 rounded transition-colors"
                      title="Usuń"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>
              {image.title && (
                <div className="p-2 bg-[#1c1f33]">
                  <p className="text-sm text-[#e5e4e2] truncate">{image.title}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Lightbox modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/90 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-6xl max-h-[90vh] w-full"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute -top-12 right-0 text-white hover:text-[#d3bb73] transition-colors"
            >
              <X className="w-8 h-8" />
            </button>

            <div className="bg-[#1c1f33] rounded-lg overflow-hidden">
              <div className="relative">
                <img
                  src={selectedImage.image_url}
                  alt={selectedImage.title || 'Vehicle image'}
                  className="w-full h-auto max-h-[70vh] object-contain"
                />
              </div>

              <div className="p-6 space-y-4">
                {canManage ? (
                  <input
                    type="text"
                    value={selectedImage.title || ''}
                    onChange={(e) =>
                      setSelectedImage({ ...selectedImage, title: e.target.value })
                    }
                    onBlur={(e) => handleUpdateTitle(selectedImage.id, e.target.value)}
                    placeholder="Tytuł zdjęcia..."
                    className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                  />
                ) : (
                  selectedImage.title && (
                    <h3 className="text-xl font-semibold text-[#e5e4e2]">
                      {selectedImage.title}
                    </h3>
                  )
                )}

                {canManage && (
                  <div className="flex gap-2">
                    {!selectedImage.is_primary && (
                      <button
                        onClick={() => handleSetPrimary(selectedImage.id)}
                        className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                      >
                        <Star className="w-4 h-4" />
                        Ustaw jako główne
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(selectedImage)}
                      className="flex items-center gap-2 bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Usuń
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
