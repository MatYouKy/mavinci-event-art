'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Package, CreditCard as Edit2, Save, X, Plus, Trash2, Upload, Loader2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';

interface PopularPackage {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  icon_id: string | null;
  order_index: number;
}

export default function TechnicalStagePackages() {
  const { canEdit } = useWebsiteEdit();
  const { showSnackbar } = useSnackbar();
  const [packages, setPackages] = useState<PopularPackage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<PopularPackage>>({});
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchPackages();

    const channel = supabase
      .channel('tech_packages_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'technical_stage_packages' },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            setPackages((prev) =>
              [...prev, payload.new as PopularPackage].sort(
                (a, b) => a.order_index - b.order_index,
              ),
            );
          } else if (payload.eventType === 'UPDATE') {
            setPackages((prev) =>
              prev.map((p) => (p.id === payload.new.id ? (payload.new as PopularPackage) : p)),
            );
          } else if (payload.eventType === 'DELETE') {
            setPackages((prev) => prev.filter((p) => p.id !== payload.old.id));
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('technical_stage_packages')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    }
  };

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % packages.length);
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + packages.length) % packages.length);
  };

  const handleEdit = (pkg: PopularPackage) => {
    setEditingId(pkg.id);
    setEditForm({ title: pkg.title, description: pkg.description, image_url: pkg.image_url });
  };

  const handleCancel = () => {
    setEditingId(null);
    setEditForm({});
  };

  const handleSave = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('technical_stage_packages')
        .update({
          title: editForm.title,
          description: editForm.description,
          image_url: editForm.image_url,
        })
        .eq('id', editingId);

      if (error) throw error;
      await fetchPackages();
      setEditingId(null);
      setEditForm({});
      showSnackbar('Pakiet zaktualizowany', 'success');
    } catch (error) {
      console.error('Error updating package:', error);
      showSnackbar('Błąd zapisu pakietu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć ten pakiet?')) return;
    try {
      const { error } = await supabase
        .from('technical_stage_packages')
        .update({ is_visible: false })
        .eq('id', id);

      if (error) throw error;
      await fetchPackages();
      showSnackbar('Pakiet usunięty', 'success');
    } catch (error) {
      console.error('Error deleting package:', error);
      showSnackbar('Błąd usuwania', 'error');
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const maxOrder = packages.length > 0
        ? Math.max(...packages.map(p => p.order_index))
        : 0;

      const { error } = await supabase
        .from('technical_stage_packages')
        .insert({
          title: 'Nowy pakiet',
          description: 'Opis pakietu',
          image_url: null,
          icon_id: null,
          order_index: maxOrder + 1,
          is_visible: true,
        });

      if (error) throw error;
      await fetchPackages();
      showSnackbar('Dodano nowy pakiet', 'success');
    } catch (error) {
      console.error('Error adding package:', error);
      showSnackbar('Błąd dodawania pakietu', 'error');
    } finally {
      setAdding(false);
    }
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const fileName = `technika-pakiety/${Date.now()}-${file.name}`;
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

  if (packages.length === 0 && !canEdit) return null;

  return (
    <section className="relative overflow-hidden bg-[#0f1119] px-4 py-16 sm:px-6 sm:py-24">
      <div className="absolute left-0 top-1/4 h-96 w-96 rounded-full bg-[#d3bb73]/5 blur-3xl" />
      <div className="absolute bottom-1/4 right-0 h-96 w-96 rounded-full bg-[#800020]/5 blur-3xl" />

      <div className="relative z-10 mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center sm:mb-16"
        >
          <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl">
            Popularne <span className="text-[#d3bb73]">Pakiety</span> Techniczne
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-base font-light text-[#e5e4e2]/70 sm:text-lg">
            Gotowe rozwiązania dla Twojego eventu
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
              Dodaj pakiet
            </button>
          </div>
        )}

        {packages.length === 0 ? (
          <div className="text-center text-[#e5e4e2]/60">
            <Package className="mx-auto mb-4 h-16 w-16 text-[#d3bb73]/40" />
            <p>Brak pakietów do wyświetlenia</p>
          </div>
        ) : (
          <div className="relative">
            <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {packages
                .slice(currentIndex, currentIndex + 3)
                .concat(packages.slice(0, Math.max(0, currentIndex + 3 - packages.length)))
                .map((pkg, i) => (
                  <motion.div
                    key={pkg.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="group relative overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-6 shadow-2xl sm:p-8"
                  >
                    {canEdit && editingId !== pkg.id && (
                      <div className="absolute right-3 top-3 z-20 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => handleEdit(pkg)}
                          className="rounded-full bg-[#d3bb73]/10 p-2 backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
                        >
                          <Edit2 className="h-4 w-4 text-[#d3bb73]" />
                        </button>
                        <button
                          onClick={() => handleDelete(pkg.id)}
                          className="rounded-full bg-red-500/10 p-2 backdrop-blur-sm transition-colors hover:bg-red-500/20"
                        >
                          <Trash2 className="h-4 w-4 text-red-400" />
                        </button>
                      </div>
                    )}

                    {editingId === pkg.id ? (
                      <div className="space-y-4">
                        <input
                          type="text"
                          value={editForm.title || ''}
                          onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          placeholder="Nazwa pakietu"
                        />

                        <textarea
                          value={editForm.description || ''}
                          onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          rows={4}
                          placeholder="Opis pakietu"
                        />

                        <div>
                          <label className="mb-2 block text-xs text-[#e5e4e2]/60">Zdjęcie pakietu</label>
                          {editForm.image_url && (
                            <div className="relative mb-2 aspect-video overflow-hidden rounded-lg">
                              <img src={editForm.image_url} alt="" className="h-full w-full object-cover" />
                              <button
                                onClick={() => setEditForm({ ...editForm, image_url: null })}
                                className="absolute right-2 top-2 rounded-full bg-red-500/80 p-1 text-white"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          )}
                          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-[#d3bb73]/30 bg-[#0f1119] px-4 py-3 text-sm text-[#d3bb73]/70 transition-colors hover:border-[#d3bb73]/50 hover:text-[#d3bb73]">
                            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                            <span>{uploading ? 'Ładowanie...' : 'Wybierz zdjęcie'}</span>
                            <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" disabled={uploading} />
                          </label>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={handleSave}
                            disabled={saving}
                            className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#d3bb73] py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                          >
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                            Zapisz
                          </button>
                          <button
                            onClick={handleCancel}
                            className="flex flex-1 items-center justify-center gap-2 rounded-full border border-[#d3bb73]/40 py-2 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10"
                          >
                            <X className="h-4 w-4" />
                            Anuluj
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {pkg.icon_id ? (
                          <div className="mb-5 inline-flex rounded-xl bg-[#d3bb73]/10 p-3 ring-1 ring-[#d3bb73]/20 sm:mb-6 sm:p-4">
                            <CustomIcon iconId={pkg.icon_id} className="h-10 w-10 text-[#d3bb73] sm:h-12 sm:w-12" />
                          </div>
                        ) : (
                          <div className="mb-5 inline-flex h-16 w-16 items-center justify-center rounded-xl bg-[#d3bb73]/10 ring-1 ring-[#d3bb73]/20 sm:mb-6 sm:h-[80px] sm:w-[80px]">
                            <Package className="h-8 w-8 text-[#d3bb73] sm:h-10 sm:w-10" />
                          </div>
                        )}

                        <h3 className="mb-2 text-xl font-light text-[#e5e4e2] sm:mb-3 sm:text-2xl">{pkg.title}</h3>

                        <p className="mb-4 text-sm font-light leading-relaxed text-[#e5e4e2]/70 sm:mb-6 sm:text-base">
                          {pkg.description}
                        </p>

                        {pkg.image_url && (
                          <div className="aspect-video overflow-hidden rounded-xl">
                            <img
                              src={pkg.image_url}
                              alt={pkg.title}
                              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                            />
                          </div>
                        )}
                      </>
                    )}
                  </motion.div>
                ))}
            </div>

            {packages.length > 3 && (
              <>
                <button
                  onClick={prevSlide}
                  className="absolute -left-2 top-1/2 z-30 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-3 text-[#d3bb73] backdrop-blur-sm transition-all hover:bg-[#d3bb73]/20 sm:p-4 md:-left-12 lg:-left-20"
                >
                  <ChevronLeft className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>

                <button
                  onClick={nextSlide}
                  className="absolute -right-2 top-1/2 z-30 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-3 text-[#d3bb73] backdrop-blur-sm transition-all hover:bg-[#d3bb73]/20 sm:p-4 md:-right-12 lg:-right-20"
                >
                  <ChevronRight className="h-5 w-5 sm:h-6 sm:w-6" />
                </button>

                <div className="mt-8 flex justify-center gap-2 sm:mt-12">
                  {packages.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setCurrentIndex(index)}
                      className={`h-2 rounded-full transition-all ${
                        index === currentIndex
                          ? 'w-8 bg-[#d3bb73]'
                          : 'w-2 bg-[#d3bb73]/30 hover:bg-[#d3bb73]/50'
                      }`}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
