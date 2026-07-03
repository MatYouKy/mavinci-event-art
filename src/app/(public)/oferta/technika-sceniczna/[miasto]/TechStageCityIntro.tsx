'use client';

import { useEffect, useState } from 'react';
import { Pencil, Save, X, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { useSnackbar } from '@/contexts/SnackbarContext';
import type { PolishCityCases } from '@/lib/polishCityCases';

function capitalize(value: string) {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}

type Props = {
  cityCases?: PolishCityCases | null;
  content?: any;
  citySlug: string;
};

function replacePlaceholders(template: string, cityCases?: PolishCityCases | null): string {
  if (!cityCases) return template.replace(/\{\{[^}]+\}\}/g, '');

  const prep = cityCases.locative_preposition || 'w';

  return template
    .replace(/\{\{prep\}\}/g, prep)
    .replace(/\{\{locative\}\}/g, capitalize(cityCases.locative))
    .replace(/\{\{genitive\}\}/g, capitalize(cityCases.genitive))
    .replace(/\{\{nominative\}\}/g, capitalize(cityCases.nominative));
}

const PAGE_SLUG = 'technika-sceniczna';

const DEFAULT_HEADING = 'Profesjonalna technika sceniczna {{prep}} {{locative}}';

const DEFAULT_TEXT =
  'Zapewniamy kompleksową obsługę techniczną wydarzeń {{prep}} {{locative}} i okolicach. Dostarczamy profesjonalne nagłośnienie koncertowe i konferencyjne, oświetlenie sceniczne i architekturalne, ekrany LED i multimedia, konstrukcje sceniczne oraz rigging. Nasz zespół certyfikowanych techników i inżynierów dźwięku zapewnia pełne wsparcie - od projektu technicznego i rideru, przez montaż i konfigurację, po realizację podczas wydarzenia i demontaż. Pracujemy na własnym sprzęcie renomowanych marek: L-Acoustics, d&b audiotechnik, MA Lighting, Robe, Clay Paky.';

export default function TechStageCityIntro({ cityCases, content, citySlug }: Props) {
  const { canEdit } = useWebsiteEdit();
  const { showSnackbar } = useSnackbar();

  const [recordId, setRecordId] = useState<string | null>(null);
  const [localFeatures, setLocalFeatures] = useState<Record<string, any>>(
    content?.local_features || {},
  );

  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [headingDraft, setHeadingDraft] = useState(DEFAULT_HEADING);
  const [textDraft, setTextDraft] = useState(DEFAULT_TEXT);
  const [saving, setSaving] = useState(false);

  const headingTemplate = localFeatures?.intro_heading || DEFAULT_HEADING;
  const textTemplate = localFeatures?.intro_text || DEFAULT_TEXT;

  const displayHeading = replacePlaceholders(headingTemplate, cityCases);
  const displayText = replacePlaceholders(textTemplate, cityCases);

  useEffect(() => {
    const fetchIntro = async () => {
      setLoading(true);

      try {
        const { data, error } = await supabase
          .from('seo_city_content')
          .select('id, local_features')
          .eq('page_slug', PAGE_SLUG)
          .eq('city', citySlug)
          .maybeSingle();

        if (error) throw error;

        setRecordId(data?.id || null);
        setLocalFeatures(data?.local_features || {});
      } catch (error) {
        console.error('Error fetching intro:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchIntro();
  }, [citySlug]);

  const handleEdit = () => {
    setHeadingDraft(headingTemplate);
    setTextDraft(textTemplate);
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      const nextLocalFeatures = {
        ...localFeatures,
        intro_heading: headingDraft,
        intro_text: textDraft,
      };

      if (recordId) {
        const { error } = await supabase
          .from('seo_city_content')
          .update({
            local_features: nextLocalFeatures,
            updated_at: new Date().toISOString(),
          })
          .eq('id', recordId);

        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('seo_city_content')
          .insert({
            page_slug: PAGE_SLUG,
            city: citySlug,
            region: null,
            local_features: nextLocalFeatures,
            is_active: true,
          })
          .select('id')
          .single();

        if (error) throw error;

        setRecordId(data.id);
      }

      setLocalFeatures(nextLocalFeatures);
      showSnackbar('Intro zapisane', 'success');
      setEditing(false);
    } catch (error) {
      console.error('Error saving intro:', error);
      showSnackbar('Błąd zapisu intro', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="relative border-b border-[#d3bb73]/10 px-6 py-20">
        <div className="mx-auto max-w-5xl text-center text-[#e5e4e2]/60">
          Ładowanie...
        </div>
      </section>
    );
  }

  return (
    <section className="relative border-b border-[#d3bb73]/10 px-6 py-20">
      {canEdit && !editing && (
        <button
          onClick={handleEdit}
          className="absolute right-6 top-6 rounded-full bg-[#d3bb73]/80 p-2 backdrop-blur-sm transition-all hover:bg-[#d3bb73]"
          title="Edytuj intro"
        >
          <Pencil className="h-4 w-4 text-[#1c1f33]" />
        </button>
      )}

      <div className="mx-auto max-w-5xl">
        {editing ? (
          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#d3bb73]">
                Heading placeholders: {'{{prep}}'}, {'{{locative}}'}, {'{{genitive}}'}, {'{{nominative}}'}
              </label>

              <input
                type="text"
                value={headingDraft}
                onChange={(e) => setHeadingDraft(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-lg text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                placeholder="Nagłówek sekcji..."
              />

              <p className="mt-1 text-xs text-[#e5e4e2]/40">
                Podgląd: {replacePlaceholders(headingDraft, cityCases)}
              </p>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#d3bb73]">
                Treść placeholders: {'{{prep}}'}, {'{{locative}}'}, {'{{genitive}}'}, {'{{nominative}}'}
              </label>

              <textarea
                value={textDraft}
                onChange={(e) => setTextDraft(e.target.value)}
                rows={8}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                placeholder="Treść sekcji..."
              />

              <p className="mt-1 text-xs text-[#e5e4e2]/40">
                Użyj Enter, aby podzielić na akapity
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {saving ? 'Zapisywanie...' : 'Zapisz'}
              </button>

              <button
                onClick={handleCancel}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10 disabled:opacity-50"
              >
                <X className="h-4 w-4" />
                Anuluj
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2 className="mb-8 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              {displayHeading}
            </h2>

            <div className="space-y-6 text-lg leading-relaxed text-[#e5e4e2]/80">
              {displayText.split('\n').map((paragraph: string, idx: number) => (
                <p key={idx}>{paragraph}</p>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}