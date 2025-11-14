'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Package,
  Users,
  DollarSign,
  Clock,
  Sparkles,
  CreditCard as Edit,
  Trash2,
} from 'lucide-react';
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
      const { data, error } = await supabase.from('attractions').select('*').order('name');

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
          attr.description?.toLowerCase().includes(searchQuery.toLowerCase()),
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
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Atrakcje i usługi</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Zarządzaj katalogiem atrakcji, sprzętem i kosztorysami
          </p>
        </div>
        <button
          onClick={() => router.push('/crm/attractions/new')}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj atrakcję
        </button>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <Sparkles className="h-5 w-5 text-[#d3bb73]" />
            <span className="text-2xl font-light text-[#e5e4e2]">{attractions.length}</span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wszystkie atrakcje</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <Package className="h-5 w-5 text-blue-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {attractions.filter((a) => a.is_active).length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Aktywne</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <Users className="h-5 w-5 text-green-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {attractions.filter((a) => a.requires_operator).length}
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Wymaga operatora</p>
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
          <div className="mb-2 flex items-center gap-3">
            <DollarSign className="h-5 w-5 text-yellow-400" />
            <span className="text-2xl font-light text-[#e5e4e2]">
              {attractions.reduce((sum, a) => sum + (a.base_price || 0), 0).toLocaleString('pl-PL')}
              zł
            </span>
          </div>
          <p className="text-sm text-[#e5e4e2]/60">Łączna wartość</p>
        </div>
      </div>

      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="mb-6 flex flex-col gap-4 lg:flex-row">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Szukaj atrakcji..."
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] py-2 pl-10 pr-4 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
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
          <div className="py-12 text-center">
            <Sparkles className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
            <p className="text-[#e5e4e2]/60">
              {searchQuery || selectedCategory !== 'all'
                ? 'Brak atrakcji spełniających kryteria'
                : 'Brak atrakcji'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAttractions.map((attraction) => (
              <div
                key={attraction.id}
                className="cursor-pointer rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-5 transition-colors hover:border-[#d3bb73]/30"
                onClick={() => router.push(`/crm/attractions/${attraction.id}`)}
              >
                <div className="mb-3 flex items-start justify-between">
                  <div className="flex-1">
                    <h3 className="mb-1 text-lg font-medium text-[#e5e4e2]">{attraction.name}</h3>
                    <span className="inline-block rounded bg-[#d3bb73]/20 px-2 py-1 text-xs text-[#d3bb73]">
                      {categoryLabels[attraction.category] || attraction.category}
                    </span>
                  </div>
                  {!attraction.is_active && (
                    <span className="rounded bg-red-500/20 px-2 py-1 text-xs text-red-400">
                      Nieaktywna
                    </span>
                  )}
                </div>

                {attraction.description && (
                  <p className="mb-4 line-clamp-2 text-sm text-[#e5e4e2]/60">
                    {attraction.description}
                  </p>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#e5e4e2]/60">Cena bazowa</span>
                    <span className="font-medium text-[#d3bb73]">
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
                      <Clock className="h-4 w-4" />
                      <span>{attraction.duration_hours}h</span>
                    </div>
                  )}

                  {attraction.requires_operator && (
                    <div className="flex items-center gap-2 text-sm text-blue-400">
                      <Users className="h-4 w-4" />
                      <span>Wymaga operatora</span>
                    </div>
                  )}
                </div>

                <div className="mt-4 flex items-center gap-2 border-t border-[#d3bb73]/10 pt-4">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/crm/attractions/${attraction.id}`);
                    }}
                    className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-3 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                  >
                    <Edit className="h-4 w-4" />
                    Edytuj
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(attraction.id);
                    }}
                    className="rounded-lg px-3 py-2 text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-4 w-4" />
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
