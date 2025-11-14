import { uploadImage } from '@/lib/storage';
import { supabase } from '@/lib/supabase';
import { Upload } from 'lucide-react';
import { useState } from 'react';

export function AddConnectorModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [commonUses, setCommonUses] = useState('');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [uploadingThumbnail, setUploadingThumbnail] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleThumbnailUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingThumbnail(true);
    try {
      const url = await uploadImage(file, 'connector-thumbnails');
      setThumbnailUrl(url);
    } catch (error) {
      console.error('Error uploading thumbnail:', error);
      alert('Błąd podczas wgrywania zdjęcia');
    } finally {
      setUploadingThumbnail(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSaving(true);
    try {
      const { error } = await supabase.from('connector_types').insert({
        name: name.trim(),
        description: description.trim() || null,
        common_uses: commonUses.trim() || null,
        thumbnail_url: thumbnailUrl || null,
        is_active: true,
      });

      if (error) throw error;

      onAdd(name.trim());
      onClose();
    } catch (error) {
      console.error('Error adding connector:', error);
      alert('Błąd podczas dodawania wtyczki');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Dodaj nowy wtyk</h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa wtyczki *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="np. XLR Male"
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis (opcjonalnie)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="np. Wtyk XLR męski, 3-pinowy"
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Typowe zastosowania (opcjonalnie)
            </label>
            <textarea
              value={commonUses}
              onChange={(e) => setCommonUses(e.target.value)}
              placeholder="np. Mikrofony, sygnały audio balanced, DMX"
              rows={3}
              className="w-full rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73]/30 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">
              Zdjęcie wtyczki (opcjonalnie)
            </label>
            <div className="flex items-start gap-4">
              {thumbnailUrl && (
                <div className="h-20 w-20 overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]">
                  <img src={thumbnailUrl} alt="Miniaturka" className="h-full w-full object-cover" />
                </div>
              )}
              <label className="flex-1 cursor-pointer">
                <div className="rounded-lg border-2 border-dashed border-[#d3bb73]/20 p-4 text-center transition-colors hover:border-[#d3bb73]/40">
                  <Upload className="mx-auto mb-2 h-6 w-6 text-[#e5e4e2]/40" />
                  <div className="text-sm text-[#e5e4e2]/60">
                    {uploadingThumbnail ? 'Wgrywanie...' : 'Kliknij aby dodać zdjęcie'}
                  </div>
                </div>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handleThumbnailUpload}
                  className="hidden"
                  disabled={uploadingThumbnail}
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-[#e5e4e2]/10 px-6 py-2.5 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="rounded-lg bg-[#d3bb73] px-6 py-2.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {saving ? 'Dodawanie...' : 'Dodaj wtyk'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
