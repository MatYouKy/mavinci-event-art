'use client';

import { useState } from 'react';
import { CreditCard as Edit2, Save, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { SiteImage } from '../lib/siteImages';
import { Formik, Form } from 'formik';
import { ImageEditorField } from './ImageEditorField';
import { IUploadImage, IImage } from '../types/image';
import { uploadImage } from '../lib/storage';

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

  if (!isEditMode) return null;

  const positionClasses = {
    'top-left': 'top-4 left-4',
    'top-right': 'top-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'bottom-right': 'bottom-4 right-4',
  };

  const initialImage: IImage | null = image
    ? {
        id: image.id,
        alt: image.alt_text || '',
        image_metadata: {
          desktop: {
            src: image.desktop_url,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: image.mobile_url
            ? {
                src: image.mobile_url,
                position: { posX: 0, posY: 0, scale: 1 },
              }
            : undefined,
        },
      }
    : null;

  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      const desktopImage = values.desktopImage as IUploadImage | IImage;
      let desktopUrl = '';
      let mobileUrl = '';

      if ('file' in desktopImage && desktopImage.file) {
        desktopUrl = await uploadImage(desktopImage.file, section);
      } else if (desktopImage?.image_metadata?.desktop?.src) {
        desktopUrl = desktopImage.image_metadata.desktop.src;
      }

      const mobileImage = values.mobileImage as IUploadImage | IImage | undefined;
      if (mobileImage) {
        if ('file' in mobileImage && mobileImage.file) {
          mobileUrl = await uploadImage(mobileImage.file, `${section}-mobile`);
        } else if (mobileImage?.image_metadata?.mobile?.src) {
          mobileUrl = mobileImage.image_metadata.mobile.src;
        }
      }

      if (image && image.id) {
        const { error } = await supabase
          .from('site_images')
          .update({
            desktop_url: desktopUrl,
            mobile_url: mobileUrl || null,
            alt_text: desktopImage.alt || '',
          })
          .eq('id', image.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('site_images').insert({
          section: section,
          name: `${section} image`,
          description: '',
          desktop_url: desktopUrl,
          mobile_url: mobileUrl || null,
          alt_text: desktopImage.alt || '',
          position: 'center',
          order_index: 1,
          is_active: true,
        });

        if (error) throw error;
      }

      setIsOpen(false);
      if (onUpdate) onUpdate();
      window.location.reload();
    } catch (error) {
      console.error('Error saving image:', error);
      alert(
        'Błąd podczas zapisywania obrazu. Sprawdź czy tabela site_images istnieje w bazie danych.',
      );
    }
    setSaving(false);
  };

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`absolute ${positionClasses[position]} z-50 rounded-full bg-[#d3bb73] p-3 text-[#1c1f33] shadow-lg transition-all hover:scale-110 hover:bg-[#d3bb73]/90`}
        title={image ? 'Edytuj obraz' : 'Dodaj obraz'}
      >
        <Edit2 className="h-5 w-5" />
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-6xl overflow-y-auto rounded-lg bg-[#1c1f33]">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#1c1f33] p-6">
              <h2 className="text-2xl font-light text-[#e5e4e2]">Edytuj Obraz - {section}</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
              >
                <X className="h-6 w-6" />
              </button>
            </div>

            <Formik
              initialValues={{
                desktopImage: initialImage || {
                  alt: '',
                  image_metadata: {
                    desktop: {
                      position: { posX: 0, posY: 0, scale: 1 },
                    },
                  },
                },
                mobileImage: initialImage || undefined,
              }}
              onSubmit={handleSave}
            >
              {() => (
                <Form>
                  <div className="space-y-8 p-6">
                    <div>
                      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">Obraz Desktop *</h3>
                      <div className="rounded-lg bg-[#0f1119] p-4">
                        <ImageEditorField
                          fieldName="desktopImage"
                          image={initialImage}
                          isAdmin={true}
                          withMenu={true}
                          mode="horizontal"
                          menuPosition="right-bottom"
                          onSave={async () => {}}
                        />
                      </div>
                      <p className="mt-2 text-sm text-[#e5e4e2]/60">
                        Kliknij menu (trzy kropki) aby wgrać obraz lub ustawić pozycję
                      </p>
                    </div>

                    <div>
                      <h3 className="mb-4 text-lg font-medium text-[#e5e4e2]">
                        Obraz Mobile (opcjonalnie)
                      </h3>
                      <div className="rounded-lg bg-[#0f1119] p-4">
                        <ImageEditorField
                          fieldName="mobileImage"
                          image={initialImage?.image_metadata?.mobile ? initialImage : null}
                          isAdmin={true}
                          withMenu={true}
                          mode="vertical"
                          menuPosition="right-bottom"
                          onSave={async () => {}}
                        />
                      </div>
                      <p className="mt-2 text-sm text-[#e5e4e2]/60">
                        Opcjonalnie: wgraj osobny obraz dla urządzeń mobilnych
                      </p>
                    </div>

                    <div className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 p-4">
                      <p className="text-sm text-[#e5e4e2]/80">
                        💡 <strong>Instrukcja:</strong>
                      </p>
                      <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-[#e5e4e2]/70">
                        <li>Kliknij menu (⋮) na obrazie aby wgrać zdjęcie</li>
                        <li>Po wgraniu możesz ustawić pozycję (przesunięcie, skalowanie)</li>
                        <li>Kliknij zielony przycisk ✓ aby zaakceptować zmiany</li>
                        <li>Na końcu kliknij "Zapisz Zmiany" na dole formularza</li>
                      </ul>
                    </div>
                  </div>

                  <div className="sticky bottom-0 flex gap-3 border-t border-[#d3bb73]/20 bg-[#1c1f33] p-6">
                    <button
                      type="button"
                      onClick={() => setIsOpen(false)}
                      className="flex-1 rounded-lg bg-[#e5e4e2]/10 px-6 py-3 text-[#e5e4e2] transition-colors hover:bg-[#e5e4e2]/20"
                    >
                      Anuluj
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                    >
                      {saving ? (
                        'Zapisywanie...'
                      ) : (
                        <>
                          <Save className="h-5 w-5" />
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
