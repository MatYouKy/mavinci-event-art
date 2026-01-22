'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
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
    const { error } = await supabase.from('conferences_pricing').update(editData).eq('id', id);

    if (!error) {
      setEditingId(null);
      setEditData({});
      onUpdate();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten poziom cenowy?')) return;

    const { error } = await supabase.from('conferences_pricing').delete().eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const handleAddTier = async () => {
    const { error } = await supabase.from('conferences_pricing').insert({
      tier_name: 'Nowy poziom',
      tier_description: 'Opis poziomu cenowego',
      price_range: '0 - 0 zł',
      attendees_range: '0 osób',
      whats_included: ['Usługa 1', 'Usługa 2'],
      display_order: pricing.length,
      is_active: true,
    });

    if (!error) {
      onUpdate();
    }
  };

  const addFeature = () => {
    if (!newFeature.trim() || !editData.whats_included) return;
    setEditData({
      ...editData,
      whats_included: [...editData.whats_included, newFeature.trim()],
    });
    setNewFeature('');
  };

  const removeFeature = (index: number) => {
    if (!editData.whats_included) return;
    setEditData({
      ...editData,
      whats_included: editData.whats_included.filter((_, i) => i !== index),
    });
  };

  return (
    <div className="mb-8 rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6">
      <div className="mb-6 flex items-center justify-between">
        <h3 className="text-xl font-medium text-[#d3bb73]">Edycja Orientacyjnych Cen</h3>
        <button
          onClick={handleAddTier}
          className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
        >
          <Plus className="h-4 w-4" />
          Dodaj poziom
        </button>
      </div>

      <div className="grid gap-6 md:grid-cols-3">
        {pricing.map((tier) => (
          <div key={tier.id} className="rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
            {editingId === tier.id ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Nazwa poziomu</label>
                  <input
                    type="text"
                    value={editData.tier_name || ''}
                    onChange={(e) => setEditData({ ...editData, tier_name: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Zakres cen</label>
                  <input
                    type="text"
                    value={editData.price_range || ''}
                    onChange={(e) => setEditData({ ...editData, price_range: e.target.value })}
                    placeholder="2500 - 5000 zł"
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Liczba uczestników</label>
                  <input
                    type="text"
                    value={editData.attendees_range || ''}
                    onChange={(e) => setEditData({ ...editData, attendees_range: e.target.value })}
                    placeholder="Do 50 osób"
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Opis</label>
                  <textarea
                    value={editData.tier_description || ''}
                    onChange={(e) => setEditData({ ...editData, tier_description: e.target.value })}
                    rows={2}
                    className="w-full resize-none rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]">Co zawiera</label>
                  <div className="mb-2 space-y-2">
                    {editData.whats_included?.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center gap-2 rounded bg-[#1c1f33] px-2 py-1"
                      >
                        <span className="flex-1 text-xs text-[#e5e4e2]">{item}</span>
                        <button
                          onClick={() => removeFeature(idx)}
                          className="rounded p-1 text-red-400 hover:bg-red-400/10"
                        >
                          <X className="h-3 w-3" />
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
                      className="flex-1 rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-2 py-1 text-xs text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={addFeature}
                      className="rounded bg-[#d3bb73]/20 px-3 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/30"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 border-t border-[#d3bb73]/20 pt-4">
                  <button
                    onClick={() => handleSave(tier.id)}
                    className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                  >
                    Zapisz
                  </button>
                  <button
                    onClick={() => {
                      setEditingId(null);
                      setEditData({});
                    }}
                    className="flex-1 rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:border-[#d3bb73]"
                  >
                    Anuluj
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="mb-4 flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-2 flex items-center gap-2">
                      <DollarSign className="h-5 w-5 text-[#d3bb73]" />
                      <h4 className="text-lg font-medium text-[#d3bb73]">{tier.tier_name}</h4>
                    </div>
                    <p className="mb-2 text-2xl font-light text-[#e5e4e2]">{tier.price_range}</p>
                    <p className="text-sm text-[#e5e4e2]/60">{tier.attendees_range}</p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleStartEdit(tier)}
                      className="rounded p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      title="Edytuj"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(tier.id)}
                      className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                      title="Usuń"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="mb-4 text-sm text-[#e5e4e2]/70">{tier.tier_description}</p>

                <div className="space-y-2">
                  {tier.whats_included.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-sm text-[#e5e4e2]/70">
                      <span className="mt-0.5 text-[#d3bb73]">✓</span>
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
