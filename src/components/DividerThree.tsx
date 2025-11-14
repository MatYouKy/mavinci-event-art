'use client';

import { useState, useEffect } from 'react';
import { getSiteImage, SiteImage } from '../lib/siteImages';
import { useEditMode } from '../contexts/EditModeContext';
import { ImageEditorField } from './ImageEditorField';
import { Formik, Form } from 'formik';
import { IImage, IUploadImage } from '../types/image';
import { uploadImage } from '../lib/storage';
import { supabase } from '../lib/supabase';

export default function DividerThree() {
  const [image, setImage] = useState<SiteImage | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const { isEditMode } = useEditMode();

  const loadImage = async () => {
    const img = await getSiteImage('divider3');
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
        desktopUrl = await uploadImage(payload.file, 'divider3');
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
          section: 'divider3',
          name: 'Divider 3 image',
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
    <section className="relative h-[50vh] overflow-hidden md:h-[60vh]">
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
              <div
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-[#1c1f33]/90 via-[#800020]/80 to-[#1c1f33]/90"
                style={{ zIndex: 1 }}
              ></div>
              <div className="absolute inset-0" style={{ zIndex: 50 }}>
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
            </Form>
          )}
        </Formik>
      ) : (
        <>
          <div
            className="absolute inset-0 bg-cover bg-fixed bg-center"
            style={{
              backgroundImage: image
                ? `url(${isMobile && image.mobile_url ? image.mobile_url : image.desktop_url})`
                : 'url(https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=1920)',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#1c1f33]/90 via-[#800020]/80 to-[#1c1f33]/90"></div>
        </>
      )}

      <div className="relative z-10 flex h-full items-center justify-center px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl text-center">
          <div className="mb-8 animate-[fadeIn_1s_ease-out]">
            <div className="mb-6 inline-flex items-center gap-3">
              <div className="h-px w-12 bg-gradient-to-r from-transparent to-[#d3bb73]"></div>
              <span className="text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
                Sprawdzony Proces
              </span>
              <div className="h-px w-12 bg-gradient-to-l from-transparent to-[#d3bb73]"></div>
            </div>
          </div>

          <h2 className="mb-6 animate-[fadeIn_1.2s_ease-out] text-4xl font-light leading-tight text-[#e5e4e2] sm:text-5xl md:text-6xl">
            Od wizji do realizacji
          </h2>

          <p className="mx-auto max-w-2xl animate-[fadeIn_1.4s_ease-out] text-base font-light leading-relaxed text-[#e5e4e2]/90 md:text-lg">
            Każdy etap starannie zaplanowany, każdy krok przemyślany
          </p>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-0">
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
