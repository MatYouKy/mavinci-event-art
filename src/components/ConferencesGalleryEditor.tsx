'use client';

import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Plus, GripVertical, ArrowUp, ArrowDown, Upload, Loader2 } from 'lucide-react';

interface GalleryItem {
  id: string;
  image_url: string;
  alt_text?: string;
  title?: string;
  caption?: string;
  display_order: number;
  is_active: boolean;
}

interface Props {
  items: GalleryItem[];
  onUpdate: () => void;
}

const compressImage = async (file: File, maxWidth = 1200, quality = 0.8): Promise<Blob> => {
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

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Failed to get canvas context'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);

        canvas.toBlob(
          (blob) => {
            if (blob) {
              resolve(blob);
            } else {
              reject(new Error('Failed to compress image'));
            }
          },
          'image/jpeg',
          quality,
        );
      };
      img.onerror = reject;
    };
    reader.onerror = reject;
  });
};

export function ConferencesGalleryEditor({ items, onUpdate }: Props) {
  const [uploading, setUploading] = useState<{ [key: string]: boolean }>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [globalUploading, setGlobalUploading] = useState(false);

  const handleAdd = async () => {
    try {
      const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.display_order)) : -1;

      const { error } = await supabase.from('conferences_gallery').insert({
        image_url: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg',
        alt_text: 'Zdjęcie z konferencji',
        title: '',
        caption: '',
        display_order: maxOrder + 1,
        is_active: true,
      });

      if (error) {
        console.error('Error adding image:', error);
        alert('Błąd dodawania zdjęcia: ' + error.message);
        return;
      }

      onUpdate();
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd podczas dodawania zdjęcia');
    }
  };

  const uploadImageFile = async (file: File, itemId?: string) => {
    try {
      const compressed = await compressImage(file);

      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.jpg`;
      const filePath = fileName;

      const { error: uploadError } = await supabase.storage
        .from('conferences-gallery')
        .upload(filePath, compressed, {
          cacheControl: '3600',
          upsert: false,
          contentType: 'image/jpeg',
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        throw uploadError;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('conferences-gallery').getPublicUrl(filePath);

      if (itemId) {
        const { error: updateError } = await supabase
          .from('conferences_gallery')
          .update({
            image_url: publicUrl,
            alt_text: file.name.replace(/\.[^/.]+$/, ''),
          })
          .eq('id', itemId);

        if (updateError) throw updateError;
      } else {
        const maxOrder = items.length > 0 ? Math.max(...items.map((i) => i.display_order)) : -1;

        const { error: insertError } = await supabase.from('conferences_gallery').insert({
          image_url: publicUrl,
          alt_text: file.name.replace(/\.[^/.]+$/, ''),
          title: '',
          caption: '',
          display_order: maxOrder + 1,
          is_active: true,
        });

        if (insertError) throw insertError;
      }

      return publicUrl;
    } catch (error) {
      console.error('Error uploading image:', error);
      throw error;
    }
  };

  const handleImageUpload = async (itemId: string, file: File) => {
    setUploading({ ...uploading, [itemId]: true });
    try {
      await uploadImageFile(file, itemId);
      onUpdate();
    } catch (error) {
      alert('Błąd przesyłania zdjęcia');
    } finally {
      setUploading({ ...uploading, [itemId]: false });
    }
  };

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);

      const files = Array.from(e.dataTransfer.files).filter((file) =>
        file.type.startsWith('image/'),
      );

      if (files.length === 0) return;

      setGlobalUploading(true);
      try {
        for (const file of files) {
          await uploadImageFile(file);
        }
        onUpdate();
      } catch (error) {
        alert('Błąd przesyłania zdjęć');
      } finally {
        setGlobalUploading(false);
      }
    },
    [items, onUpdate],
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = () => {
    setDragOver(false);
  };

  const handleFileInput = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('image/'));

    if (files.length === 0) return;

    setGlobalUploading(true);
    try {
      for (const file of files) {
        await uploadImageFile(file);
      }
      onUpdate();
    } catch (error) {
      alert('Błąd przesyłania zdjęć');
    } finally {
      setGlobalUploading(false);
    }

    e.target.value = '';
  };

  const handleUpdate = async (id: string, updates: Partial<GalleryItem>) => {
    const { error } = await supabase.from('conferences_gallery').update(updates).eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const handleDelete = async (id: string, imageUrl: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to zdjęcie?')) return;

    try {
      if (imageUrl.includes('conferences-gallery')) {
        const filePath = imageUrl.split('/').pop();
        if (filePath) {
          await supabase.storage.from('conferences-gallery').remove([filePath]);
        }
      }

      const { error } = await supabase.from('conferences_gallery').delete().eq('id', id);

      if (!error) {
        onUpdate();
      }
    } catch (error) {
      console.error('Error deleting:', error);
    }
  };

  const moveItem = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const item1 = items[index];
    const item2 = items[targetIndex];

    await Promise.all([
      supabase
        .from('conferences_gallery')
        .update({ display_order: item2.display_order })
        .eq('id', item1.id),
      supabase
        .from('conferences_gallery')
        .update({ display_order: item1.display_order })
        .eq('id', item2.id),
    ]);

    onUpdate();
  };

  return (
    <div className="mb-8 rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-xl font-medium text-[#d3bb73]">Edycja Galerii</h3>
        <div className="flex gap-2">
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d3bb73] bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30">
            <Upload className="h-4 w-4" />
            Wybierz zdjęcia
            <input
              type="file"
              multiple
              accept="image/*"
              onChange={handleFileInput}
              className="hidden"
            />
          </label>
          <button
            onClick={handleAdd}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-4 w-4" />
            Dodaj placeholder
          </button>
        </div>
      </div>

      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`mb-6 rounded-xl border-2 border-dashed p-8 transition-colors ${
          dragOver ? 'border-[#d3bb73] bg-[#d3bb73]/10' : 'border-[#d3bb73]/30 bg-[#0f1119]/50'
        }`}
      >
        <div className="text-center">
          <Upload className="mx-auto mb-4 h-12 w-12 text-[#d3bb73]" />
          <p className="mb-2 text-[#e5e4e2]">Przeciągnij i upuść zdjęcia tutaj</p>
          <p className="text-sm text-[#e5e4e2]/60">lub użyj przycisku powyżej</p>
          {globalUploading && (
            <div className="mt-4 flex items-center justify-center gap-2 text-[#d3bb73]">
              <Loader2 className="h-5 w-5 animate-spin" />
              <span>Przesyłanie i kompresja zdjęć...</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4">
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  onClick={() => moveItem(index, 'up')}
                  disabled={index === 0}
                  className="rounded p-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-30"
                  title="Przenieś w górę"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <GripVertical className="h-4 w-4 text-[#d3bb73]/40" />
                <button
                  onClick={() => moveItem(index, 'down')}
                  disabled={index === items.length - 1}
                  className="rounded p-1 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:cursor-not-allowed disabled:opacity-30"
                  title="Przenieś w dół"
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1">
                <div className="group relative mb-3">
                  <img
                    src={item.image_url}
                    alt={item.alt_text || 'Preview'}
                    className="h-32 w-full rounded object-cover"
                  />
                  <label className="absolute inset-0 flex cursor-pointer items-center justify-center rounded bg-black/50 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="text-center text-white">
                      {uploading[item.id] ? (
                        <>
                          <Loader2 className="mx-auto mb-2 h-6 w-6 animate-spin" />
                          <span className="text-sm">Kompresja...</span>
                        </>
                      ) : (
                        <>
                          <Upload className="mx-auto mb-2 h-6 w-6" />
                          <span className="text-sm">Zmień zdjęcie</span>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleImageUpload(item.id, file);
                        e.target.value = '';
                      }}
                      className="hidden"
                      disabled={uploading[item.id]}
                    />
                  </label>
                </div>

                {editingId === item.id ? (
                  <div className="grid gap-2">
                    <input
                      type="text"
                      defaultValue={item.title || ''}
                      onBlur={(e) => {
                        handleUpdate(item.id, { title: e.target.value });
                        setEditingId(null);
                      }}
                      placeholder="Tytuł"
                      className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      autoFocus
                    />
                    <input
                      type="text"
                      defaultValue={item.alt_text || ''}
                      onBlur={(e) => handleUpdate(item.id, { alt_text: e.target.value })}
                      placeholder="Alt text"
                      className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <input
                      type="text"
                      defaultValue={item.caption || ''}
                      onBlur={(e) => handleUpdate(item.id, { caption: e.target.value })}
                      placeholder="Opis"
                      className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="cursor-pointer" onClick={() => setEditingId(item.id)}>
                    {item.title && (
                      <div className="mb-1 text-sm font-medium text-[#e5e4e2]">{item.title}</div>
                    )}
                    {item.caption && (
                      <div className="mb-1 text-xs text-[#e5e4e2]/60">{item.caption}</div>
                    )}
                    {item.alt_text && (
                      <div className="text-xs text-[#e5e4e2]/40">Alt: {item.alt_text}</div>
                    )}
                    {!item.title && !item.caption && !item.alt_text && (
                      <div className="text-xs italic text-[#e5e4e2]/40">Kliknij aby edytować</div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleDelete(item.id, item.image_url)}
                className="h-fit rounded p-1.5 text-red-400 transition-colors hover:bg-red-400/10"
                title="Usuń"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && !globalUploading && (
        <div className="py-12 text-center text-[#e5e4e2]/40">
          <p className="mb-4">Brak zdjęć w galerii</p>
          <p className="text-sm">Przeciągnij zdjęcia powyżej lub użyj przycisków</p>
        </div>
      )}
    </div>
  );
}
