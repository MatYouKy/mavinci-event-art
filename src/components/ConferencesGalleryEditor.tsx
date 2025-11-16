'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Plus, Upload, GripVertical } from 'lucide-react';

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
  const [isAdding, setIsAdding] = useState(false);
  const [newItem, setNewItem] = useState({
    image_url: '',
    alt_text: '',
    title: '',
    caption: ''
  });
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleAdd = async () => {
    if (!newItem.image_url) return;

    const { error } = await supabase.from('conferences_gallery').insert({
      ...newItem,
      display_order: items.length,
      is_active: true
    });

    if (!error) {
      setNewItem({ image_url: '', alt_text: '', title: '', caption: '' });
      setIsAdding(false);
      onUpdate();
    }
  };

  const handleUpdate = async (id: string, updates: Partial<GalleryItem>) => {
    const { error } = await supabase
      .from('conferences_gallery')
      .update(updates)
      .eq('id', id);

    if (!error) {
      onUpdate();
      setEditingId(null);
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

  return (
    <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[#d3bb73] text-xl font-medium">Edycja Galerii</h3>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj zdjęcie
        </button>
      </div>

      {isAdding && (
        <div className="bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg p-4 mb-4">
          <div className="grid gap-3">
            <div>
              <label className="text-[#e5e4e2] text-sm mb-1 block">URL zdjęcia *</label>
              <input
                type="text"
                value={newItem.image_url}
                onChange={(e) => setNewItem({ ...newItem, image_url: e.target.value })}
                placeholder="https://..."
                className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-[#e5e4e2] text-sm mb-1 block">Tytuł</label>
                <input
                  type="text"
                  value={newItem.title}
                  onChange={(e) => setNewItem({ ...newItem, title: e.target.value })}
                  className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-[#e5e4e2] text-sm mb-1 block">Alt text</label>
                <input
                  type="text"
                  value={newItem.alt_text}
                  onChange={(e) => setNewItem({ ...newItem, alt_text: e.target.value })}
                  className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="text-[#e5e4e2] text-sm mb-1 block">Opis</label>
              <input
                type="text"
                value={newItem.caption}
                onChange={(e) => setNewItem({ ...newItem, caption: e.target.value })}
                className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={handleAdd}
              className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
            >
              Dodaj
            </button>
            <button
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/30 rounded-lg hover:border-[#d3bb73] transition-colors"
            >
              Anuluj
            </button>
          </div>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {items.map((item) => (
          <div key={item.id} className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4">
            <div className="flex gap-3">
              <GripVertical className="w-5 h-5 text-[#d3bb73]/40 flex-shrink-0 mt-1" />
              <div className="flex-1">
                {editingId === item.id ? (
                  <div className="grid gap-2">
                    <input
                      type="text"
                      defaultValue={item.image_url}
                      onBlur={(e) => handleUpdate(item.id, { image_url: e.target.value })}
                      className="w-full px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                      placeholder="URL zdjęcia"
                    />
                    <input
                      type="text"
                      defaultValue={item.title || ''}
                      onBlur={(e) => handleUpdate(item.id, { title: e.target.value })}
                      className="w-full px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                      placeholder="Tytuł"
                    />
                    <input
                      type="text"
                      defaultValue={item.caption || ''}
                      onBlur={(e) => handleUpdate(item.id, { caption: e.target.value })}
                      className="w-full px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                      placeholder="Opis"
                    />
                  </div>
                ) : (
                  <>
                    <div className="w-full h-32 rounded-lg overflow-hidden bg-[#1c1f33] mb-2">
                      <img src={item.image_url} alt={item.alt_text || ''} className="w-full h-full object-cover" />
                    </div>
                    {item.title && <div className="text-[#e5e4e2] font-medium text-sm mb-1">{item.title}</div>}
                    {item.caption && <div className="text-[#e5e4e2]/60 text-xs">{item.caption}</div>}
                  </>
                )}
              </div>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                  className="p-1.5 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                  title={editingId === item.id ? 'Zamknij' : 'Edytuj'}
                >
                  {editingId === item.id ? <X className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                </button>
                <button
                  onClick={() => handleDelete(item.id)}
                  className="p-1.5 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                  title="Usuń"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
