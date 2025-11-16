'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Plus, Save, Trash2, Image as ImageIcon, Edit2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SimpleImageUploader } from './SimpleImageUploader';

interface AdminServiceEditorProps {
  serviceId: string;
  onClose: () => void;
  onSaved: () => void;
}

export function AdminServiceEditor({ serviceId, onClose, onSaved }: AdminServiceEditorProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [longDescription, setLongDescription] = useState('');
  const [heroImageUrl, setHeroImageUrl] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [isPremium, setIsPremium] = useState(false);
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
      setDescription(data.description || '');
      setLongDescription(data.long_description || '');
      setHeroImageUrl(data.hero_image_url || '');
      setThumbnailUrl(data.thumbnail_url || '');
      setIsPremium(data.is_premium || false);
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
      const { error } = await supabase
        .from('conferences_service_items')
        .update({
          name,
          description,
          long_description: longDescription,
          hero_image_url: heroImageUrl,
          thumbnail_url: thumbnailUrl,
          is_premium: isPremium,
          features,
          technical_specs: technicalSpecs,
          seo_title: seoTitle,
          seo_description: seoDescription,
          seo_keywords: seoKeywords,
          updated_at: new Date().toISOString()
        })
        .eq('id', serviceId);

      if (error) throw error;

      showSnackbar('Usługa zaktualizowana pomyślnie', 'success');
      onSaved();
      onClose();
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
        [newSpecKey.trim()]: newSpecValue.trim()
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

  const handleImageUpload = (url: string) => {
    if (showImageUploader === 'hero') {
      setHeroImageUrl(url);
      const thumbnailUrl = url.includes('pexels.com')
        ? url.replace(/w=\d+/, 'w=400&h=300&fit=crop')
        : url;
      setThumbnailUrl(thumbnailUrl);
    } else if (showImageUploader === 'thumbnail') {
      setThumbnailUrl(url);
    }
    setShowImageUploader(null);
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[#d3bb73]/20">
            <h2 className="text-2xl font-light text-[#e5e4e2]">Edycja usługi</h2>
            <button
              onClick={onClose}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6 space-y-8">
            {/* Basic Info */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Podstawowe informacje</h3>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Nazwa usługi</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Krótki opis (katalog)</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Szczegółowy opis</label>
                <textarea
                  value={longDescription}
                  onChange={(e) => setLongDescription(e.target.value)}
                  rows={4}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isPremium"
                  checked={isPremium}
                  onChange={(e) => setIsPremium(e.target.checked)}
                  className="w-4 h-4"
                />
                <label htmlFor="isPremium" className="text-[#e5e4e2]/70 text-sm">
                  Usługa Premium
                </label>
              </div>
            </div>

            {/* Images */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">Obrazy</h3>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[#e5e4e2]/70 text-sm mb-2">Hero Image (1920px)</label>
                  {heroImageUrl ? (
                    <div className="relative aspect-video rounded-lg overflow-hidden border border-[#d3bb73]/20">
                      <img src={heroImageUrl} alt="Hero" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setShowImageUploader('hero')}
                        className="absolute top-2 right-2 bg-[#d3bb73] text-[#1c1f33] p-2 rounded-lg hover:bg-[#d3bb73]/90"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowImageUploader('hero')}
                      className="w-full aspect-video border-2 border-dashed border-[#d3bb73]/20 rounded-lg flex items-center justify-center hover:border-[#d3bb73]/40 transition-colors"
                    >
                      <ImageIcon className="w-8 h-8 text-[#e5e4e2]/40" />
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-[#e5e4e2]/70 text-sm mb-2">Miniaturka (400px)</label>
                  {thumbnailUrl ? (
                    <div className="relative aspect-video rounded-lg overflow-hidden border border-[#d3bb73]/20">
                      <img src={thumbnailUrl} alt="Thumbnail" className="w-full h-full object-cover" />
                      <button
                        onClick={() => setShowImageUploader('thumbnail')}
                        className="absolute top-2 right-2 bg-[#d3bb73] text-[#1c1f33] p-2 rounded-lg hover:bg-[#d3bb73]/90"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowImageUploader('thumbnail')}
                      className="w-full aspect-video border-2 border-dashed border-[#d3bb73]/20 rounded-lg flex items-center justify-center hover:border-[#d3bb73]/40 transition-colors"
                    >
                      <ImageIcon className="w-8 h-8 text-[#e5e4e2]/40" />
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
                      className="flex-1 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={() => removeFeature(index)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
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
                  className="flex-1 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  onClick={addFeature}
                  className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-5 h-5" />
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
                      className="w-1/3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => updateTechnicalSpec(key, key, e.target.value)}
                      placeholder="Wartość"
                      className="flex-1 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      onClick={() => removeTechnicalSpec(key)}
                      className="text-red-400 hover:text-red-300 transition-colors"
                    >
                      <Trash2 className="w-5 h-5" />
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
                  className="w-1/3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <input
                  type="text"
                  value={newSpecValue}
                  onChange={(e) => setNewSpecValue(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTechnicalSpec()}
                  placeholder="Wartość (np. 5000 nits)"
                  className="flex-1 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
                <button
                  onClick={addTechnicalSpec}
                  className="bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* SEO */}
            <div className="space-y-4">
              <h3 className="text-xl font-medium text-[#e5e4e2]">SEO</h3>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Tytuł SEO</label>
                <input
                  type="text"
                  value={seoTitle}
                  onChange={(e) => setSeoTitle(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Opis SEO</label>
                <textarea
                  value={seoDescription}
                  onChange={(e) => setSeoDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-[#e5e4e2]/70 text-sm mb-2">Słowa kluczowe (oddzielone przecinkami)</label>
                <input
                  type="text"
                  value={seoKeywords}
                  onChange={(e) => setSeoKeywords(e.target.value)}
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-[#d3bb73]/20">
            <button
              onClick={onClose}
              className="px-6 py-2 text-[#e5e4e2] hover:text-[#e5e4e2]/70 transition-colors"
            >
              Anuluj
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>
      </div>

      {showImageUploader && (
        <SimpleImageUploader
          onUpload={handleImageUpload}
          onClose={() => setShowImageUploader(null)}
          currentImageUrl={showImageUploader === 'hero' ? heroImageUrl : thumbnailUrl}
          maxSizeMB={showImageUploader === 'hero' ? 1.2 : 0.5}
          targetWidth={showImageUploader === 'hero' ? 1920 : 400}
        />
      )}
    </>
  );
}
