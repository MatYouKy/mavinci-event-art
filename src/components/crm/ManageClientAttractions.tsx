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

      const ids = new Set(data?.map(item => item.attraction_id) || []);
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

      const { data: { user } } = await supabase.auth.getUser();

      const { error } = await supabase
        .from('client_allowed_attractions')
        .insert({
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

  const categories = Array.from(new Set(allAttractions.map(a => a.category)));

  const filteredAttractions = allAttractions.filter(attraction => {
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
        className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all"
      >
        <Plus className="w-5 h-5" />
        Zarządzaj atrakcjami
      </button>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/20">
          <h2 className="text-2xl font-bold text-[#e5e4e2]">Zarządzaj atrakcjami klienta</h2>
          <button
            onClick={() => setShowModal(false)}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 overflow-y-auto flex-1">
          <div className="space-y-6">
            <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-4">
              <h3 className="text-lg font-semibold text-[#e5e4e2] mb-4">Dodaj nową atrakcję</h3>

              <div className="space-y-4">
                <div className="flex gap-4">
                  <div className="flex-1">
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Wyszukaj atrakcję
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
                      <input
                        type="text"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Szukaj po nazwie..."
                        className="w-full pl-10 pr-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Kategoria
                    </label>
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                    >
                      <option value="all">Wszystkie</option>
                      {categories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                    Wybierz atrakcję
                  </label>
                  <select
                    value={newAttraction.attraction_id}
                    onChange={(e) => setNewAttraction({ ...newAttraction, attraction_id: e.target.value })}
                    className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  >
                    <option value="">-- Wybierz atrakcję --</option>
                    {filteredAttractions.map(attraction => (
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
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Cena custom (opcjonalnie)
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      value={newAttraction.custom_price}
                      onChange={(e) => setNewAttraction({ ...newAttraction, custom_price: e.target.value })}
                      placeholder="Pozostaw puste dla ceny bazowej"
                      className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                      Notatki
                    </label>
                    <input
                      type="text"
                      value={newAttraction.notes}
                      onChange={(e) => setNewAttraction({ ...newAttraction, notes: e.target.value })}
                      placeholder="Opcjonalne notatki"
                      className="w-full px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                </div>

                <button
                  onClick={handleAddAttraction}
                  disabled={loading || !newAttraction.attraction_id}
                  className="w-full flex items-center justify-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Plus className="w-5 h-5" />
                  {loading ? 'Dodawanie...' : 'Dodaj atrakcję'}
                </button>
              </div>
            </div>

            <div className="bg-[#0f1119] rounded-lg border border-[#d3bb73]/10 p-4">
              <h3 className="text-lg font-semibold text-[#e5e4e2] mb-4">
                Przypisane atrakcje ({assignedAttractions.size})
              </h3>

              {assignedAttractions.size === 0 ? (
                <p className="text-[#e5e4e2]/60 text-center py-4">
                  Brak przypisanych atrakcji
                </p>
              ) : (
                <div className="space-y-2">
                  {allAttractions
                    .filter(a => assignedAttractions.has(a.id))
                    .map(attraction => (
                      <div
                        key={attraction.id}
                        className="flex items-center justify-between p-3 bg-[#1c1f33] border border-[#d3bb73]/10 rounded-lg"
                      >
                        <div>
                          <div className="text-[#e5e4e2] font-medium">{attraction.name}</div>
                          <div className="text-sm text-[#e5e4e2]/60">
                            {attraction.category} • {attraction.base_price.toLocaleString('pl-PL')} PLN
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveAttraction(attraction.id)}
                          className="text-red-400 hover:text-red-300 transition-colors"
                        >
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-[#d3bb73]/20">
          <button
            onClick={() => setShowModal(false)}
            className="w-full px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
