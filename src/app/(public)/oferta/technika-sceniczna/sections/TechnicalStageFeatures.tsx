'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import { CreditCard as Edit2, Save, X, Plus, Trash2, Upload, Loader2, Zap } from 'lucide-react';

interface Feature {
  id: string;
  title: string;
  description: string;
  icon_id: string | null;
  image_url?: string | null;
  order_index: number;
}

export default function TechnicalStageFeatures() {
  const { canEdit } = useWebsiteEdit();
  const { showSnackbar } = useSnackbar();
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Feature>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchFeatures();

    const channel = supabase
      .channel('tech_features_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'technical_stage_features' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setFeatures((prev) =>
              [...prev, payload.new as Feature].sort((a, b) => a.order_index - b.order_index),
            );
          } else if (payload.eventType === 'UPDATE') {
            setFeatures((prev) =>
              prev.map((f) => (f.id === payload.new.id ? (payload.new as Feature) : f)),
            );
          } else if (payload.eventType === 'DELETE') {
            setFeatures((prev) => prev.filter((f) => f.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchFeatures = async () => {
    try {
      const { data, error } = await supabase
        .from('technical_stage_features')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setFeatures(data || []);
    } catch (error) {
      console.error('Error fetching features:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleEdit = (feature: Feature) => {
    setEditingId(feature.id);
    setEditForm({
      title: feature.title,
      description: feature.description,
      image_url: feature.image_url,
    });
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const updateData: Record<string, unknown> = {
        title: editForm.title,
        description: editForm.description,
      };
      if (editForm.image_url !== undefined) {
        updateData.image_url = editForm.image_url;
      }

      const { error } = await supabase
        .from('technical_stage_features')
        .update(updateData)
        .eq('id', editingId);

      if (error) throw error;
      await fetchFeatures();
      setEditingId(null);
      setEditForm({});
      showSnackbar('Zapisano zmiany', 'success');
    } catch (error) {
      console.error('Error updating feature:', error);
      showSnackbar('Błąd zapisu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten element?')) return;
    try {
      const { error } = await supabase
        .from('technical_stage_features')
        .update({ is_visible: false })
        .eq('id', id);

      if (error) throw error;
      await fetchFeatures();
      showSnackbar('Element usunięty', 'success');
    } catch (error) {
      console.error('Error deleting feature:', error);
      showSnackbar('Błąd usuwania', 'error');
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const maxOrder = features.length > 0
        ? Math.max(...features.map(f => f.order_index))
        : 0;

      const { error } = await supabase
        .from('technical_stage_features')
        .insert({
          title: 'Nowa funkcja',
          description: 'Opis funkcji',
          icon_id: null,
          order_index: maxOrder + 1,
          is_visible: true,
        });

      if (error) throw error;
      await fetchFeatures();
      showSnackbar('Dodano nowy element', 'success');
    } catch (error) {
      console.error('Error adding feature:', error);
      showSnackbar('Błąd dodawania', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileName = `technika-features/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('site-images')
        .upload(fileName, file, { contentType: file.type });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('site-images').getPublicUrl(uploadData.path);
      setEditForm({ ...editForm, image_url: urlData.publicUrl });
      showSnackbar('Zdjęcie załadowane', 'success');
    } catch (error) {
      console.error('Error uploading image:', error);
      showSnackbar('Błąd ładowania zdjęcia', 'error');
    } finally {
      setUploading(false);
    }
  };

  if (loading) {
    return <div className="py-24 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  return (
    <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center sm:mb-16"
        >
          <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl">Co oferujemy?</h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-base font-light text-[#e5e4e2]/70 sm:text-lg">
            Kompleksowe rozwiązania techniczne dla Twojego eventu
          </p>
        </motion.div>

        {canEdit && (
          <div className="mb-8 flex justify-center">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:opacity-50"
            >
              {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Dodaj element
            </button>
          </div>
        )}

        {features.length > 1 && (
          <div className="mb-8 sm:mb-12">
            <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 sm:mx-0 sm:flex-wrap sm:justify-center sm:gap-2 sm:px-0">
              {features.map((feature, idx) => (
                <button
                  key={feature.id}
                  onClick={() => setActiveTab(idx)}
                  className={`flex-shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-all sm:px-5 sm:py-2.5 sm:text-sm ${
                    activeTab === idx
                      ? 'bg-[#d3bb73] text-[#0f1119] shadow-lg shadow-[#d3bb73]/20'
                      : 'border border-[#d3bb73]/20 bg-[#0f1119]/50 text-[#e5e4e2]/70 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]'
                  }`}
                >
                  {feature.title}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence mode="wait">
          {features.length > 0 && features[activeTab] && (
            <motion.div
              key={features[activeTab].id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className="mb-12"
            >
              {editingId === features[activeTab].id ? (
                <div className="mx-auto max-w-2xl space-y-4 rounded-2xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
                  <input
                    type="text"
                    value={editForm.title || ''}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-3 text-lg text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Tytuł"
                  />
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-3 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    rows={5}
                    placeholder="Opis szczegółowy"
                  />

                  <div>
                    <label className="mb-2 block text-xs text-[#e5e4e2]/60">Zdjęcie</label>
                    {editForm.image_url && (
                      <div className="relative mb-3 aspect-video max-w-sm overflow-hidden rounded-lg">
                        <img src={editForm.image_url} alt="" className="h-full w-full object-cover" />
                        <button
                          onClick={() => setEditForm({ ...editForm, image_url: null })}
                          className="absolute right-2 top-2 rounded-full bg-red-500/80 p-1 text-white"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-3 text-sm text-[#d3bb73]/70 transition-colors hover:border-[#d3bb73]/50">
                      {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                      <span>{uploading ? 'Ładowanie...' : 'Dodaj zdjęcie'}</span>
                      <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploading} />
                    </label>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#d3bb73] py-2.5 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Zapisz
                    </button>
                    <button
                      onClick={handleCancel}
                      className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[#d3bb73]/40 py-2.5 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                    >
                      <X className="h-4 w-4" />
                      Anuluj
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mx-auto max-w-4xl">
                  <div className="relative overflow-hidden rounded-2xl border border-[#d3bb73]/10 bg-[#0f1119]/80 p-6 sm:p-10">
                    {canEdit && (
                      <div className="absolute right-4 top-4 z-20 flex gap-2">
                        <button
                          onClick={() => handleEdit(features[activeTab])}
                          className="rounded-full bg-[#d3bb73]/10 p-2 backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
                        >
                          <Edit2 className="h-4 w-4 text-[#d3bb73]" />
                        </button>
                        <button
                          onClick={() => handleDelete(features[activeTab].id)}
                          className="rounded-full bg-red-500/10 p-2 backdrop-blur-sm transition-colors hover:bg-red-500/20"
                        >
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </button>
                      </div>
                    )}

                    <div className="flex flex-col gap-6 sm:flex-row sm:gap-10">
                      <div className="flex-1">
                        <div className="mb-4 inline-flex items-center justify-center rounded-xl bg-[#d3bb73]/10 p-3 text-[#d3bb73] ring-1 ring-[#d3bb73]/20 sm:p-4">
                          {features[activeTab].icon_id ? (
                            <CustomIcon iconId={features[activeTab].icon_id!} className="h-7 w-7 sm:h-8 sm:w-8" />
                          ) : (
                            <Zap className="h-7 w-7 sm:h-8 sm:w-8" />
                          )}
                        </div>

                        <h3 className="mb-3 text-xl font-light text-[#e5e4e2] sm:mb-4 sm:text-2xl">
                          {features[activeTab].title}
                        </h3>

                        <p className="text-sm leading-relaxed text-[#e5e4e2]/70 sm:text-base">
                          {features[activeTab].description}
                        </p>
                      </div>

                      {features[activeTab].image_url && (
                        <div className="flex-shrink-0 sm:w-64 md:w-80">
                          <div className="aspect-[4/3] overflow-hidden rounded-xl">
                            <img
                              src={features[activeTab].image_url!}
                              alt={features[activeTab].title}
                              className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid gap-3 sm:gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => (
            <motion.div
              key={feature.id}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.05 }}
              onClick={() => setActiveTab(index)}
              className={`group relative cursor-pointer overflow-hidden rounded-xl border p-4 backdrop-blur-sm transition-all duration-300 sm:rounded-2xl sm:p-6 ${
                activeTab === index
                  ? 'border-[#d3bb73]/40 bg-[#d3bb73]/5 shadow-xl shadow-[#d3bb73]/10'
                  : 'border-[#d3bb73]/10 bg-[#0f1119]/50 hover:border-[#d3bb73]/30 hover:shadow-lg hover:shadow-[#d3bb73]/5'
              }`}
            >
              <div className="relative z-10">
                {feature.icon_id && (
                  <div className="mb-3 inline-flex items-center justify-center rounded-lg bg-[#d3bb73]/10 p-2.5 text-[#d3bb73] ring-1 ring-[#d3bb73]/20 transition-transform duration-300 group-hover:scale-110 sm:mb-4 sm:rounded-xl sm:p-3">
                    <CustomIcon iconId={feature.icon_id} className="h-5 w-5 sm:h-6 sm:w-6" />
                  </div>
                )}

                {feature.image_url && (
                  <div className="mb-3 aspect-[3/2] overflow-hidden rounded-lg sm:mb-4">
                    <img
                      src={feature.image_url}
                      alt={feature.title}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                )}

                <h3 className="mb-1.5 text-sm font-medium text-[#e5e4e2] sm:mb-2 sm:text-base">
                  {feature.title}
                </h3>

                <p className="line-clamp-2 text-xs leading-relaxed text-[#e5e4e2]/60 sm:text-sm">
                  {feature.description}
                </p>
              </div>

              <div className={`absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-[#d3bb73] to-[#c5a960] transition-all duration-300 ${
                activeTab === index ? 'w-full' : 'w-0 group-hover:w-full'
              }`} />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
