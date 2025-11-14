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
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-light text-[#e5e4e2]">Nasze Stoły</h3>
        <button
          onClick={addTable}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Dodaj stół
        </button>
      </div>

      {tables.map((table, index) => (
        <div key={table.id} className="bg-[#1c1f33]/60 border border-[#d3bb73]/20 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-lg font-light text-[#e5e4e2]">Stół #{index + 1}</h4>
            <div className="flex gap-2">
              <button
                onClick={() => moveTable(index, 'up')}
                disabled={index === 0}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => moveTable(index, 'down')}
                disabled={index === tables.length - 1}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                onClick={() => removeTable(table.id)}
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[#e5e4e2]/70 text-sm mb-2">Nazwa</label>
            <input
              type="text"
              value={table.name}
              onChange={(e) => updateTable(table.id, 'name', e.target.value)}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[#e5e4e2]/70 text-sm mb-2">Opis</label>
            <textarea
              value={table.description}
              onChange={(e) => updateTable(table.id, 'description', e.target.value)}
              rows={3}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-[#e5e4e2]/70 text-sm mb-2">
              <ImageIcon className="w-4 h-4 inline mr-2" />
              Zdjęcie
            </label>
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
      ))}

      {tables.length === 0 && (
        <div className="text-center py-12 text-[#e5e4e2]/50">
          <p>Brak stolików. Kliknij "Dodaj stół" aby utworzyć pierwszy.</p>
        </div>
      )}
    </div>
  );
}
