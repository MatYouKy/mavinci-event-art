'use client';

import { useState } from 'react';
import { supabase } from '@/lib/supabase/browser';
import { X, Save, Plus } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AdminAddServiceModalProps {
  categoryId: string;
  categoryName: string;
  onClose: () => void;
  onAdded: () => void;
}

export function AdminAddServiceModal({
  categoryId,
  categoryName,
  onClose,
  onAdded,
}: AdminAddServiceModalProps) {
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPremium, setIsPremium] = useState(false);

  const generateSlug = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[ąĄ]/g, 'a')
      .replace(/[ćĆ]/g, 'c')
      .replace(/[ęĘ]/g, 'e')
      .replace(/[łŁ]/g, 'l')
      .replace(/[ńŃ]/g, 'n')
      .replace(/[óÓ]/g, 'o')
      .replace(/[śŚ]/g, 's')
      .replace(/[źŹżŻ]/g, 'z')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  };

  const handleSave = async () => {
    if (!name.trim()) {
      showSnackbar('Nazwa usługi jest wymagana', 'error');
      return;
    }

    setSaving(true);
    try {
      const slug = generateSlug(name);

      const { error: insertError } = await supabase.from('conferences_service_items').insert({
        category_id: categoryId,
        name: name.trim(),
        slug,
        description: description.trim() || null,
        is_premium: isPremium,
        is_active: true,
        display_order: 999,
      });

      if (insertError) throw insertError;

      showSnackbar('Usługa dodana pomyślnie', 'success');
      onAdded();
      onClose();
    } catch (error: any) {
      console.error('Error adding service:', error);
      if (error.code === '23505') {
        showSnackbar('Usługa o takiej nazwie już istnieje', 'error');
      } else {
        showSnackbar('Błąd dodawania usługi', 'error');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/20 px-6 py-4">
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">Dodaj nową usługę</h2>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">Kategoria: {categoryName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">
              Nazwa usługi <span className="text-red-400">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. Ekrany LED indoor"
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/70">Krótki opis</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Krótki opis usługi..."
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isPremiumNew"
              checked={isPremium}
              onChange={(e) => setIsPremium(e.target.checked)}
              className="h-4 w-4"
            />
            <label htmlFor="isPremiumNew" className="text-sm text-[#e5e4e2]/70">
              Usługa Premium
            </label>
          </div>

          <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4">
            <p className="text-sm text-[#e5e4e2]/60">
              💡 Po dodaniu będziesz mógł edytować szczegóły usługi, dodać obrazy, cechy i
              specyfikację techniczną.
            </p>
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
            disabled={saving || !name.trim()}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? 'Dodawanie...' : 'Dodaj usługę'}
          </button>
        </div>
      </div>
    </div>
  );
}
