'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { X, Plus, Save, Trash2, Image as ImageIcon, Edit2, Upload } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SimpleImageUploader } from './SimpleImageUploader';
import { uploadOptimizedImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';
import { slugify } from '@/lib/slugify';
import { IconGridSelector } from './IconGridSelector';

interface AdminServiceEditorProps {
  serviceId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AdminServiceEditor({ serviceId, onClose, onSaved }: AdminServiceEditorProps) {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [originalSlug, setOriginalSlug] = useState('');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [isPremium, setIsPremium] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [iconId, setIconId] = useState('');
  const [features, setFeatures] = useState<string[]>([]);
  const [technicalSpecs, setTechnicalSpecs] = useState<Record<string, string>>({});
  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [seoKeywords, setSeoKeywords] = useState('');

  const [newFeature, setNewFeature] = useState('');
  const [newSpecKey, setNewSpecKey] = useState('');
  const [newSpecValue, setNewSpecValue] = useState('');
  const [showImageUploader, setShowImageUploader] = useState<'hero' | 'thumbnail' | null>(null);

  useEffect(() => {
    loadService();
  }, [serviceId]);

  const loadService = async () => {
    try {
      const { data, error } = await supabase
        .from('conferences_service_items')
        .select('*')
        .eq('id', serviceId)
        .single();

      if (error) throw error;
      if (!data) return;

      setName(data.name || '');
      setOriginalSlug(data.slug || '');
      setDescription(data.description || '');
      setLongDescription(data.long_description || '');
      setHeroImageUrl(data.hero_image_url || '');
      setThumbnailUrl(data.thumbnail_url || '');
      setIsPremium(data.is_premium || false);
      setIsActive(data.is_active !== false);
      setIconId(data.icon_id || '');
      setFeatures(Array.isArray(data.features) ? data.features : []);
      setTechnicalSpecs(data.technical_specs || {});
      setSeoTitle(data.seo_title || '');
      setSeoDescription(data.seo_description || '');
      setSeoKeywords(data.seo_keywords || '');
    } catch (error) {
      console.error('Error loading service:', error);
      showSnackbar('Błąd wczytywania usługi', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const newSlug = slugify(name);

      const { error } = await supabase
        .from('conferences_service_items')
        .update({
          name,
          slug: newSlug,
          description,
          long_description: longDescription,
          hero_image_url: heroImageUrl,
          thumbnail_url: thumbnailUrl,
          is_premium: isPremium,
          is_active: isActive,
          icon_id: iconId || null,
          features,
          technical_specs: technicalSpecs,
          seo_title: seoTitle,
          seo_description: seoDescription,
          seo_keywords: seoKeywords,
          updated_at: new Date().toISOString(),
        })
        .eq('id', serviceId);

      if (error) throw error;

      showSnackbar('Usługa zaktualizowana pomyślnie', 'success');
      onClose();

      if (newSlug !== originalSlug) {
        router.push(`/uslugi/${newSlug}`);
      } else {
        onSaved();
      }
    } catch (error) {
      console.error('Error saving service:', error);
      showSnackbar('Błąd zapisu usługi', 'error');
    } finally {
      setSaving(false);
    }
  };

  const addFeature = () => {
    if (newFeature.trim()) {
      setFeatures([...features, newFeature.trim()]);
      setNewFeature('');
    }
  };

  const removeFeature = (index: number) => {
    setFeatures(features.filter((_, i) => i !== index));
  };

  const updateFeature = (index: number, value: string) => {
    const updated = [...features];
    updated[index] = value;
    setFeatures(updated);
  };

  const addTechnicalSpec = () => {
    if (newSpecKey.trim() && newSpecValue.trim()) {
      setTechnicalSpecs({
        ...technicalSpecs,
        [newSpecKey.trim()]: newSpecValue.trim(),
      });
      setNewSpecKey('');
      setNewSpecValue('');
    }
  };

  const removeTechnicalSpec = (key: string) => {
    const updated = { ...technicalSpecs };
    delete updated[key];
    setTechnicalSpecs(updated);
  };

  const updateTechnicalSpec = (oldKey: string, newKey: string, newValue: string) => {
    const updated = { ...technicalSpecs };
    delete updated[oldKey];
    updated[newKey] = newValue;
    setTechnicalSpecs(updated);
  };

  const handleImageUpload = async (imageData: IUploadImage) => {
    if (!imageData.file) {
      showSnackbar('Nie wybrano pliku', 'error');
      return;
    }

    try {
      showSnackbar('Uploading...', 'info');

      const folder = showImageUploader === 'hero' ? 'services/hero' : 'services/thumbnails';
      const result = await uploadOptimizedImage(imageData.file, folder);

      if (showImageUploader === 'hero') {
        setHeroImageUrl(result.desktop);
        setThumbnailUrl(result.thumbnail);
        showSnackbar('Zdjęcie hero uploaded', 'success');
      } else if (showImageUploader === 'thumbnail') {
        setThumbnailUrl(result.thumbnail);
        showSnackbar('Miniatura uploaded', 'success');
      }

      setShowImageUploader(null);
    } catch (error) {
      console.error('Upload error:', error);
      showSnackbar('Błąd uploadu zdjęcia', 'error');
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
        <div className="flex max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-6 py-4">
            <h2 className="text-2xl font-light text-[#e5e4e2]">Edycja usługi</h2>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            >
              <X className="h-6 w-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 space-y-8 overflow-y-auto p-6">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Podstawowe informacje</h3>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Nazwa usługi</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  Krótki opis (katalog)
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Szczegółowy opis</label>
                <textarea
                  value={longDescription}
                  onChange={(e) => setLongDescription(e.target.value)}
                  rows={4}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPremium"
                  checked={isPremium}
                  onChange={(e) => setIsPremium(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="isPremium" className="text-sm text-[#e5e4e2]/70">
                  Usługa Premium
                </label>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className="h-4 w-4"
                />
                <label htmlFor="isActive" className="text-sm text-[#e5e4e2]/70">
                  Widoczna publicznie
                </label>
              </div>
            </div>

            {/* Icon Selector */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Ikona usługi</h3>
              <IconGridSelector
                value={iconId}
                onChange={setIconId}
                label="Wybierz ikonę"
              />
            </div>

            {/* Images */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Obrazy</h3>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                    Hero Image (1920px)
                  </label>
                  {heroImageUrl ? (
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-[#d3bb73]/20">
                      <img src={heroImageUrl} alt="Hero" className="h-full w-full object-cover" />
                      <button
                        onClick={() => setShowImageUploader('hero')}
                        className="absolute right-2 top-2 rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowImageUploader('hero')}
                      className="flex aspect-video w-full items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73]/20 transition-colors hover:border-[#d3bb73]/40"
                    >
                      <ImageIcon className="h-8 w-8 text-[#e5e4e2]/40" />
                    </button>
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/70">Miniaturka (400px)</label>
                  {thumbnailUrl ? (
                    <div className="relative aspect-video overflow-hidden rounded-lg border border-[#d3bb73]/20">
                      <img
                        src={thumbnailUrl}
                        alt="Thumbnail"
                        className="h-full w-full object-cover"
                      />
                      <button
                        onClick={() => setShowImageUploader('thumbnail')}
                        className="absolute right-2 top-2 rounded-lg bg-[#d3bb73] p-2 text-[#1c1f33] hover:bg-[#d3bb73]/90"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowImageUploader('thumbnail')}
                      className="flex aspect-video w-full items-center justify-center rounded-lg border-2 border-dashed border-[#d3bb73]/20 transition-colors hover:border-[#d3bb73]/40"
                    >
                      <ImageIcon className="h-8 w-8 text-[#e5e4e2]/40" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Features */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Co oferujemy</h3>

              <div className="space-y-2">
                {features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={feature}
                      onChange={(e) => updateFeature(index, e.target.value)}
                      className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={() => removeFeature(index)}
                      className="text-red-400 transition-colors hover:text-red-300"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addFeature()}
                  placeholder="Nowa cecha..."
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  onClick={addFeature}
                  className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Technical Specs */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Specyfikacja techniczna</h3>

              <div className="space-y-2">
                {Object.entries(technicalSpecs).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <input
                      type="text"
                      value={key}
                      onChange={(e) => updateTechnicalSpec(key, e.target.value, value)}
                      placeholder="Klucz"
                      className="w-1/3 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => updateTechnicalSpec(key, key, e.target.value)}
                      placeholder="Wartość"
                      className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={() => removeTechnicalSpec(key)}
                      className="text-red-400 transition-colors hover:text-red-300"
                    >
                      <Trash2 className="h-5 w-5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newSpecKey}
                  onChange={(e) => setNewSpecKey(e.target.value)}
                  placeholder="Klucz (np. brightness)"
                  className="w-1/3 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <input
                  type="text"
                  value={newSpecValue}
                  onChange={(e) => setNewSpecValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTechnicalSpec()}
                  placeholder="Wartość (np. 5000 nits)"
                  className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  onClick={addTechnicalSpec}
                  className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Plus className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* SEO */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">SEO</h3>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Tytuł SEO</label>
                <input
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">Opis SEO</label>
                <textarea
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                  Słowa kluczowe (oddzielone przecinkami)
                </label>
                <input
                  type="text"
                  value={seoKeywords}
                  onChange={(e) => setSeoKeywords(e.target.value)}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-[#d3bb73]/20 px-6 py-4">
            <button
              onClick={onClose}
              className="px-6 py-2 text-[#e5e4e2] transition-colors hover:text-[#e5e4e2]/70"
            >
              Anuluj
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>
      </div>

      {showImageUploader && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6">
          <div className="relative w-full max-w-2xl rounded-2xl bg-[#1c1f33] p-6">
            <button
              onClick={() => setShowImageUploader(null)}
              className="absolute right-4 top-4 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            >
              <X className="h-6 w-6" />
            </button>

            <h3 className="mb-4 text-xl font-medium text-[#e5e4e2]">
              {showImageUploader === 'hero' ? 'Upload Hero Image' : 'Upload Thumbnail'}
            </h3>

            <SimpleImageUploader
              onImageSelect={handleImageUpload}
              initialImage={{
                src: showImageUploader === 'hero' ? heroImageUrl : thumbnailUrl,
                alt: name
              }}
              showPreview={true}
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setShowImageUploader(null)}
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/40"
              >
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
