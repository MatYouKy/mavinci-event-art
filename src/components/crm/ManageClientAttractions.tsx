'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Save, Search } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface Attraction {
  id: string;
  name: string;
  category: string;
  base_price: number;
  description: string | null;
}

interface AllowedAttraction {
  id: string;
  attraction_id: string;
  custom_price: number | null;
  notes: string | null;
}

interface Props {
  clientId: string;
  onUpdate: () => void;
}

export default function ManageClientAttractions({ clientId, onUpdate }: Props) {
  const [showModal, setShowModal] = useState(false);
  const [allAttractions, setAllAttractions] = useState<Attraction[]>([]);
  const [assignedAttractions, setAssignedAttractions] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [loading, setLoading] = useState(false);

  const [newAttraction, setNewAttraction] = useState({
    attraction_id: '',
    custom_price: '',
    notes: '',
  });

  useEffect(() => {
    if (showModal) {
      fetchAttractions();
      fetchAssignedAttractions();
    }
  }, [showModal]);

  const fetchAttractions = async () => {
    try {
      const { data, error } = await supabase
        .from('attractions')
        .select('*')
        .eq('is_active', true)
        .order('category')
        .order('name');

      if (error) throw error;
      setAllAttractions(data || []);
    } catch (error) {
      console.error('Error fetching attractions:', error);
    }
  };

  const fetchAssignedAttractions = async () => {
    try {
      const { data, error } = await supabase
        .from('client_allowed_attractions')
        .select('attraction_id')
        .eq('client_id', clientId);

      if (error) throw error;

      const ids = new Set(data?.map((item) => item.attraction_id) || []);
      setAssignedAttractions(ids);
    } catch (error) {
      console.error('Error fetching assigned attractions:', error);
    }
  };

  const handleAddAttraction = async () => {
    if (!newAttraction.attraction_id) {
      alert('Wybierz atrakcję');
      return;
    }

    try {
      setLoading(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { error } = await supabase.from('client_allowed_attractions').insert({
        client_id: clientId,
        attraction_id: newAttraction.attraction_id,
        custom_price: newAttraction.custom_price ? parseFloat(newAttraction.custom_price) : null,
        notes: newAttraction.notes || null,
        created_by: user?.id,
      });

      if (error) throw error;

      setNewAttraction({ attraction_id: '', custom_price: '', notes: '' });
      fetchAssignedAttractions();
      onUpdate();
      alert('Atrakcja została przypisana!');
    } catch (error: any) {
      console.error('Error adding attraction:', error);
      if (error.code === '23505') {
        alert('Ta atrakcja jest już przypisana do tego klienta');
      } else {
        alert('Błąd podczas dodawania atrakcji');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveAttraction = async (attractionId: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę atrakcję?')) return;

    try {
      const { error } = await supabase
        .from('client_allowed_attractions')
        .delete()
        .eq('client_id', clientId)
        .eq('attraction_id', attractionId);

      if (error) throw error;

      fetchAssignedAttractions();
      onUpdate();
      alert('Atrakcja została usunięta!');
    } catch (error) {
      console.error('Error removing attraction:', error);
      alert('Błąd podczas usuwania atrakcji');
    }
  };

  const categories = Array.from(new Set(allAttractions.map((a) => a.category)));

  const filteredAttractions = allAttractions.filter((attraction) => {
    const matchesSearch =
      attraction.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      attraction.description?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = selectedCategory === 'all' || attraction.category === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  if (!showModal) {
    return (
      <button
        onClick={() => setShowModal(true)}
        className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] transition-all hover:bg-[#d3bb73]/90"
      >
        <Plus className="h-5 w-5" />
        Zarządzaj atrakcjami
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 p-6">
          <h2 className="text-2xl font-bold text-[#e5e4e2]">Zarządzaj atrakcjami klienta</h2>
          <button
            onClick={() => setShowModal(false)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
              <h3 className="mb-4 text-lg font-semibold text-[#e5e4e2]">Dodaj nową atrakcję</h3>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Wyszukaj atrakcję
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Szukaj po nazwie..."
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Kategoria
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="all">Wszystkie</option>
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Wybierz atrakcję
                  </label>
                  <select
                    value={newAttraction.attraction_id}
                    onChange={(e) =>
                      setNewAttraction({ ...newAttraction, attraction_id: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="">-- Wybierz atrakcję --</option>
                    {filteredAttractions.map((attraction) => (
                      <option
                        key={attraction.id}
                        value={attraction.id}
                        disabled={assignedAttractions.has(attraction.id)}
                      >
                        {attraction.name} - {attraction.base_price.toLocaleString('pl-PL')} PLN
                        {assignedAttractions.has(attraction.id) ? ' (przypisana)' : ''}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                      Cena custom (opcjonalnie)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newAttraction.custom_price}
                      onChange={(e) =>
                        setNewAttraction({ ...newAttraction, custom_price: e.target.value })
                      }
                      placeholder="Pozostaw puste dla ceny bazowej"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Notatki</label>
                    <input
                      type="text"
                      value={newAttraction.notes}
                      onChange={(e) =>
                        setNewAttraction({ ...newAttraction, notes: e.target.value })
                      }
                      placeholder="Opcjonalne notatki"
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                    />
                  </div>
                </div>

                <button
                  onClick={handleAddAttraction}
                  disabled={loading || !newAttraction.attraction_id}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-all hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-5 w-5" />
                  {loading ? 'Dodawanie...' : 'Dodaj atrakcję'}
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
              <h3 className="mb-4 text-lg font-semibold text-[#e5e4e2]">
                Przypisane atrakcje ({assignedAttractions.size})
              </h3>

              {assignedAttractions.size === 0 ? (
                <p className="py-4 text-center text-[#e5e4e2]/60">Brak przypisanych atrakcji</p>
              ) : (
                <div className="space-y-2">
                  {allAttractions
                    .filter((a) => assignedAttractions.has(a.id))
                    .map((attraction) => (
                      <div
                        key={attraction.id}
                        className="flex items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-3"
                      >
                        <div>
                          <div className="font-medium text-[#e5e4e2]">{attraction.name}</div>
                          <div className="text-sm text-[#e5e4e2]/60">
                            {attraction.category} • {attraction.base_price.toLocaleString('pl-PL')}{' '}
                            PLN
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveAttraction(attraction.id)}
                          className="text-red-400 transition-colors hover:text-red-300"
                        >
                          <X className="h-5 w-5" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="border-t border-[#d3bb73]/20 p-6">
          <button
            onClick={() => setShowModal(false)}
            className="w-full rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-all hover:bg-[#d3bb73]/90"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
