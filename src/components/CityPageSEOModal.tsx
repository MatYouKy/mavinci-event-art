'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface CityPageSEOModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageType: string;
  citySlug: string;
  cityName: string;
  defaultTitle: string;
  defaultDescription: string;
}

export default function CityPageSEOModal({
  isOpen,
  onClose,
  pageType,
  citySlug,
  cityName,
  defaultTitle,
  defaultDescription,
}: CityPageSEOModalProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadSEOData();
    }
  }, [isOpen, pageType, citySlug]);

  const loadSEOData = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('city_pages_seo')
        .select('*')
        .eq('page_type', pageType)
        .eq('city_slug', citySlug)
        .eq('is_active', true)
        .maybeSingle();

      if (data) {
        setSeoTitle(data.seo_title || '');
        setSeoDescription(data.seo_description || '');
        const keywordsArray = data.seo_keywords
          ? data.seo_keywords
              .split(',')
              .map((k: string) => k.trim())
              .filter(Boolean)
          : [];
        setKeywords(keywordsArray);
      } else {
        setSeoTitle('');
        setSeoDescription('');
        setKeywords([]);
      }
    } catch (error) {
      console.error('Error loading SEO data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddKeyword = () => {
    const trimmed = newKeyword.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords((prev) => [...prev, trimmed]);
      setNewKeyword('');
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    setKeywords((prev) => prev.filter((k) => k !== keyword));
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const keywordsString = keywords.length > 0 ? keywords.join(', ') : null;

      const payload = {
        page_type: pageType,
        city_slug: citySlug,
        city_name: cityName,
        seo_title: seoTitle || null,
        seo_description: seoDescription || null,
        seo_keywords: keywordsString,
        is_active: true,
        updated_at: new Date().toISOString(),
      };

      const { data: existing } = await supabase
        .from('city_pages_seo')
        .select('id')
        .eq('page_type', pageType)
        .eq('city_slug', citySlug)
        .maybeSingle();

      let error;
      if (existing) {
        const result = await supabase.from('city_pages_seo').update(payload).eq('id', existing.id);
        error = result.error;
      } else {
        const result = await supabase.from('city_pages_seo').insert(payload);
        error = result.error;
      }

      if (error) throw error;

      showSnackbar('Metadata zapisane pomyślnie', 'success');

      onClose();

      setTimeout(() => {
        window.location.reload();
      }, 100);
    } catch (error) {
      console.error('Error saving metadata:', error);
      showSnackbar('Błąd podczas zapisywania metadata', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg bg-[#1c1f33] p-6 shadow-xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold text-[#e5e4e2]">Edytuj SEO dla {cityName}</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              /{pageType}/{citySlug}
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="py-12 text-center text-[#e5e4e2]/60">Ładowanie...</div>
        ) : (
          <div className="space-y-6">
            {/* SEO Title */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                SEO Title <span className="text-[#e5e4e2]/50">(opcjonalne)</span>
              </label>
              <input
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder={defaultTitle}
              />
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                Zostaw puste aby użyć domyślnego: &quot;{defaultTitle}&quot;
              </p>
            </div>

            {/* SEO Description */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                SEO Description <span className="text-[#e5e4e2]/50">(opcjonalne)</span>
              </label>
              <textarea
                value={seoDescription}
                onChange={(e) => setSeoDescription(e.target.value)}
                rows={4}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                placeholder={defaultDescription}
              />
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                Zostaw puste aby użyć domyślnego opisu
              </p>
            </div>

            {/* SEO Keywords */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Słowa kluczowe (keywords) <span className="text-[#e5e4e2]/50">(opcjonalne)</span>
              </label>

              <div className="mb-3 flex gap-2">
                <input
                  type="text"
                  value={newKeyword}
                  onChange={(e) => setNewKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddKeyword();
                    }
                  }}
                  placeholder={`konferencje ${cityName}, eventy ${cityName}...`}
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  type="button"
                  onClick={handleAddKeyword}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj
                </button>
              </div>

              {keywords.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {keywords.map((keyword, index) => (
                    <div
                      key={index}
                      className="flex items-center gap-2 rounded-full border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5"
                    >
                      <span className="text-sm text-[#e5e4e2]">{keyword}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveKeyword(keyword)}
                        className="text-[#800020] hover:text-[#800020]/80"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-[#e5e4e2]/40">Brak słów kluczowych</p>
              )}

              <p className="mt-2 text-xs text-[#e5e4e2]/50">
                Dodaj słowa kluczowe klikając przycisk &rdquo;Dodaj&rdquo; lub wciskając Enter
              </p>
            </div>

            {/* Info Box */}
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-4">
              <h3 className="mb-2 text-sm font-medium text-[#d3bb73]">Informacja</h3>
              <ul className="space-y-1 text-xs text-[#e5e4e2]/60">
                <li>• Wszystkie pola są opcjonalne</li>
                <li>• Puste pola użyją wartości domyślnych</li>
                <li>• SEO dotyczy tylko tej konkretnej strony miasta</li>
                <li>• Zmiany będą widoczne po odświeżeniu strony</li>
              </ul>
            </div>
          </div>
        )}

        {/* Buttons */}
        <div className="mt-8 flex gap-3">
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-3 font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
