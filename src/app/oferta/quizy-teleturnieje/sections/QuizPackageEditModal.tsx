'use client';

import { useState, useEffect } from 'react';
import { X, Save, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IconGridSelector } from '@/components/IconGridSelector';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';

interface QuizPackageEditModalProps {
  packageId: string | null;
  onClose: () => void;
}

export default function QuizPackageEditModal({ packageId, onClose }: QuizPackageEditModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [iconId, setIconId] = useState<string | null>(null);
  const [isVisible, setIsVisible] = useState(true);

  useEffect(() => {
    if (packageId) {
      fetchPackage();
    }
  }, [packageId]);

  const fetchPackage = async () => {
    if (!packageId) return;

    try {
      const { data, error } = await supabase
        .from('quiz_popular_packages')
        .select('*')
        .eq('id', packageId)
        .single();

      if (error) throw error;

      setTitle(data.title || '');
      setDescription(data.description || '');
      setImageUrl(data.image_url || '');
      setIconId(data.icon_id);
      setIsVisible(data.is_visible ?? true);
    } catch (error) {
      console.error('Error fetching package:', error);
      showSnackbar('BBd podczas Badowania pakietu', 'error');
    }
  };

  const handleSave = async () => {
    if (!title.trim() || !description.trim()) {
      showSnackbar('WypeBnij wymagane pola', 'error');
      return;
    }

    try {
      setLoading(true);

      if (packageId) {
        await supabase
          .from('quiz_popular_packages')
          .update({
            title,
            description,
            image_url: imageUrl || null,
            icon_id: iconId,
            is_visible: isVisible,
          })
          .eq('id', packageId);

        showSnackbar('Pakiet zaktualizowany', 'success');
      } else {
        const { data: maxData } = await supabase
          .from('quiz_popular_packages')
          .select('order_index')
          .order('order_index', { ascending: false })
          .limit(1)
          .single();

        const nextOrder = (maxData?.order_index || 0) + 1;

        await supabase.from('quiz_popular_packages').insert({
          title,
          description,
          image_url: imageUrl || null,
          icon_id: iconId,
          is_visible: isVisible,
          order_index: nextOrder,
        });

        showSnackbar('Pakiet dodany', 'success');
      }

      onClose();
    } catch (error) {
      console.error('Error saving package:', error);
      showSnackbar('BBd podczas zapisywania', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!packageId) return;
    if (!confirm('Czy na pewno chcesz usun ten pakiet?')) return;

    try {
      setDeleting(true);
      await supabase.from('quiz_popular_packages').delete().eq('id', packageId);
      showSnackbar('Pakiet usunity', 'success');
      onClose();
    } catch (error) {
      console.error('Error deleting package:', error);
      showSnackbar('BBd podczas usuwania', 'error');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="relative max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8">
        <div className="mb-8 flex items-center justify-between">
          <h3 className="text-2xl font-light text-[#e5e4e2]">
            {packageId ? 'Edytuj pakiet' : 'Dodaj pakiet'}
          </h3>
          <button
            onClick={onClose}
            className="rounded-full p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              TytuB *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/40 focus:outline-none"
              placeholder="np. QuizXpress - profesjonalne teleturnieje"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Opis *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/40 focus:outline-none"
              placeholder="Opisz pakiet..."
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Zdjcie
            </label>
            <SimpleImageUploader
              currentImageUrl={imageUrl}
              onImageChange={setImageUrl}
              bucket="site-images"
              path="quiz-packages"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-light text-[#e5e4e2]/80">
              Ikona
            </label>
            <IconGridSelector selectedIconId={iconId} onSelect={setIconId} />
          </div>

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

        <div className="mt-8 flex items-center justify-between">
          <div>
            {packageId && (
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-500/10 px-4 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-4 w-4" />
                {deleting ? 'Usuwanie...' : 'UsuD'}
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
