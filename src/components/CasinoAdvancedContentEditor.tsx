'use client';

import { useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Minus, Grip } from 'lucide-react';
import RichContentItemEditor, { ContentItem } from './RichContentItemEditor';

interface Section {
  id: string;
  title: string;
  subtitle?: string;
  layout_type: 'grid-1' | 'grid-2' | 'grid-3' | 'grid-4';
  items: ContentItem[];
  order_index: number;
  background_color?: string;
  padding_y?: 'small' | 'normal' | 'large';
}

interface Separator {
  id: string;
  separator_type: 'line' | 'dots' | 'wave' | 'none';
  order_index: number;
}

interface ContentElement {
  type: 'section' | 'separator';
  data: Section | Separator;
  order_index: number;
}

interface CasinoAdvancedContentEditorProps {
  sections: Section[];
  separators: Separator[];
  onChange: (sections: Section[], separators: Separator[]) => void;
}

export default function CasinoAdvancedContentEditor({
  sections,
  separators,
  onChange,
}: CasinoAdvancedContentEditorProps) {
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());

  const mergeElements = (): ContentElement[] => {
    const elements: ContentElement[] = [
      ...sections.map(s => ({ type: 'section' as const, data: s, order_index: s.order_index })),
      ...separators.map(s => ({ type: 'separator' as const, data: s, order_index: s.order_index })),
    ];
    return elements.sort((a, b) => a.order_index - b.order_index);
  };

  const reorderElements = (elements: ContentElement[]) => {
    const newSections: Section[] = [];
    const newSeparators: Separator[] = [];

    elements.forEach((el, index) => {
      if (el.type === 'section') {
        newSections.push({ ...el.data as Section, order_index: index });
      } else {
        newSeparators.push({ ...el.data as Separator, order_index: index });
      }
    });

    onChange(newSections, newSeparators);
  };

  const addSection = () => {
    const newSection: Section = {
      id: crypto.randomUUID(),
      title: 'Nowa sekcja',
      subtitle: '',
      layout_type: 'grid-1',
      items: [],
      order_index: sections.length + separators.length,
      padding_y: 'normal',
    };
    onChange([...sections, newSection], separators);
  };

  const addSeparator = () => {
    const newSeparator: Separator = {
      id: crypto.randomUUID(),
      separator_type: 'line',
      order_index: sections.length + separators.length,
    };
    onChange(sections, [...separators, newSeparator]);
  };

  const removeElement = (id: string, type: 'section' | 'separator') => {
    if (type === 'section') {
      onChange(sections.filter(s => s.id !== id), separators);
    } else {
      onChange(sections, separators.filter(s => s.id !== id));
    }
  };

  const moveElement = (index: number, direction: 'up' | 'down') => {
    const elements = mergeElements();
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= elements.length) return;

    [elements[index], elements[targetIndex]] = [elements[targetIndex], elements[index]];
    reorderElements(elements);
  };

  const updateSection = (sectionId: string, updates: Partial<Section>) => {
    onChange(
      sections.map(s => s.id === sectionId ? { ...s, ...updates } : s),
      separators
    );
  };

  const updateSeparator = (separatorId: string, updates: Partial<Separator>) => {
    onChange(
      sections,
      separators.map(s => s.id === separatorId ? { ...s, ...updates } : s)
    );
  };

  const addItemToSection = (sectionId: string, itemType: ContentItem['item_type']) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const newItem: ContentItem = {
      id: crypto.randomUUID(),
      item_type: itemType,
      content: itemType === 'list' ? { items: [''] } : {},
      order_index: section.items.length,
    };

    updateSection(sectionId, {
      items: [...section.items, newItem],
    });

    setExpandedSections(new Set([...expandedSections, sectionId]));
  };

  const updateItem = (sectionId: string, item: ContentItem) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    updateSection(sectionId, {
      items: section.items.map(i => i.id === item.id ? item : i),
    });
  };

  const deleteItem = (sectionId: string, itemId: string) => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    updateSection(sectionId, {
      items: section.items.filter(i => i.id !== itemId),
    });
  };

  const moveItem = (sectionId: string, itemIndex: number, direction: 'up' | 'down') => {
    const section = sections.find(s => s.id === sectionId);
    if (!section) return;

    const items = [...section.items];
    const targetIndex = direction === 'up' ? itemIndex - 1 : itemIndex + 1;
    if (targetIndex < 0 || targetIndex >= items.length) return;

    [items[itemIndex], items[targetIndex]] = [items[targetIndex], items[itemIndex]];
    items.forEach((item, idx) => {
      item.order_index = idx;
    });

    updateSection(sectionId, { items });
  };

  const toggleSection = (sectionId: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(sectionId)) {
      newExpanded.delete(sectionId);
    } else {
      newExpanded.add(sectionId);
    }
    setExpandedSections(newExpanded);
  };

  const elements = mergeElements();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h3 className="text-xl font-light text-[#e5e4e2]">Zaawansowany System Treści</h3>
          <p className="text-sm text-[#e5e4e2]/50 mt-1">
            Sekcje z wieloma itemami + separatory + rich content creator
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={addSection}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
          >
            <Plus className="w-4 h-4" />
            Dodaj sekcję
          </button>
          <button
            onClick={addSeparator}
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/20 border border-[#d3bb73]/30 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/30 transition-colors text-sm"
          >
            <Minus className="w-4 h-4" />
            Dodaj separator
          </button>
        </div>
      </div>

      <div className="space-y-4">
        {elements.map((element, index) => (
          <div key={element.type + (element.data as any).id} className="relative">
            {/* Move buttons */}
            <div className="absolute -left-10 top-4 flex flex-col gap-1">
              <button
                onClick={() => moveElement(index, 'up')}
                disabled={index === 0}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                onClick={() => moveElement(index, 'down')}
                disabled={index === elements.length - 1}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
            </div>

            {element.type === 'separator' ? (
              <div className="bg-[#1c1f33]/40 border border-[#d3bb73]/10 rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <Minus className="w-4 h-4 text-[#d3bb73]" />
                    <span className="text-sm font-medium text-[#d3bb73]">SEPARATOR</span>
                  </div>
                  <button
                    onClick={() => removeElement((element.data as Separator).id, 'separator')}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                <select
                  value={(element.data as Separator).separator_type}
                  onChange={(e) =>
                    updateSeparator((element.data as Separator).id, {
                      separator_type: e.target.value as any,
                    })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none text-sm"
                >
                  <option value="line">Linia</option>
                  <option value="dots">Kropki</option>
                  <option value="wave">Fala</option>
                  <option value="none">Przestrzeń</option>
                </select>

                {/* Preview */}
                <div className="mt-3 pt-3 border-t border-[#d3bb73]/10">
                  {(element.data as Separator).separator_type === 'line' && (
                    <div className="h-px bg-gradient-to-r from-transparent via-[#d3bb73]/30 to-transparent" />
                  )}
                  {(element.data as Separator).separator_type === 'dots' && (
                    <div className="flex justify-center gap-2">
                      {[1, 2, 3].map(i => (
                        <div key={i} className="w-1 h-1 rounded-full bg-[#d3bb73]/50" />
                      ))}
                    </div>
                  )}
                  {(element.data as Separator).separator_type === 'wave' && (
                    <div className="w-full h-4 opacity-30">
                      <svg viewBox="0 0 1200 20" fill="none" className="w-full h-full">
                        <path
                          d="M0 10 Q 150 0 300 10 T 600 10 T 900 10 T 1200 10"
                          stroke="currentColor"
                          strokeWidth="2"
                          className="text-[#d3bb73]"
                        />
                      </svg>
                    </div>
                  )}
                  {(element.data as Separator).separator_type === 'none' && (
                    <div className="text-center text-xs text-[#e5e4e2]/30">Pusta przestrzeń (40px)</div>
                  )}
                </div>
              </div>
            ) : (
              <div className="bg-[#1c1f33]/60 border border-[#d3bb73]/20 rounded-xl overflow-hidden">
                {/* Section Header */}
                <div
                  className="p-4 cursor-pointer hover:bg-[#1c1f33]/80 transition-colors"
                  onClick={() => toggleSection((element.data as Section).id)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3">
                        <Grip className="w-4 h-4 text-[#d3bb73]" />
                        <input
                          type="text"
                          value={(element.data as Section).title}
                          onChange={(e) => {
                            e.stopPropagation();
                            updateSection((element.data as Section).id, { title: e.target.value });
                          }}
                          onClick={(e) => e.stopPropagation()}
                          placeholder="Tytuł sekcji..."
                          className="bg-transparent text-lg font-light text-[#e5e4e2] border-none outline-none focus:ring-0"
                        />
                      </div>
                      <div className="flex items-center gap-3 ml-7 mt-2">
                        <span className="text-xs text-[#e5e4e2]/50">
                          {(element.data as Section).items.length} element(ów)
                        </span>
                        <span className="text-xs px-2 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded">
                          {(element.data as Section).layout_type}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeElement((element.data as Section).id, 'section');
                        }}
                        className="text-red-400 hover:text-red-300 px-2"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section Content (Collapsible) */}
                {expandedSections.has((element.data as Section).id) && (
                  <div className="border-t border-[#d3bb73]/10 p-4 space-y-4 bg-[#0f1119]/30">
                    {/* Settings */}
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-[#e5e4e2]/70 mb-1">Układ grid</label>
                        <select
                          value={(element.data as Section).layout_type}
                          onChange={(e) =>
                            updateSection((element.data as Section).id, {
                              layout_type: e.target.value as any,
                            })
                          }
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                        >
                          <option value="grid-1">1 kolumna</option>
                          <option value="grid-2">2 kolumny</option>
                          <option value="grid-3">3 kolumny</option>
                          <option value="grid-4">4 kolumny</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-xs text-[#e5e4e2]/70 mb-1">Padding</label>
                        <select
                          value={(element.data as Section).padding_y || 'normal'}
                          onChange={(e) =>
                            updateSection((element.data as Section).id, {
                              padding_y: e.target.value as any,
                            })
                          }
                          className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded px-3 py-2 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                        >
                          <option value="small">Mały</option>
                          <option value="normal">Normalny</option>
                          <option value="large">Duży</option>
                        </select>
                      </div>
                    </div>

                    {/* Add Item Buttons */}
                    <div className="flex flex-wrap gap-2">
                      <button
                        onClick={() => addItemToSection((element.data as Section).id, 'heading')}
                        className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/20 transition-colors"
                      >
                        + Nagłówek
                      </button>
                      <button
                        onClick={() => addItemToSection((element.data as Section).id, 'paragraph')}
                        className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/20 transition-colors"
                      >
                        + Paragraf
                      </button>
                      <button
                        onClick={() => addItemToSection((element.data as Section).id, 'list')}
                        className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/20 transition-colors"
                      >
                        + Lista
                      </button>
                      <button
                        onClick={() => addItemToSection((element.data as Section).id, 'image')}
                        className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/20 transition-colors"
                      >
                        + Obraz
                      </button>
                      <button
                        onClick={() => addItemToSection((element.data as Section).id, 'video')}
                        className="px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/20 transition-colors"
                      >
                        + Film
                      </button>
                    </div>

                    {/* Items */}
                    <div className="space-y-3">
                      {(element.data as Section).items.map((item, itemIndex) => (
                        <RichContentItemEditor
                          key={item.id}
                          item={item}
                          onUpdate={(updatedItem) =>
                            updateItem((element.data as Section).id, updatedItem)
                          }
                          onDelete={() => deleteItem((element.data as Section).id, item.id)}
                          onMoveUp={() =>
                            moveItem((element.data as Section).id, itemIndex, 'up')
                          }
                          onMoveDown={() =>
                            moveItem((element.data as Section).id, itemIndex, 'down')
                          }
                          canMoveUp={itemIndex > 0}
                          canMoveDown={itemIndex < (element.data as Section).items.length - 1}
                        />
                      ))}
                    </div>

                    {(element.data as Section).items.length === 0 && (
                      <div className="text-center py-8 text-[#e5e4e2]/30 text-sm border border-dashed border-[#d3bb73]/10 rounded">
                        Brak elementów - dodaj nagłówek, paragraf lub listę
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {elements.length === 0 && (
        <div className="text-center py-16 text-[#e5e4e2]/50 border border-dashed border-[#d3bb73]/20 rounded-xl">
          <p className="mb-2">Brak sekcji i separatorów</p>
          <p className="text-xs">
            Dodaj sekcję aby stworzyć blok treści lub separator aby oddzielić wizualnie sekcje
          </p>
        </div>
      )}
    </div>
  );
}
