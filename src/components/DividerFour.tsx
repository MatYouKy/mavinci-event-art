'use client';

import { useState, useEffect } from 'react';
import { getSiteImage, SiteImage } from '../lib/siteImages';
import { useEditMode } from '../contexts/EditModeContext';
import { ImageEditorField } from './ImageEditorField';
import { Formik, Form } from 'formik';
import { IImage, IUploadImage } from '../types/image';
import { uploadImage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function DividerFour() {
  const [image, setImage] = useState<SiteImage | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { isEditMode } = useEditMode();

  const loadImage = async () => {
    const img = await getSiteImage('divider4');
    setImage(img);
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

  const handleSave = async (payload: { file?: File; image: IUploadImage | IImage }) => {
    try {
      let desktopUrl = '';

      if (payload.file) {
        desktopUrl = await uploadImage(payload.file, 'divider4');
      } else if (payload.image?.image_metadata?.desktop?.src) {
        desktopUrl = payload.image.image_metadata.desktop.src;
      }

      if (!desktopUrl) {
        throw new Error('Brak URL obrazu');
      }

      if (image && image.id) {
        const { error } = await supabase
          .from('site_images')
          .update({
            desktop_url: desktopUrl,
            alt_text: payload.image.alt || '',
          })
          .eq('id', image.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('site_images').insert({
          section: 'divider4',
          name: 'Divider 4 image',
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
    } catch (error) {
      console.error('Error saving image:', error);
      alert('Błąd podczas zapisywania obrazu: ' + (error as Error).message);
    }
  };

  return (
    <section className="relative h-[50vh] md:h-[60vh] overflow-hidden">
      {isEditMode ? (
        <Formik
          initialValues={{
            dividerImage: initialImage || {
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
                  fieldName="dividerImage"
                  image={initialImage}
                  isAdmin={true}
                  withMenu={true}
                  mode="horizontal"
                  menuPosition="right-bottom"
                  onSave={handleSave}
                  style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
                />
              </div>
              <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/85 via-[#800020]/75 to-[#1c1f33]/85 pointer-events-none" style={{ zIndex: 2 }}></div>
            </Form>
          )}
        </Formik>
      ) : (
        <>
          <div
            className="absolute inset-0 bg-cover bg-center bg-fixed"
            style={{
              backgroundImage: image
                ? `url(${isMobile && image.mobile_url ? image.mobile_url : image.desktop_url})`
                : 'url(https://images.pexels.com/photos/1157557/pexels-photo-1157557.jpeg?auto=compress&cs=tinysrgb&w=1920)',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/85 via-[#800020]/75 to-[#1c1f33]/85"></div>
        </>
      )}

      <div className="relative z-10 h-full flex items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl text-center">
          <div className="mb-8 animate-[fadeIn_1s_ease-out]">
            <div className="inline-flex items-center gap-3 mb-6">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#d3bb73]"></div>
              <span className="text-[#d3bb73] text-sm md:text-base font-light tracking-widest uppercase">
                Zaufaj Ekspertom
              </span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#d3bb73]"></div>
            </div>
          </div>

          <h2 className="text-4xl sm:text-5xl md:text-6xl lg:text-7xl font-light text-[#e5e4e2] mb-8 leading-tight animate-[fadeIn_1.2s_ease-out]">
            Rozpocznijmy współpracę
          </h2>

          <p className="text-base md:text-lg text-[#e5e4e2]/90 font-light leading-relaxed max-w-2xl mx-auto mb-10 animate-[fadeIn_1.4s_ease-out]">
            Jesteśmy gotowi, aby wysłuchać Twoich pomysłów i stworzyć event, który przekroczy oczekiwania
          </p>

          <div className="animate-[fadeIn_1.6s_ease-out]">
            <a
              href="#contact"
              className="group inline-flex items-center gap-3 px-10 py-5 bg-[#d3bb73] text-[#1c1f33] rounded-full text-base md:text-lg font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-2xl hover:shadow-[#d3bb73]/50"
            >
              Skontaktuj się z Nami
              <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform duration-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
              </svg>
            </a>
          </div>
        </div>
      </div>

      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNSI+PHBhdGggZD0iTTM2IDM0djItaDJ2LTJoLTJ6bTAtNGgydjJoLTJ2LTJ6bS0yIDJoMnYyaC0ydi0yem0wLTJoMnYyaC0ydi0yem0wIDRoMnYyaC0ydi0yem0wIDRoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yem0wIDJoMnYyaC0ydi0yem0yLTJoMnYyaC0ydi0yeiIvPjwvZz48L2c+PC9zdmc+')] opacity-20"></div>
      </div>

      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
    </section>
  );
}
