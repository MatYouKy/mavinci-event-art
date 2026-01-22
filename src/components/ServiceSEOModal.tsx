'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface ServiceSEOModalProps {
  isOpen: boolean;
  onClose: () => void;
  serviceId: string;
  slug: string;
  initialData: {
    name: string;
    description: string;
    seo_title?: string;
    seo_description?: string;
    seo_keywords?: string;
    og_image?: string;
  };
}

export default function ServiceSEOModal({
  isOpen,
  onClose,
  serviceId,
  slug,
  initialData,
}: ServiceSEOModalProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(initialData.name);
  const [description, setDescription] = useState(initialData.description);
  const [seoTitle, setSeoTitle] = useState(initialData.seo_title || '');
  const [seoDescription, setSeoDescription] = useState(initialData.seo_description || '');
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [ogImage, setOgImage] = useState(initialData.og_image || '');

  useEffect(() => {
    setName(initialData.name);
    setDescription(initialData.description);
    setSeoTitle(initialData.seo_title || '');
    setSeoDescription(initialData.seo_description || '');
    setOgImage(initialData.og_image || '');

    const keywordsArray = initialData.seo_keywords
      ? initialData.seo_keywords.split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    setKeywords(keywordsArray);
  }, [initialData]);

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
      const { updateServiceSEO } = await import('@/app/(public)/uslugi/[slug]/actions');

      const keywordsString = keywords.length > 0 ? keywords.join(', ') : null;

      const result = await updateServiceSEO(serviceId, slug, {
        name,
        description,
        seo_title: seoTitle || null,
        seo_description: seoDescription || null,
        seo_keywords: keywordsString,
      });

      if (!result.success) {
        throw new Error(result.error || 'Failed to update');
      }

      showSnackbar('Metadata zapisane pomyślnie', 'success');
      onClose();

      setTimeout(() => {
        router.refresh();
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
    <div className="fixed inset-0 z-50 bg-black/50 flex items-start justify-center overflow-y-auto">
      {/* wrapper z marginesem od góry/dół */}
      <div className="w-full max-w-3xl px-4 py-10">
        {/* sam modal z max wysokością i własnym scrollowaniem */}
        <div className="max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg bg-[#1c1f33] p-4 sm:p-6 shadow-xl">
          <div className="mb-6 flex items-center justify-between sticky top-0 bg-[#1c1f33] pb-4 z-10">
            <h2 className="text-lg sm:text-2xl font-bold text-[#e5e4e2]">
              Edytuj metadata usługi
            </h2>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-[#e5e4e2]/70 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#d3bb73]"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="space-y-6">
            {/* Nazwa usługi */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Nazwa usługi
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none text-sm sm:text-base"
                placeholder="np. Streaming HD 4K"
              />
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                Używane w nagłówkach, breadcrumbs i jako fallback dla SEO title
              </p>
            </div>

            {/* Opis */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Opis usługi
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none text-sm sm:text-base"
                placeholder="Krótki opis usługi"
              />
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                Używany jako fallback dla SEO description
              </p>
            </div>

            {/* SEO Title */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                SEO Title <span className="text-[#e5e4e2]/50">(opcjonalne)</span>
              </label>
              <input
                type="text"
                value={seoTitle}
                onChange={(e) => setSeoTitle(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none text-sm sm:text-base"
                placeholder="Zostaw puste aby użyć nazwy usługi"
              />
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                Tytuł strony w wynikach wyszukiwania (50-60 znaków)
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
                rows={3}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none text-sm sm:text-base"
                placeholder="Zostaw puste aby użyć opisu usługi"
              />
              <p className="mt-1 text-xs text-[#e5e4e2]/50">
                Opis w wynikach wyszukiwania (150-160 znaków)
              </p>
            </div>

            {/* SEO Keywords */}
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Słowa kluczowe (keywords){' '}
                <span className="text-[#e5e4e2]/50">(opcjonalne)</span>
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
                  placeholder="Wpisz słowo kluczowe..."
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none text-sm sm:text-base"
                />
                <button
                  type="button"
                  onClick={handleAddKeyword}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 text-sm"
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
                      <span className="text-xs sm:text-sm text-[#e5e4e2]">
                        {keyword}
                      </span>
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
                Dodaj słowa kluczowe klikając przycisk "Dodaj" lub wciskając Enter
              </p>
            </div>

            {/* OG Image Preview */}
            {ogImage && (
              <div>
                <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                  Open Graph Image (podgląd)
                </label>
                <div className="relative overflow-hidden rounded-lg border border-[#d3bb73]/20">
                  <img
                    src={ogImage}
                    alt="OG Image Preview"
                    className="h-40 sm:h-48 w-full object-cover"
                  />
                </div>
                <p className="mt-2 text-xs text-[#e5e4e2]/50">
                  Ten obrazek jest używany w podglądach na social media (Facebook,
                  Twitter, LinkedIn). Obrazek pochodzi z Hero Image strony i można go
                  edytować osobno.
                </p>
              </div>
            )}
          </div>

          {/* Buttons */}
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !name}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50 text-sm sm:text-base"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
            </button>
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-3 font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 text-sm sm:text-base"
            >
              Anuluj
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}