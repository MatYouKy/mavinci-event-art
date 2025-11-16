'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Plus, GripVertical, ArrowUp, ArrowDown } from 'lucide-react';
import { SimpleImageUploader } from './SimpleImageUploader';
import { IUploadImage } from '@/types/image';

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

export function ConferencesGalleryEditor({ items, onUpdate }: Props) {
  const [uploading, setUploading] = useState<{ [key: string]: boolean }>({});
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async () => {
    const { data, error } = await supabase.from('conferences_gallery').insert({
      image_url: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg',
      alt_text: 'Nowe zdjęcie',
      title: '',
      caption: '',
      display_order: items.length,
      is_active: true
    }).select().single();

    if (!error && data) {
      onUpdate();
    }
  };

  const handleImageUpload = async (itemId: string, imageData: IUploadImage) => {
    if (!imageData.file) return;

    setUploading({ ...uploading, [itemId]: true });

    try {
      const fileExt = imageData.file.name.split('.').pop();
      const fileName = `${itemId}-${Date.now()}.${fileExt}`;
      const filePath = `${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('conferences-gallery')
        .upload(filePath, imageData.file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return;
      }

      const { data: { publicUrl } } = supabase.storage
        .from('conferences-gallery')
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from('conferences_gallery')
        .update({
          image_url: publicUrl,
          alt_text: imageData.alt || 'Zdjęcie z konferencji'
        })
        .eq('id', itemId);

      if (!updateError) {
        onUpdate();
      }
    } finally {
      setUploading({ ...uploading, [itemId]: false });
    }
  };

  const handleUpdate = async (id: string, updates: Partial<GalleryItem>) => {
    const { error } = await supabase
      .from('conferences_gallery')
      .update(updates)
      .eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten element?')) return;

    const { error } = await supabase
      .from('conferences_gallery')
      .delete()
      .eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const moveItem = async (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    const item1 = items[index];
    const item2 = items[targetIndex];

    await Promise.all([
      supabase.from('conferences_gallery').update({ display_order: item2.display_order }).eq('id', item1.id),
      supabase.from('conferences_gallery').update({ display_order: item1.display_order }).eq('id', item2.id)
    ]);

    onUpdate();
  };

  return (
    <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[#d3bb73] text-xl font-medium">Edycja Galerii</h3>
        <button
          onClick={handleAdd}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj zdjęcie
        </button>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        {items.map((item, index) => (
          <div key={item.id} className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
            <div className="flex gap-3">
              <div className="flex flex-col gap-1 pt-1">
                <button
                  onClick={() => moveItem(index, 'up')}
                  disabled={index === 0}
                  className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Przenieś w górę"
                >
                  <ArrowUp className="w-4 h-4" />
                </button>
                <GripVertical className="w-4 h-4 text-[#d3bb73]/40" />
                <button
                  onClick={() => moveItem(index, 'down')}
                  disabled={index === items.length - 1}
                  className="p-1 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                  title="Przenieś w dół"
                >
                  <ArrowDown className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1">
                <div className="mb-3">
                  <SimpleImageUploader
                    currentImage={item.image_url}
                    onImageSelect={(imageData) => handleImageUpload(item.id, imageData)}
                    bucket="conferences-gallery"
                    isUploading={uploading[item.id]}
                  />
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
                      className="w-full px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                      autoFocus
                    />
                    <input
                      type="text"
                      defaultValue={item.alt_text || ''}
                      onBlur={(e) => handleUpdate(item.id, { alt_text: e.target.value })}
                      placeholder="Alt text"
                      className="w-full px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                    />
                    <input
                      type="text"
                      defaultValue={item.caption || ''}
                      onBlur={(e) => handleUpdate(item.id, { caption: e.target.value })}
                      placeholder="Opis"
                      className="w-full px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                ) : (
                  <div className="cursor-pointer" onClick={() => setEditingId(item.id)}>
                    {item.title && <div className="text-[#e5e4e2] font-medium text-sm mb-1">{item.title}</div>}
                    {item.caption && <div className="text-[#e5e4e2]/60 text-xs mb-1">{item.caption}</div>}
                    {item.alt_text && <div className="text-[#e5e4e2]/40 text-xs">Alt: {item.alt_text}</div>}
                    {!item.title && !item.caption && !item.alt_text && (
                      <div className="text-[#e5e4e2]/40 text-xs italic">Kliknij aby edytować</div>
                    )}
                  </div>
                )}
              </div>

              <button
                onClick={() => handleDelete(item.id)}
                className="p-1.5 h-fit text-red-400 hover:bg-red-400/10 rounded transition-colors"
                title="Usuń"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {items.length === 0 && (
        <div className="text-center py-12 text-[#e5e4e2]/40">
          <p className="mb-4">Brak zdjęć w galerii</p>
          <button
            onClick={handleAdd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 text-[#d3bb73] border border-[#d3bb73]/30 rounded-lg hover:bg-[#d3bb73]/20 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj pierwsze zdjęcie
          </button>
        </div>
      )}
    </div>
  );
}
