'use client';

import { useState, useEffect } from 'react';
import { Upload, Trash2, X, Loader2, ChevronLeft, ChevronRight, Type, Save } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';

interface GalleryImage {
  id: string;
  image_url: string;
  title: string | null;
  order_index: number;
}

export default function TechnicalStageGallery() {
  const { showSnackbar } = useSnackbar();
  const { canEdit } = useWebsiteEdit();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [editingAltId, setEditingAltId] = useState<string | null>(null);
  const [altValue, setAltValue] = useState('');

  useEffect(() => {
    fetchImages();

    const channel = supabase
      .channel('tech_gallery_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'technical_stage_gallery' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setImages((prev) =>
              [...prev, payload.new as GalleryImage].sort((a, b) => a.order_index - b.order_index),
            );
          } else if (payload.eventType === 'UPDATE') {
            setImages((prev) =>
              prev.map((i) => (i.id === payload.new.id ? (payload.new as GalleryImage) : i)),
            );
          } else if (payload.eventType === 'DELETE') {
            setImages((prev) => prev.filter((i) => i.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchImages = async () => {
    try {
      const { data, error } = await supabase
        .from('technical_stage_gallery')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setImages(data || []);
    } catch (error) {
      console.error('Error fetching images:', error);
    } finally {
      setLoading(false);
    }
  };

  const uploadFiles = async (files: FileList | File[]) => {
    if (!files || files.length === 0) return;

    setUploading(true);
    const filesArray = Array.from(files);

    for (const file of filesArray) {
      if (!file.type.startsWith('image/')) {
        showSnackbar(`${file.name} nie jest obrazem`, 'error');
        continue;
      }

      try {
        const fileExt = file.name.split('.').pop();
        const fileName = `technical-gallery/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('site-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const {
          data: { publicUrl },
        } = supabase.storage.from('site-images').getPublicUrl(fileName);

        await supabase.from('technical_stage_gallery').insert({
          image_url: publicUrl,
          title: file.name,
          order_index: images.length,
        });
      } catch (error) {
        console.error('Error uploading:', error);
        showSnackbar(`Błąd: ${file.name}`, 'error');
      }
    }

    setUploading(false);
    showSnackbar('Zdjęcia dodane', 'success');
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Usunąć zdjęcie?')) return;

    try {
      await supabase.from('technical_stage_gallery').delete().eq('id', id);
      showSnackbar('Zdjęcie usunięte', 'success');
    } catch (error) {
      console.error('Error deleting:', error);
      showSnackbar('Błąd usuwania', 'error');
    }
  };

  const handleAltEdit = (image: GalleryImage) => {
    setEditingAltId(image.id);
    setAltValue(image.title || '');
  };

  const handleAltSave = async () => {
    if (!editingAltId) return;
    try {
      const { error } = await supabase
        .from('technical_stage_gallery')
        .update({ title: altValue })
        .eq('id', editingAltId);

      if (error) throw error;
      setImages((prev) =>
        prev.map((img) => (img.id === editingAltId ? { ...img, title: altValue } : img)),
      );
      showSnackbar('Alt text zapisany', 'success');
    } catch (error) {
      console.error('Error saving alt:', error);
      showSnackbar('Błąd zapisu alt', 'error');
    } finally {
      setEditingAltId(null);
      setAltValue('');
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      uploadFiles(e.dataTransfer.files);
    }
  };

  if (loading) {
    return <div className="py-24 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <>
      <section className="bg-[#0f1119] px-6 py-24">
        <div className="mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16 text-center"
          >
            <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Galeria realizacji</h2>
            <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Zobacz nasze najlepsze projekty techniczne
            </p>
          </motion.div>

          {!canEdit ? (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {images.map((image, index) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-2xl"
                  onClick={() => setSelectedIndex(index)}
                >
                  <img
                    src={image.image_url}
                    alt={image.title || `Zdjęcie ${index + 1}`}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                </motion.div>
              ))}
            </div>
          ) : canEdit ? (
            <>
              <div className="mb-8">
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragEnter={() => setIsDragging(true)}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  className={`relative rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
                    isDragging
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => e.target.files && uploadFiles(e.target.files)}
                    className="absolute inset-0 cursor-pointer opacity-0"
                    disabled={uploading}
                  />
                  {uploading ? (
                    <Loader2 className="mx-auto h-12 w-12 animate-spin text-[#d3bb73]" />
                  ) : (
                    <>
                      <Upload className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]" />
                      <p className="text-lg font-light text-[#e5e4e2]">
                        Przeciągnij zdjęcia lub kliknij aby wybrać
                      </p>
                    </>
                  )}
                </div>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {images.map((image, index) => (
                  <motion.div
                    key={image.id}
                    initial={{ opacity: 0, scale: 0.9 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="group relative overflow-hidden rounded-2xl"
                  >
                    <div className="relative aspect-[4/3]">
                      <img
                        src={image.image_url}
                        alt={image.title || `Zdjęcie ${index + 1}`}
                        className="h-full w-full cursor-pointer object-cover transition-transform duration-500 group-hover:scale-110"
                        onClick={() => setSelectedIndex(index)}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
                      <div className="absolute right-3 top-3 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAltEdit(image);
                          }}
                          className="rounded-full bg-[#d3bb73]/80 p-2 backdrop-blur-sm transition-colors hover:bg-[#d3bb73]"
                          title="Edytuj alt text"
                        >
                          <Type className="h-4 w-4 text-[#1c1f33]" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(image.id);
                          }}
                          className="rounded-full bg-red-500/80 p-2 backdrop-blur-sm transition-opacity hover:bg-red-500"
                        >
                          <Trash2 className="h-4 w-4 text-white" />
                        </button>
                      </div>
                    </div>

                    {editingAltId === image.id ? (
                      <div className="flex gap-2 border-t border-[#d3bb73]/10 bg-[#1c1f33] p-3">
                        <input
                          type="text"
                          value={altValue}
                          onChange={(e) => setAltValue(e.target.value)}
                          placeholder="Opisz zdjęcie (alt text SEO)"
                          className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAltSave();
                            if (e.key === 'Escape') { setEditingAltId(null); setAltValue(''); }
                          }}
                        />
                        <button
                          onClick={handleAltSave}
                          className="rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                        >
                          <Save className="h-4 w-4" />
                        </button>
                        <button
                          onClick={() => { setEditingAltId(null); setAltValue(''); }}
                          className="rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ) : image.title ? (
                      <div className="border-t border-[#d3bb73]/10 bg-[#1c1f33]/50 px-3 py-2">
                        <p className="truncate text-xs text-[#e5e4e2]/50">
                          <span className="text-[#d3bb73]/60">alt:</span> {image.title}
                        </p>
                      </div>
                    ) : null}
                  </motion.div>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </section>

      {selectedIndex !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 p-4"
          onClick={() => setSelectedIndex(null)}
        >
          <button
            onClick={() => setSelectedIndex(null)}
            className="absolute right-4 top-4 rounded-full bg-[#d3bb73]/10 p-3 text-white backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
          >
            <X className="h-6 w-6" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((selectedIndex - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-3 text-white backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>

          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelectedIndex((selectedIndex + 1) % images.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-3 text-white backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
          >
            <ChevronRight className="h-8 w-8" />
          </button>

          <img
            src={images[selectedIndex].image_url}
            alt={images[selectedIndex].title || ''}
            className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}
