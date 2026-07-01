'use client';

import { useState, useEffect } from 'react';
import {
  Users,
  Target,
  Heart,
  TrendingUp,
  Shield,
  Lightbulb,
  Award,
  Clock,
  Star,
  CreditCard as Edit,
  Save,
  X,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  XCircle,
} from 'lucide-react';
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

interface TypeItem {
  title: string;
  description: string;
  keywords: string;
  image: string;
}

const DEFAULT_TYPES: TypeItem[] = [
  { title: 'Gry terenowe i fabularne', description: 'Scenariusze integracyjne z fabułą, zagadkami i zadaniami zespołowymi w plenerze. Gry miejskie, podchody, questy.', keywords: 'gry terenowe, gra fabularna firmowa, gra miejska integracja', image: 'https://images.pexels.com/photos/7551667/pexels-photo-7551667.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Integracje outdoor', description: 'Survival light, zadania terenowe, biegi z przeszkodami, olimpiady firmowe. Aktywny team building na świeżym powietrzu.', keywords: 'integracja outdoor, team building plener, olimpiada firmowa', image: 'https://images.pexels.com/photos/8112172/pexels-photo-8112172.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Integracje indoor', description: 'Mobilny escape room, zagadki logiczne, gry planszowe w skali XXL, warsztaty kreatywne. Idealne na każdą pogodę.', keywords: 'integracja indoor, escape room firmowy, gry planszowe XXL', image: 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Wieczory firmowe z programem', description: 'Imprezy firmowe z animatorami, konkursami, quizami i eventami integracyjnymi. Pełna oprawa rozrywkowa.', keywords: 'wieczór firmowy, impreza integracyjna, animatorzy firmowi', image: 'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Integracje kreatywne', description: 'Video challenge, warsztaty bębniarskie, malowanie, gotowanie team buildingowe. Twórcze zadania dla zespołów.', keywords: 'integracja kreatywna, warsztaty team building, video challenge', image: 'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=600' },
  { title: 'Duże integracje 100-500+', description: 'Koordynacja dużych grup, strefy aktywności, profesjonalne prowadzenie, logistyka eventowa. Skala bez kompromisów.', keywords: 'duża integracja firmowa, event 500 osób, integracja korporacyjna', image: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=600' },
];

const DEFAULT_GALLERY: GalleryImage[] = [
  { id: '1', image_url: 'https://images.pexels.com/photos/7551667/pexels-photo-7551667.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Gra terenowa fabularna - team building', caption: 'Integracja w plenerze', category: 'outdoor', order_index: 0, is_visible: true },
  { id: '2', image_url: 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Integracja indoor - escape room', caption: 'Escape room dla firm', category: 'indoor', order_index: 1, is_visible: true },
  { id: '3', image_url: 'https://images.pexels.com/photos/8112172/pexels-photo-8112172.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Integracja outdoor - zadania zespołowe', caption: 'Wyzwania terenowe', category: 'outdoor', order_index: 2, is_visible: true },
  { id: '4', image_url: 'https://images.pexels.com/photos/2608517/pexels-photo-2608517.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Wieczór firmowy z animacjami', caption: 'Wieczór firmowy', category: 'evening', order_index: 3, is_visible: true },
  { id: '5', image_url: 'https://images.pexels.com/photos/3184360/pexels-photo-3184360.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Warsztaty kreatywne team building', caption: 'Integracja kreatywna', category: 'creative', order_index: 4, is_visible: true },
  { id: '6', image_url: 'https://images.pexels.com/photos/2774556/pexels-photo-2774556.jpeg?auto=compress&cs=tinysrgb&w=800', alt_text: 'Duża integracja firmowa - event korporacyjny', caption: 'Event dla 200+ osób', category: 'large', order_index: 5, is_visible: true },
];

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  Target, Heart, TrendingUp, Shield, Lightbulb, Award,
};

const defaultBenefits = [
  { icon: 'Target', title: 'Skuteczne budowanie zespołu', description: 'Zadania zespołowe wzmacniające współpracę, komunikację i zaufanie w grupie.' },
  { icon: 'Heart', title: 'Atmosfera i zaangażowanie', description: 'Eventy integracyjne tworzące pozytywne relacje i wspólne wspomnienia.' },
  { icon: 'TrendingUp', title: 'Motywacja i energia', description: 'Imprezy firmowe podnoszące morale i chęć do wspólnego działania.' },
  { icon: 'Shield', title: 'Bezpieczeństwo i profesjonalizm', description: 'Doświadczeni animatorzy firmowi zapewniający płynny i bezpieczny przebieg.' },
  { icon: 'Lightbulb', title: 'Kreatywne scenariusze', description: 'Autorskie scenariusze integracyjne dopasowane do charakteru firmy i celów.' },
  { icon: 'Award', title: 'Kompleksowa obsługa', description: 'Od koncepcji przez realizację po podsumowanie i dokumentację eventu.' },
];

const defaultFaq = [
  { question: 'Ile osób może uczestniczyć w integracji?', answer: 'Organizujemy integracje od 10 do 500+ osób. Format i atrakcje dobieramy do wielkości grupy, zapewniając zaangażowanie każdego uczestnika.' },
  { question: 'Jak wcześnie trzeba zarezerwować termin?', answer: 'Optymalna rezerwacja to 3-6 tygodni przed eventem. Dla dużych projektów zalecamy 2-3 miesiące. W trybie ekspresowym realizujemy w 7 dni.' },
  { question: 'Czy organizujecie integracje poza miastem?', answer: 'Tak - realizujemy eventy w całej Polsce: hotele, ośrodki, lasy, parki, centra konferencyjne. Dojeżdżamy wszędzie.' },
  { question: 'Co jest potrzebne od klienta?', answer: 'Potrzebujemy: datę, lokalizację lub preferencje, liczbę uczestników, orientacyjny budżet i cele integracji. Resztą zajmujemy się my.' },
  { question: 'Jaki budżet potrzebny jest na integrację?', answer: 'Budżet zależy od formatu i skali: integracja 20-50 osób od 5 000 zł, średni event 50-150 osób od 12 000 zł, duże projekty wyceniamy indywidualnie.' },
  { question: 'Czy integracje działają przy złej pogodzie?', answer: 'Mamy scenariusze backup dla każdego eventu outdoor. Alternatywne warianty indoor zapewniają sukces niezależnie od pogody.' },
  { question: 'Czy zapewniacie dokumentację foto/video?', answer: 'Tak - profesjonalny fotograf i kamerzysta, relacja na żywo, aftermovie. Pamiątki z integracji dla całego zespołu.' },
];

interface ServerDataRow {
  id: string;
  name: string;
  desktop_url: string | null;
  alt_text: string | null;
  image_metadata: Record<string, any> | null;
  order_index: number | null;
  [key: string]: any;
}

interface Props {
  serverData?: ServerDataRow[];
}

function parseServerData(data: ServerDataRow[]) {
  let introImage = 'https://images.pexels.com/photos/7551667/pexels-photo-7551667.jpeg?auto=compress&cs=tinysrgb&w=800';
  let introText = 'Organizujemy profesjonalne integracje firmowe i eventy team buildingowe dla zespołów od 10 do 500+ osób. Gry terenowe, scenariusze fabularne, zadania zespołowe outdoor i indoor - budujemy zespoły przez doświadczenie i wspólną przygodę.';
  let introText2 = 'Zapewniamy kompletną obsługę eventu: scenariusz, animatorów, sprzęt, koordynację logistyczną i dokumentację foto/video. Każda integracja jest tworzona od podstaw pod Twój zespół.';
  let seoImage = 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=800';
  let seoText = 'Specjalizujemy się w organizacji integracji firmowych, team buildingu i eventów integracyjnych dla firm, korporacji i agencji eventowych. Nasze integracje to nie gotowe szablony - każdy scenariusz projektujemy indywidualnie, dopasowując format, atrakcje i poziom aktywności do celów klienta i profilu grupy.';
  let types: TypeItem[] = DEFAULT_TYPES;
  let gallery: GalleryImage[] = DEFAULT_GALLERY;

  if (!data || data.length === 0) {
    return { introImage, introText, introText2, seoImage, seoText, types, gallery };
  }

  for (const row of data) {
    const meta = row.image_metadata;
    if (row.name === 'intro') {
      if (row.desktop_url) introImage = row.desktop_url;
      if (meta?.text) introText = meta.text;
      if (meta?.text2) introText2 = meta.text2;
    } else if (row.name === 'seo') {
      if (row.desktop_url) seoImage = row.desktop_url;
      if (meta?.text) seoText = meta.text;
    } else if (row.name === 'types') {
      if (meta?.items && Array.isArray(meta.items)) {
        types = meta.items as TypeItem[];
      }
    }
  }

  const galleryRows = data
    .filter((r) => r.name?.startsWith('gallery-'))
    .sort((a, b) => (a.order_index || 0) - (b.order_index || 0));

  if (galleryRows.length > 0) {
    gallery = galleryRows.map((r, idx) => ({
      id: r.id,
      image_url: r.desktop_url || '',
      alt_text: r.alt_text || '',
      caption: (r.image_metadata as any)?.caption || '',
      category: (r.image_metadata as any)?.category || 'general',
      order_index: idx,
      is_visible: true,
    }));
  }

  return { introImage, introText, introText2, seoImage, seoText, types, gallery };
}

export default function IntegracjePage({ serverData = [] }: Props) {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();

  const initial = parseServerData(serverData);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [types, setTypes] = useState<TypeItem[]>(initial.types);
  const [gallery, setGallery] = useState<GalleryImage[]>(initial.gallery);
  const [introText, setIntroText] = useState(initial.introText);
  const [introText2, setIntroText2] = useState(initial.introText2);
  const [introImage, setIntroImage] = useState(initial.introImage);
  const [seoText, setSeoText] = useState(initial.seoText);
  const [seoImage, setSeoImage] = useState(initial.seoImage);

  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);

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
      const url = await uploadImage(file, 'integrations');
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

  const STORAGE_SECTION = 'integrations';

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
      } else if (row.name === 'types') {
        if (meta?.items && Array.isArray(meta.items)) {
          setTypes(meta.items as TypeItem[]);
        }
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
          alt_text: 'Intro integracje firmowe',
          image_metadata: { text: introText, text2: introText2 },
          order_index: 0,
          is_active: true,
        },
        {
          section: STORAGE_SECTION,
          name: 'types',
          desktop_url: '',
          alt_text: 'Types data',
          image_metadata: { items: types },
          order_index: 1,
          is_active: true,
        },
        {
          section: STORAGE_SECTION,
          name: 'seo',
          desktop_url: seoImage,
          alt_text: 'SEO integracje',
          image_metadata: { text: seoText },
          order_index: 2,
          is_active: true,
        },
      ];

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
      image_url: 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=800',
      alt_text: 'Nowe zdjecie',
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

  const addType = () => {
    setTypes([...types, { title: 'Nowy rodzaj integracji', description: 'Opis...', keywords: '', image: 'https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg?auto=compress&cs=tinysrgb&w=600' }]);
  };

  const removeType = (index: number) => {
    setTypes(types.filter((_, i) => i !== index));
  };

  const updateType = (index: number, field: keyof TypeItem, value: string) => {
    const newTypes = [...types];
    newTypes[index] = { ...newTypes[index], [field]: value };
    setTypes(newTypes);
  };

  const openLightbox = (index: number) => {
    setCurrentGalleryIndex(index);
    setLightboxOpen(true);
  };

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        {isEditing && (
          <div className="sticky top-0 z-50 border-b border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-3">
            <div className="mx-auto flex max-w-7xl items-center justify-between">
              <div className="flex items-center gap-3">
                <Edit className="h-5 w-5 text-[#d3bb73]" />
                <span className="font-medium text-[#e5e4e2]">Tryb edycji - Integracje Firmowe</span>
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

        {/* Intro Section */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <h2 className="mb-8 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Integracje firmowe i team building dla zespolow
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
                      alt="Integracje firmowe - profesjonalny team building"
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

        {/* Types Grid */}
        <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Rodzaje integracji firmowych
            </h2>
            <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
              Dopasowane do Twojego zespolu - wybierz format lub pozwol nam zaproponowac idealny scenariusz
            </p>

            {isEditing && (
              <div className="mb-6 flex justify-end">
                <button onClick={addType} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/30">
                  <Plus className="h-4 w-4" /> Dodaj rodzaj
                </button>
              </div>
            )}

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {types.map((type, idx) => (
                <div key={idx} className="group overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] transition-all duration-300 hover:border-[#d3bb73]/40">
                  <div className="relative aspect-[16/9] overflow-hidden">
                    <Image src={type.image} alt={type.title} fill sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119] via-[#0f1119]/20 to-transparent" />
                    {isEditing && (
                      <button onClick={() => removeType(idx)} className="absolute right-2 top-2 z-10 rounded-full bg-red-600/80 p-1 text-white hover:bg-red-600">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                  <div className="p-5">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input value={type.title} onChange={(e) => updateType(idx, 'title', e.target.value)} className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-2 py-1 text-sm font-medium text-[#d3bb73] outline-none focus:border-[#d3bb73]" />
                        <textarea value={type.description} onChange={(e) => updateType(idx, 'description', e.target.value)} rows={2} className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-2 py-1 text-xs text-[#e5e4e2]/70 outline-none focus:border-[#d3bb73]" />
                        <div className="h-40 w-full">
                          <SimpleImageUploader
                            onImageSelect={async (data: IUploadImage) => {
                              if (data.file) {
                                const url = await uploadImmediately(data.file, `type-${idx}`);
                                if (url) updateType(idx, 'image', url);
                              }
                            }}
                            initialImage={{ src: type.image, alt: type.title }}
                            showPreview={true}
                            uploadStatus={getStatusProp(`type-${idx}`)}
                            uploadProgress={getUploadState(`type-${idx}`).progress}
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <h3 className="mb-2 text-lg font-medium text-[#d3bb73]">{type.title}</h3>
                        <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{type.description}</p>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Benefits Section */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Dlaczego warto wybrac nasze integracje
            </h2>
            <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
              Korzyści z profesjonalnych integracji firmowych
            </p>
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {defaultBenefits.map((benefit, idx) => {
                const IconComp = iconMap[benefit.icon] || Target;
                return (
                  <div key={idx} className="group rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-6 transition-all duration-300 hover:border-[#d3bb73]/30">
                    <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 text-[#d3bb73]">
                      <IconComp className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">{benefit.title}</h3>
                    <p className="text-sm leading-relaxed text-[#e5e4e2]/70">{benefit.description}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Gallery Section */}
        <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-4 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Galeria integracji firmowych
            </h2>
            <p className="mx-auto mb-12 max-w-3xl text-center text-[#e5e4e2]/60">
              Wybrane realizacje naszych integracji i eventow team buildingowych
            </p>

            {isEditing && (
              <div className="mb-6 flex justify-end">
                <button onClick={addGalleryImage} className="flex items-center gap-2 rounded-lg bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] hover:bg-[#d3bb73]/30">
                  <Plus className="h-4 w-4" /> Dodaj zdjecie
                </button>
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {gallery.map((img, idx) => (
                <div key={img.id} className="group relative">
                  {isEditing ? (
                    <div className="space-y-2 rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-3">
                      <div className="relative h-48 w-full">
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
                      <input value={img.alt_text} onChange={(e) => updateGalleryImage(img.id, 'alt_text', e.target.value)} placeholder="Alt text" className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-2 py-1 text-xs text-[#e5e4e2] outline-none" />
                      <input value={img.caption} onChange={(e) => updateGalleryImage(img.id, 'caption', e.target.value)} placeholder="Podpis" className="w-full rounded border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-2 py-1 text-xs text-[#e5e4e2] outline-none" />
                      <div className="flex gap-1">
                        <button onClick={() => moveGalleryImage(idx, 'up')} disabled={idx === 0} className="rounded bg-[#d3bb73]/10 p-1 text-[#d3bb73] disabled:opacity-30"><ArrowUp className="h-3 w-3" /></button>
                        <button onClick={() => moveGalleryImage(idx, 'down')} disabled={idx === gallery.length - 1} className="rounded bg-[#d3bb73]/10 p-1 text-[#d3bb73] disabled:opacity-30"><ArrowDown className="h-3 w-3" /></button>
                        <button onClick={() => removeGalleryImage(img.id)} className="ml-auto rounded bg-red-600/20 p-1 text-red-400 hover:bg-red-600/30"><Trash2 className="h-3 w-3" /></button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => openLightbox(idx)}
                      className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border border-[#d3bb73]/10 transition-all duration-300 hover:border-[#d3bb73]/40 hover:shadow-lg hover:shadow-[#d3bb73]/5"
                    >
                      <Image src={img.image_url} alt={img.alt_text} fill sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" />
                      <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                        <div className="absolute bottom-4 left-4 right-4">
                          <p className="text-sm font-light text-[#e5e4e2]">{img.alt_text}</p>
                          {img.caption && <p className="mt-1 text-xs text-[#e5e4e2]/60">{img.caption}</p>}
                        </div>
                      </div>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Stats Section */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Integracje w liczbach
            </h2>
            <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
              {[
                { icon: Award, value: '300+', label: 'Zrealizowanych integracji' },
                { icon: Users, value: '30 000+', label: 'Uczestnikow' },
                { icon: Star, value: '25+', label: 'Formatow integracji' },
                { icon: Clock, value: '12 lat', label: 'Doswiadczenia' },
              ].map((stat, idx) => (
                <div key={idx} className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/50 p-6 text-center">
                  <stat.icon className="mx-auto mb-3 h-8 w-8 text-[#d3bb73]" />
                  <div className="mb-1 text-2xl font-light text-[#e5e4e2]">{stat.value}</div>
                  <div className="text-sm text-[#e5e4e2]/60">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ Section */}
        <section className="border-b border-[#d3bb73]/10 bg-[#1c1f33]/30 px-6 py-20">
          <div className="mx-auto max-w-4xl">
            <h2 className="mb-12 text-center text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Najczesciej zadawane pytania o integracje
            </h2>
            <div className="space-y-4">
              {defaultFaq.map((item, idx) => (
                <details key={idx} className="group rounded-xl border border-[#d3bb73]/10 bg-[#0f1119] transition-colors open:border-[#d3bb73]/30">
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

        {/* SEO Text Section */}
        <section className="border-b border-[#d3bb73]/10 px-6 py-20">
          <div className="mx-auto max-w-7xl">
            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#d3bb73]/20">
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
                  <Image src={seoImage} alt="Integracje firmowe - organizacja eventow" fill sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" loading="lazy" />
                )}
              </div>
              <div>
                <h2 className="mb-6 text-2xl font-light text-[#e5e4e2] md:text-3xl">
                  Profesjonalne integracje firmowe
                </h2>
                {isEditing ? (
                  <textarea
                    value={seoText}
                    onChange={(e) => setSeoText(e.target.value)}
                    rows={8}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]/40 px-4 py-3 text-[#e5e4e2] outline-none focus:border-[#d3bb73]"
                  />
                ) : (
                  <div className="space-y-4 text-lg leading-relaxed text-[#e5e4e2]/80">
                    {seoText.split('\n').map((p, i) => <p key={i}>{p}</p>)}
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="px-6 py-24">
          <div className="mx-auto max-w-4xl rounded-2xl border border-[#d3bb73]/30 bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-12 text-center">
            <div className="mb-6 inline-flex items-center justify-center rounded-full bg-[#d3bb73]/10 p-4">
              <Users className="h-8 w-8 text-[#d3bb73]" />
            </div>
            <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Zaplanujmy Twoja integracje!
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg text-[#e5e4e2]/70">
              Skontaktuj sie z nami - przygotujemy indywidualny scenariusz integracji dopasowany do Twojego zespolu. Bezplatna konsultacja i wycena w 24h.
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
              <a href="/#kontakt" className="rounded-lg bg-[#d3bb73] px-8 py-3.5 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90">
                Zapytaj o wycene
              </a>
              <a href="/#kontakt" className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-6 py-3.5 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/10">
                <Heart className="h-4 w-4" />
                Bezplatna konsultacja
              </a>
            </div>
            <div className="mt-10 flex flex-wrap justify-center gap-6 text-sm text-[#e5e4e2]/50">
              <span>Team building</span>
              <span className="text-[#d3bb73]/30">|</span>
              <span>Gry terenowe</span>
              <span className="text-[#d3bb73]/30">|</span>
              <span>Outdoor &amp; Indoor</span>
              <span className="text-[#d3bb73]/30">|</span>
              <span>10-500+ osob</span>
            </div>
          </div>
        </section>
      </main>

      {/* Lightbox */}
      {lightboxOpen && gallery.length > 0 && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95">
          <button onClick={() => setLightboxOpen(false)} className="absolute right-4 top-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <XCircle className="h-6 w-6" />
          </button>
          {gallery.length > 1 && (
            <>
              <button onClick={() => setCurrentGalleryIndex((p) => (p - 1 + gallery.length) % gallery.length)} className="absolute left-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                <ChevronLeft className="h-8 w-8" />
              </button>
              <button onClick={() => setCurrentGalleryIndex((p) => (p + 1) % gallery.length)} className="absolute right-4 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
                <ChevronRight className="h-8 w-8" />
              </button>
            </>
          )}
          <div className="relative mx-4 h-[80vh] w-full max-w-7xl">
            <Image
              src={gallery[currentGalleryIndex].image_url}
              alt={gallery[currentGalleryIndex].alt_text || ''}
              fill
              className="object-contain"
              sizes="100vw"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
              <p className="text-center text-white">{gallery[currentGalleryIndex].alt_text}</p>
              {gallery[currentGalleryIndex].caption && (
                <p className="mt-1 text-center text-sm text-white/80">{gallery[currentGalleryIndex].caption}</p>
              )}
              <p className="mt-2 text-center text-sm text-white/60">
                {currentGalleryIndex + 1} / {gallery.length}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
