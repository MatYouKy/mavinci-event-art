'use client';

import { useEditMode } from '@/contexts/EditModeContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { IUploadImage } from '@/types/image';
import { ArrowLeft, Edit, Save, X } from 'lucide-react';
import Link from 'next/link';
import React, { useMemo, useState } from 'react';
import { PageHeroImage } from './PageHeroImage';
import { useHeroImage } from './PageImage/hooks/useHeroImage';
import { motion, AnimatePresence } from 'framer-motion';
import { usePathname } from 'next/navigation';
import { useMobile } from '@/hooks/useMobile';

interface EditableHeroSectionProps {
  section: string;
  whiteWordsCount?: number;
  labelTag?: { title: string; icon: React.ReactNode };
  buttonText?: string;
}

export default function EditableHeroSection({
  section,
  whiteWordsCount = 1,
  labelTag,
  buttonText,
}: EditableHeroSectionProps) {
  const isMobile = useMobile();
  const { isEditMode } = useEditMode();
  const { showSnackbar } = useSnackbar();
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageData] = useState<IUploadImage | null>(null);

  const { imageUrl, loading } = useHeroImage(section, {
    defaultOpacity: 0.2,
  });

  // 🔹 DYNAMICZNY BACK LINK
  const pathname = usePathname();

  const backHref = useMemo(() => {
    if (!pathname) return '/';

    // rozbijamy np. "/oferta/konferencje/pakiet-x" -> ["oferta","konferencje","pakiet-x"]
    const segments = pathname.split('/').filter(Boolean);

    // jeżeli jesteśmy już w root /coś -> wróć do "/"
    if (segments.length <= 1) {
      return '/';
    }

    // utnij ostatni segment: ["oferta","konferencje","pakiet-x"] -> ["oferta","konferencje"]
    const parent = '/' + segments.slice(0, -1).join('/');

    return parent || '/';
  }, [pathname]);

  const handleSave = async () => {
    try {
      setSaving(true);
      // TODO: zapisz title/description do supabase
      setIsEditing(false);
      showSnackbar('Wydarzenie zapisane pomyślnie', 'success');
    } catch (error) {
      console.error('Error saving hero:', error);
      showSnackbar('Błąd podczas zapisywania wydarzenia', 'error');
    } finally {
      setSaving(false);
    }
  };

  const safeTitle = title && title.trim().length > 0 ? title : 'Techniczna obsługa konferencji';

  const words = safeTitle.split(' ').filter(Boolean);
  const beforeTitle = words.slice(0, whiteWordsCount).join(' ');
  const afterTitle = words.slice(whiteWordsCount).join(' ');

  return (
    <div className="relative">
      {/* LOADER OVERLAY */}
      <AnimatePresence>
        {loading && (
          <motion.div
            key="hero-loader-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/40"
          >
            <motion.div
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.85, opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="pointer-events-auto flex items-center gap-3 rounded-2xl border border-white/10 bg-[#111321] px-6 py-4 shadow-xl"
            >
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#d3bb73] border-t-transparent" />
              <span className="text-sm text-[#e5e4e2]/80">Ładuję tło sekcji...</span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <PageHeroImage section={section}>
        <section className={`relative overflow-hidden pt-24 pb-2 md:pb-16`}>
          <div className="absolute inset-0 bg-gradient-to-b from-[#0a0c15]/50 via-[#0f1119]/30 to-[#1c1f33]" />

          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {/* Top Navigation */}
            <div className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <Link
                href={backHref} // 🔹 używamy wyliczonego parent path
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
                      onClick={() => setIsEditing(true)}
                      className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      <Edit className="h-4 w-4" />
                      Edytuj sekcję
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Reszta layoutu bez zmian */}
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
                  </div>
                ) : (
                  <>
                    <div className={`mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2 ${isMobile ? 'text-xs' : ''}`}>
                      {labelTag?.icon}
                      <span className={`text-sm font-medium text-[#d3bb73] ${isMobile ? 'text-xs' : ''}`}>{labelTag?.title}</span>
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
                      alt={imageData?.alt || title || 'Hero image'}
                      className="h-full w-full object-cover"
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
