'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Package, Users, DollarSign, Clock, Sparkles, CreditCard as Edit, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Attraction {
  id: string;
  name: string;
  description: string;
  category: string;
  base_price: number;
  unit: string;
  duration_hours: number;
  max_daily_capacity: number;
  requires_operator: boolean;
  setup_time_minutes: number;
  breakdown_time_minutes: number;
  is_active: boolean;
}

const categoryLabels: Record<string, string> = {
  sound_system: 'Nagłośnienie',
  lighting: 'Oświetlenie',
  dj_services: 'DJ',
  stage_tech: 'Technika sceniczna',
  decorations: 'Dekoracje',
  entertainment: 'Rozrywka',
  casino: 'Kasyno',
  simulators: 'Symulatory',
  conference: 'Konferencje',
  streaming: 'Streaming',
  other: 'Inne',
};

export default function AttractionsPage() {
  const router = useRouter();
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [filteredAttractions, setFilteredAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    fetchAttractions();
  }, []);

  useEffect(() => {
    filterAttractions();
  }, [searchQuery, selectedCategory, attractions]);

  const fetchAttractions = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('attractions')
        .select('*')
        .order('name');

      if (error) {
        console.error('Error fetching attractions:', error);
        return;
      }

      if (data) {
        setAttractions(data);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filterAttractions = () => {
    let filtered = [...attractions];

    if (searchQuery) {
      filtered = filtered.filter(
        (attr) =>
          attr.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          attr.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (selectedCategory !== 'all') {
      filtered = filtered.filter((attr) => attr.category === selectedCategory);
    }

    setFilteredAttractions(filtered);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę atrakcję?')) return;

    try {
      const { error } = await supabase.from('attractions').delete().eq('id', id);

      if (error) {
        console.error('Error deleting attraction:', error);
        alert('Błąd podczas usuwania atrakcji');
        return;
      }

      fetchAttractions();
    } catch (err) {
      console.error('Error:', err);
      alert('Wystąpił błąd');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Atrakcje i usługi</h1>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj katalogiem atrakcji, sprzętem i kosztorysami
          </p>
        </div>
        <button
          onClick={() => router.push('/crm/attractions/new')}
          className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj atrakcję
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <Sparkles className="w-5 h-5 text-[#d3bb73]" />
            <span className="text-2xl font-light text-[#e5e4e2]">{attractions.length}</span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wszystkie atrakcje</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <Package className="w-5 h-5 text-blue-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {attractions.filter((a) => a.is_active).length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Aktywne</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <Users className="w-5 h-5 text-green-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {attractions.filter((a) => a.requires_operator).length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wymaga operatora</p>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <DollarSign className="w-5 h-5 text-yellow-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {attractions
                .reduce((sum, a) => sum + (a.base_price || 0), 0)
                .toLocaleString('pl-PL')}
              zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Łączna wartość</p>
        </div>
      </div>

      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div className="flex flex-col lg:flex-row gap-4 mb-6">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj atrakcji..."
              className="w-full bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-[#0a0d1a] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
          >
            <option value="all">Wszystkie kategorie</option>
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {filteredAttractions.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="w-12 h-12 text-[#e5e4e2]/20 mx-auto mb-4" />
            <p className="text-[#e5e4e2]/60">
              {searchQuery || selectedCategory !== 'all'
                ? 'Brak atrakcji spełniających kryteria'
                : 'Brak atrakcji'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAttractions.map((attraction) => (
              <div
                key={attraction.id}
                className="bg-[#0f1119] border border-[#d3bb73]/10 rounded-lg p-5 hover:border-[#d3bb73]/30 transition-colors cursor-pointer"
                onClick={() => router.push(`/crm/attractions/${attraction.id}`)}
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-[#e5e4e2] mb-1">
                      {attraction.name}
                    </h3>
                    <span className="inline-block px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs">
                      {categoryLabels[attraction.category] || attraction.category}
                    </span>
                  </div>
                  {!attraction.is_active && (
                    <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">
                      Nieaktywna
                    </span>
                  )}
                </div>

                {attraction.description && (
                  <p className="text-sm text-[#e5e4e2]/60 mb-4 line-clamp-2">
                    {attraction.description}
                  </p>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#e5e4e2]/60">Cena bazowa</span>
                    <span className="text-[#d3bb73] font-medium">
                      {attraction.base_price?.toLocaleString('pl-PL')} zł/{attraction.unit}
                    </span>
                  </div>

                  {attraction.max_daily_capacity && (
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#e5e4e2]/60">Maks. dziennie</span>
                      <span className="text-[#e5e4e2]">{attraction.max_daily_capacity}</span>
                    </div>
                  )}

                  {attraction.duration_hours && (
                    <div className="flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                      <Clock className="w-4 h-4" />
                      <span>{attraction.duration_hours}h</span>
                    </div>
                  )}

                  {attraction.requires_operator && (
                    <div className="flex items-center gap-2 text-sm text-blue-400">
                      <Users className="w-4 h-4" />
                      <span>Wymaga operatora</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 mt-4 pt-4 border-t border-[#d3bb73]/10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/crm/attractions/${attraction.id}`);
                    }}
                    className="flex-1 flex items-center justify-center gap-2 bg-[#d3bb73]/10 text-[#d3bb73] px-3 py-2 rounded-lg text-sm hover:bg-[#d3bb73]/20 transition-colors"
                  >
                    <Edit className="w-4 h-4" />
                    Edytuj
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(attraction.id);
                    }}
                    className="px-3 py-2 text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
