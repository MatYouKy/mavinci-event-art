'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Plus, Edit2, DollarSign } from 'lucide-react';

interface PricingTier {
  id: string;
  tier_name: string;
  tier_description: string;
  price_range: string;
  attendees_range: string;
  whats_included: string[];
  display_order: number;
  is_active: boolean;
}

interface Props {
  pricing: PricingTier[];
  onUpdate: () => void;
}

export function ConferencesPricingEditor({ pricing, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<PricingTier>>({});
  const [newFeature, setNewFeature] = useState('');

  const handleStartEdit = (tier: PricingTier) => {
    setEditingId(tier.id);
    setEditData(tier);
  };

  const handleSave = async (id: string) => {
    const { error } = await supabase
      .from('conferences_pricing')
      .update(editData)
      .eq('id', id);

    if (!error) {
      setEditingId(null);
      setEditData({});
      onUpdate();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten poziom cenowy?')) return;

    const { error } = await supabase
      .from('conferences_pricing')
      .delete()
      .eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const handleAddTier = async () => {
    const { error } = await supabase
      .from('conferences_pricing')
      .insert({
        tier_name: 'Nowy poziom',
        tier_description: 'Opis poziomu cenowego',
        price_range: '0 - 0 zł',
        attendees_range: '0 osób',
        whats_included: ['Usługa 1', 'Usługa 2'],
        display_order: pricing.length,
        is_active: true
      });

    if (!error) {
      onUpdate();
    }
  };

  const addFeature = () => {
    if (!newFeature.trim() || !editData.whats_included) return;
    setEditData({
      ...editData,
      whats_included: [...editData.whats_included, newFeature.trim()]
    });
    setNewFeature('');
  };

  const removeFeature = (index: number) => {
    if (!editData.whats_included) return;
    setEditData({
      ...editData,
      whats_included: editData.whats_included.filter((_, i) => i !== index)
    });
  };

  return (
    <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-[#d3bb73] text-xl font-medium">Edycja Orientacyjnych Cen</h3>
        <button
          onClick={handleAddTier}
          className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Dodaj poziom
        </button>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {pricing.map((tier) => (
          <div
            key={tier.id}
            className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6"
          >
            {editingId === tier.id ? (
              <div className="space-y-4">
                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Nazwa poziomu</label>
                  <input
                    type="text"
                    value={editData.tier_name || ''}
                    onChange={(e) => setEditData({ ...editData, tier_name: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Zakres cen</label>
                  <input
                    type="text"
                    value={editData.price_range || ''}
                    onChange={(e) => setEditData({ ...editData, price_range: e.target.value })}
                    placeholder="2500 - 5000 zł"
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Liczba uczestników</label>
                  <input
                    type="text"
                    value={editData.attendees_range || ''}
                    onChange={(e) => setEditData({ ...editData, attendees_range: e.target.value })}
                    placeholder="Do 50 osób"
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Opis</label>
                  <textarea
                    value={editData.tier_description || ''}
                    onChange={(e) => setEditData({ ...editData, tier_description: e.target.value })}
                    rows={2}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none resize-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-2 block">Co zawiera</label>
                  <div className="space-y-2 mb-2">
                    {editData.whats_included?.map((item, idx) => (
                      <div key={idx} className="flex items-center gap-2 bg-[#1c1f33] rounded px-2 py-1">
                        <span className="text-[#e5e4e2] text-xs flex-1">{item}</span>
                        <button
                          onClick={() => removeFeature(idx)}
                          className="p-1 text-red-400 hover:bg-red-400/10 rounded"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newFeature}
                      onChange={(e) => setNewFeature(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && addFeature()}
                      placeholder="Nowa usługa..."
                      className="flex-1 px-2 py-1 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] text-xs focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={addFeature}
                      className="px-3 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs hover:bg-[#d3bb73]/30"
                    >
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-4 border-t border-[#d3bb73]/20">
                  <button
                    onClick={() => handleSave(tier.id)}
                    className="flex-1 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm font-medium"
                  >
                    Zapisz
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditData({});
                    }}
                    className="flex-1 px-4 py-2 bg-[#1c1f33] text-[#e5e4e2] border border-[#d3bb73]/30 rounded-lg hover:border-[#d3bb73] transition-colors text-sm"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <DollarSign className="w-5 h-5 text-[#d3bb73]" />
                      <h4 className="text-[#d3bb73] text-lg font-medium">{tier.tier_name}</h4>
                    </div>
                    <p className="text-[#e5e4e2] text-2xl font-light mb-2">{tier.price_range}</p>
                    <p className="text-[#e5e4e2]/60 text-sm">{tier.attendees_range}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleStartEdit(tier)}
                      className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                      title="Edytuj"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(tier.id)}
                      className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Usuń"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-[#e5e4e2]/70 text-sm mb-4">{tier.tier_description}</p>

                <div className="space-y-2">
                  {tier.whats_included.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[#e5e4e2]/70 text-sm">
                      <span className="text-[#d3bb73] mt-0.5">✓</span>
                      <span>{item}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
