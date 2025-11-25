'use client';

import { useState, useEffect } from 'react';
import { Upload, Trash2, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';

interface GalleryImage {
  id: string;
  image_url: string;
  title: string | null;
  order_index: number;
}

export default function DJGalleryEditor() {
  const { showSnackbar } = useSnackbar();
  const { canEdit } = useWebsiteEdit();
  const [images, setImages] = useState<GalleryImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    fetchImages();

    const channel = supabase
      .channel('dj_gallery_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dj_gallery' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setImages(prev => [...prev, payload.new as GalleryImage].sort((a, b) => a.order_index - b.order_index));
        } else if (payload.eventType === 'UPDATE') {
          setImages(prev => prev.map(i => i.id === payload.new.id ? payload.new as GalleryImage : i));
        } else if (payload.eventType === 'DELETE') {
          setImages(prev => prev.filter(i => i.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchImages = async () => {
    try {
      const { data, error } = await supabase
        .from('dj_gallery')
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
        const fileName = `dj-gallery/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

        const { error: uploadError } = await supabase.storage
          .from('site-images')
          .upload(fileName, file);

        if (uploadError) throw uploadError;

        const { data: { publicUrl } } = supabase.storage
          .from('site-images')
          .getPublicUrl(fileName);

        await supabase.from('dj_gallery').insert({
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
      await supabase.from('dj_gallery').delete().eq('id', id);
      showSnackbar('Zdjęcie usunięte', 'success');
    } catch (error) {
      console.error('Error deleting:', error);
      showSnackbar('Błąd usuwania', 'error');
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
    <section className="bg-[#0f1119] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
            Galeria
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
        </motion.div>

        {canEdit && (
          <div className="mb-8">
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
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
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {images.map((image, index) => (
            <motion.div
              key={image.id}
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative aspect-[4/3] overflow-hidden rounded-2xl"
            >
              <img
                src={image.image_url}
                alt={image.title || 'DJ Gallery'}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
              />
              {image.title && (
                <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-6 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                  <p className="font-light text-white">{image.title}</p>
                </div>
              )}
              {canEdit && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleDelete(image.id); }}
                  className="absolute right-4 top-4 rounded-full bg-red-500/80 p-2 opacity-0 backdrop-blur-sm transition-opacity hover:bg-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4 text-white" />
                </button>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
