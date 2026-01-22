'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
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
    const { error } = await supabase.from('conferences_packages').update(editData).eq('id', id);

    if (!error) {
      setEditingId(null);
      setEditData({});
      onUpdate();
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten pakiet?')) return;

    const { error } = await supabase.from('conferences_packages').delete().eq('id', id);

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
            className={`h-5 w-5 ${
              star <= rating ? 'fill-[#d3bb73] text-[#d3bb73]' : 'text-[#d3bb73]/20'
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
            className="transition-transform hover:scale-110 focus:outline-none"
          >
            <Star
              className={`h-6 w-6 ${
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
    <div className="mb-8 rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6">
      <h3 className="mb-6 text-xl font-medium text-[#d3bb73]">Edycja Pakietów</h3>

      <div className="grid gap-6 md:grid-cols-3">
        {packages.map((pkg) => (
          <div
            key={pkg.id}
            className={`rounded-xl border bg-[#0f1119] p-6 ${
              pkg.package_level === 'pro' ? 'border-[#d3bb73]' : 'border-[#d3bb73]/20'
            }`}
          >
            {editingId === pkg.id ? (
              <div className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Nazwa pakietu</label>
                  <input
                    type="text"
                    value={editData.package_name || ''}
                    onChange={(e) => setEditData({ ...editData, package_name: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Poziom</label>
                  <select
                    value={editData.package_level || 'basic'}
                    onChange={(e) =>
                      setEditData({ ...editData, package_level: e.target.value as any })
                    }
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  >
                    <option value="basic">Basic</option>
                    <option value="standard">Standard</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]">Rating (gwiazdki)</label>
                  {renderEditableStars(editData.rating || 1, (val) =>
                    setEditData({ ...editData, rating: val }),
                  )}
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Grupa docelowa</label>
                  <input
                    type="text"
                    value={editData.target_audience || ''}
                    onChange={(e) => setEditData({ ...editData, target_audience: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Cena</label>
                  <input
                    type="text"
                    value={editData.price_info || ''}
                    onChange={(e) => setEditData({ ...editData, price_info: e.target.value })}
                    className="w-full rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-1 block text-sm text-[#e5e4e2]">Opis</label>
                  <textarea
                    value={editData.description || ''}
                    onChange={(e) => setEditData({ ...editData, description: e.target.value })}
                    rows={3}
                    className="w-full resize-none rounded border border-[#d3bb73]/30 bg-[#1c1f33] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div className="flex gap-2 border-t border-[#d3bb73]/20 pt-4">
                  <button
                    onClick={() => handleSave(pkg.id)}
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
                    <h4 className="mb-2 text-xl font-medium text-[#d3bb73]">{pkg.package_name}</h4>
                    {renderStars(pkg.rating || 1)}
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleStartEdit(pkg)}
                      className="rounded p-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                      title="Edytuj"
                    >
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => handleDelete(pkg.id)}
                      className="rounded p-2 text-red-400 transition-colors hover:bg-red-400/10"
                      title="Usuń"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <p className="mb-2 text-sm text-[#e5e4e2]/60">{pkg.target_audience}</p>
                <div className="mb-4 text-2xl font-light text-[#e5e4e2]">{pkg.price_info}</div>
                <p className="text-sm text-[#e5e4e2]/80">{pkg.description}</p>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
