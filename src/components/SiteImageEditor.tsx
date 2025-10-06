'use client';

import { useState } from 'react';
import { Edit2, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SiteImage } from '../lib/siteImages';
import { Formik, Form, Field } from 'formik';

interface SiteImageEditorProps {
  section: string;
  image: SiteImage | null;
  isEditMode: boolean;
  onUpdate?: () => void;
  position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';
}

export default function SiteImageEditor({
  section,
  image,
  isEditMode,
  onUpdate,
  position = 'bottom-right',
}: SiteImageEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!isEditMode || !image) return null;

  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };

  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('site_images')
        .update({
          desktop_url: values.desktop_url,
          mobile_url: values.mobile_url || null,
          alt_text: values.alt_text,
          position: values.position,
        })
        .eq('id', image.id);

      if (error) throw error;

      setIsOpen(false);
      if (onUpdate) onUpdate();
      window.location.reload();
    } catch (error) {
      console.error('Error saving image:', error);
      alert('Błąd podczas zapisywania obrazu');
    }
    setSaving(false);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`absolute ${positionClasses[position]} z-50 bg-[#d3bb73] hover:bg-[#d3bb73]/90 text-[#1c1f33] p-3 rounded-full shadow-lg transition-all hover:scale-110`}
        title="Edytuj obraz"
      >
        <Edit2 className="w-5 h-5" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999] p-4">
          <div className="bg-[#1c1f33] rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
              <h2 className="text-2xl font-light text-[#e5e4e2]">Edytuj Obraz</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            <Formik
              initialValues={{
                desktop_url: image.desktop_url,
                mobile_url: image.mobile_url || '',
                alt_text: image.alt_text,
                position: image.position,
              }}
              onSubmit={handleSave}
            >
              {({ values }) => (
                <Form>
                  <div className="p-6 space-y-6">
                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        Sekcja
                      </label>
                      <div className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2">
                        {image.name} ({section})
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        URL Desktop *
                      </label>
                      <Field
                        name="desktop_url"
                        type="text"
                        className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                        placeholder="https://images.pexels.com/..."
                      />
                      {values.desktop_url && (
                        <div className="mt-3">
                          <p className="text-xs text-[#e5e4e2]/60 mb-2">Podgląd Desktop:</p>
                          <div className="aspect-video bg-[#0f1119] rounded-lg overflow-hidden">
                            <img
                              src={values.desktop_url}
                              alt="Preview"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        URL Mobile (opcjonalnie)
                      </label>
                      <Field
                        name="mobile_url"
                        type="text"
                        className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                        placeholder="https://images.pexels.com/..."
                      />
                      {values.mobile_url && (
                        <div className="mt-3">
                          <p className="text-xs text-[#e5e4e2]/60 mb-2">Podgląd Mobile:</p>
                          <div className="aspect-video bg-[#0f1119] rounded-lg overflow-hidden max-w-xs">
                            <img
                              src={values.mobile_url}
                              alt="Preview Mobile"
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = 'none';
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        Tekst alternatywny (ALT)
                      </label>
                      <Field
                        name="alt_text"
                        type="text"
                        className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                        placeholder="Opis obrazu dla dostępności"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
                        Pozycja obrazu
                      </label>
                      <Field
                        as="select"
                        name="position"
                        className="bg-[#0f1119] border border-[#d3bb73]/20 text-[#e5e4e2] rounded-lg px-4 py-2 w-full focus:outline-none focus:border-[#d3bb73]"
                      >
                        <option value="center">Center</option>
                        <option value="top">Top</option>
                        <option value="bottom">Bottom</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                        <option value="cover">Cover</option>
                      </Field>
                    </div>

                    <div className="bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-lg p-4">
                      <p className="text-sm text-[#e5e4e2]/80">
                        💡 <strong>Wskazówka:</strong> Po wprowadzeniu URL, zobaczysz podgląd obrazu.
                        Upewnij się, że obraz wygląda dobrze przed zapisaniem.
                      </p>
                    </div>
                  </div>

                  <div className="sticky bottom-0 bg-[#1c1f33] border-t border-[#d3bb73]/20 p-6 flex gap-3">
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="flex-1 px-6 py-3 bg-[#e5e4e2]/10 text-[#e5e4e2] rounded-lg hover:bg-[#e5e4e2]/20 transition-colors"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 flex items-center justify-center gap-2 px-6 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                    >
                      {saving ? (
                        'Zapisywanie...'
                      ) : (
                        <>
                          <Save className="w-5 h-5" />
                          Zapisz Zmiany
                        </>
                      )}
                    </button>
                  </div>
                </Form>
              )}
            </Formik>
          </div>
        </div>
      )}
    </>
  );
}
