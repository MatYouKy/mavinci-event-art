'use client';

import Head from 'next/head';
import { useState, useEffect } from 'react';
import { Dices, Spade, CheckCircle2, ArrowLeft, ChevronLeft, ChevronRight, XCircle, Edit, Save, X, Image as ImageIcon } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import CasinoLegalPopup from '@/components/CasinoLegalPopup';
import CasinoTablesEditor from '@/components/CasinoTablesEditor';
import CasinoGalleryEditor from '@/components/CasinoGalleryEditor';
import CasinoContentBlocksEditor from '@/components/CasinoContentBlocksEditor';
import { supabase } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { SimpleImageUploader } from '@/components/SimpleImageUploader';
import { uploadImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

interface CasinoTable {
  id: string;
  name: string;
  slug: string;
  description: string;
  image: string;
  alt: string;
  image_metadata?: {
    desktop?: { src: string; position: { posX: number; posY: number; scale: number } };
    mobile?: { src: string; position: { posX: number; posY: number; scale: number } };
  };
  order_index: number;
  is_visible?: boolean;
}

interface CasinoFeature {
  id: string;
  title: string;
  icon_name: string;
  order_index: number;
}

interface CasinoGameRule {
  id: string;
  game_name: string;
  slug: string;
  short_description: string;
  rules_content: string;
  order_index: number;
}

interface GalleryImage {
  id: string;
  image: string;
  alt: string;
  caption: string;
  image_metadata?: {
    desktop?: { src: string; position: { posX: number; posY: number; scale: number } };
    mobile?: { src: string; position: { posX: number; posY: number; scale: number } };
  };
  order_index?: number;
  is_visible?: boolean;
}

interface ContentBlock {
  id: string;
  title: string;
  content: string;
  layout_type: 'grid-4' | 'grid-3' | 'grid-2' | 'grid-1';
  order_index: number;
  is_visible?: boolean;
}

interface PageSettings {
  id?: string;
  hero_title: string;
  hero_subtitle: string;
  hero_description: string;
  hero_image_section: string;
  hero_image_opacity: number;
}

export default function KasynoPage() {
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();

  const [showContent, setShowContent] = useState(true);
  const [legalContent, setLegalContent] = useState('');
  const [tables, setTables] = useState<CasinoTable[]>([]);
  const [features, setFeatures] = useState<CasinoFeature[]>([]);
  const [gameRules, setGameRules] = useState<CasinoGameRule[]>([]);
  const [gallery, setGallery] = useState<GalleryImage[]>([]);
  const [contentBlocks, setContentBlocks] = useState<ContentBlock[]>([]);
  const [currentGalleryIndex, setCurrentGalleryIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  const [pageSettings, setPageSettings] = useState<PageSettings>({
    hero_title: 'Kasyno Eventowe',
    hero_subtitle: 'Profesjonalna agencja eventowa',
    hero_description: 'Nie prowadzimy gier losowych',
    hero_image_section: 'kasyno',
    hero_image_opacity: 0.2,
  });

  const [editHeroTitle, setEditHeroTitle] = useState('');
  const [editHeroSubtitle, setEditHeroSubtitle] = useState('');
  const [editHeroDescription, setEditHeroDescription] = useState('');
  const [editHeroOpacity, setEditHeroOpacity] = useState(0.2);
  const [editImageData, setEditImageData] = useState<IUploadImage | null>(null);
  const [editPreviewImage, setEditPreviewImage] = useState('');
  
  const [editTables, setEditTables] = useState<CasinoTable[]>([]);
  const [editGallery, setEditGallery] = useState<GalleryImage[]>([]);
  const [editBlocks, setEditBlocks] = useState<ContentBlock[]>([]);
  const [tablePendingUploads, setTablePendingUploads] = useState<Map<string, IUploadImage>>(new Map());
  const [galleryPendingUploads, setGalleryPendingUploads] = useState<Map<string, IUploadImage>>(new Map());

  useEffect(() => {
    fetchData();
  }, []);

  useEffect(() => {
    if (isEditMode && !isEditing) {
      setIsEditing(true);
      setEditHeroTitle(pageSettings.hero_title);
      setEditHeroSubtitle(pageSettings.hero_subtitle);
      setEditHeroDescription(pageSettings.hero_description);
      setEditHeroOpacity(pageSettings.hero_image_opacity);
      setEditTables([...tables]);
      setEditGallery([...gallery]);
      setEditBlocks([...contentBlocks]);
    } else if (!isEditMode && isEditing) {
      setIsEditing(false);
    }
  }, [isEditMode, tables, gallery, contentBlocks, pageSettings]);

  const fetchData = async () => {
    const { data: popupData } = await supabase
      .from('casino_legal_popup')
      .select('*')
      .eq('is_active', true)
      .maybeSingle();

    if (popupData) {
      setLegalContent(popupData.content);
    }

    const { data: settingsData } = await supabase
      .from('casino_page_settings')
      .select('*')
      .maybeSingle();

    if (settingsData) {
      setPageSettings(settingsData);
    }

    const { data: tablesData } = await supabase
      .from('casino_tables')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (tablesData) setTables(tablesData);

    const { data: featuresData } = await supabase
      .from('casino_features')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (featuresData) setFeatures(featuresData);

    const { data: rulesData } = await supabase
      .from('casino_game_rules')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (rulesData) setGameRules(rulesData);

    const { data: galleryData } = await supabase
      .from('casino_gallery')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (galleryData) setGallery(galleryData);

    const { data: blocksData } = await supabase
      .from('casino_content_blocks')
      .select('*')
      .eq('is_visible', true)
      .order('order_index');
    if (blocksData) setContentBlocks(blocksData);
  };

  const handleTableImageUpload = (tableId: string, imageData: IUploadImage) => {
    setTablePendingUploads(prev => {
      const newMap = new Map(prev);
      newMap.set(tableId, imageData);
      return newMap;
    });
  };

  const handleGalleryImageUpload = (imageId: string, imageData: IUploadImage) => {
    setGalleryPendingUploads(prev => {
      const newMap = new Map(prev);
      newMap.set(imageId, imageData);
      return newMap;
    });
  };

  const handleSave = async () => {
    setSaving(true);

    try {
      let settingsId = pageSettings.id;

      if (!settingsId) {
        const { data } = await supabase
          .from('casino_page_settings')
          .select('id')
          .maybeSingle();
        settingsId = data?.id;
      }

      if (settingsId) {
        const { error: settingsError } = await supabase
          .from('casino_page_settings')
          .update({
            hero_title: editHeroTitle,
            hero_subtitle: editHeroSubtitle,
            hero_description: editHeroDescription,
            hero_image_opacity: editHeroOpacity,
            updated_at: new Date().toISOString(),
          })
          .eq('id', settingsId);

        if (settingsError) throw settingsError;
      }

      const processedTables: CasinoTable[] = [];
      for (const table of editTables) {
        const tableData = {...table};
        const pendingUpload = tablePendingUploads.get(table.id);

        if (pendingUpload?.file) {
          try {
            const imageUrl = await uploadImage(pendingUpload.file, 'casino-tables');
            tableData.image = imageUrl;
            tableData.image_metadata = {
              desktop: pendingUpload.desktop || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
              mobile: pendingUpload.mobile || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
            };
            if (tableData.image_metadata.desktop) tableData.image_metadata.desktop.src = imageUrl;
            if (tableData.image_metadata.mobile) tableData.image_metadata.mobile.src = imageUrl;
          } catch (error) {
            console.error('Error uploading table image:', error);
            showSnackbar(`Błąd uploadu zdjęcia dla ${table.name}`, 'error');
          }
        }

        processedTables.push(tableData);
      }

      await supabase.from('casino_tables').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      for (const table of processedTables) {
        const tableData = {...table};
        delete tableData.is_visible;
        const { error } = await supabase.from('casino_tables').insert({
          ...tableData,
          image_url: tableData.image,
          image_alt: tableData.alt,
          is_visible: true,
        });
        if (error) console.error('Error saving table:', error);
      }

      const processedGallery: GalleryImage[] = [];
      for (let i = 0; i < editGallery.length; i++) {
        const image = {...editGallery[i]};
        const pendingUpload = galleryPendingUploads.get(image.id);

        if (pendingUpload?.file) {
          try {
            const imageUrl = await uploadImage(pendingUpload.file, 'casino-gallery');
            image.image = imageUrl;
            image.image_metadata = {
              desktop: pendingUpload.desktop || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
              mobile: pendingUpload.mobile || { src: imageUrl, position: { posX: 0, posY: 0, scale: 1 } },
            };
            if (image.image_metadata.desktop) image.image_metadata.desktop.src = imageUrl;
            if (image.image_metadata.mobile) image.image_metadata.mobile.src = imageUrl;
          } catch (error) {
            console.error('Error uploading gallery image:', error);
            showSnackbar(`Błąd uploadu zdjęcia galerii`, 'error');
          }
        }

        processedGallery.push(image);
      }

      await supabase.from('casino_gallery').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      for (let i = 0; i < processedGallery.length; i++) {
        const image = {...processedGallery[i]};
        delete image.is_visible;
        delete image.order_index;
        const { error } = await supabase.from('casino_gallery').insert({
          ...image,
          image_url: image.image,
          alt_text: image.alt,
          order_index: i,
          is_visible: true,
        });
        if (error) console.error('Error saving gallery image:', error);
      }

      await supabase.from('casino_content_blocks').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      for (const block of editBlocks) {
        const blockData = {...block};
        delete blockData.is_visible;
        const { error } = await supabase.from('casino_content_blocks').insert({
          ...blockData,
          is_visible: true,
        });
        if (error) console.error('Error saving block:', error);
      }

      showSnackbar('Wszystkie zmiany zapisane!', 'success');
      setTablePendingUploads(new Map());
      setGalleryPendingUploads(new Map());
      await fetchData();
      setIsEditing(false);
    } catch (error: any) {
      showSnackbar('Błąd zapisu: ' + error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditHeroTitle(pageSettings.hero_title);
    setEditHeroSubtitle(pageSettings.hero_subtitle);
    setEditHeroDescription(pageSettings.hero_description);
    setEditHeroOpacity(pageSettings.hero_image_opacity);
    setEditTables([...tables]);
    setEditGallery([...gallery]);
    setEditBlocks([...contentBlocks]);
    setEditImageData(null);
    setEditPreviewImage('');
    setTablePendingUploads(new Map());
    setGalleryPendingUploads(new Map());
  };

  const handleImageSelect = async (imageData: IUploadImage) => {
    setEditImageData(imageData);
    if (imageData.file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setEditPreviewImage(reader.result as string);
      };
      reader.readAsDataURL(imageData.file);
    }
  };

  const openLightbox = (index: number) => {
    setCurrentGalleryIndex(index);
    setLightboxOpen(true);
  };

  const closeLightbox = () => {
    setLightboxOpen(false);
  };

  const nextImage = () => {
    setCurrentGalleryIndex((prev) => (prev + 1) % gallery.length);
  };

  const prevImage = () => {
    setCurrentGalleryIndex((prev) => (prev - 1 + gallery.length) % gallery.length);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!lightboxOpen) return;
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowLeft') prevImage();
      if (e.key === 'ArrowRight') nextImage();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lightboxOpen]);

  const getGridClass = (layout: string) => {
    switch (layout) {
      case 'grid-4': return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
      case 'grid-3': return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
      case 'grid-2': return 'grid-cols-1 md:grid-cols-2';
      case 'grid-1': return 'grid-cols-1';
      default: return 'grid-cols-1';
    }
  };
  const canonicalUrl = 'https://mavinci.pl/uslugi/kasyno';
  const serviceName = pageSettings.hero_title.split(' ')[0];

  return (
    <>
          <main className="min-h-screen bg-[#0f1119]">
            {isEditing && (
              <div className="sticky top-0 z-50 bg-[#1c1f33] border-b border-[#d3bb73]/30 px-4 py-3">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Edit className="w-5 h-5 text-[#d3bb73]" />
                    <span className="text-[#e5e4e2] font-medium">Tryb edycji - Kasyno</span>
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={handleCancel}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] rounded-lg hover:bg-[#d3bb73]/20 transition-colors disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                      Anuluj
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
                    >
                      <Save className="w-4 h-4" />
                      {saving ? 'Zapisywanie...' : 'Zapisz wszystko'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <PageHeroImage
              section={pageSettings.hero_image_section}
              defaultImage="https://images.pexels.com/photos/262508/pexels-photo-262508.jpeg?auto=compress&cs=tinysrgb&w=1920"
              defaultOpacity={pageSettings.hero_image_opacity}
              className="py-24 md:py-32 overflow-hidden"
            >
              <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {!isEditing && (
                  <Link href="/#uslugi" className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8">
                    <ArrowLeft className="w-4 h-4" />
                    Powrót do usług
                  </Link>
                )}

                <div className="grid lg:grid-cols-2 gap-12 items-center">
                  <div>
                    <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                      <Dices className="w-5 h-5 text-[#d3bb73]" />
                      <span className="text-[#d3bb73] text-sm font-medium">Wieczory w Kasynie</span>
                    </div>

                    {isEditing ? (
                      <div className="space-y-4 mb-8">
                        <div>
                          <label className="block text-[#e5e4e2]/70 text-sm mb-2">Tytuł</label>
                          <input
                            type="text"
                            value={editHeroTitle}
                            onChange={(e) => setEditHeroTitle(e.target.value)}
                            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] text-3xl font-light focus:border-[#d3bb73] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[#e5e4e2]/70 text-sm mb-2">Podtytuł</label>
                          <textarea
                            value={editHeroSubtitle}
                            onChange={(e) => setEditHeroSubtitle(e.target.value)}
                            rows={3}
                            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[#e5e4e2]/70 text-sm mb-2">Opis</label>
                          <textarea
                            value={editHeroDescription}
                            onChange={(e) => setEditHeroDescription(e.target.value)}
                            rows={2}
                            className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] text-sm focus:border-[#d3bb73] focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[#e5e4e2]/70 text-sm mb-2">
                            Przeźroczystość tła: {Math.round(editHeroOpacity * 100)}%
                          </label>
                          <input
                            type="range"
                            min="0"
                            max="100"
                            value={editHeroOpacity * 100}
                            onChange={(e) => setEditHeroOpacity(parseInt(e.target.value) / 100)}
                            className="w-full h-2 bg-[#1c1f33] rounded-lg appearance-none cursor-pointer accent-[#d3bb73]"
                          />
                        </div>
                      </div>
                    ) : (
                      <>
                        <h1 className="text-4xl md:text-6xl font-light text-[#e5e4e2] mb-6">
                          {pageSettings.hero_title.split(' ')[0]} <span className="text-[#d3bb73]">{pageSettings.hero_title.split(' ').slice(1).join(' ')}</span>
                        </h1>

                        <p className="text-[#e5e4e2]/70 text-lg font-light leading-relaxed mb-4">
                          {pageSettings.hero_subtitle}
                        </p>

                        <p className="text-[#e5e4e2]/50 text-sm font-light leading-relaxed mb-8">
                          {pageSettings.hero_description}
                        </p>
                      </>
                    )}

                    {!isEditing && (
                      <div className="flex flex-wrap gap-4">
                        <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
                          Zapytaj o wycenę
                        </a>
                        <Link href="/#uslugi" className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors">
                          Zobacz inne usługi
                        </Link>
                      </div>
                    )}
                  </div>

                  <div className="relative">
                    <div className="relative">
                      <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl"></div>
                      <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                        <Spade className="w-24 h-24 text-[#d3bb73] mb-6" />
                        <h3 className="text-2xl font-light text-[#e5e4e2] mb-4">Elegancja i Rozrywka</h3>
                        <p className="text-[#e5e4e2]/70 font-light">
                          Klimat prawdziwego kasyna, profesjonalni krupierzy i niezapomniana atmosfera gier w bezpiecznym środowisku eventowym bez hazardu.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </PageHeroImage>
            <section className="pt-6 px-6 border-t border-b border-[#d3bb73]/20">
        <div className="max-w-7xl mx-auto">
        <CategoryBreadcrumb />
        </div>
        </section>

            {features.length > 0 && (
              <section className="py-24 bg-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Co Oferujemy</h2>
                    <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                  </div>

                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {features.map((feature) => (
                      <div key={feature.id} className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300">
                        <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                        <span className="text-[#e5e4e2]/90 font-light">{feature.title}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            <section className="py-24 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                  <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Nasze Stoły</h2>
                  <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                </div>

                {isEditing ? (
                  <CasinoTablesEditor
                    tables={editTables}
                    onChange={setEditTables}
                    onImageUpload={handleTableImageUpload}
                  />
                ) : (
                  <div className="space-y-16">
                    {tables.map((table, index) => (
                      <div key={table.id} className={`grid lg:grid-cols-2 gap-12 items-center ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}>
                        <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                          <div className="relative group">
                            <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-transparent rounded-2xl blur-xl group-hover:blur-2xl transition-all"></div>
                            <img
                              src={table.image_metadata?.desktop?.src || table.image}
                              alt={table.alt || table.name}
                              className="relative w-full h-[400px] object-cover rounded-2xl border border-[#d3bb73]/20"
                            />
                          </div>
                        </div>
                        <div className={index % 2 === 1 ? 'lg:order-1' : ''}>
                          <h3 className="text-3xl font-light text-[#e5e4e2] mb-4">{table.name}</h3>
                          <p className="text-[#e5e4e2]/70 font-light leading-relaxed">
                            {table.description}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="py-24 bg-[#0f1119]">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="text-center mb-16">
                  <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Galeria</h2>
                  <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                </div>

                {isEditing ? (
                  <CasinoGalleryEditor
                    gallery={editGallery}
                    onChange={setEditGallery}
                    onImageUpload={handleGalleryImageUpload}
                  />
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {gallery.map((image, index) => (
                      <div
                        key={image.id}
                        onClick={() => openLightbox(index)}
                        className="group relative aspect-[4/3] overflow-hidden rounded-xl border border-[#d3bb73]/10 hover:border-[#d3bb73]/30 transition-all duration-300 cursor-pointer"
                      >
                        <img
                          src={image.image_metadata?.desktop?.src || image.image}
                          alt={image.alt || `Zdjęcie z kasyna ${index + 1}`}
                          className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                          <div className="absolute bottom-4 left-4 right-4">
                            <p className="text-[#e5e4e2] text-sm font-light">
                              {image.alt || `Zdjęcie ${index + 1}`}
                            </p>
                            {image.caption && (
                              <p className="text-[#e5e4e2]/60 text-xs font-light mt-1">
                                {image.caption}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {gameRules.length > 0 && (
              <section className="py-24 bg-gradient-to-br from-[#1c1f33] to-[#0f1119]">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">Zasady Gier</h2>
                    <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto"></div>
                  </div>

                  <div className="grid lg:grid-cols-3 gap-8">
                    {gameRules.map((rule) => {
                      const ruleLinks: { [key: string]: string } = {
                        'poker-texas-holdem': '/uslugi/kasyno/zasady/poker',
                        'ruletka': '/uslugi/kasyno/zasady/ruletka',
                        'blackjack': '/uslugi/kasyno/zasady/blackjack',
                      };

                      return (
                        <Link
                          key={rule.id}
                          href={isEditing ? '#' : (ruleLinks[rule.slug] || '/uslugi/kasyno')}
                          onClick={(e) => isEditing && e.preventDefault()}
                          className="group bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8 hover:border-[#d3bb73]/30 transition-all"
                        >
                          <h3 className="text-2xl font-light text-[#e5e4e2] mb-3 group-hover:text-[#d3bb73] transition-colors">
                            {rule.game_name}
                          </h3>
                          <p className="text-[#e5e4e2]/60 text-sm font-light mb-6">
                            {rule.short_description}
                          </p>
                          {!isEditing && (
                            <div className="text-[#d3bb73] text-sm font-medium flex items-center gap-2 group-hover:gap-3 transition-all">
                              Czytaj więcej
                              <ArrowLeft className="w-4 h-4 rotate-180" />
                            </div>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                </div>
              </section>
            )}

            <section className="py-24 bg-[#0f1119]">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                {isEditing ? (
                  <CasinoContentBlocksEditor blocks={editBlocks} onChange={setEditBlocks} />
                ) : (
                  contentBlocks.length > 0 && (
                    <div className="space-y-16">
                      {contentBlocks.map((block) => (
                        <div key={block.id}>
                          <h2 className="text-3xl font-light text-[#e5e4e2] mb-8 text-center">{block.title}</h2>
                          <div className={`grid ${getGridClass(block.layout_type)} gap-6`}>
                            <div className="bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-2xl p-8">
                              <div className="prose prose-invert max-w-none">
                                <div className="text-[#e5e4e2]/80 font-light leading-relaxed whitespace-pre-line">
                                  {block.content}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>
            </section>

            {!isEditing && (
              <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
                <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
                  <Dices className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
                  <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
                    Zorganizujmy Wieczór w Kasynie!
                  </h2>
                  <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
                    Skontaktuj się z nami, aby przygotować niezapomniane kasyno eventowe.
                  </p>
                  <a href="/#kontakt" className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors">
                    Skontaktuj się z nami
                  </a>
                </div>
              </section>
            )}
          </main>

          {lightboxOpen && gallery.length > 0 && !isEditing && (
            <div className="fixed inset-0 z-[9999] bg-black/95 flex items-center justify-center">
              <button
                onClick={closeLightbox}
                className="absolute top-4 right-4 text-white hover:text-[#d3bb73] transition-colors z-10"
              >
                <XCircle className="w-10 h-10" />
              </button>

              {gallery.length > 1 && (
                <>
                  <button
                    onClick={prevImage}
                    className="absolute left-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                  >
                    <ChevronLeft className="w-12 h-12" />
                  </button>
                  <button
                    onClick={nextImage}
                    className="absolute right-4 text-white hover:text-[#d3bb73] transition-colors z-10"
                  >
                    <ChevronRight className="w-12 h-12" />
                  </button>
                </>
              )}

              <div className="relative max-w-7xl max-h-[90vh] mx-4">
                <img
                  src={gallery[currentGalleryIndex].image_metadata?.desktop?.src || gallery[currentGalleryIndex].image}
                  alt={gallery[currentGalleryIndex].alt}
                  className="max-w-full max-h-[90vh] object-contain"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
                  <p className="text-white text-center">
                    {gallery[currentGalleryIndex].alt}
                  </p>
                  {gallery[currentGalleryIndex].caption && (
                    <p className="text-white/80 text-sm text-center mt-1">
                      {gallery[currentGalleryIndex].caption}
                    </p>
                  )}
                  <p className="text-white/60 text-sm text-center mt-2">
                    {currentGalleryIndex + 1} / {gallery.length}
                  </p>
                </div>
              </div>
            </div>
          )}

      {legalContent && !isEditing && (
        <CasinoLegalPopup
          content={legalContent}
          onAccept={() => setShowContent(true)}
        />
      )}
    </>
  );
}
