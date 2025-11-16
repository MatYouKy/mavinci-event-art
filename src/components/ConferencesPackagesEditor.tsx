'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Plus, Star, Edit2 } from 'lucide-react';

interface Package {
  id: string;
  package_name: string;
  package_level: 'basic' | 'standard' | 'pro';
  target_audience?: string;
  description?: string;
  price_info?: string;
  features: Record<string, string[]>;
  rating?: number;
  display_order: number;
  is_active: boolean;
}

interface Props {
  packages: Package[];
  onUpdate: () => void;
}

export function ConferencesPackagesEditor({ packages, onUpdate }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editData, setEditData] = useState<Partial<Package>>({});

  const handleStartEdit = (pkg: Package) => {
    setEditingId(pkg.id);
    setEditData(pkg);
  };

  const handleSave = async (id: string) => {
    const { error } = await supabase
      .from('conferences_packages')
      .update(editData)
      .eq('id', id);

    if (!error) {
      setEditingId(null);
      setEditData({});
      onUpdate();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten pakiet?')) return;

    const { error } = await supabase
      .from('conferences_packages')
      .delete()
      .eq('id', id);

    if (!error) {
      onUpdate();
    }
  };

  const renderStars = (rating: number = 1) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3].map((star) => (
          <Star
            key={star}
            className={`w-5 h-5 ${
              star <= rating
                ? 'fill-[#d3bb73] text-[#d3bb73]'
                : 'text-[#d3bb73]/20'
            }`}
          />
        ))}
      </div>
    );
  };

  const renderEditableStars = (rating: number = 1, onChange: (val: number) => void) => {
    return (
      <div className="flex gap-1">
        {[1, 2, 3].map((star) => (
          <button
            key={star}
            type="button"
            onClick={() => onChange(star)}
            className="focus:outline-none transition-transform hover:scale-110"
          >
            <Star
              className={`w-6 h-6 ${
                star <= rating
                  ? 'fill-[#d3bb73] text-[#d3bb73]'
                  : 'text-[#d3bb73]/20 hover:text-[#d3bb73]/50'
              }`}
            />
          </button>
        ))}
      </div>
    );
  };

  return (
    <div className="bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6 mb-8">
      <h3 className="text-[#d3bb73] text-xl font-medium mb-6">Edycja Pakietów</h3>

      <div className="grid md:grid-cols-3 gap-6">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`bg-[#0f1119] border rounded-xl p-6 ${
              pkg.package_level === 'pro'
                ? 'border-[#d3bb73]'
                : 'border-[#d3bb73]/20'
            }`}
          >
            {editingId === pkg.id ? (
              <div className="space-y-4">
                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Nazwa pakietu</label>
                  <input
                    type="text"
                    value={editData.package_name || ''}
                    onChange={(e) => setEditData({ ...editData, package_name: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Poziom</label>
                  <select
                    value={editData.package_level || 'basic'}
                    onChange={(e) => setEditData({ ...editData, package_level: e.target.value as any })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="basic">Basic</option>
                    <option value="standard">Standard</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-2 block">Rating (gwiazdki)</label>
                  {renderEditableStars(editData.rating || 1, (val) =>
                    setEditData({ ...editData, rating: val })
                  )}
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Grupa docelowa</label>
                  <input
                    type="text"
                    value={editData.target_audience || ''}
                    onChange={(e) => setEditData({ ...editData, target_audience: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Cena</label>
                  <input
                    type="text"
                    value={editData.price_info || ''}
                    onChange={(e) => setEditData({ ...editData, price_info: e.target.value })}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="text-[#e5e4e2] text-sm mb-1 block">Opis</label>
                  <textarea
                    value={editData.description || ''}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    rows={3}
                    className="w-full px-3 py-2 bg-[#1c1f33] border border-[#d3bb73]/30 rounded text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none resize-none"
                  />
                </div>

                <div className="flex gap-2 pt-4 border-t border-[#d3bb73]/20">
                  <button
                    onClick={() => handleSave(pkg.id)}
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
                    <h4 className="text-[#d3bb73] text-xl font-medium mb-2">
                      {pkg.package_name}
                    </h4>
                    {renderStars(pkg.rating || 1)}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleStartEdit(pkg)}
                      className="p-2 text-[#d3bb73] hover:bg-[#d3bb73]/10 rounded transition-colors"
                      title="Edytuj"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(pkg.id)}
                      className="p-2 text-red-400 hover:bg-red-400/10 rounded transition-colors"
                      title="Usuń"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <p className="text-[#e5e4e2]/60 text-sm mb-2">{pkg.target_audience}</p>
                <div className="text-[#e5e4e2] text-2xl font-light mb-4">
                  {pkg.price_info}
                </div>
                <p className="text-[#e5e4e2]/80 text-sm">{pkg.description}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
