'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { CheckCircle, CreditCard as Edit2, Save, X, Plus, Trash2, Loader2 } from 'lucide-react';
import { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

interface Benefit {
  id: string;
  title: string;
  description: string;
  order_index: number;
  city_slug: string | null;
}

const defaultBenefits: Omit<Benefit, 'id'>[] = [
  {
    title: 'Własny park sprzętowy',
    description:
      'Nie pośredniczymy - posiadamy własny sprzęt najwyższej klasy. Gwarancja dostępności, serwis techniczny i pełna kontrola jakości.',
    order_index: 1,
    city_slug: null,
  },
  {
    title: 'Certyfikowani technicy',
    description:
      'Zespół z uprawnieniami UDT, certyfikatami producentów (L-Acoustics, MA Lighting, Robe) i wieloletnim doświadczeniem w realizacjach live.',
    order_index: 2,
    city_slug: null,
  },
  {
    title: 'Kompleksowa obsługa',
    description:
      'Od projektu technicznego i rideru, przez logistykę i montaż, po realizację i demontaż. Jeden wykonawca - pełna odpowiedzialność.',
    order_index: 3,
    city_slug: null,
  },
  {
    title: 'Realizacje 50–50 000 osób',
    description:
      'Skalowalne rozwiązania dla eventów kameralnych, konferencji korporacyjnych i wielkich festiwali. Dobieramy sprzęt do potrzeb i budżetu.',
    order_index: 4,
    city_slug: null,
  },
  {
    title: 'Redundancja i bezpieczeństwo',
    description:
      'Backup kluczowych systemów, UPS, zapasowe procesory i konsolety. Pełna dokumentacja techniczna i ubezpieczenie OC.',
    order_index: 5,
    city_slug: null,
  },
  {
    title: 'Wsparcie 24/7',
    description:
      'Kierownik techniczny dostępny przez cały czas trwania eventu. Serwis na miejscu, zapasowy sprzęt w magazynie mobilnym.',
    order_index: 6,
    city_slug: null,
  },
];

type Props = {
  cityCases?: PolishCityCases | null;
  content?: any;
};

export default function TechStageCityBenefits({ cityCases, content }: Props) {
  const { canEdit } = useWebsiteEdit();
  const { showSnackbar } = useSnackbar();
  const [benefits, setBenefits] = useState<Benefit[]>([]);
  const [usingDefaults, setUsingDefaults] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Benefit>>({});
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);

  const citySlug = cityCases?.nominative?.toLowerCase() || null;

  useEffect(() => {
    fetchBenefits();

    const channel = supabase
      .channel('techstage_benefits_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'techstage_benefits' },
        () => {
          fetchBenefits();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [citySlug]);

  const fetchBenefits = async () => {
    try {
      const { data, error } = await supabase
        .from('techstage_benefits')
        .select('*')
        .eq('is_visible', true)
        .or(`city_slug.is.null,city_slug.eq.${citySlug}`)
        .order('order_index', { ascending: true });

      if (error) throw error;

      if (data && data.length > 0) {
        setBenefits(data);
        setUsingDefaults(false);
      } else {
        setBenefits(
          defaultBenefits.map((b, idx) => ({ ...b, id: `default-${idx}` })) as Benefit[],
        );
        setUsingDefaults(true);
      }
    } catch {
      setBenefits(
        defaultBenefits.map((b, idx) => ({ ...b, id: `default-${idx}` })) as Benefit[],
      );
      setUsingDefaults(true);
    }
  };

  const handleEdit = (benefit: Benefit) => {
    setEditingId(benefit.id);
    setEditForm({ title: benefit.title, description: benefit.description });
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
        .from('techstage_benefits')
        .update({ title: editForm.title, description: editForm.description })
        .eq('id', editingId);

      if (error) throw error;
      await fetchBenefits();
      setEditingId(null);
      setEditForm({});
      showSnackbar('Korzyść zaktualizowana', 'success');
    } catch (error) {
      console.error('Error updating benefit:', error);
      showSnackbar('Błąd zapisu', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć tę korzyść?')) return;
    try {
      const { error } = await supabase
        .from('techstage_benefits')
        .update({ is_visible: false })
        .eq('id', id);

      if (error) throw error;
      await fetchBenefits();
      showSnackbar('Korzyść usunięta', 'success');
    } catch (error) {
      console.error('Error deleting benefit:', error);
      showSnackbar('Błąd usuwania', 'error');
    }
  };

  const handleAdd = async () => {
    setAdding(true);
    try {
      const maxOrder =
        benefits.length > 0
          ? Math.max(...benefits.map((b) => b.order_index))
          : 0;

      const { error } = await supabase.from('techstage_benefits').insert({
        title: 'Nowa korzyść',
        description: 'Opis korzyści',
        city_slug: citySlug,
        order_index: maxOrder + 1,
        is_visible: true,
      });

      if (error) throw error;
      await fetchBenefits();
      showSnackbar('Dodano nową korzyść', 'success');
    } catch (error) {
      console.error('Error adding benefit:', error);
      showSnackbar('Błąd dodawania', 'error');
    } finally {
      setAdding(false);
    }
  };

  const hasCity = !!cityCases;

  const heading =
    content?.benefits_heading ||
    (hasCity
      ? `Dlaczego warto wybrać nas ${cityCases!.locative_preposition || 'w'} ${capitalize(cityCases!.locative)}`
      : 'Dlaczego warto wybrać nas');

  return (
    <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-7xl">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="mb-10 text-center sm:mb-12"
        >
          <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
            {heading}
          </h2>
          <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
        </motion.div>

        {canEdit && !usingDefaults && (
          <div className="mb-8 flex justify-center">
            <button
              onClick={handleAdd}
              disabled={adding}
              className="flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Plus className="h-4 w-4" />
              )}
              Dodaj korzyść
            </button>
          </div>
        )}

        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {benefits.map((benefit, index) => (
            <motion.div
              key={benefit.id}
              initial={{ opacity: 0, y: 15 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: index * 0.08 }}
              className="group relative rounded-xl p-4 transition-all duration-300 hover:bg-[#1c1f33]/50 sm:p-5"
            >
              {canEdit && !usingDefaults && editingId !== benefit.id && (
                <div className="absolute right-2 top-2 z-20 flex gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    onClick={() => handleEdit(benefit)}
                    className="rounded-full bg-[#d3bb73]/10 p-2 backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
                  >
                    <Edit2 className="h-3.5 w-3.5 text-[#d3bb73]" />
                  </button>
                  <button
                    onClick={() => handleDelete(benefit.id)}
                    className="rounded-full bg-red-500/10 p-2 backdrop-blur-sm transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </button>
                </div>
              )}

              {editingId === benefit.id ? (
                <div className="space-y-3">
                  <input
                    type="text"
                    value={editForm.title || ''}
                    onChange={(e) =>
                      setEditForm({ ...editForm, title: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    placeholder="Tytuł"
                  />
                  <textarea
                    value={editForm.description || ''}
                    onChange={(e) =>
                      setEditForm({ ...editForm, description: e.target.value })
                    }
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    rows={3}
                    placeholder="Opis"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex flex-1 items-center justify-center gap-2 rounded-full bg-[#d3bb73] py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="h-4 w-4" />
                      )}
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
                <div className="flex gap-4">
                  <div className="flex-shrink-0 pt-0.5">
                    <CheckCircle className="h-6 w-6 text-[#d3bb73]" />
                  </div>
                  <div>
                    <h3 className="mb-1 font-medium text-[#e5e4e2]">
                      {benefit.title}
                    </h3>
                    <p className="text-sm leading-relaxed text-[#e5e4e2]/60">
                      {benefit.description}
                    </p>
                  </div>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
