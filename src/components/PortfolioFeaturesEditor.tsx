'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { AvailableIcon, PortfolioProjectFeature } from '@/lib/supabase';
import * as Icons from 'lucide-react';

interface PortfolioFeaturesEditorProps {
  projectId?: string;
  features: PortfolioProjectFeature[];
  onChange: (features: PortfolioProjectFeature[]) => void;
}

export default function PortfolioFeaturesEditor({
  projectId,
  features,
  onChange
}: PortfolioFeaturesEditorProps) {
  const [availableIcons, setAvailableIcons] = useState<AvailableIcon[]>([]);
  const [showIconPicker, setShowIconPicker] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    fetchAvailableIcons();
  }, []);

  const fetchAvailableIcons = async () => {
    const { data, error } = await supabase
      .from('available_icons')
      .select('*')
      .order('category', { ascending: true })
      .order('label', { ascending: true });

    if (error) {
      console.error('Error fetching icons:', error);
      return;
    }

    setAvailableIcons(data || []);
  };

  const categories = ['all', ...new Set(availableIcons.map(icon => icon.category))];

  const filteredIcons = selectedCategory === 'all'
    ? availableIcons
    : availableIcons.filter(icon => icon.category === selectedCategory);

  const addFeature = () => {
    const newFeature: PortfolioProjectFeature = {
      icon_name: 'Star',
      title: 'Nowa cecha',
      description: '',
      order_index: features.length,
    };
    onChange([...features, newFeature]);
  };

  const updateFeature = (index: number, updates: Partial<PortfolioProjectFeature>) => {
    const updated = [...features];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const removeFeature = (index: number) => {
    const updated = features.filter((_, i) => i !== index);
    onChange(updated.map((f, i) => ({ ...f, order_index: i })));
  };

  const renderIcon = (iconName: string, className?: string) => {
    const IconComponent = (Icons as any)[iconName];
    if (!IconComponent) return null;
    return <IconComponent className={className} />;
  };

  const getCategoryLabel = (category: string) => {
    const labels: Record<string, string> = {
      all: 'Wszystkie',
      ludzie: 'Ludzie',
      czas: 'Czas',
      jakość: 'Jakość',
      technologia: 'Technologia',
      realizacja: 'Realizacja',
      sukces: 'Sukces',
    };
    return labels[category] || category;
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-white">
          Cechy & Mocne Strony
        </h3>
        <button
          type="button"
          onClick={addFeature}
          className="px-4 py-2 bg-yellow-600 hover:bg-yellow-700 text-white rounded-lg transition-colors"
        >
          + Dodaj Cechę
        </button>
      </div>

      <div className="space-y-3">
        {features.map((feature, index) => (
          <div
            key={index}
            className="bg-gray-800/50 border border-gray-700 rounded-lg p-4"
          >
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Icon Picker */}
              <div className="relative">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Ikona
                </label>
                <button
                  type="button"
                  onClick={() => setShowIconPicker(showIconPicker === index ? null : index)}
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-left flex items-center gap-3 hover:border-yellow-500 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-yellow-600/20 flex items-center justify-center">
                    {renderIcon(feature.icon_name, 'w-5 h-5 text-yellow-500')}
                  </div>
                  <div>
                    <div className="text-white font-medium">
                      {availableIcons.find(i => i.name === feature.icon_name)?.label || feature.icon_name}
                    </div>
                    <div className="text-sm text-gray-400">Kliknij aby zmienić</div>
                  </div>
                </button>

                {showIconPicker === index && (
                  <div className="absolute z-50 mt-2 w-full bg-gray-900 border border-gray-700 rounded-lg shadow-xl p-4">
                    {/* Category Filter */}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      {categories.map(cat => (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => setSelectedCategory(cat)}
                          className={`px-3 py-1 rounded text-sm transition-colors ${
                            selectedCategory === cat
                              ? 'bg-yellow-600 text-white'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          }`}
                        >
                          {getCategoryLabel(cat)}
                        </button>
                      ))}
                    </div>

                    {/* Icon Grid */}
                    <div className="grid grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                      {filteredIcons.map(icon => (
                        <button
                          key={icon.id}
                          type="button"
                          onClick={() => {
                            updateFeature(index, { icon_name: icon.name });
                            setShowIconPicker(null);
                          }}
                          className={`p-3 rounded-lg flex flex-col items-center gap-1 transition-colors ${
                            feature.icon_name === icon.name
                              ? 'bg-yellow-600 text-white'
                              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                          }`}
                          title={icon.description}
                        >
                          {renderIcon(icon.name, 'w-6 h-6')}
                          <span className="text-xs text-center line-clamp-2">{icon.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Title Input */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Tytuł Cechy
                </label>
                <input
                  type="text"
                  value={feature.title}
                  onChange={(e) => updateFeature(index, { title: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:border-yellow-500 focus:outline-none"
                  placeholder="np. Profesjonalna Obsługa"
                />
              </div>

              {/* Description (optional) */}
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Opis (opcjonalnie)
                </label>
                <input
                  type="text"
                  value={feature.description || ''}
                  onChange={(e) => updateFeature(index, { description: e.target.value })}
                  className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-lg text-white focus:border-yellow-500 focus:outline-none"
                  placeholder="Dodatkowy opis cechy"
                />
              </div>
            </div>

            {/* Remove Button */}
            <div className="mt-3 flex justify-end">
              <button
                type="button"
                onClick={() => removeFeature(index)}
                className="px-3 py-1 text-red-400 hover:text-red-300 transition-colors text-sm"
              >
                Usuń
              </button>
            </div>
          </div>
        ))}

        {features.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            Brak cech. Kliknij &quot;Dodaj Cechę&quot; aby rozpocząć.
          </div>
        )}
      </div>
    </div>
  );
}
