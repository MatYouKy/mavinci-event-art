'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { Formik, Form } from 'formik';
import { FormInput } from '@/components/formik/FormInput';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';
import { PortfolioGalleryEditor } from '@/components/PortfolioGalleryEditor';
import { uploadImage } from '@/lib/storage';
import { supabase, GalleryImage } from '@/lib/supabase';
import { IUploadImage } from '@/types/image';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function NewPortfolioPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [saving, setSaving] = useState(false);
  const [previewImage, setPreviewImage] = useState<string>('https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920');

  const handleSave = async (values: any) => {
    setSaving(true);
    try {
      let imageUrl = '';

      if (values.imageData?.file) {
        imageUrl = await uploadImage(values.imageData.file, 'portfolio');
      }

      const newProject = {
        title: values.title,
        category: values.category,
        image: imageUrl,
        alt: values.imageData?.alt || values.title,
        description: values.description,
        order_index: parseInt(values.order_index) || 0,
        location: values.location,
        event_date: values.event_date,
        image_metadata: {
          desktop: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
          mobile: {
            src: imageUrl,
            position: { posX: 0, posY: 0, scale: 1 },
          },
        },
        gallery: values.gallery,
      };

      const { data, error } = await supabase
        .from('portfolio_projects')
        .insert([newProject])
        .select()
        .single();

      if (error) throw error;

      showSnackbar('Wydarzenie zostało dodane pomyślnie', 'success');
      router.push(`/portfolio/${data.id}`);
    } catch (error) {
      console.error('Error saving project:', error);
      showSnackbar('Błąd podczas zapisywania wydarzenia', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-[#0a0c15] via-[#0f1119] to-[#1c1f33]">
        <PageHeroImage
          section="portfolio"
          defaultImage={previewImage}
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
              <button
                onClick={() => router.push('/portfolio')}
                className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Wróć do portfolio
              </button>
            </div>

            <div className="text-center">
              <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                Nowe <span className="text-[#d3bb73]">Wydarzenie</span>
              </h1>
              <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed max-w-2xl mx-auto">
                Uzupełnij szczegóły wydarzenia i zobacz jak będzie wyglądać na stronie
              </p>
            </div>
          </div>
        </PageHeroImage>

        <section className="py-12 bg-[#0f1119] border-b border-[#d3bb73]/10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-2xl p-8">
              <h2 className="text-2xl font-light text-[#e5e4e2] mb-6">Szczegóły Wydarzenia</h2>
              <Formik
                initialValues={{
                  title: '',
                  category: '',
                  imageData: null as IUploadImage | null,
                  description: '',
                  order_index: 0,
                  gallery: [] as GalleryImage[],
                  location: 'Polska',
                  event_date: new Date().toISOString().split('T')[0],
                }}
                onSubmit={handleSave}
              >
                {({ submitForm, values, setFieldValue }) => (
                  <Form>
                    <div className="mb-6">
                      <label className="block text-[#e5e4e2] text-sm font-medium mb-3">Główne zdjęcie wydarzenia</label>
                      <SimpleImageUploader
                        onImageSelect={(imageData) => {
                          setFieldValue('imageData', imageData);
                          if (imageData.file) {
                            const reader = new FileReader();
                            reader.onloadend = () => {
                              setPreviewImage(reader.result as string);
                            };
                            reader.readAsDataURL(imageData.file);
                          }
                        }}
                        showPreview={true}
                      />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <FormInput name="title" label="Tytuł wydarzenia" />
                      <FormInput name="category" label="Kategoria" />
                      <FormInput name="location" label="Lokalizacja" />
                      <FormInput name="event_date" label="Data wydarzenia" type="date" />
                      <FormInput name="order_index" label="Kolejność" type="number" />
                      <div className="md:col-span-2">
                        <FormInput name="description" label="Opis wydarzenia" multiline rows={4} />
                      </div>
                    </div>

                    <div className="mb-6">
                      <PortfolioGalleryEditor
                        gallery={values.gallery}
                        onChange={(gallery) => setFieldValue('gallery', gallery)}
                      />
                    </div>

                    <div className="flex gap-3">
                      <button
                        type="button"
                        onClick={submitForm}
                        disabled={saving || !values.title || !values.imageData?.file}
                        className="flex items-center gap-2 px-6 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Save className="w-4 h-4" />
                        {saving ? 'Zapisywanie...' : 'Zapisz wydarzenie'}
                      </button>
                      <button
                        type="button"
                        onClick={() => router.push('/portfolio')}
                        className="px-6 py-2 bg-[#800020]/20 text-[#e5e4e2] rounded-lg hover:bg-[#800020]/30 transition-colors"
                      >
                        Anuluj
                      </button>
                    </div>
                  </Form>
                )}
              </Formik>
            </div>
          </div>
        </section>

        <section className="py-16 bg-[#0a0c15]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="bg-[#d3bb73]/5 border border-[#d3bb73]/20 rounded-xl p-6">
              <h3 className="text-lg font-light text-[#e5e4e2] mb-3">Podgląd</h3>
              <p className="text-[#e5e4e2]/60 text-sm">
                Po zapisaniu, wydarzenie będzie widoczne na stronie portfolio. Będziesz mógł je edytować w dowolnym momencie.
              </p>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
