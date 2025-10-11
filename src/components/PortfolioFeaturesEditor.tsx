'use client';

import { useState } from 'react';
import type { PortfolioProjectFeature } from '@/lib/supabase';
import * as Icons from 'lucide-react';

interface AvailableIcon {
  name: string;
  label: string;
  category: string;
  description?: string;
}

interface PortfolioFeaturesEditorProps {
  projectId?: string;
  features: PortfolioProjectFeature[];
  onChange: (features: PortfolioProjectFeature[]) => void;
}

// Stała lista dostępnych ikon - zdefiniowana bezpośrednio w UI
const AVAILABLE_ICONS: AvailableIcon[] = [
  // Ludzie
  { name: 'Users', label: 'Zespół', category: 'ludzie', description: 'Profesjonalny zespół' },
  { name: 'UserCheck', label: 'Ekspert', category: 'ludzie', description: 'Eksperci w swojej dziedzinie' },
  { name: 'UsersRound', label: 'Grupa', category: 'ludzie', description: 'Duża grupa uczestników' },

  // Czas
  { name: 'Clock', label: 'Terminowość', category: 'czas', description: 'Dotrzymanie terminów' },
  { name: 'Timer', label: 'Szybkość', category: 'czas', description: 'Szybka realizacja' },
  { name: 'Calendar', label: 'Planowanie', category: 'czas', description: 'Dobre planowanie' },

  // Jakość
  { name: 'Award', label: 'Jakość', category: 'jakość', description: 'Najwyższa jakość' },
  { name: 'Star', label: 'Wyróżnienie', category: 'jakość', description: 'Nagradzana realizacja' },
  { name: 'BadgeCheck', label: 'Certyfikat', category: 'jakość', description: 'Certyfikowana jakość' },
  { name: 'Target', label: 'Precyzja', category: 'jakość', description: 'Precyzyjna realizacja' },

  // Technologia
  { name: 'Lightbulb', label: 'Innowacyjność', category: 'technologia', description: 'Innowacyjne rozwiązania' },
  { name: 'Zap', label: 'Energia', category: 'technologia', description: 'Pełna energii' },
  { name: 'Radio', label: 'Sprzęt', category: 'technologia', description: 'Profesjonalny sprzęt' },
  { name: 'Settings', label: 'Konfiguracja', category: 'technologia', description: 'Dopasowana konfiguracja' },
  { name: 'Mic', label: 'Audio', category: 'technologia', description: 'Profesjonalne audio' },

  // Realizacja
  { name: 'CheckCircle2', label: 'Kompleksowość', category: 'realizacja', description: 'Kompleksowa realizacja' },
  { name: 'Package', label: 'Kompletność', category: 'realizacja', description: 'Kompletne wyposażenie' },
  { name: 'Truck', label: 'Logistyka', category: 'realizacja', description: 'Sprawna logistyka' },
  { name: 'Wrench', label: 'Serwis', category: 'realizacja', description: 'Pełen serwis' },

  // Sukces
  { name: 'TrendingUp', label: 'Wzrost', category: 'sukces', description: 'Rosnące wyniki' },
  { name: 'ThumbsUp', label: 'Zadowolenie', category: 'sukces', description: 'Zadowolony klient' },
  { name: 'Heart', label: 'Pasja', category: 'sukces', description: 'Z pasją i zaangażowaniem' },
  { name: 'Sparkles', label: 'Wyjątkowość', category: 'sukces', description: 'Wyjątkowe wydarzenie' },
];

export default function PortfolioFeaturesEditor({
  projectId,
  features,
  onChange
}: PortfolioFeaturesEditorProps) {
  const [showIconPicker, setShowIconPicker] = useState<number | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  const categories = ['all', ...new Set(AVAILABLE_ICONS.map(icon => icon.category))];

  const filteredIcons = selectedCategory === 'all'
    ? AVAILABLE_ICONS
    : AVAILABLE_ICONS.filter(icon => icon.category === selectedCategory);

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
      światło: 'Światło',
      catering: 'Catering',
      dekoracje: 'Dekoracje',
      komunikacja: 'Komunikacja',
      logistyka: 'Logistyka',
      bezpieczeństwo: 'Bezpieczeństwo',
      rozrywka: 'Rozrywka',
      emocje: 'Emocje',
      organizacja: 'Organizacja',
      innowacje: 'Innowacje',
      edukacja: 'Edukacja',
      sport: 'Sport',
      wellness: 'Wellness',
      networking: 'Networking',
      finanse: 'Finanse',
      lokalizacja: 'Lokalizacja',
      usługi: 'Usługi',
      efekty: 'Efekty',
      rodzina: 'Rodzina',
      premium: 'Premium',
      sezonowe: 'Sezonowe',
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
                      {AVAILABLE_ICONS.find(i => i.name === feature.icon_name)?.label || feature.icon_name}
                    </div>
                    <div className="text-sm text-gray-400">Kliknij aby zmienić</div>
                  </div>
                </button>

                {showIconPicker === index && (
                  <div className="absolute z-[100] mt-2 w-full min-w-[500px] bg-gray-900 border-2 border-yellow-500 rounded-lg shadow-2xl p-4">
                    {/* Debug Info */}
                    <div className="text-xs text-gray-500 mb-2">
                      Załadowano: {AVAILABLE_ICONS.length} ikon | Widoczne: {filteredIcons.length}
                    </div>

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
                      {filteredIcons.length === 0 ? (
                        <div className="col-span-4 text-center py-8 text-gray-400">
                          Brak ikon w tej kategorii
                        </div>
                      ) : (
                        filteredIcons.map(icon => (
                          <button
                            key={icon.name}
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
                        ))
                      )}
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
