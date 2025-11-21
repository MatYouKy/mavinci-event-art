'use client';

import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { ArrowLeft, Edit, Save, X } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState, useEffect } from 'react';
import { PageHeroImage } from './PageHeroImage';
import { usePathname, useRouter } from 'next/navigation';
import { useMobile } from '@/hooks/useMobile';
import { useHeroImage } from './PageImage/hooks/useHeroImage';
import { supabase } from '@/lib/supabase';
import { IconGridSelector } from './IconGridSelector';

interface EditableHeroWithMetadataProps {
  section: string;
  pageSlug: string;
  whiteWordsCount: number;
  labelText: string;
  labelIcon: string;
  buttonText: string;
  initialImageUrl: string;
  initialOpacity: number;
  initialPosition: {
    posX: number;
    posY: number;
    scale: number;
  };
  initialTitle?: string;
  initialDescription?: string;
}

export default function EditableHeroWithMetadata({
  section,
  pageSlug,
  whiteWordsCount: initialWhiteWordsCount,
  labelText: initialLabelText,
  labelIcon: initialLabelIcon,
  buttonText: initialButtonText,
  initialImageUrl,
  initialOpacity,
  initialPosition,
  initialTitle = '',
  initialDescription = '',
}: EditableHeroWithMetadataProps) {
  const isMobile = useMobile();
  const router = useRouter();
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [description, setDescription] = useState(initialDescription);
  const [labelText, setLabelText] = useState(initialLabelText);
  const [labelIcon, setLabelIcon] = useState(initialLabelIcon);
  const [buttonText, setButtonText] = useState(initialButtonText);
  const [whiteWordsCount, setWhiteWordsCount] = useState(initialWhiteWordsCount);

  useEffect(() => {
    console.log('[CLIENT] useEffect - syncing with initial props:', {
      initialTitle,
      initialLabelText,
      initialLabelIcon,
      initialDescription: initialDescription?.substring(0, 50),
    });
    setTitle(initialTitle);
    setDescription(initialDescription);
    setLabelText(initialLabelText);
    setLabelIcon(initialLabelIcon);
    setButtonText(initialButtonText);
    setWhiteWordsCount(initialWhiteWordsCount);
  }, [initialTitle, initialDescription, initialLabelText, initialLabelIcon, initialButtonText, initialWhiteWordsCount]);

  const {
    imageUrl,
    opacity,
    uploadHeroImage,
    saveOpacity,
    uploading,
  } = useHeroImage(section, {
    pageSlug,
    defaultImage: initialImageUrl,
    defaultOpacity: initialOpacity,
  });

  const pathname = usePathname();

  const backHref = useMemo(() => {
    if (!pathname) return '/';
    const segments = pathname.split('/').filter(Boolean);
    if (segments.length <= 1) return '/';
    const parent = '/' + segments.slice(0, -1).join('/');
    return parent || '/';
  }, [pathname]);

  const updateMetadataOgImage = async (newImageUrl: string) => {
    try {
      const normalizedSlug = pageSlug.replace(/^\/+/, '').replace(/\/+$/, '');
      const { data: existing } = await supabase
        .from('schema_org_page_metadata')
        .select('id')
        .eq('page_slug', normalizedSlug)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('schema_org_page_metadata')
          .update({
            og_image: newImageUrl,
            updated_at: new Date().toISOString(),
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('schema_org_page_metadata')
          .insert({
            page_slug: normalizedSlug,
            og_image: newImageUrl,
            title: title || 'Obsługa Konferencji',
            description: description || '',
            keywords: [],
          });
      }
    } catch (error) {
      console.error('Error updating metadata:', error);
    }
  };

  useEffect(() => {
    if (imageUrl && imageUrl !== initialImageUrl) {
      updateMetadataOgImage(imageUrl);
    }
  }, [imageUrl]);

  const getTableName = () => {
    const cleanSection = section.replace('-hero', '');
    const serviceMapping: Record<string, string> = {
      konferencje: 'konferencje_page_images',
      streaming: 'streaming_page_images',
      integracje: 'integracje_page_images',
      kasyno: 'kasyno_page_images',
      'symulatory-vr': 'symulatory-vr_page_images',
      naglosnienie: 'naglosnienie_page_images',
      'quizy-teleturnieje': 'quizy-teleturnieje_page_images',
      'technika-sceniczna': 'technika-sceniczna_page_images',
      'wieczory-tematyczne': 'wieczory-tematyczne_page_images',
    };
    return serviceMapping[cleanSection] || `${cleanSection}_page_images`;
  };

  const loadCurrentData = async () => {
    try {
      const tableName = getTableName();
      const { data, error } = await supabase
        .from(tableName)
        .select('title, description, label_text, label_icon, button_text, white_words_count')
        .eq('section', 'hero')
        .maybeSingle();

      if (error) {
        console.error('Error loading data:', error);
        return;
      }

      if (data) {
        console.log('Loaded data from DB:', data);
        setTitle(data.title || '');
        setDescription(data.description || '');
        setLabelText(data.label_text || '');
        setLabelIcon(data.label_icon || '');
        setButtonText(data.button_text || 'Zobacz inne oferty');
        setWhiteWordsCount(data.white_words_count || 2);
      }
    } catch (error) {
      console.error('Error loading current data:', error);
    }
  };

  const handleEditClick = async () => {
    await loadCurrentData();
    setIsEditing(true);
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      const tableName = getTableName();

      const dataToSave = {
        title,
        description,
        label_text: labelText,
        label_icon: labelIcon,
        button_text: buttonText,
        white_words_count: whiteWordsCount,
        updated_at: new Date().toISOString(),
      };

      console.log('Saving data:', dataToSave);

      const { error } = await supabase
        .from(tableName)
        .update(dataToSave)
        .eq('section', 'hero');

      if (error) {
        console.error('Supabase error:', error);
        throw error;
      }

      showSnackbar('Zmiany zapisane pomyślnie', 'success');

      await loadCurrentData();

      setIsEditing(false);

      router.refresh();
    } catch (error) {
      console.error('Error saving hero:', error);
      showSnackbar('Błąd podczas zapisywania zmian', 'error');
    } finally {
      setSaving(false);
    }
  };

  const safeTitle = title || '';
  const words = safeTitle.split(' ').filter(Boolean);
  const beforeTitle = words.slice(0, whiteWordsCount).join(' ');
  const afterTitle = words.slice(whiteWordsCount).join(' ');

  const [currentIcon, setCurrentIcon] = useState<{ svg_code: string } | null>(null);

  useEffect(() => {
    const fetchCurrentIcon = async () => {
      if (!labelIcon) return;

      const { data } = await supabase
        .from('custom_icons')
        .select('svg_code')
        .eq('id', labelIcon)
        .maybeSingle();

      if (data) {
        setCurrentIcon(data);
      }
    };

    fetchCurrentIcon();
  }, [labelIcon]);

  return (
    <div className="relative">
      <PageHeroImage
        section={section}
        defaultImage={initialImageUrl}
        defaultOpacity={initialOpacity}
      >
        <section className={`relative overflow-hidden pt-24 pb-2 md:pb-16`}>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c15]/50 via-[#0f1119]/30 to-[#1c1f33]" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <Link
                href={backHref}
                className={`inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80 ${isMobile ? 'text-sm' : ''}`}
              >
                <ArrowLeft className="h-4 w-4" />
                Wróć
              </Link>

              {isEditMode && (
                <div className="flex gap-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={handleSave}
                        disabled={saving || !safeTitle}
                        className="flex items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <Save className="h-4 w-4" />
                        {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
                      </button>
                      <button
                        onClick={() => setIsEditing(false)}
                        className="flex items-center gap-2 rounded-lg bg-[#800020]/20 px-6 py-2 text-sm font-medium text-[#e5e4e2] transition-colors hover:bg-[#800020]/30"
                      >
                        <X className="h-4 w-4" />
                        Anuluj
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={handleEditClick}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      <Edit className="h-4 w-4" />
                      Edytuj sekcję
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid items-center gap-12 lg:grid-cols-2 ">
              <div>
                {isEditing ? (
                  <div className="mb-8 space-y-4">
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Tytuł</label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-3xl font-light text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Opis</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        rows={4}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Tekst etykiety</label>
                      <input
                        type="text"
                        value={labelText}
                        onChange={(e) => setLabelText(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <IconGridSelector
                      value={labelIcon}
                      onChange={setLabelIcon}
                      label="Ikona etykiety"
                    />
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Tekst przycisku</label>
                      <input
                        type="text"
                        value={buttonText}
                        onChange={(e) => setButtonText(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                        Ilość białych słów w tytule: {whiteWordsCount}
                      </label>
                      <input
                        type="range"
                        min="0"
                        max={words.length}
                        value={whiteWordsCount}
                        onChange={(e) => setWhiteWordsCount(parseInt(e.target.value))}
                        className="w-full"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className={`mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2 ${isMobile ? 'text-xs' : ''}`}>
                      {currentIcon ? (
                        <div
                          className="w-5 h-5 text-[#d3bb73]"
                          dangerouslySetInnerHTML={{ __html: currentIcon.svg_code }}
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-[#d3bb73]/30" />
                      )}
                      <span className={`text-sm font-medium text-[#d3bb73] ${isMobile ? 'text-xs' : ''}`}>{labelText}</span>
                    </div>
                    <h1 className={`mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl ${isMobile ? 'text-2xl' : ''}`}>
                      {beforeTitle}
                      {afterTitle && ' '}
                      <span className="text-[#d3bb73]">{afterTitle}</span>
                    </h1>

                    <p className={`mb-8 text-lg font-light leading-relaxed text-[#e5e4e2]/70 ${isMobile ? 'text-sm' : ''}`}>
                      {description || ''}
                    </p>

                    <div className="flex flex-wrap gap-4">
                      <a
                        href="/#kontakt"
                        className={`${isMobile ? 'w-full justify-center' : ''} md:w-auto inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90`}
                      >
                        Zapytaj o wycenę
                      </a>
                      {buttonText && <Link
                        href={backHref}
                        className={`${isMobile ? 'w-full justify-center' : ''} md:w-auto inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20`}
                      >
                        {buttonText}
                      </Link>}
                    </div>
                  </>
                )}
              </div>

              <div>
                <div className="relative">
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 blur-3xl" />
                  <div className="relative overflow-hidden rounded-3xl border border-[#d3bb73]/20">
                    <img
                      src={imageUrl}
                      alt={title || 'Hero image'}
                      className="h-full w-full object-cover max-h-[300px]"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </PageHeroImage>
    </div>
  );
}
