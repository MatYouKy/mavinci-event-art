'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface PageMetadataModalProps {
  isOpen: boolean;
  onClose: () => void;
  pageSlug: string;
  pageName: string;
}

export function PageMetadataModal({ isOpen, onClose, pageSlug, pageName }: PageMetadataModalProps) {
  const [metadata, setMetadata] = useState<any>(null);
  const [keywords, setKeywords] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [ogImage, setOgImage] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [availableImages, setAvailableImages] = useState<any[]>([]);
  const [showImagePicker, setShowImagePicker] = useState(false);
  const { showSnackbar } = useSnackbar();

  const isEdit = !!metadata?.id;

  useEffect(() => {
    if (isOpen) {
      loadMetadata();
      loadAvailableImages();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pageSlug]);

  const loadAvailableImages = async () => {
    const { data, error } = await supabase
      .from('site_images')
      .select('*')
      .or(`section.ilike.%${pageSlug}%,section.eq.global`)
      .eq('is_active', true)
      .order('section');

    if (data && !error) {
      setAvailableImages(data);
    }
  };

  const loadMetadata = async () => {
    const { data, error } = await supabase
      .from('schema_org_page_metadata')
      .select('*')
      .eq('page_slug', pageSlug)
      .maybeSingle();

    if (error) {
      console.error('Error loading metadata', error);
    }

    if (data) {
      setMetadata(data);
      setKeywords(data.keywords || []);
      setTitle(data.title || '');
      setDescription(data.description || '');
      setOgImage(data.og_image || '');
    } else {
      setMetadata(null);
      setKeywords([]);
      setTitle('');
      setDescription('');
      setOgImage('');
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
    setIsSaving(true);

    const payload = {
      page_slug: pageSlug,
      title: title || null,
      description: description || null,
      keywords,
      og_image: ogImage || null,
      is_active: true,
      updated_at: new Date().toISOString(),
    };

    let error;

    if (metadata) {
      const result = await supabase
        .from('schema_org_page_metadata')
        .update(payload)
        .eq('id', metadata.id);
      error = result.error;
    } else {
      const result = await supabase.from('schema_org_page_metadata').insert(payload);
      error = result.error;
    }

    setIsSaving(false);

    if (error) {
      console.error('Error saving metadata', error);
      showSnackbar('Błąd podczas zapisywania', 'error');
      return;
    }

    showSnackbar(
      isEdit
        ? 'Zaktualizowano metadane strony. Odświeżanie...'
        : 'Dodano metadane strony. Odświeżanie...',
      'success',
    );

    onClose();

    try {
      const pathToRevalidate = `/${pageSlug}`;
      await fetch('/api/revalidate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: pathToRevalidate }),
      });
    } catch (err) {
      console.error('Revalidation failed:', err);
    }

    setTimeout(() => {
      window.location.reload();
    }, 300);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
        {/* HEADER */}
        <div className="sticky top-0 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">
              {isEdit ? 'Edytujesz metadane strony' : 'Dodajesz metadane strony'}
            </h2>
            <p className="text-sm text-[#e5e4e2]/60">
              {pageName} <span className="text-[#e5e4e2]/40">({pageSlug})</span>
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* BODY */}
        <div className="space-y-6 p-6">
          {/* Title */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Tytuł strony (opcjonalny)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pozostaw puste aby użyć domyślnego"
              className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Meta Description (opcjonalny)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pozostaw puste aby użyć domyślnego"
              rows={3}
              className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
            />
          </div>

          {/* OG Image */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Open Graph Image (opcjonalny)
            </label>

            <div className="space-y-3">
              <button
                type="button"
                onClick={() => setShowImagePicker(!showImagePicker)}
                className="w-full rounded border border-[#d3bb73]/20 bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
              >
                {ogImage ? 'Zmień obrazek' : 'Wybierz obrazek z galerii'}
              </button>

              {showImagePicker && (
                <div className="grid max-h-60 grid-cols-2 gap-3 overflow-y-auto rounded border border-[#d3bb73]/20 bg-[#0f1119] p-3 md:grid-cols-3">
                  {availableImages.length > 0 ? (
                    availableImages.map((img) => (
                      <button
                        key={img.id}
                        onClick={() => {
                          setOgImage(img.desktop_url);
                          setShowImagePicker(false);
                        }}
                        className={`relative aspect-video overflow-hidden rounded border-2 transition-all hover:scale-105 ${
                          ogImage === img.desktop_url
                            ? 'border-[#d3bb73]'
                            : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/50'
                        }`}
                      >
                        <img
                          src={img.desktop_url}
                          alt={img.alt_text || img.section}
                          className="h-full w-full object-cover"
                        />
                        {ogImage === img.desktop_url && (
                          <div className="absolute inset-0 flex items-center justify-center bg-[#d3bb73]/20">
                            <div className="rounded-full bg-[#d3bb73] p-2 text-[#1c1f33]">✓</div>
                          </div>
                        )}
                      </button>
                    ))
                  ) : (
                    <p className="col-span-full py-4 text-center text-sm text-[#e5e4e2]/40">
                      Brak dostępnych obrazków
                    </p>
                  )}
                </div>
              )}

              {ogImage && (
                <div className="relative">
                  <img
                    src={ogImage}
                    alt="Selected OG Image"
                    className="max-h-40 w-full rounded border border-[#d3bb73]/20 object-cover"
                  />
                  <button
                    onClick={() => setOgImage('')}
                    className="absolute right-2 top-2 rounded-full bg-[#800020] p-2 text-white hover:bg-[#800020]/80"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <input
                type="url"
                value={ogImage}
                onChange={(e) => setOgImage(e.target.value)}
                placeholder="Lub wklej URL ręcznie"
                className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
              />
            </div>
          </div>

          {/* Keywords */}
          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Słowa kluczowe (keywords)
            </label>

            <div className="mb-3 flex gap-2">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddKeyword())}
                placeholder="Wpisz słowo kluczowe..."
                className="flex-1 rounded border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
              />
              <button
                onClick={handleAddKeyword}
                className="flex items-center gap-2 rounded bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
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
          </div>

          {/* Info */}
          <div className="rounded border border-[#d3bb73]/20 bg-[#0f1119] p-4">
            <h3 className="mb-2 font-medium text-[#d3bb73]">Informacja</h3>
            <ul className="space-y-1 text-sm text-[#e5e4e2]/60">
              <li>• Keywords są używane w meta tags dla SEO</li>
              <li>• Title i Description nadpisują wartości domyślne jeśli są wypełnione</li>
              <li>• OG Image jest używany dla podglądów na social media</li>
              <li>• Wszystkie pola są opcjonalne</li>
            </ul>
          </div>
        </div>

        {/* FOOTER */}
        <div className="sticky bottom-0 flex justify-end gap-3 border-t border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <button
            onClick={onClose}
            className="rounded bg-[#800020]/20 px-6 py-2 text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {isSaving ? 'Zapisywanie...' : isEdit ? 'Zapisz zmiany' : 'Dodaj metadane'}
          </button>
        </div>
      </div>
    </div>
  );
}
