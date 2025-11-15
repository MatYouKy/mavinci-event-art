'use client';

import { useState } from 'react';
import { Plus, Trash2, Image as ImageIcon, ArrowUp, ArrowDown } from 'lucide-react';
import { SimpleImageUploader } from './SimpleImageUploader';
import { IUploadImage } from '@/types/image';

interface CasinoTable {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  alt: string;
  image_metadata?: {
    desktop?: { src: string; position: { posX: number; posY: number; scale: number } };
    mobile?: { src: string; position: { posX: number; posY: number; scale: number } };
  };
  order_index: number;
  is_visible?: boolean;
}

interface CasinoTablesEditorProps {
  tables: CasinoTable[];
  onChange: (tables: CasinoTable[]) => void;
  onImageUpload?: (tableId: string, imageData: IUploadImage) => void;
}

export default function CasinoTablesEditor({ tables, onChange, onImageUpload }: CasinoTablesEditorProps) {
  const [editingImages, setEditingImages] = useState<{ [key: string]: IUploadImage }>({});

  const addTable = () => {
    const defaultImage = 'https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920';
    const newTable: CasinoTable = {
      id: crypto.randomUUID(),
      name: 'Nowy stół',
      slug: `stol-${Date.now()}`,
      description: 'Opis nowego stołu',
      image: defaultImage,
      alt: 'Nowy stół',
      image_metadata: {
        desktop: { src: defaultImage, position: { posX: 0, posY: 0, scale: 1 } },
        mobile: { src: defaultImage, position: { posX: 0, posY: 0, scale: 1 } },
      },
      order_index: tables.length,
    };
    onChange([...tables, newTable]);
  };

  const removeTable = (id: string) => {
    onChange(tables.filter(t => t.id !== id));
  };

  const updateTable = (id: string, field: keyof CasinoTable, value: any) => {
    onChange(tables.map(t => t.id === id ? { ...t, [field]: value } : t));
  };

  const moveTable = (index: number, direction: 'up' | 'down') => {
    const newTables = [...tables];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newTables.length) return;

    [newTables[index], newTables[targetIndex]] = [newTables[targetIndex], newTables[index]];
    newTables.forEach((table, idx) => {
      table.order_index = idx;
    });
    onChange(newTables);
  };

  const handleImageSelect = (tableId: string, imageData: IUploadImage) => {
    setEditingImages({ ...editingImages, [tableId]: imageData });

    if (onImageUpload) {
      onImageUpload(tableId, imageData);
    }

    const updatedTables = tables.map(t => {
      if (t.id === tableId) {
        let imageUrl = t.image;
        if (imageData.file) {
          imageUrl = URL.createObjectURL(imageData.file);
        }

        return {
          ...t,
          image: imageUrl,
          alt: imageData.alt || t.alt,
          image_metadata: {
            desktop: imageData.desktop || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
            mobile: imageData.mobile || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
          },
        };
      }
      return t;
    });

    onChange(updatedTables);
  };

  return (
    <div className="space-y-16">
      <div className="flex justify-between items-center mb-8">
        <h3 className="text-xl font-light text-[#e5e4e2]">Edycja Stołów</h3>
        <button
          onClick={addTable}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Dodaj stół
        </button>
      </div>

      {tables.map((table, index) => (
        <div key={table.id} className="bg-[#1c1f33]/60 border-2 border-[#d3bb73]/30 rounded-2xl p-4 lg:p-6">
          <div className="flex items-center justify-between mb-6">
            <h4 className="text-lg font-light text-[#e5e4e2] flex items-center gap-2">
              <span className="bg-[#d3bb73]/20 px-3 py-1 rounded-full text-sm">Stół #{index + 1}</span>
            </h4>
            <div className="flex gap-2">
              <button
                onClick={() => moveTable(index, 'up')}
                disabled={index === 0}
                className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg disabled:opacity-30 transition-colors"
                title="Przesuń w górę"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => moveTable(index, 'down')}
                disabled={index === tables.length - 1}
                className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded-lg disabled:opacity-30 transition-colors"
                title="Przesuń w dół"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => removeTable(table.id)}
                className="p-2 text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                title="Usuń stół"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className={`grid lg:grid-cols-2 gap-8 items-center ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
            <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
              <label className="block text-[#e5e4e2]/70 text-sm mb-3">
                <ImageIcon className="w-4 h-4 inline mr-2" />
                Zdjęcie stołu
              </label>
              <div className="relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-transparent rounded-2xl blur-xl group-hover:blur-2xl transition-all"></div>
                <div className="relative">
                  <SimpleImageUploader
                    onImageSelect={(data) => handleImageSelect(table.id, data)}
                    initialImage={{
                      src: table.image_metadata?.desktop?.src || table.image,
                      alt: table.alt,
                      desktop: table.image_metadata?.desktop,
                      mobile: table.image_metadata?.mobile,
                    }}
                    showPreview={true}
                  />
                </div>
              </div>
            </div>

            <div className={`space-y-4 ${index % 2 === 1 ? 'lg:order-1' : ''}`}>
              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Nazwa stołu</label>
                <input
                  type="text"
                  value={table.name}
                  onChange={(e) => updateTable(table.id, 'name', e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] text-lg focus:border-[#d3bb73] focus:outline-none transition-colors"
                  placeholder="np. Ruletka"
                />
              </div>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Opis stołu</label>
                <textarea
                  value={table.description}
                  onChange={(e) => updateTable(table.id, 'description', e.target.value)}
                  rows={5}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none transition-colors"
                  placeholder="Opisz stół i zasady gry..."
                />
              </div>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Slug (URL)</label>
                <input
                  type="text"
                  value={table.slug}
                  onChange={(e) => updateTable(table.id, 'slug', e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none transition-colors font-mono"
                  placeholder="ruletka"
                />
              </div>
            </div>
          </div>
        </div>
      ))}

      {tables.length === 0 && (
        <div className="text-center py-12 text-[#e5e4e2]/50">
          <p>Brak stolików. Kliknij "Dodaj stół" aby utworzyć pierwszy.</p>
        </div>
      )}
    </div>
  );
}
