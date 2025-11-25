'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { Check, Star, Edit2, Save, X } from 'lucide-react';

interface DJPackage {
  id: string;
  name: string;
  level: 'Standard' | 'Premium' | 'VIP';
  description: string;
  price_from: number;
  duration: string;
  equipment: any;
  features: string[];
  order_index: number;
}

export default function DJPackagesEditor() {
  const { showSnackbar } = useSnackbar();
  const { canEdit } = useWebsiteEdit();
  const [packages, setPackages] = useState<DJPackage[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<DJPackage>>({});

  useEffect(() => {
    fetchPackages();
  }, []);

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('dj_packages')
        .select('*')
        .eq('is_visible', true)
        .order('order_index');

      if (error) throw error;
      setPackages(data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (pkg: DJPackage) => {
    setEditingId(pkg.id);
    setEditForm({
      name: pkg.name,
      description: pkg.description,
      features: pkg.features,
    });
  };

  const handleSave = async () => {
    if (!editingId) return;

    try {
      const { error } = await supabase
        .from('dj_packages')
        .update({
          name: editForm.name,
          description: editForm.description,
          features: editForm.features,
        })
        .eq('id', editingId);

      if (error) throw error;

      await fetchPackages();
      setEditingId(null);
      setEditForm({});
      showSnackbar('Pakiet zaktualizowany', 'success');
    } catch (error) {
      console.error('Error updating package:', error);
      showSnackbar('Błąd zapisu', 'error');
    }
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleFeatureChange = (index: number, value: string) => {
    const newFeatures = [...(editForm.features || [])];
    newFeatures[index] = value;
    setEditForm({ ...editForm, features: newFeatures });
  };

  const handleAddFeature = () => {
    setEditForm({ ...editForm, features: [...(editForm.features || []), ''] });
  };

  const handleRemoveFeature = (index: number) => {
    const newFeatures = [...(editForm.features || [])];
    newFeatures.splice(index, 1);
    setEditForm({ ...editForm, features: newFeatures });
  };

  if (loading) {
    return <div className="py-24 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <section className="bg-[#0f1119] px-6 py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-16 text-center"
        >
          <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
            Pakiety DJ
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            Wybierz pakiet dopasowany do Twojego eventu
          </p>
        </motion.div>

        <div className="grid gap-8 md:grid-cols-3">
          {packages.map((pkg, index) => (
            <motion.div
              key={pkg.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className={`group relative overflow-hidden rounded-2xl p-8 transition-all duration-300 ${
                pkg.level === 'Premium'
                  ? 'border-2 border-[#d3bb73] bg-gradient-to-br from-[#d3bb73]/10 to-[#1c1f33] shadow-2xl shadow-[#d3bb73]/20'
                  : 'border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33] to-[#1c1f33]/50 hover:border-[#d3bb73]/40'
              }`}
            >
              {pkg.level === 'Premium' && (
                <div className="absolute right-4 top-4">
                  <div className="flex items-center gap-1 rounded-full bg-[#d3bb73] px-3 py-1 text-xs font-medium text-[#1c1f33]">
                    <Star className="h-3 w-3" />
                    Najpopularniejszy
                  </div>
                </div>
              )}

              {canEdit && editingId !== pkg.id && (
                <button
                  onClick={() => handleEdit(pkg)}
                  className="absolute left-4 top-4 rounded-full bg-[#d3bb73]/10 p-2 opacity-0 backdrop-blur-sm transition-opacity hover:bg-[#d3bb73]/20 group-hover:opacity-100"
                >
                  <Edit2 className="h-4 w-4 text-[#d3bb73]" />
                </button>
              )}

              {editingId === pkg.id ? (
                <div className="space-y-4">
                  <input
                    type="text"
                    value={editForm.name || ''}
                    onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Nazwa pakietu"
                  />

                  <div className="mb-4 flex items-baseline gap-2">
                    <span className="text-4xl font-light text-[#d3bb73]">
                      {pkg.price_from?.toLocaleString('pl-PL')}
                    </span>
                    <span className="text-sm text-[#e5e4e2]/60">PLN</span>
                  </div>

                  <p className="mb-4 text-sm font-light text-[#e5e4e2]/70">
                    {pkg.duration}
                  </p>

                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    rows={3}
                    placeholder="Opis pakietu"
                  />

                  <div className="space-y-2">
                    <label className="text-sm font-light text-[#e5e4e2]/70">Cechy pakietu:</label>
                    {(editForm.features || []).map((feature, i) => (
                      <div key={i} className="flex gap-2">
                        <input
                          type="text"
                          value={feature}
                          onChange={(e) => handleFeatureChange(i, e.target.value)}
                          className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                        <button
                          onClick={() => handleRemoveFeature(i)}
                          className="rounded-lg bg-red-500/20 px-3 py-1 text-red-400 hover:bg-red-500/30"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={handleAddFeature}
                      className="text-sm text-[#d3bb73] hover:underline"
                    >
                      + Dodaj cechę
                    </button>
                  </div>

                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      className="flex-1 rounded-full bg-[#d3bb73] py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      <Save className="mx-auto h-4 w-4" />
                    </button>
                    <button
                      onClick={handleCancel}
                      className="flex-1 rounded-full border border-[#d3bb73] py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <X className="mx-auto h-4 w-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <h3 className="mb-2 text-2xl font-light text-[#e5e4e2]">
                      {pkg.name}
                    </h3>
                  </div>

                  <p className="mb-6 font-light leading-relaxed text-[#e5e4e2]/80">
                    {pkg.description}
                  </p>

                  {pkg.features && pkg.features.length > 0 && (
                    <ul className="mb-6 space-y-2">
                      {pkg.features.map((feature: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[#e5e4e2]/70">
                          <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <a
                    href="/#kontakt"
                    className={`inline-block w-full rounded-full py-3 text-center text-sm font-medium transition-colors ${
                      pkg.level === 'Premium'
                        ? 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90'
                        : 'border border-[#d3bb73] text-[#d3bb73] hover:bg-[#d3bb73]/10'
                    }`}
                  >
                    Zapytaj o ofertę
                  </a>
                </>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
