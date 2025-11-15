'use client';

import { useState } from 'react';
import { Type, List, AlignLeft, Image as ImageIcon, Video, Heading1, Heading2, Heading3, Plus, Trash2, GripVertical } from 'lucide-react';

export interface ContentItem {
  id: string;
  item_type: 'heading' | 'paragraph' | 'list' | 'image' | 'video';
  content: {
    text?: string;
    level?: 'h1' | 'h2' | 'h3';
    items?: string[];
    url?: string;
    alt?: string;
    align?: 'left' | 'center' | 'right' | 'justify';
  };
  order_index: number;
}

interface RichContentItemEditorProps {
  item: ContentItem;
  onUpdate: (item: ContentItem) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

export default function RichContentItemEditor({
  item,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: RichContentItemEditorProps) {
  const updateContent = (field: string, value: any) => {
    onUpdate({
      ...item,
      content: {
        ...item.content,
        [field]: value,
      },
    });
  };

  const addListItem = () => {
    const items = item.content.items || [];
    updateContent('items', [...items, '']);
  };

  const updateListItem = (index: number, value: string) => {
    const items = [...(item.content.items || [])];
    items[index] = value;
    updateContent('items', items);
  };

  const removeListItem = (index: number) => {
    const items = item.content.items?.filter((_, i) => i !== index) || [];
    updateContent('items', items);
  };

  const getIcon = () => {
    switch (item.item_type) {
      case 'heading': return <Type className="w-4 h-4" />;
      case 'paragraph': return <AlignLeft className="w-4 h-4" />;
      case 'list': return <List className="w-4 h-4" />;
      case 'image': return <ImageIcon className="w-4 h-4" />;
      case 'video': return <Video className="w-4 h-4" />;
    }
  };

  const getLabel = () => {
    switch (item.item_type) {
      case 'heading': return `Nagłówek ${item.content.level || 'h2'}`.toUpperCase();
      case 'paragraph': return 'Paragraf';
      case 'list': return 'Lista punktowana';
      case 'image': return 'Obraz';
      case 'video': return 'Film';
    }
  };

  return (
    <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex flex-col gap-1">
            <button
              onClick={onMoveUp}
              disabled={!canMoveUp}
              className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <GripVertical className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-2 px-3 py-1 bg-[#d3bb73]/10 rounded-full">
            {getIcon()}
            <span className="text-xs font-medium text-[#d3bb73]">{getLabel()}</span>
          </div>
        </div>
        <button
          onClick={onDelete}
          className="text-red-400 hover:text-red-300 transition-colors"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      {/* Content */}
      {item.item_type === 'heading' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {['h1', 'h2', 'h3'].map((level) => (
              <button
                key={level}
                onClick={() => updateContent('level', level)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  item.content.level === level
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] text-[#d3bb73] hover:bg-[#1c1f33]/80'
                }`}
              >
                {level.toUpperCase()}
              </button>
            ))}
          </div>
          <input
            type="text"
            value={item.content.text || ''}
            onChange={(e) => updateContent('text', e.target.value)}
            placeholder="Treść nagłówka..."
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
        </div>
      )}

      {item.item_type === 'paragraph' && (
        <div className="space-y-3">
          <div className="flex gap-2">
            {['left', 'center', 'right', 'justify'].map((align) => (
              <button
                key={align}
                onClick={() => updateContent('align', align)}
                className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                  item.content.align === align
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#1c1f33] text-[#d3bb73] hover:bg-[#1c1f33]/80'
                }`}
              >
                {align === 'left' ? 'Lewy' : align === 'center' ? 'Środek' : align === 'right' ? 'Prawy' : 'Justuj'}
              </button>
            ))}
          </div>
          <textarea
            value={item.content.text || ''}
            onChange={(e) => updateContent('text', e.target.value)}
            placeholder="Treść paragrafu..."
            rows={4}
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none resize-none"
          />
        </div>
      )}

      {item.item_type === 'list' && (
        <div className="space-y-2">
          {(item.content.items || []).map((listItem, index) => (
            <div key={index} className="flex gap-2">
              <span className="text-[#d3bb73] mt-2">•</span>
              <input
                type="text"
                value={listItem}
                onChange={(e) => updateListItem(index, e.target.value)}
                placeholder="Element listy..."
                className="flex-1 bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
              <button
                onClick={() => removeListItem(index)}
                className="text-red-400 hover:text-red-300"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={addListItem}
            className="flex items-center gap-2 px-3 py-2 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Dodaj element
          </button>
        </div>
      )}

      {item.item_type === 'image' && (
        <div className="space-y-3">
          <input
            type="text"
            value={item.content.url || ''}
            onChange={(e) => updateContent('url', e.target.value)}
            placeholder="URL obrazu..."
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
          <input
            type="text"
            value={item.content.alt || ''}
            onChange={(e) => updateContent('alt', e.target.value)}
            placeholder="Opis alternatywny (ALT)..."
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
          {item.content.url && (
            <img src={item.content.url} alt={item.content.alt} className="w-full rounded border border-[#d3bb73]/20" />
          )}
        </div>
      )}

      {item.item_type === 'video' && (
        <div className="space-y-3">
          <input
            type="text"
            value={item.content.url || ''}
            onChange={(e) => updateContent('url', e.target.value)}
            placeholder="URL filmu (YouTube, Vimeo)..."
            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          />
          <p className="text-xs text-[#e5e4e2]/50">
            Wspierane: YouTube, Vimeo (embed URLs)
          </p>
        </div>
      )}
    </div>
  );
}
