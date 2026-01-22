'use client';

import { useState, useEffect } from 'react';
import {
  CheckCircle2,
  ArrowLeft,
  Edit,
  Save,
  X,
  Dices,
  XCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import Link from 'next/link';
import CasinoLegalPopup from '@/components/CasinoLegalPopup';
import CasinoTablesEditor from '@/components/CasinoTablesEditor';
import CasinoGalleryEditor from '@/components/CasinoGalleryEditor';
import CasinoContentBlocksEditor from '@/components/CasinoContentBlocksEditor';
import { supabase } from '@/lib/supabase/browser';
import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { uploadImage } from '@/lib/storage';
import { IUploadImage } from '@/types/image';
import { useMobile } from '@/hooks/useMobile';

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
  const isMobile = useMobile();
  const screenMode = isMobile ? 'mobile' : 'desktop';

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
  const [tablePendingUploads, setTablePendingUploads] = useState<Map<string, IUploadImage>>(
    new Map(),
  );
  const [galleryPendingUploads, setGalleryPendingUploads] = useState<Map<string, IUploadImage>>(
    new Map(),
  );

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
    setTablePendingUploads((prev) => {
      const newMap = new Map(prev);
      newMap.set(tableId, imageData);
      return newMap;
    });
  };

  const handleGalleryImageUpload = (imageId: string, imageData: IUploadImage) => {
    setGalleryPendingUploads((prev) => {
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
        const { data } = await supabase.from('casino_page_settings').select('id').maybeSingle();
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
        const tableData = { ...table };
        const pendingUpload = tablePendingUploads.get(table.id);

        if (pendingUpload?.file) {
          try {
            const imageUrl = await uploadImage(pendingUpload.file, 'casino-tables');
            tableData.image = imageUrl;
            tableData.image_metadata = {
              desktop: pendingUpload.desktop || {
                src: imageUrl,
                position: { posX: 0, posY: 0, scale: 1 },
              },
              mobile: pendingUpload.mobile || {
                src: imageUrl,
                position: { posX: 0, posY: 0, scale: 1 },
              },
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

      await supabase
        .from('casino_tables')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      for (const table of processedTables) {
        const tableData = { ...table };
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
        const image = { ...editGallery[i] };
        const pendingUpload = galleryPendingUploads.get(image.id);

        if (pendingUpload?.file) {
          try {
            const imageUrl = await uploadImage(pendingUpload.file, 'casino-gallery');
            image.image = imageUrl;
            image.image_metadata = {
              desktop: pendingUpload.desktop || {
                src: imageUrl,
                position: { posX: 0, posY: 0, scale: 1 },
              },
              mobile: pendingUpload.mobile || {
                src: imageUrl,
                position: { posX: 0, posY: 0, scale: 1 },
              },
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

      await supabase
        .from('casino_gallery')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      for (let i = 0; i < processedGallery.length; i++) {
        const image = { ...processedGallery[i] };
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

      await supabase
        .from('casino_content_blocks')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');
      for (const block of editBlocks) {
        const blockData = { ...block };
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
      case 'grid-4':
        return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-4';
      case 'grid-3':
        return 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';
      case 'grid-2':
        return 'grid-cols-1 md:grid-cols-2';
      case 'grid-1':
        return 'grid-cols-1';
      default:
        return 'grid-cols-1';
    }
  };

  return (
    <>
      <main className="min-h-screen bg-[#0f1119]">
        {isEditing && (
          <div className="sticky top-0 z-50 border-b border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-3">
            <div className="mx-auto flex max-w-7xl items-center justify-between">
              <div className="flex items-center gap-3">
                <Edit className="h-5 w-5 text-[#d3bb73]" />
                <span className="font-medium text-[#e5e4e2]">Tryb edycji - Kasyno</span>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleCancel}
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

        {features.length > 0 && (
          <section className="bg-[#0f1119] py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-16 text-center">
                <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                  Co Oferujemy
                </h2>
                <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
              </div>

              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {features.map((feature) => (
                  <div
                    key={feature.id}
                    className="flex items-start gap-3 rounded-xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-6 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30"
                  >
                    <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#d3bb73]" />
                    <span className="font-light text-[#e5e4e2]/90">{feature.title}</span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">Nasze Stoły</h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
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
                  <div
                    key={table.id}
                    className={`grid items-center gap-12 lg:grid-cols-2 ${index % 2 === 1 ? 'lg:flex-row-reverse' : ''}`}
                  >
                    <div className={index % 2 === 1 ? 'lg:order-2' : ''}>
                      <div className="group relative">
                        <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-[#d3bb73]/20 to-transparent blur-xl transition-all group-hover:blur-2xl"></div>
                        <img
                          src={table.image_metadata?.desktop?.src || table.image}
                          alt={table.alt || table.name}
                          className="relative h-[400px] w-full rounded-2xl border border-[#d3bb73]/20 object-cover"
                        />
                      </div>
                    </div>
                    <div className={index % 2 === 1 ? 'lg:order-1' : ''}>
                      <h3 className="mb-4 text-3xl font-light text-[#e5e4e2]">{table.name}</h3>
                      <p className="font-light leading-relaxed text-[#e5e4e2]/70">
                        {table.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="bg-[#0f1119] py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-16 text-center">
              <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">Galeria</h2>
              <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
            </div>

            {isEditing ? (
              <CasinoGalleryEditor
                gallery={editGallery}
                onChange={setEditGallery}
                onImageUpload={handleGalleryImageUpload}
              />
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {gallery.map((image, index) => (
                  <div
                    key={image.id}
                    onClick={() => openLightbox(index)}
                    className="group relative aspect-[4/3] cursor-pointer overflow-hidden rounded-xl border border-[#d3bb73]/10 transition-all duration-300 hover:border-[#d3bb73]/30"
                  >
                    <img
                      src={image.image_metadata?.desktop?.src || image.image}
                      alt={image.alt || `Zdjęcie z kasyna ${index + 1}`}
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[#0f1119]/80 to-transparent opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <div className="absolute bottom-4 left-4 right-4">
                        <p className="text-sm font-light text-[#e5e4e2]">
                          {image.alt || `Zdjęcie ${index + 1}`}
                        </p>
                        {image.caption && (
                          <p className="mt-1 text-xs font-light text-[#e5e4e2]/60">
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
          <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              <div className="mb-16 text-center">
                <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">Zasady Gier</h2>
                <div className="mx-auto h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
              </div>

              <div className="grid gap-8 lg:grid-cols-3">
                {gameRules.map((rule) => {
                  const ruleLinks: { [key: string]: string } = {
                    'poker-texas-holdem': '/oferta/kasyno/zasady/poker',
                    ruletka: '/oferta/kasyno/zasady/ruletka',
                    blackjack: '/oferta/kasyno/zasady/blackjack',
                  };

                  return (
                    <Link
                      key={rule.id}
                      href={isEditing ? '#' : ruleLinks[rule.slug] || '/oferta/kasyno'}
                      onClick={(e) => isEditing && e.preventDefault()}
                      className="group rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm transition-all hover:border-[#d3bb73]/30"
                    >
                      <h3 className="mb-3 text-2xl font-light text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                        {rule.game_name}
                      </h3>
                      <p className="mb-6 text-sm font-light text-[#e5e4e2]/60">
                        {rule.short_description}
                      </p>
                      {!isEditing && (
                        <div className="flex items-center gap-2 text-sm font-medium text-[#d3bb73] transition-all group-hover:gap-3">
                          Czytaj więcej
                          <ArrowLeft className="h-4 w-4 rotate-180" />
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          </section>
        )}

        {isEditMode && contentBlocks.length > 0 && (
          <section className="bg-[#0f1119] py-24">
            <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
              {isEditing ? (
                <CasinoContentBlocksEditor blocks={editBlocks} onChange={setEditBlocks} />
              ) : (
                contentBlocks.length > 0 && (
                  <div className="space-y-16">
                    {contentBlocks.map((block) => (
                      <div key={block.id}>
                        <h2 className="mb-8 text-center text-3xl font-light text-[#e5e4e2]">
                          {block.title}
                        </h2>
                        <div className={`grid ${getGridClass(block.layout_type)} gap-6`}>
                          <div className="rounded-2xl border border-[#d3bb73]/10 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
                            <div className="prose prose-invert max-w-none">
                              <div className="whitespace-pre-line font-light leading-relaxed text-[#e5e4e2]/80">
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
        )}

        {!isEditing && (
          <section className="bg-gradient-to-br from-[#0f1119] to-[#1c1f33] py-24">
            <div className="mx-auto max-w-4xl px-4 text-center sm:px-6 lg:px-8">
              <Dices className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
              <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
                Zorganizujmy Wieczór w Kasynie!
              </h2>
              <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
                Skontaktuj się z nami, aby przygotować niezapomniane kasyno eventowe.
              </p>
              <a
                href="/#kontakt"
                className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                Skontaktuj się z nami
              </a>
            </div>
          </section>
        )}
      </main>

      {lightboxOpen && gallery.length > 0 && !isEditing && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/95">
          <button
            onClick={closeLightbox}
            className="absolute right-4 top-4 z-10 text-white transition-colors hover:text-[#d3bb73]"
          >
            <XCircle className="h-10 w-10" />
          </button>

          {gallery.length > 1 && (
            <>
              <button
                onClick={prevImage}
                className="absolute left-4 z-10 text-white transition-colors hover:text-[#d3bb73]"
              >
                <ChevronLeft className="h-12 w-12" />
              </button>
              <button
                onClick={nextImage}
                className="absolute right-4 z-10 text-white transition-colors hover:text-[#d3bb73]"
              >
                <ChevronRight className="h-12 w-12" />
              </button>
            </>
          )}

          <div className="relative mx-4 max-h-[90vh] max-w-7xl">
            <img
              src={
                gallery[currentGalleryIndex].image_metadata?.desktop?.src ||
                gallery[currentGalleryIndex].image
              }
              alt={gallery[currentGalleryIndex].alt}
              className="max-h-[90vh] max-w-full object-contain"
            />
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-6">
              <p className="text-center text-white">{gallery[currentGalleryIndex].alt}</p>
              {gallery[currentGalleryIndex].caption && (
                <p className="mt-1 text-center text-sm text-white/80">
                  {gallery[currentGalleryIndex].caption}
                </p>
              )}
              <p className="mt-2 text-center text-sm text-white/60">
                {currentGalleryIndex + 1} / {gallery.length}
              </p>
            </div>
          </div>
        </div>
      )}

      {legalContent && !isEditing && (
        <CasinoLegalPopup content={legalContent} onAccept={() => setShowContent(true)} />
      )}
    </>
  );
}
