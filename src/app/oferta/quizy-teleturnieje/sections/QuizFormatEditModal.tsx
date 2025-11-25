'use client';

import { useState, useEffect } from 'react';
import { X, Save, Trash2, Plus, Minus, ArrowLeft, ArrowRight } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IconGridSelector } from '@/components/IconGridSelector';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';

interface QuizFormatEditModalProps {
  formatId: string | null;
  onClose: () => void;
}

export default function QuizFormatEditModal({ formatId, onClose }: QuizFormatEditModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState('');
  const [level, setLevel] = useState('');
  const [description, setDescription] = useState('');
  const [features, setFeatures] = useState<string[]>(['']);
  const [imageUrl, setImageUrl] = useState('');
  const [iconId, setIconId] = useState<string | null>(null);
  const [layoutDirection, setLayoutDirection] = useState<'left' | 'right'>('left');
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (formatId) {
      fetchFormat();
    }
  }, [formatId]);

  const fetchFormat = async () => {
    if (!formatId) return;

    try {
      const { data, error } = await supabase
        .from('quiz_show_formats')
        .select('*')
        .eq('id', formatId)
        .single();

      if (error) throw error;

      setTitle(data.title || '');
      setLevel(data.level || '');
      setDescription(data.description || '');
      setFeatures(data.features || ['']);
      setImageUrl(data.image_url || '');
      setIconId(data.icon_id);
      setLayoutDirection(data.layout_direction || 'left');
      setIsVisible(data.is_visible ?? true);
    } catch (error) {
      console.error('Error fetching format:', error);
      showSnackbar('Błąd podczas ładowania formatu', 'error');
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !level.trim() || !description.trim()) {
      showSnackbar('Wypełnij wszystkie wymagane pola', 'error');
      return;
    }

    const filteredFeatures = features.filter(f => f.trim());
    if (filteredFeatures.length === 0) {
      showSnackbar('Dodaj przynajmniej jedną cechę', 'error');
      return;
    }

    try {
      setLoading(true);

      if (formatId) {
        // Update existing
        const { error } = await supabase
          .from('quiz_show_formats')
          .update({
            title,
            level,
            description,
            features: filteredFeatures,
            image_url: imageUrl || null,
            icon_id: iconId,
            layout_direction: layoutDirection,
            is_visible: isVisible,
          })
          .eq('id', formatId);

        if (error) throw error;
        showSnackbar('Format zaktualizowany', 'success');
      } else {
        // Get max order_index
        const { data: maxData } = await supabase
          .from('quiz_show_formats')
          .select('order_index')
          .order('order_index', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxData?.order_index || 0) + 1;

        // Create new
        const { error } = await supabase
          .from('quiz_show_formats')
          .insert({
            title,
            level,
            description,
            features: filteredFeatures,
            image_url: imageUrl || null,
            icon_id: iconId,
            layout_direction: layoutDirection,
            is_visible: isVisible,
            order_index: nextOrder,
          });

        if (error) throw error;
        showSnackbar('Format dodany', 'success');
      }

      onClose();
    } catch (error) {
      console.error('Error saving format:', error);
      showSnackbar('Błąd podczas zapisywania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!formatId) return;
    if (!confirm('Czy na pewno chcesz usunąć ten format?')) return;

    try {
      setDeleting(true);
      const { error } = await supabase
        .from('quiz_show_formats')
        .delete()
        .eq('id', formatId);

      if (error) throw error;
      showSnackbar('Format usunięty', 'success');
      onClose();
    } catch (error) {
      console.error('Error deleting format:', error);
      showSnackbar('Błąd podczas usuwania', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const addFeature = () => {
    setFeatures([...features, '']);
  };

  const removeFeature = (index: number) => {
    setFeatures(features.filter((_, i) => i !== index));
  };

  const updateFeature = (index: number, value: string) => {
    const updated = [...features];
    updated[index] = value;
    setFeatures(updated);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-[#1c1f33] border border-[#d3bb73]/20 p-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <h3 className="text-2xl font-light text-[#e5e4e2]">
            {formatId ? 'Edytuj format' : 'Dodaj format'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          {/* Title */}
          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Tytuł *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/40 focus:outline-none"
              placeholder="np. Klasyczne quizy wiedzy"
            />
          </div>

          {/* Level */}
          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Poziom *
            </label>
            <input
              type="text"
              value={level}
              onChange={(e) => setLevel(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/40 focus:outline-none"
              placeholder="np. Proste, Zaawansowane, Premium"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Opis *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/40 focus:outline-none"
              placeholder="Opisz format teleturnieju..."
            />
          </div>

          {/* Features */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-sm font-light text-[#e5e4e2]/80">
                Cechy *
              </label>
              <button
                onClick={addFeature}
                className="inline-flex items-center gap-1 rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
              >
                <Plus className="h-3 w-3" />
                Dodaj
              </button>
            </div>

            <div className="space-y-3">
              {features.map((feature, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={feature}
                    onChange={(e) => updateFeature(index, e.target.value)}
                    className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/40 focus:outline-none"
                    placeholder={`Cecha ${index + 1}`}
                  />
                  {features.length > 1 && (
                    <button
                      onClick={() => removeFeature(index)}
                      className="rounded-full p-2 text-red-400 transition-colors hover:bg-red-400/10"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Image */}
          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Zdjęcie
            </label>
            <SimpleImageUploader
              currentImageUrl={imageUrl}
              onImageChange={setImageUrl}
              bucket="site-images"
              path="quiz-formats"
            />
          </div>

          {/* Icon */}
          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Ikona
            </label>
            <IconGridSelector
              selectedIconId={iconId}
              onSelect={setIconId}
            />
          </div>

          {/* Layout Direction */}
          <div>
            <label className="mb-3 block text-sm font-light text-[#e5e4e2]/80">
              Kierunek layoutu
            </label>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setLayoutDirection('left')}
                className={`flex items-center justify-center gap-2 rounded-lg border p-4 transition-all ${
                  layoutDirection === 'left'
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                    : 'border-[#d3bb73]/20 bg-[#0f1119] text-[#e5e4e2]/60 hover:border-[#d3bb73]/40'
                }`}
              >
                <ArrowLeft className="h-5 w-5" />
                <span className="text-sm">Zdjęcie z lewej</span>
              </button>

              <button
                onClick={() => setLayoutDirection('right')}
                className={`flex items-center justify-center gap-2 rounded-lg border p-4 transition-all ${
                  layoutDirection === 'right'
                    ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                    : 'border-[#d3bb73]/20 bg-[#0f1119] text-[#e5e4e2]/60 hover:border-[#d3bb73]/40'
                }`}
              >
                <span className="text-sm">Zdjęcie z prawej</span>
                <ArrowRight className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Visibility */}
          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isVisible}
                onChange={(e) => setIsVisible(e.target.checked)}
                className="h-5 w-5 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-2 focus:ring-[#d3bb73]/20"
              />
              <span className="text-sm font-light text-[#e5e4e2]/80">
                Widoczny na stronie
              </span>
            </label>
          </div>
        </div>

        {/* Actions */}
        <div className="mt-8 flex items-center justify-between">
          <div>
            {formatId && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Usuwanie...' : 'Usuń'}
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/20 px-6 py-2 text-sm font-light text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
            >
              Anuluj
            </button>
            <button
              onClick={handleSave}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-all hover:bg-[#c5a960] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {loading ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
