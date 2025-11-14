'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Save, MapPin, Calendar, Tag, Image as ImageIcon } from 'lucide-react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
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

  // Stan formularza
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [location, setLocation] = useState('Polska');
  const [eventDate, setEventDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [detailedDescription, setDetailedDescription] = useState('');
  const [orderIndex, setOrderIndex] = useState(0);
  const [imageData, setImageData] = useState<IUploadImage | null>(null);
  const [previewImage, setPreviewImage] = useState<string>(
    'https://images.pexels.com/photos/1190297/pexels-photo-1190297.jpeg?auto=compress&cs=tinysrgb&w=1920',
  );
  const [heroOpacity, setHeroOpacity] = useState(0.2);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);

  const handleImageSelect = (data: IUploadImage) => {
    setImageData(data);
    if (data.file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreviewImage(reader.result as string);
      };
      reader.readAsDataURL(data.file);
    }
  };

  const handleSave = async () => {
    if (!title || !imageData?.file) {
      showSnackbar('Uzupełnij tytuł i dodaj zdjęcie', 'error');
      return;
    }

    setSaving(true);
    try {
      const imageUrl = await uploadImage(imageData.file, 'portfolio');

      const newProject = {
        title,
        category,
        image: imageUrl,
        alt: imageData.alt || title,
        description,
        detailed_description: detailedDescription,
        order_index: orderIndex,
        location,
        event_date: eventDate,
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
        gallery,
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

  const formatDate = (dateString: string) => {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('pl-PL', { year: 'numeric', month: 'long', day: 'numeric' });
  };

  return (
    <>
      <Navbar />
      <main className="min-h-screen bg-gradient-to-b from-[#0a0c15] via-[#0f1119] to-[#1c1f33]">
        {/* Hero Section z edytowalnym tłem */}
        <section className="relative overflow-hidden py-24 md:py-32">
          {/* Background Image */}
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${previewImage})`,
              opacity: heroOpacity,
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c15]/50 via-[#0f1119]/30 to-[#1c1f33]" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {/* Top Navigation */}
            <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <button
                onClick={() => router.push('/portfolio')}
                className="inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
              >
                <ArrowLeft className="h-4 w-4" />
                Wróć do portfolio
              </button>

              <button
                onClick={handleSave}
                disabled={saving || !title || !imageData?.file}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz wydarzenie'}
              </button>
            </div>

            <div className="grid items-center gap-12 lg:grid-cols-2">
              {/* Left Column - Editable Content */}
              <div>
                {/* Category Badge */}
                <div className="mb-6">
                  <div className="inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                    <Tag className="h-5 w-5 text-[#d3bb73]" />
                    <input
                      type="text"
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      placeholder="Kategoria wydarzenia"
                      className="w-full border-none bg-transparent text-sm font-medium text-[#d3bb73] outline-none"
                    />
                  </div>
                </div>

                {/* Title */}
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Tytuł wydarzenia..."
                  className="mb-6 w-full border-b-2 border-transparent bg-transparent pb-2 text-4xl font-light text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73] md:text-5xl"
                />

                {/* Location & Date */}
                <div className="mb-8 flex flex-wrap gap-6">
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <MapPin className="h-5 w-5 text-[#d3bb73]" />
                    <input
                      type="text"
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      placeholder="Lokalizacja"
                      className="border-none bg-transparent text-sm outline-none"
                    />
                  </div>
                  <div className="flex items-center gap-2 text-[#e5e4e2]/70">
                    <Calendar className="h-5 w-5 text-[#d3bb73]" />
                    <span className="text-sm">{formatDate(eventDate)}</span>
                  </div>
                </div>

                {/* Description */}
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Opis wydarzenia... Opisz co się wydarzyło, jakie były atrakcje, ile osób uczestniczyło."
                  className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/40 p-4 text-base font-light leading-relaxed text-[#e5e4e2]/80 outline-none transition-colors focus:border-[#d3bb73]"
                  rows={6}
                />
              </div>

              {/* Right Column - Image Uploader */}
              <div className="space-y-4">
                <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/60 p-6 backdrop-blur-sm">
                  <div className="mb-4 flex items-center gap-2">
                    <ImageIcon className="h-5 w-5 text-[#d3bb73]" />
                    <h3 className="text-lg font-light text-[#e5e4e2]">Główne zdjęcie</h3>
                  </div>
                  <SimpleImageUploader onImageSelect={handleImageSelect} showPreview={true} />

                  {/* Opacity Control */}
                  <div className="mt-4">
                    <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                      Przeźroczystość tła: {Math.round(heroOpacity * 100)}%
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={heroOpacity * 100}
                      onChange={(e) => setHeroOpacity(parseInt(e.target.value) / 100)}
                      className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#1c1f33] accent-[#d3bb73]"
                    />
                  </div>
                </div>

                {/* Additional Settings */}
                <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33]/60 p-6 backdrop-blur-sm">
                  <h3 className="mb-4 text-lg font-light text-[#e5e4e2]">Ustawienia</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                        Data wydarzenia
                      </label>
                      <input
                        type="date"
                        value={eventDate}
                        onChange={(e) => setEventDate(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0c15] px-4 py-2 text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                        Kolejność wyświetlania
                      </label>
                      <input
                        type="number"
                        value={orderIndex}
                        onChange={(e) => setOrderIndex(parseInt(e.target.value) || 0)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0c15] px-4 py-2 text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Detailed Description Section */}
        <section className="border-y border-[#d3bb73]/10 bg-[#0f1119] py-16">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 text-center">
              <h2 className="mb-2 text-3xl font-light text-[#e5e4e2]">
                Szczegóły <span className="text-[#d3bb73]">Realizacji</span>
              </h2>
              <p className="text-sm text-[#e5e4e2]/60">
                Dodaj szczegółowy opis z konkretnymi słowami kluczowymi dla SEO
              </p>
            </div>

            <div className="rounded-2xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
              <label className="mb-3 block text-sm font-medium text-[#e5e4e2]">
                Szczegółowy opis wydarzenia (opcjonalny, ale zalecany dla SEO)
              </label>
              <textarea
                value={detailedDescription}
                onChange={(e) => setDetailedDescription(e.target.value)}
                placeholder="Np: Organizacja konferencji biznesowej w Warszawie dla 300 uczestników. Zapewniliśmy profesjonalne nagłośnienie sceny, oświetlenie LED, tłumaczenia symultaniczne na 5 języków, catering premium dla gości VIP, strefy networkingowe z meblami eventowymi, rejestrację wideo 4K, transmisję online na żywo, kompleksową obsługę techniczną wydarzenia oraz dedykowanego koordynatora projektu. Event obejmował panel dyskusyjny z ekspertami branżowymi, warsztaty praktyczne oraz uroczystą galę wieczorną..."
                className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0a0c15] px-4 py-4 font-light leading-relaxed text-[#e5e4e2] outline-none transition-colors focus:border-[#d3bb73]"
                rows={8}
              />
              <div className="mt-4 rounded-lg border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-4">
                <p className="mb-2 text-xs font-medium text-[#e5e4e2]/70">
                  Przykłady słów kluczowych z długim ogonem:
                </p>
                <ul className="space-y-1 text-xs text-[#e5e4e2]/60">
                  <li>• "organizacja eventów firmowych w [miasto]"</li>
                  <li>• "profesjonalne nagłośnienie i oświetlenie sceny"</li>
                  <li>• "catering na konferencje biznesowe"</li>
                  <li>• "wynajem sprzętu eventowego"</li>
                  <li>• "kompleksowa obsługa imprez korporacyjnych"</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* Gallery Section */}
        <section className="border-t border-[#d3bb73]/10 bg-[#0f1119] py-16">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8">
              <h2 className="mb-2 text-3xl font-light text-[#e5e4e2]">
                Galeria <span className="text-[#d3bb73]">Zdjęć</span>
              </h2>
              <p className="text-[#e5e4e2]/60">
                Dodaj więcej zdjęć z wydarzenia, które będą wyświetlane w galerii
              </p>
            </div>
            <PortfolioGalleryEditor gallery={gallery} onChange={setGallery} />
          </div>
        </section>

        {/* Tips Section */}
        <section className="bg-[#0a0c15] py-12">
          <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8">
            <div className="rounded-xl border border-[#d3bb73]/20 bg-[#d3bb73]/5 p-6">
              <h3 className="mb-3 text-lg font-light text-[#e5e4e2]">Porady</h3>
              <ul className="space-y-2 text-sm text-[#e5e4e2]/60">
                <li>• Wypełnij wszystkie pola aby stworzyć kompletne wydarzenie</li>
                <li>• Użyj suwaka przeźroczystości aby dostosować widoczność tła</li>
                <li>• Dodaj co najmniej 3-5 zdjęć do galerii dla najlepszego efektu</li>
                <li>• Kliknij "Zapisz wydarzenie" gdy będziesz gotowy</li>
              </ul>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
