'use client';

import { useState, useEffect } from 'react';
import { Wine, Sparkles, Music, Camera, Utensils, Users, Palette, Star, Clock, Award, Heart, CreditCard as Edit, Save, X, Plus, Trash2, ArrowUp, ArrowDown, ChevronLeft, ChevronRight, XCircle } from 'lucide-react';
import Image from 'next/image';
import { supabase } from '@/lib/supabase/browser';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { uploadImage } from '@/lib/storage';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';
import { IUploadImage } from '@/types/image';

interface GalleryImage {
  id: string;
  image_url: string;
  alt_text: string;
  caption: string;
  category: string;
  order_index: number;
  is_visible: boolean;
}

interface ThemeItem {
  title: string;
  description: string;
  keywords: string;
  image: string;
}

const DEFAULT_THEMES: ThemeItem[] = [
  { title: 'Wieczór w stylu Las Vegas', description: 'Kasyno rozrywkowe, neonowe dekoracje, hostessy, dress code glamour. Stoły do ruletki, blackjacka i pokera. Muzyka lounge i koktajle.', keywords: 'impreza Las Vegas, wieczór kasynowy, event kasyno, impreza glamour', image: 'https://images.pexels.com/photos/787961/pexels-photo-787961.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór w klimacie PRL', description: 'Dekoracje z epoki, plakaty propagandowe, bar mleczny, muzyka lat 60-80. Zabawy i konkursy w stylu retro. Dress code robotniczy lub dyskotekowy.', keywords: 'impreza PRL, wieczór retro, event lata 80, zabawa w stylu PRL', image: 'https://images.pexels.com/photos/1763075/pexels-photo-1763075.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór kryminalny - Murder Mystery', description: 'Gra fabularna z rozwiązywaniem zagadki kryminalnej. Profesjonalni aktorzy, rekwizyty, scenografia detektywistyczna.', keywords: 'murder mystery, wieczór kryminalny, gra detektywistyczna', image: 'https://images.pexels.com/photos/5699456/pexels-photo-5699456.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór James Bond / Casino Royale', description: 'Elegancki wieczór agentów. Stroje wieczorowe, koktajle, kasyno, pokazy kaskaderskie. Muzyka filmowa na żywo.', keywords: 'impreza James Bond, wieczór Casino Royale, event szpiegowski', image: 'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór Gatsby / Lata 20.', description: 'Szalone lata dwudzieste: art deco, frędzelki, charleston, jazz na żywo, bąbelki szampana. Prohibicja bar z koktajlami epoki.', keywords: 'impreza Gatsby, wieczór lat 20, event art deco, charleston party', image: 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór meksykański - Fiesta', description: 'Kolorowe dekoracje, pinata, mariachi, tacos i margarita. Sombreros, kaktusy, papel picado. Taneczna atmosfera fiesty.', keywords: 'impreza meksykańska, wieczór fiesta, event meksyk', image: 'https://images.pexels.com/photos/1267697/pexels-photo-1267697.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór hawajski - Aloha Party', description: 'Tropikalne dekoracje, leje z kwiatów, tiki bar, koktajle egzotyczne. Taniec hula, konkurs limbo, muzyka reggae.', keywords: 'impreza hawajska, wieczór aloha, event tropikalny', image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór disco / lata 80.', description: 'Kula dyskotekowa, neony, retro muzyka, karaoke. Dress code fluorescencyjny, konkursy taneczne. DJ z hitami lat 70-80.', keywords: 'impreza disco, wieczór lat 80, event retro disco', image: 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór w stylu Hollywood', description: 'Czerwony dywan, Oscary firmowe, paparazzi, fotobudka filmowa. Gala z wręczeniem nagród, oprawa jak na wielkim festiwalu.', keywords: 'impreza Hollywood, wieczór filmowy, gala oscarowa', image: 'https://images.pexels.com/photos/1387174/pexels-photo-1387174.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór sportowy - Olimpiada firmowa', description: 'Rywalizacja drużynowa w dyscyplinach sportowych i zabawowych. Ceremonia otwarcia, medale, hymn firmowy.', keywords: 'olimpiada firmowa, event sportowy, team building sport', image: 'https://images.pexels.com/photos/3621104/pexels-photo-3621104.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór w stylu włoskim - Dolce Vita', description: 'Romantyczna atmosfera Włoch: wino, ser, oliwa. Muzyka italiana na żywo, dekoracje toskańskie, pokaz gotowania pasta.', keywords: 'impreza włoska, wieczór dolce vita, event italia', image: 'https://images.pexels.com/photos/1579739/pexels-photo-1579739.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczór maskaradowy - Wenecja', description: 'Maski weneckie, kostiumy karnawałowe, złoto i purpura. Muzyka barokowa, pokazy cyrkowe, tajemnicza atmosfera balu.', keywords: 'bal maskowy, wieczór wenecki, maskarada firmowa', image: 'https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=600' },
];

const DEFAULT_GALLERY: GalleryImage[] = [
  { id: '1', image_url: 'https://images.pexels.com/photos/787961/pexels-photo-787961.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Wieczór w stylu Las Vegas - kasyno rozrywkowe', caption: 'Wieczór Las Vegas z kasynem', category: 'las-vegas', order_index: 0, is_visible: true },
  { id: '2', image_url: 'https://images.pexels.com/photos/1283219/pexels-photo-1283219.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Bal maskowy w stylu weneckim', caption: 'Maskarada wenecka na gali firmowej', category: 'maskarada', order_index: 1, is_visible: true },
  { id: '3', image_url: 'https://images.pexels.com/photos/1540406/pexels-photo-1540406.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Impreza w stylu lat 20 - Gatsby party', caption: 'Wieczór Great Gatsby', category: 'gatsby', order_index: 2, is_visible: true },
  { id: '4', image_url: 'https://images.pexels.com/photos/2263436/pexels-photo-2263436.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Wieczór Hollywood - czerwony dywan', caption: 'Gala w stylu Hollywood', category: 'hollywood', order_index: 3, is_visible: true },
  { id: '5', image_url: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Impreza tropikalna - hawajski wieczór', caption: 'Aloha Party', category: 'hawajska', order_index: 4, is_visible: true },
  { id: '6', image_url: 'https://images.pexels.com/photos/1190298/pexels-photo-1190298.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Impreza disco - kula dyskotekowa', caption: 'Wieczór disco retro', category: 'disco', order_index: 5, is_visible: true },
  { id: '7', image_url: 'https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Impreza tematyczna z dekoracjami', caption: 'Event firmowy z oprawą scenograficzną', category: 'general', order_index: 6, is_visible: true },
  { id: '8', image_url: 'https://images.pexels.com/photos/1267697/pexels-photo-1267697.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Wieczór meksykański - fiesta', caption: 'Fiesta meksykańska', category: 'meksykanska', order_index: 7, is_visible: true },
  { id: '9', image_url: 'https://images.pexels.com/photos/2306281/pexels-photo-2306281.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Neonowe oświetlenie na imprezie', caption: 'Efekty świetlne', category: 'general', order_index: 8, is_visible: true },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Sparkles, Palette, Music, Camera, Utensils, Users,
};

const defaultBenefits = [
  { icon: 'Sparkles', title: 'Autorskie koncepty tematyczne', description: 'Nie korzystamy z gotowych schematów. Każdy wieczór tematyczny jest unikalnym projektem stworzonym specjalnie pod Twój event i grupę.' },
  { icon: 'Palette', title: 'Profesjonalna scenografia', description: 'Własna pracownia scenograficzna z doświadczonymi dekoratorami. Tworzymy immersyjne środowiska, które przenoszą gości w inny świat.' },
  { icon: 'Music', title: 'Kompletna oprawa muzyczna', description: 'DJ, zespół na żywo, soliści - dobieramy oprawę muzyczną idealnie pasującą do tematyki i klimatu wieczoru.' },
  { icon: 'Camera', title: 'Dokumentacja foto i video', description: 'Profesjonalny fotograf i kamerzysta. Fotobudka tematyczna, slow motion booth, drony. Pamiątki z imprezy na lata.' },
  { icon: 'Utensils', title: 'Catering tematyczny', description: 'Menu dopasowane do tematyki: meksykańskie, włoskie, amerykańskie, azjatyckie. Food trucki, stacje kulinarne, bary koktajlowe.' },
  { icon: 'Users', title: 'Zaangażowanie gości', description: 'Animatorzy, aktorzy, prowadzący z doświadczeniem. Interaktywne gry, konkursy, pokazy. Każdy gość jest aktywnym uczestnikiem.' },
];

const defaultFaq = [
  { question: 'Ile osób może uczestniczyć w wieczorze tematycznym?', answer: 'Organizujemy wieczory tematyczne od 20 do 2000 osób. Format i atrakcje dobieramy do wielkości grupy.' },
  { question: 'Jak wcześnie trzeba zarezerwować termin?', answer: 'Optymalna rezerwacja to 4-8 tygodni przed eventem. Dla dużych projektów zalecamy 2-3 miesiące.' },
  { question: 'Czy goście muszą przygotować kostiumy?', answer: 'Zależy od formatu. Możemy dostarczyć kompletne kostiumy i akcesoria dla wszystkich gości.' },
  { question: 'Czy organizujecie wieczory tematyczne na zewnątrz?', answer: 'Tak - realizujemy eventy plenerowe z pełną infrastrukturą: namioty, podłogi, zasilanie, oświetlenie outdoor.' },
  { question: 'Jaki budżet potrzebny jest na wieczór tematyczny?', answer: 'Budżet zależy od skali: kameralny wieczór (20-50 osób) od 8 000 zł, średni event (50-150 osób) od 20 000 zł.' },
  { question: 'Czy mogę wymyślić własną tematykę?', answer: 'Oczywiście! Autorskie tematyki to nasza mocna strona. Jedynym ograniczeniem jest wyobraźnia.' },
  { question: 'Co jest potrzebne od klienta?', answer: 'Potrzebujemy: datę, lokalizację, liczbę gości, orientacyjny budżet i preferowaną tematykę. Resztą zajmujemy się my.' },
  { question: 'Czy zajmujecie się też cateringiem i alkoholem?', answer: 'Tak - koordynujemy catering tematyczny, bary koktajlowe, food trucki i stacje kulinarne.' },
];

export default function WieczeoryTematycznePage() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  // Editable state
  const [themes, setThemes] = useState<ThemeItem[]>(DEFAULT_THEMES);
  const [gallery, setGallery] = useState<GalleryImage[]>(DEFAULT_GALLERY);
  const [introText, setIntroText] = useState('Organizujemy profesjonalne wieczory tematyczne, bale kostiumowe, imprezy z motywem przewodnim i eventy scenograficzne dla firm i klientów indywidualnych w całej Polsce. Tworzymy immersyjne doświadczenia, które przenoszą gości w inny świat.');
  const [introText2, setIntroText2] = useState('Zapewniamy kompletną produkcję wieczoru tematycznego: scenografię, dekoracje, oświetlenie, nagłośnienie, catering tematyczny, animacje, pokazy artystyczne i profesjonalnego konferansjera.');
  const [introImage, setIntroImage] = useState('https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg?auto=compress&cs=tinysrgb&w=800');
  const [seoText, setSeoText] = useState('Specjalizujemy się w organizacji wieczorów tematycznych dla firm, korporacji, agencji eventowych i klientów indywidualnych. Nasze imprezy z motywem przewodnim to kompletne doświadczenia sensoryczne - od scenografii i dekoracji, przez muzykę i oświetlenie, po catering tematyczny i animacje angażujące wszystkich gości.');
  const [seoImage, setSeoImage] = useState('https://images.pexels.com/photos/2306281/pexels-photo-2306281.jpeg?auto=compress&cs=tinysrgb&w=800');

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);

  // Per-image upload states (keyed by identifier like 'intro', 'seo', 'theme-0', 'gallery-abc')
  const [uploadingImages, setUploadingImages] = useState<Record<string, { status: 'uploading' | 'success' | 'error'; progress: number }>>({});

  const getUploadState = (key: string) => uploadingImages[key] || { status: 'idle' as const, progress: 0 };
  const getStatusProp = (key: string): 'idle' | 'uploading' | 'success' | 'error' => {
    const state = getUploadState(key);
    if (state.status === 'uploading') return 'uploading';
    if (state.status === 'success') return 'success';
    if (state.status === 'error') return 'error';
    return 'idle';
  };

  const uploadImmediately = async (file: File, key: string): Promise<string | null> => {
    setUploadingImages((prev) => ({ ...prev, [key]: { status: 'uploading', progress: 20 } }));
    try {
      setUploadingImages((prev) => ({ ...prev, [key]: { status: 'uploading', progress: 50 } }));
      const url = await uploadImage(file, 'themed-party');
      setUploadingImages((prev) => ({ ...prev, [key]: { status: 'success', progress: 100 } }));
      showSnackbar('Zdjecie zaladowane pomyslnie!', 'success');
      setTimeout(() => {
        setUploadingImages((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }, 3000);
      return url;
    } catch (err: any) {
      setUploadingImages((prev) => ({ ...prev, [key]: { status: 'error', progress: 0 } }));
      showSnackbar('Blad uploadu: ' + (err?.message || 'Nieznany blad'), 'error');
      setTimeout(() => {
        setUploadingImages((prev) => { const next = { ...prev }; delete next[key]; return next; });
      }, 4000);
      return null;
    }
  };

  const STORAGE_SECTION = 'themed-party';

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (isEditMode && !isEditing) {
      setIsEditing(true);
    } else if (!isEditMode && isEditing) {
      setIsEditing(false);
    }
  }, [isEditMode]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') setLightboxOpen(false);
      if (e.key === 'ArrowLeft') setCurrentGalleryIndex((p) => (p - 1 + gallery.length) % gallery.length);
      if (e.key === 'ArrowRight') setCurrentGalleryIndex((p) => (p + 1) % gallery.length);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen, gallery.length]);

  const fetchData = async () => {
    const { data, error } = await supabase
      .from('site_images')
      .select('*')
      .eq('section', STORAGE_SECTION)
      .eq('is_active', true)
      .order('order_index');

    if (error || !data || data.length === 0) return;

    for (const row of data) {
      const meta = row.image_metadata as Record<string, any> | null;
      if (row.name === 'intro') {
        if (row.desktop_url) setIntroImage(row.desktop_url);
        if (meta?.text) setIntroText(meta.text);
        if (meta?.text2) setIntroText2(meta.text2);
      } else if (row.name === 'seo') {
        if (row.desktop_url) setSeoImage(row.desktop_url);
        if (meta?.text) setSeoText(meta.text);
      } else if (row.name === 'themes') {
        if (meta?.items && Array.isArray(meta.items)) {
          setThemes(meta.items as ThemeItem[]);
        }
      } else if (row.name?.startsWith('gallery-')) {
        // Gallery items collected below
      }
    }

    const galleryRows = data
      .filter((r) => r.name?.startsWith('gallery-'))
      .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

    if (galleryRows.length > 0) {
      setGallery(
        galleryRows.map((r, idx) => ({
          id: r.id,
          image_url: r.desktop_url || '',
          alt_text: r.alt_text || '',
          caption: (r.image_metadata as any)?.caption || '',
          category: (r.image_metadata as any)?.category || 'general',
          order_index: idx,
          is_visible: true,
        }))
      );
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Delete all existing themed-party rows
      const { error: delErr } = await supabase
        .from('site_images')
        .delete()
        .eq('section', STORAGE_SECTION);

      if (delErr) {
        showSnackbar('Blad zapisu: ' + delErr.message, 'error');
        setSaving(false);
        return;
      }

      const rows: any[] = [
        {
          section: STORAGE_SECTION,
          name: 'intro',
          desktop_url: introImage,
          alt_text: 'Intro wieczory tematyczne',
          image_metadata: { text: introText, text2: introText2 },
          order_index: 0,
          is_active: true,
        },
        {
          section: STORAGE_SECTION,
          name: 'themes',
          desktop_url: '',
          alt_text: 'Themes data',
          image_metadata: { items: themes },
          order_index: 1,
          is_active: true,
        },
        {
          section: STORAGE_SECTION,
          name: 'seo',
          desktop_url: seoImage,
          alt_text: 'SEO wieczory tematyczne',
          image_metadata: { text: seoText },
          order_index: 2,
          is_active: true,
        },
      ];

      // Gallery rows
      gallery.forEach((img, idx) => {
        rows.push({
          section: STORAGE_SECTION,
          name: `gallery-${idx}`,
          desktop_url: img.image_url,
          alt_text: img.alt_text || '',
          image_metadata: { caption: img.caption, category: img.category },
          order_index: 100 + idx,
          is_active: true,
        });
      });

      const { error: insertErr } = await supabase.from('site_images').insert(rows);

      if (insertErr) {
        showSnackbar('Blad zapisu: ' + insertErr.message, 'error');
        setSaving(false);
        return;
      }

      showSnackbar('Zmiany zapisane pomyslnie!', 'success');
    } catch (error: any) {
      showSnackbar('Blad zapisu: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const addGalleryImage = () => {
    setGallery([...gallery, {
      id: crypto.randomUUID(),
      image_url: 'https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg?auto=compress&cs=tinysrgb&w=800',
      alt_text: 'Nowe zdjęcie',
      caption: '',
      category: 'general',
      order_index: gallery.length,
      is_visible: true,
    }]);
  };

  const removeGalleryImage = (id: string) => {
    setGallery(gallery.filter((img) => img.id !== id));
  };

  const moveGalleryImage = (index: number, direction: 'up' | 'down') => {
    const newGallery = [...gallery];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newGallery.length) return;
    [newGallery[index], newGallery[targetIndex]] = [newGallery[targetIndex], newGallery[index]];
    setGallery(newGallery);
  };

  const updateGalleryImage = (id: string, field: keyof GalleryImage, value: string) => {
    setGallery(gallery.map((img) => (img.id === id ? { ...img, [field]: value } : img)));
  };

  const addTheme = () => {
    setThemes([...themes, { title: 'Nowa tematyka', description: 'Opis tematyki...', keywords: '', image: 'https://images.pexels.com/photos/3171837/pexels-photo-3171837.jpeg?auto=compress&cs=tinysrgb&w=600' }]);
  };

  const removeTheme = (index: number) => {
    setThemes(themes.filter((_, i) => i !== index));
  };

  const updateTheme = (index: number, field: keyof ThemeItem, value: string) => {
    const newThemes = [...themes];
    newThemes[index] = { ...newThemes[index], [field]: value };
    setThemes(newThemes);
  };

  const openLightbox = (index: number) => {
    setCurrentGalleryIndex(index);
    setLightboxOpen(true);
  };

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        {/* Edit toolbar */}
        {isEditing && (
          <div className="sticky top-0 z-50 border-b border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-3">
            <div className="mx-auto flex max-w-7xl items-center justify-between">
              <div className="flex items-center gap-3">
                <Edit className="h-5 w-5 text-[#d3bb73]" />
                <span className="font-medium text-[#e5e4e2]">Tryb edycji - Wieczory Tematyczne</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => { setIsEditing(false); fetchData(); }}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20 disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                  Anuluj
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
                >
                  <Save className="h-4 w-4" />
                  {saving ? 'Zapisywanie...' : 'Zapisz wszystko'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Intro Section with image */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="mb-8 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Wieczory tematyczne na eventy firmowe i prywatne
                </h2>
                {isEditing ? (
                  <div className="space-y-4">
                    <textarea
                      value={introText}
                      onChange={(e) => setIntroText(e.target.value)}
                      rows={4}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                    />
                    <textarea
                      value={introText2}
                      onChange={(e) => setIntroText2(e.target.value)}
                      rows={3}
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                    />
                  </div>
                ) : (
                  <div className="space-y-6 text-lg leading-relaxed text-[#e5e4e2]/80">
                    <p>{introText}</p>
                    <p>{introText2}</p>
                  </div>
                )}
              </div>
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#d3bb73]/20">
                {isEditing ? (
                  <div className="h-full w-full">
                    <SimpleImageUploader
                      onImageSelect={async (data: IUploadImage) => {
                        if (data.file) {
                          const url = await uploadImmediately(data.file, 'intro');
                          if (url) setIntroImage(url);
                        }
                      }}
                      initialImage={{ src: introImage, alt: 'Intro' }}
                      showPreview={true}
                      uploadStatus={getStatusProp('intro')}
                      uploadProgress={getUploadState('intro').progress}
                    />
                  </div>
                ) : (
                  <>
                    <Image
                      src={introImage}
                      alt="Wieczór tematyczny - profesjonalna oprawa imprezy firmowej"
                      fill
                      sizes="(max-width: 1024px) 100vw, 50vw"
                      className="object-cover"
                      priority
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/40 to-transparent" />
                  </>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Themes Grid with images - editable */}
        <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Popularne tematyki wieczorów
            </h2>
            <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
              Wybierz gotowy motyw lub stwórz z nami autorską tematykę dopasowaną do Twojego eventu
            </p>

            {isEditing && (
              <div className="mb-6 flex justify-end">
                <button onClick={addTheme} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/30">
                  <Plus className="h-4 w-4" /> Dodaj tematykę
                </button>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {themes.map((theme, idx) => (
                <div key={idx} className="group overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] transition-all duration-300 hover:border-[#d3bb73]/40">
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <Image src={theme.image} alt={theme.title} fill sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/20 to-transparent" />
                    {isEditing && (
                      <button onClick={() => removeTheme(idx)} className="absolute right-2 top-2 z-10 rounded-full bg-red-600/80 p-1 text-white hover:bg-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="p-5">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input value={theme.title} onChange={(e) => updateTheme(idx, 'title', e.target.value)} className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-2 py-1 text-sm font-medium text-[#d3bb73] outline-none focus:border-[#d3bb73]" />
                        <textarea value={theme.description} onChange={(e) => updateTheme(idx, 'description', e.target.value)} rows={2} className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-2 py-1 text-xs text-[#e5e4e2]/70 outline-none focus:border-[#d3bb73]" />
                        <div className="h-40 w-full">
                          <SimpleImageUploader
                            onImageSelect={async (data: IUploadImage) => {
                              if (data.file) {
                                const url = await uploadImmediately(data.file, `theme-${idx}`);
                                if (url) updateTheme(idx, 'image', url);
                              }
                            }}
                            initialImage={{ src: theme.image, alt: theme.title }}
                            showPreview={true}
                            uploadStatus={getStatusProp(`theme-${idx}`)}
                            uploadProgress={getUploadState(`theme-${idx}`).progress}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="mb-2 text-lg font-medium text-[#d3bb73]">{theme.title}</h3>
                        <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{theme.description}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Gallery Section - editable */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Galeria wieczorów tematycznych
            </h2>
            <p className="mx-auto mb-12 max-w-2xl text-center text-[#e5e4e2]/60">
              Wybrane realizacje imprez tematycznych zorganizowanych przez nasz zespół
            </p>

            {isEditing ? (
              <div className="space-y-4">
                <div className="flex justify-end">
                  <button onClick={addGalleryImage} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/30">
                    <Plus className="h-4 w-4" /> Dodaj zdjęcie
                  </button>
                </div>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {gallery.map((img, idx) => (
                    <div key={img.id} className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-3">
                      <div className="h-40 w-full">
                        <SimpleImageUploader
                          onImageSelect={async (data: IUploadImage) => {
                            if (data.file) {
                              const url = await uploadImmediately(data.file, `gallery-${img.id}`);
                              if (url) updateGalleryImage(img.id, 'image_url', url);
                            }
                          }}
                          initialImage={{ src: img.image_url, alt: img.alt_text }}
                          showPreview={true}
                          uploadStatus={getStatusProp(`gallery-${img.id}`)}
                          uploadProgress={getUploadState(`gallery-${img.id}`).progress}
                        />
                      </div>
                      <div className="mt-3 space-y-2">
                        <input value={img.alt_text} onChange={(e) => updateGalleryImage(img.id, 'alt_text', e.target.value)} placeholder="Alt text (SEO)" className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]" />
                        <input value={img.caption} onChange={(e) => updateGalleryImage(img.id, 'caption', e.target.value)} placeholder="Podpis" className="w-full rounded border border-[#d3bb73]/20 bg-[#0f1119] px-2 py-1 text-xs text-[#e5e4e2] outline-none focus:border-[#d3bb73]" />
                        <div className="flex gap-2">
                          <button onClick={() => moveGalleryImage(idx, 'up')} disabled={idx === 0} className="rounded bg-[#d3bb73]/10 p-1 text-[#d3bb73] disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
                          <button onClick={() => moveGalleryImage(idx, 'down')} disabled={idx === gallery.length - 1} className="rounded bg-[#d3bb73]/10 p-1 text-[#d3bb73] disabled:opacity-30"><ArrowDown className="h-4 w-4" /></button>
                          <button onClick={() => removeGalleryImage(img.id)} className="ml-auto rounded bg-red-600/20 p-1 text-red-400 hover:bg-red-600/30"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {gallery.map((img, idx) => (
                  <button key={img.id} onClick={() => openLightbox(idx)} className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5">
                    <Image src={img.image_url} alt={img.alt_text || 'Wieczór tematyczny'} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-sm font-light text-[#e5e4e2]">{img.alt_text}</p>
                        {img.caption && <p className="mt-1 text-xs text-[#e5e4e2]/60">{img.caption}</p>}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Benefits Section */}
        <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Dlaczego warto wybrać nasze wieczory tematyczne
            </h2>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {defaultBenefits.map((benefit, idx) => {
                const IconComp = iconMap[benefit.icon] || Sparkles;
                return (
                  <div key={idx} className="flex gap-4">
                    <div className="flex-shrink-0">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10">
                        <IconComp className="h-6 w-6 text-[#d3bb73]" />
                      </div>
                    </div>
                    <div>
                      <h3 className="mb-1 font-medium text-[#e5e4e2]">{benefit.title}</h3>
                      <p className="text-sm leading-relaxed text-[#e5e4e2]/60">{benefit.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Wieczory tematyczne w liczbach
            </h2>
            <div className="grid grid-cols-2 gap-6 md:grid-cols-4">
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-6 text-center">
                <Award className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
                <div className="text-3xl font-bold text-[#d3bb73]">500+</div>
                <p className="mt-2 text-sm text-[#e5e4e2]/60">Zrealizowanych wieczorów tematycznych</p>
              </div>
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-6 text-center">
                <Users className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
                <div className="text-3xl font-bold text-[#d3bb73]">50 000+</div>
                <p className="mt-2 text-sm text-[#e5e4e2]/60">Zadowolonych uczestników imprez</p>
              </div>
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-6 text-center">
                <Star className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
                <div className="text-3xl font-bold text-[#d3bb73]">40+</div>
                <p className="mt-2 text-sm text-[#e5e4e2]/60">Gotowych tematyk do wyboru</p>
              </div>
              <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]/50 p-6 text-center">
                <Clock className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
                <div className="text-3xl font-bold text-[#d3bb73]">12 lat</div>
                <p className="mt-2 text-sm text-[#e5e4e2]/60">Doświadczenia w eventach tematycznych</p>
              </div>
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Najczęściej zadawane pytania o wieczory tematyczne
            </h2>
            <div className="space-y-4">
              {defaultFaq.map((item, idx) => (
                <details key={idx} className="group rounded-xl border border-[#d3bb73]/10 bg-[#0f1119]/50 transition-colors open:border-[#d3bb73]/30">
                  <summary className="cursor-pointer list-none px-6 py-5 text-[#e5e4e2] transition-colors hover:text-[#d3bb73]">
                    <div className="flex items-center justify-between">
                      <span className="pr-4 font-medium">{item.question}</span>
                      <span className="flex-shrink-0 text-[#d3bb73] transition-transform group-open:rotate-45">+</span>
                    </div>
                  </summary>
                  <div className="border-t border-[#d3bb73]/10 px-6 py-4">
                    <p className="leading-relaxed text-[#e5e4e2]/70">{item.answer}</p>
                  </div>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* SEO text section with image - editable */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#d3bb73]/15">
                {isEditing ? (
                  <div className="h-full w-full">
                    <SimpleImageUploader
                      onImageSelect={async (data: IUploadImage) => {
                        if (data.file) {
                          const url = await uploadImmediately(data.file, 'seo');
                          if (url) setSeoImage(url);
                        }
                      }}
                      initialImage={{ src: seoImage, alt: 'SEO' }}
                      showPreview={true}
                      uploadStatus={getStatusProp('seo')}
                      uploadProgress={getUploadState('seo').progress}
                    />
                  </div>
                ) : (
                  <Image src={seoImage} alt="Profesjonalne oświetlenie i efekty specjalne na imprezach tematycznych" fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" loading="lazy" />
                )}
              </div>
              <div>
                <h2 className="mb-8 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Profesjonalna organizacja imprez tematycznych
                </h2>
                {isEditing ? (
                  <textarea value={seoText} onChange={(e) => setSeoText(e.target.value)} rows={8} className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-4 py-3 text-sm leading-relaxed text-[#e5e4e2] outline-none focus:border-[#d3bb73]" />
                ) : (
                  <div className="space-y-5 text-base leading-relaxed text-[#e5e4e2]/70">
                    <p>{seoText}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="px-6 py-24">
          <div className="mx-auto max-w-4xl rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-12 text-center">
            <Wine className="mx-auto mb-6 h-12 w-12 text-[#d3bb73]" />
            <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Zaplanujmy Twój wieczór tematyczny!
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">
              Skontaktuj się z nami - przygotujemy koncepcję wieczoru tematycznego dopasowaną
              do Twojej okazji, grupy i budżetu. Bezpłatna konsultacja i wstępna wycena w 48h.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <a href="/#kontakt" className="rounded-lg bg-[#d3bb73] px-8 py-3.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
                Zapytaj o wycene
              </a>
              <a href="tel:+48123456789" className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-6 py-3.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10">
                <Heart className="h-4 w-4" />
                Bezplatna konsultacja
              </a>
            </div>
            <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-[#e5e4e2]/50">
              <span>Autorskie koncepty</span>
              <span className="text-[#d3bb73]/30">|</span>
              <span>Wlasna scenografia</span>
              <span className="text-[#d3bb73]/30">|</span>
              <span>Cala Polska</span>
              <span className="text-[#d3bb73]/30">|</span>
              <span>Od 20 do 2000 osob</span>
            </div>
          </div>
        </section>
      </main>

      {/* Lightbox */}
      {lightboxOpen && gallery.length > 0 && !isEditing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95">
          <button onClick={() => setLightboxOpen(false)} className="absolute right-4 top-4 z-10 text-white transition-colors hover:text-[#d3bb73]">
            <XCircle className="h-10 w-10" />
          </button>
          {gallery.length > 1 && (
            <>
              <button onClick={() => setCurrentGalleryIndex((p) => (p - 1 + gallery.length) % gallery.length)} className="absolute left-4 z-10 text-white transition-colors hover:text-[#d3bb73]">
                <ChevronLeft className="h-12 w-12" />
              </button>
              <button onClick={() => setCurrentGalleryIndex((p) => (p + 1) % gallery.length)} className="absolute right-4 z-10 text-white transition-colors hover:text-[#d3bb73]">
                <ChevronRight className="h-12 w-12" />
              </button>
            </>
          )}
          <div className="relative mx-4 h-[80vh] w-full max-w-7xl">
            <Image src={gallery[currentGalleryIndex].image_url} alt={gallery[currentGalleryIndex].alt_text || ''} fill className="object-contain" sizes="100vw" />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
              <p className="text-center text-white">{gallery[currentGalleryIndex].alt_text}</p>
              {gallery[currentGalleryIndex].caption && (
                <p className="mt-1 text-center text-sm text-white/80">{gallery[currentGalleryIndex].caption}</p>
              )}
              <p className="mt-2 text-center text-sm text-white/60">{currentGalleryIndex + 1} / {gallery.length}</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
