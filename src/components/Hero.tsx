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

  const handleSave = async (values: any) => {
    try {
      const desktopImage = values.heroImage as IUploadImage | IImage;
      let desktopUrl = '';

      if ('file' in desktopImage && desktopImage.file) {
        desktopUrl = await uploadImage(desktopImage.file, 'hero');
      } else if (desktopImage?.image_metadata?.desktop?.src) {
        desktopUrl = desktopImage.image_metadata.desktop.src;
      }

      if (heroImage && heroImage.id) {
        const { error } = await supabase
          .from('site_images')
          .update({
            desktop_url: desktopUrl,
            alt_text: desktopImage.alt || '',
          })
          .eq('id', heroImage.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('site_images').insert({
          section: 'hero',
          name: 'Hero image',
          description: '',
          desktop_url: desktopUrl,
          alt_text: desktopImage.alt || '',
          position: 'center',
          order_index: 1,
          is_active: true,
        });

        if (error) throw error;
      }

      await loadImage();
    } catch (error) {
      console.error('Error saving image:', error);
    }
  };

  return (
    <header className="relative min-h-screen flex items-center" role="banner">
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
          onSubmit={handleSave}
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
              <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/80 via-[#800020]/50 to-[#1c1f33]/90 pointer-events-none" style={{ zIndex: 2 }}></div>
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
                : 'url(https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=1920)',
            }}
            role="img"
            aria-label={heroImage?.alt_text || "Profesjonalna organizacja eventów biznesowych"}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/80 via-[#800020]/50 to-[#1c1f33]/90"></div>
        </>
      )}

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-20 md:py-32">
        <div className="max-w-3xl">
          <h1 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-light text-white mb-6 md:mb-8 leading-tight">
            Kompleksowa Obsługa
            <br />
            <span className="text-[#d3bb73]">Eventów</span>
          </h1>

          <p className="text-base sm:text-lg md:text-xl text-white/80 font-light mb-8 md:mb-12 max-w-2xl leading-relaxed">
            Od DJ-ów i nagłośnienia po oświetlenie sceniczne i streamingi. Realizujemy eventy w północnej i centralnej Polsce.
          </p>

          <div className="flex flex-col sm:flex-row gap-4" role="group" aria-label="Akcje główne">
            <a
              href="#portfolio"
              className="bg-[#d3bb73] text-[#1c1f33] px-8 py-3 md:py-4 rounded-full text-sm md:text-base font-medium hover:bg-[#d3bb73]/90 transition-all duration-200 hover:scale-105 shadow-lg text-center"
              aria-label="Zobacz nasze realizacje eventowe"
            >
              Zobacz Nasze Realizacje
            </a>
            <a
              href="#kontakt"
              className="bg-white/10 backdrop-blur-md border border-[#d3bb73]/40 text-white px-8 py-3 md:py-4 rounded-full text-sm md:text-base font-light hover:bg-white/20 transition-all duration-200 flex items-center justify-center gap-2 group"
              aria-label="Skontaktuj się z agencją eventową"
            >
              Bezpłatna Wycena
              <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-200" aria-hidden="true" />
            </a>
          </div>
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-10 animate-bounce hidden md:block" aria-hidden="true">
        <div className="w-6 h-10 border-2 border-white/40 rounded-full flex items-start justify-center p-2">
          <div className="w-1.5 h-1.5 bg-white/60 rounded-full"></div>
        </div>
      </div>
    </header>
  );
}
