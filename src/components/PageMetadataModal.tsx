'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { X, Plus, Trash2, Save } from 'lucide-react';

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

  useEffect(() => {
    if (isOpen) {
      loadMetadata();
    }
  }, [isOpen, pageSlug]);

  const loadMetadata = async () => {
    const { data, error } = await supabase
      .from('schema_org_page_metadata')
      .select('*')
      .eq('page_slug', pageSlug)
      .maybeSingle();

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
    if (newKeyword.trim() && !keywords.includes(newKeyword.trim())) {
      setKeywords([...keywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    setKeywords(keywords.filter(k => k !== keyword));
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
      const result = await supabase
        .from('schema_org_page_metadata')
        .insert(payload);
      error = result.error;
    }

    setIsSaving(false);

    if (error) {
      alert('Błąd podczas zapisywania');
      console.error(error);
      return;
    }

    alert('Zapisano!');
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-[#1c1f33] rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-[#d3bb73]/20">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">Metadata strony</h2>
            <p className="text-[#e5e4e2]/60 text-sm">{pageName}</p>
          </div>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Tytuł strony (opcjonalny)
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Pozostaw puste aby użyć domyślnego"
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Meta Description (opcjonalny)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Pozostaw puste aby użyć domyślnego"
              rows={3}
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
            />
          </div>

          {/* OG Image */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Open Graph Image URL (opcjonalny)
            </label>
            <input
              type="url"
              value={ogImage}
              onChange={(e) => setOgImage(e.target.value)}
              placeholder="https://mavinci.pl/images/og-image.jpg"
              className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
            />
          </div>

          {/* Keywords */}
          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Słowa kluczowe (keywords)
            </label>

            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={newKeyword}
                onChange={(e) => setNewKeyword(e.target.value)}
                onKeyPress={(e) => e.key === 'Enter' && handleAddKeyword()}
                placeholder="Wpisz słowo kluczowe..."
                className="flex-1 bg-[#0f1119] border border-[#d3bb73]/20 rounded px-4 py-2 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
              />
              <button
                onClick={handleAddKeyword}
                className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
              >
                <Plus className="w-4 h-4" />
                Dodaj
              </button>
            </div>

            {keywords.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {keywords.map((keyword, index) => (
                  <div
                    key={index}
                    className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-full px-3 py-1.5 flex items-center gap-2"
                  >
                    <span className="text-[#e5e4e2] text-sm">{keyword}</span>
                    <button
                      onClick={() => handleRemoveKeyword(keyword)}
                      className="text-[#800020] hover:text-[#800020]/80"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-[#e5e4e2]/40 text-sm">Brak słów kluczowych</p>
            )}
          </div>

          {/* Info */}
          <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded p-4">
            <h3 className="text-[#d3bb73] font-medium mb-2">Informacja</h3>
            <ul className="text-[#e5e4e2]/60 text-sm space-y-1">
              <li>• Keywords są używane w meta tags dla SEO</li>
              <li>• Title i Description nadpisują wartości domyślne jeśli są wypełnione</li>
              <li>• OG Image jest używany dla podglądów na social media</li>
              <li>• Wszystkie pola są opcjonalne</li>
            </ul>
          </div>
        </div>

        <div className="sticky bottom-0 bg-[#1c1f33] border-t border-[#d3bb73]/20 p-6 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded hover:bg-[#800020]/30 transition-colors"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {isSaving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
