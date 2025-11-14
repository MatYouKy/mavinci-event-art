'use client';

import { useState, useEffect } from 'react';
import {
  X,
  Upload,
  Trash2,
  Star,
  StarOff,
  Loader2,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
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

interface UploadingFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
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
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [selectedImage, setSelectedImage] = useState<VehicleImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  useEffect(() => {
    fetchImages();
  }, [vehicleId]);

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

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);

    for (let i = 0; i < filesArray.length; i++) {
      const file = filesArray[i];
      const uploadingItem: UploadingFile = {
        id: `${Date.now()}-${Math.random().toString(36).substring(7)}-${i}`,
        file,
        preview: URL.createObjectURL(file),
        progress: 0,
      };

      if (!file.type.startsWith('image/')) {
        showSnackbar(`${file.name} nie jest obrazem`, 'error');
        continue;
      }

      if (file.size > 10 * 1024 * 1024) {
        showSnackbar(`${file.name} przekracza 10MB`, 'error');
        continue;
      }

      setUploadingFiles((prev) => [...prev, uploadingItem]);

      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `${vehicleId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 30 } : item)),
        );

        const { error: uploadError } = await supabase.storage
          .from('vehicle-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 60 } : item)),
        );

        const {
          data: { publicUrl },
        } = supabase.storage.from('vehicle-images').getPublicUrl(fileName);

        const { error: dbError } = await supabase.from('vehicle_images').insert({
          vehicle_id: vehicleId,
          image_url: publicUrl,
          title: file.name,
          is_primary: images.length === 0 && i === 0,
          sort_order: images.length + i,
          uploaded_by: employee?.id,
        });

        if (dbError) throw dbError;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 100 } : item)),
        );

        setTimeout(() => {
          setUploadingFiles((prev) => prev.filter((item) => item.id !== uploadingItem.id));
          URL.revokeObjectURL(uploadingItem.preview);
        }, 500);
      } catch (error: any) {
        console.error('Error uploading image:', error);
        showSnackbar(`Błąd podczas przesyłania ${file.name}`, 'error');
        setUploadingFiles((prev) => prev.filter((item) => item.id !== uploadingItem.id));
        URL.revokeObjectURL(uploadingItem.preview);
      }
    }

    showSnackbar('Przesyłanie zakończone', 'success');
    fetchImages();
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((prev) => prev + 1);
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragCounter((prev) => {
      const newCount = prev - 1;
      if (newCount === 0) {
        setIsDragging(false);
      }
      return newCount;
    });
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);

    if (!canManage) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicleId);

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
      const urlParts = image.image_url.split('/vehicle-images/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('vehicle-images').remove([filePath]);
      }

      const { error } = await supabase.from('vehicle_images').delete().eq('id', image.id);

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
      const { error } = await supabase.from('vehicle_images').update({ title }).eq('id', imageId);

      if (error) throw error;

      setImages((prev) => prev.map((img) => (img.id === imageId ? { ...img, title } : img)));
      showSnackbar('Tytuł został zaktualizowany', 'success');
    } catch (error: any) {
      console.error('Error updating title:', error);
      showSnackbar('Błąd podczas aktualizacji tytułu', 'error');
    }
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    const currentIndex = images.findIndex((img) => img.id === selectedImage.id);
    let newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

    if (newIndex < 0) newIndex = images.length - 1;
    if (newIndex >= images.length) newIndex = 0;

    setSelectedImage(images[newIndex]);
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload section */}
      {canManage && (
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold text-[#e5e4e2]">Galeria zdjęć</h2>
          <label className="flex cursor-pointer items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
            <input
              type="file"
              accept="image/*"
              multiple
              onChange={handleUpload}
              disabled={uploadingFiles.length > 0}
              className="hidden"
            />
            {uploadingFiles.length > 0 ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Przesyłanie...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Dodaj zdjęcia
              </>
            )}
          </label>
        </div>
      )}

      {/* Gallery grid with drag & drop */}
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={`relative rounded-lg transition-all ${
          isDragging
            ? 'shadow-[0_0_20px_rgba(211,187,115,0.3)] ring-2 ring-[#d3bb73] ring-offset-2 ring-offset-[#0f1119]'
            : ''
        }`}
      >
        {/* Drag overlay */}
        {isDragging && canManage && (
          <>
            <div className="pointer-events-none absolute inset-0 z-10 rounded-lg border-2 border-dashed border-[#d3bb73] bg-[#d3bb73]/5" />
            <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 animate-pulse rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] shadow-xl">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                <span className="font-semibold">Upuść zdjęcia tutaj</span>
              </div>
            </div>
          </>
        )}

        {images.length === 0 && uploadingFiles.length === 0 ? (
          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
            <ImageIcon className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">Brak zdjęć</p>
            {canManage && (
              <div className="mt-4 space-y-2">
                <p className="text-sm text-[#e5e4e2]/40">
                  Kliknij "Dodaj zdjęcia" lub przeciągnij pliki tutaj
                </p>
                <div className="flex items-center justify-center gap-2 text-xs text-[#e5e4e2]/30">
                  <Upload className="h-4 w-4" />
                  <span>Obsługuje przeciąganie i upuszczanie</span>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            {/* Existing images */}
            {images.map((image) => (
              <div
                key={image.id}
                className="group relative cursor-pointer overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] transition-colors hover:border-[#d3bb73]/30"
                onClick={() => setSelectedImage(image)}
              >
                <div className="relative aspect-square">
                  <img
                    src={image.image_url}
                    alt={image.title || 'Vehicle image'}
                    className="h-full w-full object-cover"
                  />
                  {image.is_primary && (
                    <div className="absolute left-2 top-2 flex items-center gap-1 rounded bg-[#d3bb73] px-2 py-1 text-xs font-semibold text-[#1c1f33]">
                      <Star className="h-3 w-3 fill-current" />
                      Główne
                    </div>
                  )}
                  {canManage && (
                    <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                      {!image.is_primary && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSetPrimary(image.id);
                          }}
                          className="rounded bg-[#1c1f33]/90 p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73] hover:text-[#1c1f33]"
                          title="Ustaw jako główne"
                        >
                          <StarOff className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(image);
                        }}
                        className="rounded bg-[#1c1f33]/90 p-2 text-[#e5e4e2] transition-colors hover:bg-red-500"
                        title="Usuń"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Uploading files with preview - at the end */}
            {uploadingFiles.map((uploadingFile) => (
              <div
                key={uploadingFile.id}
                className="relative overflow-hidden rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33]"
              >
                <div className="relative aspect-square">
                  <img
                    src={uploadingFile.preview}
                    alt="Uploading..."
                    className="h-full w-full object-cover opacity-50"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="text-center">
                      <Loader2 className="mx-auto mb-2 h-8 w-8 animate-spin text-[#d3bb73]" />
                      <p className="text-xs text-[#e5e4e2]">{uploadingFile.progress}%</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Enhanced Lightbox modal */}
      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative flex max-h-[90vh] w-full max-w-6xl items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute right-4 top-4 z-10 rounded-full bg-black/50 p-2 text-white transition-colors hover:text-[#d3bb73]"
              title="Zamknij"
            >
              <X className="h-6 w-6" />
            </button>

            {/* Navigation arrows */}
            {images.length > 1 && (
              <>
                <button
                  onClick={() => navigateImage('prev')}
                  className="absolute left-4 z-10 rounded-full bg-black/50 p-3 text-white transition-colors hover:text-[#d3bb73]"
                  title="Poprzednie"
                >
                  <ChevronLeft className="h-8 w-8" />
                </button>
                <button
                  onClick={() => navigateImage('next')}
                  className="absolute right-4 z-10 rounded-full bg-black/50 p-3 text-white transition-colors hover:text-[#d3bb73]"
                  title="Następne"
                >
                  <ChevronRight className="h-8 w-8" />
                </button>
              </>
            )}

            {/* Image */}
            <div className="relative max-h-[80vh] max-w-full">
              <img
                src={selectedImage.image_url}
                alt={selectedImage.title || 'Vehicle image'}
                className="max-h-[80vh] max-w-full rounded-lg object-contain"
              />
            </div>

            {/* Action buttons */}
            {canManage && (
              <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 rounded-full bg-black/70 p-2 backdrop-blur-sm">
                {!selectedImage.is_primary && (
                  <button
                    onClick={() => handleSetPrimary(selectedImage.id)}
                    className="flex items-center gap-2 rounded-full bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    title="Ustaw jako główne"
                  >
                    <Star className="h-4 w-4" />
                    <span className="hidden sm:inline">Ustaw jako główne</span>
                  </button>
                )}
                <button
                  onClick={() => handleDelete(selectedImage)}
                  className="flex items-center gap-2 rounded-full bg-red-500/90 p-2 text-white transition-colors hover:bg-red-600"
                  title="Usuń"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
