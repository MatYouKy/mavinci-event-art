'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Save, ArrowLeft, Plus, Trash2, Eye } from 'lucide-react';

interface Placeholder {
  key: string;
  label: string;
  type: string;
}

export default function EditTemplatePage() {
  const params = useParams();
  const router = useRouter();
  const templateId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    content: '',
    category: 'event',
    is_active: true,
  });
  const [logoSettings, setLogoSettings] = useState({
    header_logo_url: '',
    header_logo_height: 50,
    center_logo_url: '',
    center_logo_height: 100,
    show_header_logo: false,
    show_center_logo: false,
  });
  const [placeholders, setPlaceholders] = useState<Placeholder[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    fetchTemplate();
  }, [templateId]);

  const fetchTemplate = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contract_templates')
        .select('*')
        .eq('id', templateId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setFormData({
          name: data.name,
          description: data.description || '',
          content: data.content || '',
          category: data.category,
          is_active: data.is_active,
        });
        setLogoSettings({
          header_logo_url: data.header_logo_url || '',
          header_logo_height: data.header_logo_height || 50,
          center_logo_url: data.center_logo_url || '',
          center_logo_height: data.center_logo_height || 100,
          show_header_logo: data.show_header_logo || false,
          show_center_logo: data.show_center_logo || false,
        });
        setPlaceholders(data.placeholders || []);
      }
    } catch (err) {
      console.error('Error fetching template:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      alert('Nazwa szablonu jest wymagana');
      return;
    }

    try {
      setSaving(true);
      const { error } = await supabase
        .from('contract_templates')
        .update({
          name: formData.name,
          description: formData.description || null,
          content: formData.content,
          category: formData.category,
          is_active: formData.is_active,
          placeholders: placeholders,
          header_logo_url: logoSettings.header_logo_url || null,
          header_logo_height: logoSettings.header_logo_height,
          center_logo_url: logoSettings.center_logo_url || null,
          center_logo_height: logoSettings.center_logo_height,
          show_header_logo: logoSettings.show_header_logo,
          show_center_logo: logoSettings.show_center_logo,
        })
        .eq('id', templateId);

      if (error) throw error;

      alert('Szablon zapisany pomyślnie');
      router.push('/crm/contract-templates');
    } catch (err) {
      console.error('Error saving template:', err);
      alert('Błąd podczas zapisywania szablonu');
    } finally {
      setSaving(false);
    }
  };

  const addPlaceholder = () => {
    setPlaceholders([...placeholders, { key: '', label: '', type: 'text' }]);
  };

  const updatePlaceholder = (index: number, field: keyof Placeholder, value: string) => {
    const updated = [...placeholders];
    updated[index][field] = value;
    setPlaceholders(updated);
  };

  const removePlaceholder = (index: number) => {
    setPlaceholders(placeholders.filter((_, i) => i !== index));
  };

  const insertPlaceholder = (key: string) => {
    const textarea = document.getElementById('content') as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = formData.content;
      const before = text.substring(0, start);
      const after = text.substring(end);
      const newContent = before + `{{${key}}}` + after;
      setFormData({ ...formData, content: newContent });

      setTimeout(() => {
        textarea.focus();
        const newPosition = start + key.length + 4;
        textarea.setSelectionRange(newPosition, newPosition);
      }, 0);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/contract-templates')}
              className="p-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            >
              <ArrowLeft className="h-6 w-6" />
            </button>
            <div>
              <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">Edycja szablonu</h1>
              <p className="text-[#e5e4e2]/60">Edytuj szablon umowy</p>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]/80"
            >
              <Eye className="h-5 w-5" />
              {showPreview ? 'Edycja' : 'Podgląd'}
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <Save className="h-5 w-5" />
              {saving ? 'Zapisywanie...' : 'Zapisz'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Podstawowe informacje</h2>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa szablonu *</label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="h-20 w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Kategoria</label>
                    <select
                      value={formData.category}
                      onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="event">Event</option>
                      <option value="service">Usługa</option>
                      <option value="rental">Wynajem</option>
                      <option value="other">Inne</option>
                    </select>
                  </div>

                  <div>
                    <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                    <select
                      value={formData.is_active ? 'active' : 'inactive'}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          is_active: e.target.value === 'active',
                        })
                      }
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                    >
                      <option value="active">Aktywny</option>
                      <option value="inactive">Nieaktywny</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Ustawienia logo</h2>

              <div className="space-y-6">
                <div className="rounded-lg border border-[#d3bb73]/10 p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="show_header_logo"
                      checked={logoSettings.show_header_logo}
                      onChange={(e) =>
                        setLogoSettings({
                          ...logoSettings,
                          show_header_logo: e.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <label htmlFor="show_header_logo" className="font-medium text-[#e5e4e2]">
                      Logo w nagłówku
                    </label>
                  </div>

                  {logoSettings.show_header_logo && (
                    <div className="ml-6 space-y-3">
                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">URL logo</label>
                        <input
                          type="text"
                          value={logoSettings.header_logo_url}
                          onChange={(e) =>
                            setLogoSettings({
                              ...logoSettings,
                              header_logo_url: e.target.value,
                            })
                          }
                          placeholder="https://example.com/logo.png"
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                          Wysokość logo (px): {logoSettings.header_logo_height}
                        </label>
                        <input
                          type="range"
                          min="20"
                          max="100"
                          value={logoSettings.header_logo_height}
                          onChange={(e) =>
                            setLogoSettings({
                              ...logoSettings,
                              header_logo_height: parseInt(e.target.value),
                            })
                          }
                          className="w-full"
                        />
                      </div>

                      {logoSettings.header_logo_url && (
                        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
                          <p className="mb-2 text-xs text-[#e5e4e2]/60">Podgląd:</p>
                          <img
                            src={logoSettings.header_logo_url}
                            alt="Logo nagłówka"
                            style={{ height: `${logoSettings.header_logo_height}px` }}
                            className="object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-[#d3bb73]/10 p-4">
                  <div className="mb-4 flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="show_center_logo"
                      checked={logoSettings.show_center_logo}
                      onChange={(e) =>
                        setLogoSettings({
                          ...logoSettings,
                          show_center_logo: e.target.checked,
                        })
                      }
                      className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]"
                    />
                    <label htmlFor="show_center_logo" className="font-medium text-[#e5e4e2]">
                      Logo centralne (pierwsza strona)
                    </label>
                  </div>

                  {logoSettings.show_center_logo && (
                    <div className="ml-6 space-y-3">
                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">URL logo</label>
                        <input
                          type="text"
                          value={logoSettings.center_logo_url}
                          onChange={(e) =>
                            setLogoSettings({
                              ...logoSettings,
                              center_logo_url: e.target.value,
                            })
                          }
                          placeholder="https://example.com/logo.png"
                          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="mb-2 block text-sm text-[#e5e4e2]/60">
                          Wysokość logo (px): {logoSettings.center_logo_height}
                        </label>
                        <input
                          type="range"
                          min="50"
                          max="200"
                          value={logoSettings.center_logo_height}
                          onChange={(e) =>
                            setLogoSettings({
                              ...logoSettings,
                              center_logo_height: parseInt(e.target.value),
                            })
                          }
                          className="w-full"
                        />
                      </div>

                      {logoSettings.center_logo_url && (
                        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-center">
                          <p className="mb-2 text-xs text-[#e5e4e2]/60">Podgląd:</p>
                          <img
                            src={logoSettings.center_logo_url}
                            alt="Logo centralne"
                            style={{ height: `${logoSettings.center_logo_height}px` }}
                            className="mx-auto object-contain"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Treść szablonu</h2>

              {showPreview ? (
                <div className="min-h-[600px] rounded-lg bg-white p-8 text-black">
                  {logoSettings.show_header_logo && logoSettings.header_logo_url && (
                    <div className="mb-6 border-b border-gray-300 pb-4">
                      <img
                        src={logoSettings.header_logo_url}
                        alt="Logo"
                        style={{ height: `${logoSettings.header_logo_height}px` }}
                        className="object-contain"
                      />
                    </div>
                  )}

                  {logoSettings.show_center_logo && logoSettings.center_logo_url && (
                    <div className="mb-12 text-center">
                      <img
                        src={logoSettings.center_logo_url}
                        alt="Logo"
                        style={{ height: `${logoSettings.center_logo_height}px` }}
                        className="mx-auto object-contain"
                      />
                    </div>
                  )}

                  <div
                    className="whitespace-pre-wrap font-mono text-sm"
                    style={{ whiteSpace: 'pre-wrap' }}
                  >
                    {formData.content || 'Brak treści'}
                  </div>
                </div>
              ) : (
                <textarea
                  id="content"
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 font-mono text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  rows={25}
                  placeholder="Wpisz treść umowy. Użyj {{placeholder_name}} dla dynamicznych wartości."
                />
              )}

              <p className="mt-2 text-xs text-[#e5e4e2]/40">
                Użyj podwójnych nawiasów klamrowych dla placeholderów, np.{' '}
                <code className="rounded bg-[#0f1119] px-2 py-1">{`{{client_name}}`}</code>
              </p>
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-light text-[#e5e4e2]">Placeholdery</h2>
                <button
                  onClick={addPlaceholder}
                  className="flex items-center gap-1 text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj
                </button>
              </div>

              <div className="max-h-[calc(100vh-300px)] space-y-3 overflow-y-auto">
                {placeholders.length === 0 ? (
                  <p className="py-4 text-center text-sm text-[#e5e4e2]/40">Brak placeholderów</p>
                ) : (
                  placeholders.map((placeholder, index) => (
                    <div
                      key={index}
                      className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <input
                            type="text"
                            value={placeholder.key}
                            onChange={(e) => updatePlaceholder(index, 'key', e.target.value)}
                            placeholder="klucz"
                            className="flex-1 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          />
                          <button
                            onClick={() => removePlaceholder(index)}
                            className="text-red-400 hover:text-red-300"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>

                        <input
                          type="text"
                          value={placeholder.label}
                          onChange={(e) => updatePlaceholder(index, 'label', e.target.value)}
                          placeholder="Etykieta"
                          className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                        />

                        <div className="flex gap-2">
                          <select
                            value={placeholder.type}
                            onChange={(e) => updatePlaceholder(index, 'type', e.target.value)}
                            className="flex-1 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          >
                            <option value="text">Text</option>
                            <option value="textarea">Textarea</option>
                            <option value="number">Number</option>
                            <option value="date">Date</option>
                          </select>

                          <button
                            onClick={() => insertPlaceholder(placeholder.key)}
                            disabled={!placeholder.key}
                            className="rounded bg-[#d3bb73] px-2 py-1 text-xs text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
                          >
                            Wstaw
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
