'use client';

import { useState, useEffect } from 'react';
import { X, Upload, Trash2, Star, StarOff, Loader2, Image as ImageIcon, ChevronLeft, ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useEditMode } from '@/contexts/EditModeContext';

interface ConferenceGalleryImage {
  id: string;
  image_url: string;
  title: string | null;
  caption: string | null;
  is_primary: boolean;
  order_index: number;
  created_at: string;
}

interface UploadingFile {
  id: string;
  file: File;
  preview: string;
  progress: number;
}

export default function ConferencesGalleryEditor() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const { canEdit } = useWebsiteEdit();
  const [images, setImages] = useState<ConferenceGalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState<UploadingFile[]>([]);
  const [selectedImage, setSelectedImage] = useState<ConferenceGalleryImage | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [dragCounter, setDragCounter] = useState(0);

  useEffect(() => {
    fetchImages();

    const channel = supabase
      .channel('conferences_gallery_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conferences_gallery' }, () => {
        fetchImages();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchImages = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('conferences_gallery')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

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
        const fileName = `conferences-gallery/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 30 } : item))
        );

        const { error: uploadError } = await supabase.storage
          .from('site-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 60 } : item))
        );

        const { data: { publicUrl } } = supabase.storage
          .from('site-images')
          .getPublicUrl(fileName);

        const { error: dbError } = await supabase.from('conferences_gallery').insert({
          image_url: publicUrl,
          title: file.name,
          is_primary: images.length === 0 && i === 0,
          order_index: images.length + i,
        });

        if (dbError) throw dbError;

        setUploadingFiles((prev) =>
          prev.map((item) => (item.id === uploadingItem.id ? { ...item, progress: 100 } : item))
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

    if (!canEdit) return;

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      await uploadFiles(files);
    }
  };

  const handleSetPrimary = async (imageId: string) => {
    try {
      await supabase
        .from('conferences_gallery')
        .update({ is_primary: false });

      const { error } = await supabase
        .from('conferences_gallery')
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

  const handleDelete = async (image: ConferenceGalleryImage) => {
    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      const urlParts = image.image_url.split('/site-images/');
      if (urlParts.length > 1) {
        const filePath = urlParts[1];
        await supabase.storage.from('site-images').remove([filePath]);
      }

      const { error } = await supabase.from('conferences_gallery').delete().eq('id', image.id);

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
      <div className="flex items-center justify-center py-24">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  return (
    <section className="py-20 px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-8"
        >
          <div className="flex items-center justify-between mb-8">
            <div className="text-center flex-1">
              <h2 className="text-4xl font-light text-[#e5e4e2] mb-4">
                Nasze realizacje w obiektywie
              </h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="text-[#e5e4e2]/60 mb-8">
                Galeria zdjęć z obsłużonych konferencji
              </p>
            </div>
            {canEdit && isEditMode &&  (
              <label className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors cursor-pointer">
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
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Przesyłanie...
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    Dodaj zdjęcia
                  </>
                )}
              </label>
            )}
          </div>
        </motion.div>

        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`relative transition-all rounded-lg ${
            isDragging ? 'ring-2 ring-[#d3bb73] ring-offset-2 ring-offset-[#0f1119] shadow-[0_0_20px_rgba(211,187,115,0.3)]' : ''
          }`}
        >
          {isDragging && canEdit && (
            <>
              <div className="absolute inset-0 border-2 border-dashed border-[#d3bb73] rounded-lg pointer-events-none z-10 bg-[#d3bb73]/5" />
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-[#d3bb73] text-[#1c1f33] px-6 py-3 rounded-lg shadow-xl z-20 pointer-events-none animate-pulse">
                <div className="flex items-center gap-2">
                  <Upload className="w-5 h-5" />
                  <span className="font-semibold">Upuść zdjęcia tutaj</span>
                </div>
              </div>
            </>
          )}

          {images.length === 0 && uploadingFiles.length === 0 ? (
            <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 p-12 text-center">
              <ImageIcon className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
              <p className="text-[#e5e4e2]/60">Brak zdjęć</p>
              {canEdit && (
                <div className="mt-4 space-y-2">
                  <p className="text-sm text-[#e5e4e2]/40">
                    Kliknij "Dodaj zdjęcia" lub przeciągnij pliki tutaj
                  </p>
                  <div className="flex items-center justify-center gap-2 text-xs text-[#e5e4e2]/30">
                    <Upload className="w-4 h-4" />
                    <span>Obsługuje przeciąganie i upuszczanie</span>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {images.map((image, index) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.05 }}
                  className="relative group bg-[#1c1f33] rounded-lg border border-[#d3bb73]/10 overflow-hidden cursor-pointer hover:border-[#d3bb73]/30 transition-colors"
                  onClick={() => setSelectedImage(image)}
                >
                  <div className="aspect-square relative">
                    <img
                      src={image.image_url}
                      alt={image.title || 'Konferencja'}
                      className="w-full h-full object-cover"
                    />
                    {image.is_primary && isEditMode && (
                      <div className="absolute top-2 left-2 bg-[#d3bb73] text-[#1c1f33] px-2 py-1 rounded text-xs font-semibold flex items-center gap-1">
                        <Star className="w-3 h-3 fill-current" />
                        Główne
                      </div>
                    )}
                    {canEdit && (
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
                  {(image.title || image.caption) && (
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                      <div className="absolute bottom-0 left-0 right-0 p-3">
                        {image.title && (
                          <h3 className="text-white font-medium text-sm mb-1">{image.title}</h3>
                        )}
                        {image.caption && (
                          <p className="text-white/80 text-xs">{image.caption}</p>
                        )}
                      </div>
                    </div>
                  )}
                </motion.div>
              ))}

              {uploadingFiles.map((uploadingFile) => (
                <div
                  key={uploadingFile.id}
                  className="relative bg-[#1c1f33] rounded-lg border border-[#d3bb73]/30 overflow-hidden"
                >
                  <div className="aspect-square relative">
                    <img
                      src={uploadingFile.preview}
                      alt="Uploading..."
                      className="w-full h-full object-cover opacity-50"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                      <div className="text-center">
                        <Loader2 className="w-8 h-8 text-[#d3bb73] animate-spin mx-auto mb-2" />
                        <p className="text-xs text-[#e5e4e2]">{uploadingFile.progress}%</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {selectedImage && (
        <div
          className="fixed inset-0 bg-black/95 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div
            className="relative max-w-6xl max-h-[90vh] w-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => setSelectedImage(null)}
              className="absolute top-4 right-4 text-white hover:text-[#d3bb73] transition-colors z-10 bg-black/50 rounded-full p-2"
              title="Zamknij"
            >
              <X className="w-6 h-6" />
            </button>

            {images.length > 1 && (
              <>
                <button
                  onClick={() => navigateImage('prev')}
                  className="absolute left-4 text-white hover:text-[#d3bb73] transition-colors z-10 bg-black/50 rounded-full p-3"
                  title="Poprzednie"
                >
                  <ChevronLeft className="w-8 h-8" />
                </button>
                <button
                  onClick={() => navigateImage('next')}
                  className="absolute right-4 text-white hover:text-[#d3bb73] transition-colors z-10 bg-black/50 rounded-full p-3"
                  title="Następne"
                >
                  <ChevronRight className="w-8 h-8" />
                </button>
              </>
            )}

            <div className="relative max-w-full max-h-[80vh]">
              <img
                src={selectedImage.image_url}
                alt={selectedImage.title || 'Konferencja'}
                className="max-w-full max-h-[80vh] object-contain rounded-lg"
              />
            </div>

            {canEdit && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2 bg-black/70 backdrop-blur-sm rounded-full p-2">
                {!selectedImage.is_primary && (
                  <button
                    onClick={() => handleSetPrimary(selectedImage.id)}
                    className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-full hover:bg-[#d3bb73]/90 transition-colors"
                    title="Ustaw jako główne"
                  >
                    <Star className="w-4 h-4" />
                    <span className="hidden sm:inline">Ustaw jako główne</span>
                  </button>
                )}
                <button
                  onClick={() => handleDelete(selectedImage)}
                  className="flex items-center gap-2 bg-red-500/90 text-white p-2 rounded-full hover:bg-red-600 transition-colors"
                  title="Usuń"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
