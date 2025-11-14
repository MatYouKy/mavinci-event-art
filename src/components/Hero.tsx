'use client';

import { ArrowRight } from 'lucide-react';
import { useState, useEffect } from 'react';
import { getSiteImage, SiteImage } from '../lib/siteImages';
import { useEditMode } from '../contexts/EditModeContext';
import { ImageEditorField } from './ImageEditorField';
import { Formik, Form } from 'formik';
import { IImage, IUploadImage } from '../types/image';
import { uploadImage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function Hero() {
  const [heroImage, setHeroImage] = useState<SiteImage | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { isEditMode } = useEditMode();

  const loadImage = async () => {
    const image = await getSiteImage('hero');
    setHeroImage(image);
  };

  useEffect(() => {
    loadImage();

    const checkMobile = () => {
      setIsMobile(window.innerWidth < 768);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const initialImage: IImage | null = heroImage
    ? {
        id: heroImage.id,
        alt: heroImage.alt_text || '',
        image_metadata: {
          desktop: {
            src: heroImage.desktop_url,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: heroImage.mobile_url
            ? {
                src: heroImage.mobile_url,
                position: { posX: 0, posY: 0, scale: 1 },
              }
            : undefined,
        },
      }
    : null;

  const handleSave = async (payload: { file?: File; image: IUploadImage | IImage }) => {
    try {
      let desktopUrl = '';

      // Jeśli jest nowy plik, wgraj go
      if (payload.file) {
        desktopUrl = await uploadImage(payload.file, 'hero');
      }
      // Jeśli nie ma pliku, użyj istniejącego URL
      else if (payload.image?.image_metadata?.desktop?.src) {
        desktopUrl = payload.image.image_metadata.desktop.src;
      }

      if (!desktopUrl) {
        throw new Error('Brak URL obrazu');
      }

      if (heroImage && heroImage.id) {
        const { error } = await supabase
          .from('site_images')
          .update({
            desktop_url: desktopUrl,
            alt_text: payload.image.alt || '',
          })
          .eq('id', heroImage.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('site_images').insert({
          section: 'hero',
          name: 'Hero image',
          description: '',
          desktop_url: desktopUrl,
          alt_text: payload.image.alt || '',
          position: 'center',
          order_index: 1,
          is_active: true,
        });

        if (error) throw error;
      }

      await loadImage();
      console.log('Obraz zapisany pomyślnie!');
    } catch (error) {
      console.error('Error saving image:', error);
      alert('Błąd podczas zapisywania obrazu: ' + (error as Error).message);
    }
  };

  return (
    <header className="relative flex min-h-screen items-center" role="banner">
      {isEditMode ? (
        <Formik
          initialValues={{
            heroImage: initialImage || {
              alt: '',
              image_metadata: {
                desktop: {
                  position: { posX: 0, posY: 0, scale: 1 },
                },
              },
            },
          }}
          onSubmit={() => {}}
          enableReinitialize
        >
          {() => (
            <Form className="absolute inset-0">
              <div className="absolute inset-0" style={{ zIndex: 1 }}>
                <ImageEditorField
                  fieldName="heroImage"
                  image={initialImage}
                  isAdmin={true}
                  withMenu={true}
                  mode="horizontal"
                  menuPosition="right-bottom"
                  onSave={handleSave}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                />
              </div>
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#1c1f33]/80 via-[#800020]/50 to-[#1c1f33]/90"
                style={{ zIndex: 2 }}
              ></div>
            </Form>
          )}
        </Formik>
      ) : (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: heroImage
                ? `url(${isMobile && heroImage.mobile_url ? heroImage.mobile_url : heroImage.desktop_url})`
                : 'url(https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1760341625716-d0b65e.jpg)',
            }}
            role="img"
            aria-label={heroImage?.alt_text || 'Profesjonalna organizacja eventów biznesowych'}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/80 via-[#800020]/50 to-[#1c1f33]/90"></div>
        </>
      )}

      <div className="relative z-10 mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-32 lg:px-8">
        <div className="max-w-3xl">
          <h1 className="mb-6 text-4xl font-light leading-tight text-white sm:text-5xl md:mb-8 md:text-6xl lg:text-7xl">
            Kompleksowa Obsługa
            <br />
            <span className="text-[#d3bb73]">Eventów</span>
          </h1>

          <p className="mb-8 max-w-2xl text-base font-light leading-relaxed text-white/80 sm:text-lg md:mb-12 md:text-xl">
            Od DJ-ów i nagłośnienia po oświetlenie sceniczne i streamingi. Realizujemy eventy w
            północnej i centralnej Polsce.
          </p>

          <div className="flex flex-col gap-4 sm:flex-row" role="group" aria-label="Akcje główne">
            <a
              href="#portfolio"
              className="rounded-full bg-[#d3bb73] px-8 py-3 text-center text-sm font-medium text-[#1c1f33] shadow-lg transition-all duration-200 hover:scale-105 hover:bg-[#d3bb73]/90 md:py-4 md:text-base"
              aria-label="Zobacz nasze realizacje eventowe"
            >
              Zobacz Nasze Realizacje
            </a>
            <a
              href="#kontakt"
              className="group flex items-center justify-center gap-2 rounded-full border border-[#d3bb73]/40 bg-white/10 px-8 py-3 text-sm font-light text-white backdrop-blur-md transition-all duration-200 hover:bg-white/20 md:py-4 md:text-base"
              aria-label="Skontaktuj się z agencją eventową"
            >
              Bezpłatna Wycena
              <ArrowRight
                className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1"
                aria-hidden="true"
              />
            </a>
          </div>
        </div>
      </div>

      <div
        className="absolute bottom-8 left-1/2 z-10 hidden -translate-x-1/2 transform animate-bounce md:block"
        aria-hidden="true"
      >
        <div className="flex h-10 w-6 items-start justify-center rounded-full border-2 border-white/40 p-2">
          <div className="h-1.5 w-1.5 rounded-full bg-white/60"></div>
        </div>
      </div>
    </header>
  );
}
