'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import { CreditCard as Edit2, Save, X, Plus, Trash2, Loader2, Wrench } from 'lucide-react';

interface Service {
  id: string;
  title: string;
  description: string;
  icon_id: string | null;
  order_index: number;
}

export default function TechnicalStageServices() {
  const { canEdit } = useWebsiteEdit();
  const { showSnackbar } = useSnackbar();
  const [services, setServices] = useState<Service[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Service>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    fetchServices();

    const channel = supabase
      .channel('tech_services_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'technical_stage_services' },
        () => {
          fetchServices();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchServices = async () => {
    try {
      const { data, error } = await supabase
        .from('technical_stage_services')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setServices(data || []);
    } catch (error) {
      console.error('Error fetching services:', error);
    }
  };

  const handleEdit = (service: Service) => {
    setEditingId(service.id);
    setEditForm({ title: service.title, description: service.description });
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
        .from('technical_stage_services')
        .update({ title: editForm.title, description: editForm.description })
        .eq('id', editingId);

      if (error) throw error;
      await fetchServices();
      setEditingId(null);
      setEditForm({});
      showSnackbar('Usługa zaktualizowana', 'success');
    } catch (error) {
      console.error('Error updating service:', error);
      showSnackbar('Błąd zapisu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę usługę?')) return;
    try {
      const { error } = await supabase
        .from('technical_stage_services')
        .update({ is_visible: false })
        .eq('id', id);

      if (error) throw error;
      await fetchServices();
      showSnackbar('Usługa usunięta', 'success');
    } catch (error) {
      console.error('Error deleting service:', error);
      showSnackbar('Błąd usuwania', 'error');
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const maxOrder = services.length > 0
        ? Math.max(...services.map(s => s.order_index))
        : 0;

      const { error } = await supabase
        .from('technical_stage_services')
        .insert({
          title: 'Nowa usługa',
          description: 'Opis usługi',
          icon_id: null,
          order_index: maxOrder + 1,
          is_visible: true,
        });

      if (error) throw error;
      await fetchServices();
      showSnackbar('Dodano nową usługę', 'success');
    } catch (error) {
      console.error('Error adding service:', error);
      showSnackbar('Błąd dodawania', 'error');
    } finally {
      setAdding(false);
    }
  };

  if (services.length === 0 && !canEdit) return null;

  return (
    <section className="bg-[#0f1119] px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center sm:mb-16"
        >
          <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl">Nasze usługi</h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
          <p className="mx-auto max-w-2xl text-base font-light text-[#e5e4e2]/70 sm:text-lg">
            Profesjonalna technika sceniczna na każdy event
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
              Dodaj usługę
            </button>
          </div>
        )}

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {services.map((service, index) => (
            <motion.div
              key={service.id}
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.1 }}
              className="group relative overflow-hidden rounded-xl bg-gradient-to-br from-[#1c1f33] to-[#1c1f33]/50 p-6 transition-all duration-300 hover:shadow-2xl hover:shadow-[#d3bb73]/10 sm:rounded-2xl sm:p-8"
            >
              <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/10 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100" />

              {canEdit && editingId !== service.id && (
                <div className="absolute right-3 top-3 z-20 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleEdit(service)}
                    className="rounded-full bg-[#d3bb73]/10 p-2 backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
                  >
                    <Edit2 className="h-4 w-4 text-[#d3bb73]" />
                  </button>
                  <button
                    onClick={() => handleDelete(service.id)}
                    className="rounded-full bg-red-500/10 p-2 backdrop-blur-sm transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4 text-red-400" />
                  </button>
                </div>
              )}

              {editingId === service.id ? (
                <div className="relative z-10 space-y-4">
                  <input
                    type="text"
                    value={editForm.title || ''}
                    onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Nazwa usługi"
                  />
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    rows={4}
                    placeholder="Opis usługi"
                  />
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
                <div className="relative z-10">
                  {service.icon_id ? (
                    <div className="mb-4 inline-flex rounded-lg bg-[#d3bb73]/10 p-3 ring-1 ring-[#d3bb73]/20 sm:mb-6 sm:rounded-xl sm:p-4">
                      <CustomIcon iconId={service.icon_id} className="h-8 w-8 text-[#d3bb73] sm:h-10 sm:w-10" />
                    </div>
                  ) : (
                    <div className="mb-4 inline-flex rounded-lg bg-[#d3bb73]/10 p-3 ring-1 ring-[#d3bb73]/20 sm:mb-6 sm:rounded-xl sm:p-4">
                      <Wrench className="h-8 w-8 text-[#d3bb73] sm:h-10 sm:w-10" />
                    </div>
                  )}

                  <h3 className="mb-2 text-lg font-light text-[#e5e4e2] sm:mb-4 sm:text-2xl">{service.title}</h3>

                  <p className="text-sm font-light leading-relaxed text-[#e5e4e2]/70 sm:text-base">
                    {service.description}
                  </p>
                </div>
              )}

              <div className="absolute bottom-0 right-0 h-32 w-32 translate-x-16 translate-y-16 rounded-full bg-[#d3bb73]/5 blur-2xl transition-transform duration-300 group-hover:translate-x-8 group-hover:translate-y-8" />
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
