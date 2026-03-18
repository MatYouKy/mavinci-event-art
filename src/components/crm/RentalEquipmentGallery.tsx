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
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface RentalImage {
  url: string;
  title?: string;
  isPrimary?: boolean;
}

interface UploadingFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
}

interface RentalEquipmentGalleryProps {
  equipmentId: string;
  images: RentalImage[];
  canManage: boolean;
  onImagesChange: (images: RentalImage[]) => void;
}

const compressImage = async (file: File, maxWidth = 1920, maxHeight = 1080, quality = 0.8): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          if (width > height) {
            if (width > maxWidth) {
              height *= maxWidth / width;
              width = maxWidth;
            }
          } else {
            if (height > maxHeight) {
              width *= maxHeight / height;
              height = maxHeight;
            }
          }
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Canvas to Blob failed'));
              return;
            }
            const compressedFile = new File([blob], file.name, {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            resolve(compressedFile);
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = (error) => reject(error);
    };
    reader.onerror = (error) => reject(error);
  });
};

export default function RentalEquipmentGallery({
  equipmentId,
  images,
  canManage,
  onImagesChange,
}: RentalEquipmentGalleryProps) {
  const { showSnackbar } = useSnackbar();
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [selectedImage, setSelectedImage] = useState<RentalImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    const filesArray = Array.from(files);
    const newImages: RentalImage[] = [];

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
        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 20 } : item)),
        );

        const compressedFile = await compressImage(file);

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 40 } : item)),
        );

        const fileExt = 'jpg';
        const fileName = `${equipmentId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('rental-equipment-images')
          .upload(fileName, compressedFile);

        if (uploadError) throw uploadError;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 80 } : item)),
        );

        const {
          data: { publicUrl },
        } = supabase.storage.from('rental-equipment-images').getPublicUrl(fileName);

        newImages.push({
          url: publicUrl,
          title: file.name,
          isPrimary: images.length === 0 && i === 0,
        });

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

    if (newImages.length > 0) {
      const updatedImages = [...images, ...newImages];
      onImagesChange(updatedImages);
      showSnackbar('Przesyłanie zakończone', 'success');
    }
  };

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      uploadFiles(e.target.files);
    }
  };

  const handleDeleteImage = async (imageUrl: string) => {
    try {
      const fileName = imageUrl.split('/rental-equipment-images/').pop();
      if (fileName) {
        const { error } = await supabase.storage.from('rental-equipment-images').remove([fileName]);
        if (error) throw error;
      }

      const updatedImages = images.filter((img) => img.url !== imageUrl);
      onImagesChange(updatedImages);
      showSnackbar('Zdjęcie usunięte', 'success');
    } catch (error: any) {
      console.error('Error deleting image:', error);
      showSnackbar('Błąd podczas usuwania zdjęcia', 'error');
    }
  };

  const handleSetPrimary = (imageUrl: string) => {
    const updatedImages = images.map((img) => ({
      ...img,
      isPrimary: img.url === imageUrl,
    }));
    onImagesChange(updatedImages);
    showSnackbar('Ustawiono jako główne zdjęcie', 'success');
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
    setDragCounter((prev) => prev - 1);
    if (dragCounter - 1 === 0) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    setDragCounter(0);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      uploadFiles(e.dataTransfer.files);
      e.dataTransfer.clearData();
    }
  };

  const navigateImage = (direction: 'prev' | 'next') => {
    if (!selectedImage) return;
    const currentIndex = images.findIndex((img) => img.url === selectedImage.url);
    const newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex >= 0 && newIndex < images.length) {
      setSelectedImage(images[newIndex]);
    }
  };

  return (
    <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
      <h2 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Galeria zdjęć</h2>

      {canManage && (
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`relative mb-6 rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? 'border-[#d3bb73] bg-[#d3bb73]/5'
              : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
          }`}
        >
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleUpload}
            className="absolute inset-0 cursor-pointer opacity-0"
            id="rental-image-upload"
          />
          <Upload className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]/40" />
          <p className="mb-2 text-[#e5e4e2]">Przeciągnij zdjęcia tutaj lub kliknij aby wybrać</p>
          <p className="text-sm text-[#e5e4e2]/60">
            Maksymalny rozmiar: 10MB (zdjęcia zostaną automatycznie skompresowane)
          </p>
        </div>
      )}

      {uploadingFiles.length > 0 && (
        <div className="mb-6 space-y-3">
          {uploadingFiles.map((file) => (
            <div key={file.id} className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm text-[#e5e4e2]">{file.file.name}</span>
                <span className="text-sm text-[#d3bb73]">{file.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-[#d3bb73]/10">
                <div
                  className="h-full bg-[#d3bb73] transition-all duration-300"
                  style={{ width: `${file.progress}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {images.length === 0 && uploadingFiles.length === 0 ? (
        <div className="py-12 text-center">
          <ImageIcon className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/10" />
          <p className="text-[#e5e4e2]/40">Brak zdjęć</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {images.map((image, index) => (
            <div
              key={index}
              className="group relative aspect-square overflow-hidden rounded-lg border border-[#d3bb73]/20"
            >
              <img
                src={image.url}
                alt={image.title || `Zdjęcie ${index + 1}`}
                className="h-full w-full cursor-pointer object-cover transition-transform group-hover:scale-110"
                onClick={() => setSelectedImage(image)}
              />
              {image.isPrimary && (
                <div className="absolute left-2 top-2 rounded-full bg-[#d3bb73] p-1">
                  <Star className="h-4 w-4 fill-[#0f1119] text-[#0f1119]" />
                </div>
              )}
              {canManage && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                  {!image.isPrimary && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSetPrimary(image.url);
                      }}
                      className="rounded-lg bg-[#d3bb73] p-2 transition-colors hover:bg-[#c4a859]"
                      title="Ustaw jako główne"
                    >
                      <StarOff className="h-4 w-4 text-[#0f1119]" />
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteImage(image.url);
                    }}
                    className="rounded-lg bg-red-600 p-2 transition-colors hover:bg-red-700"
                    title="Usuń"
                  >
                    <Trash2 className="h-4 w-4 text-white" />
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {selectedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setSelectedImage(null)}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedImage(null);
            }}
            className="absolute right-4 top-4 rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]"
          >
            <X className="h-6 w-6" />
          </button>

          {images.length > 1 && (
            <>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateImage('prev');
                }}
                className="absolute left-4 rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73] disabled:opacity-30"
                disabled={images.findIndex((img) => img.url === selectedImage.url) === 0}
              >
                <ChevronLeft className="h-6 w-6" />
              </button>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigateImage('next');
                }}
                className="absolute right-4 rounded-lg bg-[#0f1119] p-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73] disabled:opacity-30"
                disabled={images.findIndex((img) => img.url === selectedImage.url) === images.length - 1}
              >
                <ChevronRight className="h-6 w-6" />
              </button>
            </>
          )}

          <img
            src={selectedImage.url}
            alt={selectedImage.title || 'Podgląd'}
            className="max-h-[90vh] max-w-[90vw] object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  );
}
