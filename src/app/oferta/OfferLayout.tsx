'use client';

import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import EditableHeroSection from '@/components/EditableHeroSection';
import PageLayout from '@/components/Layout/PageLayout';
import { PageHeroImage, PageHeroImageProps } from '@/components/PageHeroImage';
import { useEditMode } from '@/contexts/EditModeContext';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, Mic, Presentation } from 'lucide-react';
import Link from 'next/link';
import React, { useEffect, useState } from 'react';

interface OfferLayoutProps extends PageHeroImageProps {
  children: React.ReactNode;
  pageSlug: string;
  heroImageBucket: string;
  defaultHeroImage: string;
  section: string;
  whiteWordsCount?: number;
  etykieta: { title: string; icon: React.ReactNode };
  descriptionSection?: { title: string; description: string; icon: React.ReactNode };
}

export default function OfferLayout({
  children,
  pageSlug,
  heroImageBucket = 'conferences_hero',
  defaultHeroImage,
  section = 'konferencje-hero',
  whiteWordsCount = 2,
  etykieta,
  descriptionSection,
}: OfferLayoutProps) {
  const { isEditMode } = useEditMode();
  const [editHeroOpacity, setEditHeroOpacity] = useState(0.7);
  const [heroData, setHeroData] = useState<any>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editHeroTitle, setEditHeroTitle] = useState('');
  const [editHeroSubtitle, setEditHeroSubtitle] = useState('');
  const [editHeroDescription, setEditHeroDescription] = useState('');

  console.log('heroData', heroData);

  useEffect(() => {
    if (heroData && !isEditing) {
      setEditHeroTitle(heroData.title || '');
      setEditHeroSubtitle(heroData.subtitle || '');
      setEditHeroDescription(heroData.trust_badge || '');
      setEditHeroOpacity(0.7);
    }
  }, [heroData, isEditing]);

  const handleSaveHero = async () => {
    try {
      const { error } = await supabase
        .from(heroImageBucket)
        .update({
          title: editHeroTitle,
          subtitle: editHeroSubtitle,
          trust_badge: editHeroDescription,
          updated_at: new Date().toISOString(),
        })
        .eq('id', heroData.id);

      if (error) throw error;

      setHeroData({
        ...heroData,
        title: editHeroTitle,
        subtitle: editHeroSubtitle,
        trust_badge: editHeroDescription,
      });
      setIsEditing(false);
    } catch (error) {
      console.error('Error saving hero:', error);
    }
  };

  const safeTitle =
    heroData?.title && heroData.title.trim().length > 0
      ? heroData.title
      : 'Techniczna obsługa konferencji';

  const words = safeTitle.split(' ').filter(Boolean);

  const beforeTitle = words.slice(0, whiteWordsCount).join(' ');
  const afterTitle = words.slice(whiteWordsCount).join(' ');

  return (
    <PageLayout pageSlug={pageSlug}>
      <div className="min-h-screen bg-[#0f1119]">
        <EditableHeroSection
          section={section}
          labelTag={etykieta}
          whiteWordsCount={whiteWordsCount}
          buttonText="Zobacz inne oferty"
        />
        {/* <PageHeroImage
          section={section}
          defaultImage={defaultHeroImage}
          defaultOpacity={editHeroOpacity}
          className="overflow-hidden py-24 md:py-32"
        >
          <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            {!isEditing && (
              <Link
                href="/#uslugi"
                className="mb-8 inline-flex items-center gap-2 text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
              >
                <ArrowLeft className="h-4 w-4" />
                Powrót do usług
              </Link>
            )}

            <div className="grid items-center gap-12 lg:grid-cols-2">
              <div>
                <div className="mb-6 inline-flex items-center gap-3 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-2">
                  {etykieta?.icon}
                  <span className="text-sm font-medium text-[#d3bb73]">{etykieta?.title}</span>
                </div>

                {isEditMode && (
                  <div className="mb-4 flex gap-2">
                    {!isEditing ? (
                      <button
                        onClick={() => setIsEditing(true)}
                        className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#c5ad65]"
                      >
                        Edytuj sekcję
                      </button>
                    ) : (
                      <>
                        <button
                          onClick={handleSaveHero}
                          className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-700"
                        >
                          Zapisz
                        </button>
                        <button
                          onClick={() => setIsEditing(false)}
                          className="rounded-lg bg-gray-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-700"
                        >
                          Anuluj
                        </button>
                      </>
                    )}
                  </div>
                )}

                {isEditing ? (
                  <div className="mb-8 space-y-4">
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Tytuł</label>
                      <input
                        type="text"
                        value={editHeroTitle}
                        onChange={(e) => setEditHeroTitle(e.target.value)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-3xl font-light text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Podtytuł</label>
                      <textarea
                        value={editHeroSubtitle}
                        onChange={(e) => setEditHeroSubtitle(e.target.value)}
                        rows={3}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">Opis</label>
                      <textarea
                        value={editHeroDescription}
                        onChange={(e) => setEditHeroDescription(e.target.value)}
                        rows={2}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm text-[#e5e4e2]/70">
                        Przeźroczystość tła: {Math.round(editHeroOpacity * 100)}%
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={editHeroOpacity * 100}
                        onChange={(e) => setEditHeroOpacity(parseInt(e.target.value) / 100)}
                        className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-[#1c1f33] accent-[#d3bb73]"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <h1 className="mb-6 text-4xl font-light text-[#e5e4e2] md:text-6xl">
                      {beforeTitle}
                      {afterTitle && ' '}
                      <span className="text-[#d3bb73]">{afterTitle}</span>
                    </h1>

                    <p className="mb-4 text-lg font-light leading-relaxed text-[#e5e4e2]/70">
                      {heroData?.subtitle || ''}
                    </p>

                    <p className="mb-8 text-sm font-light leading-relaxed text-[#e5e4e2]/50">
                      {heroData?.trust_badge || ''}
                    </p>
                  </>
                )}

                {!isEditing && (
                  <div className="flex flex-wrap gap-4">
                    <button
                      onClick={() => {}}
                      className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                    >
                      Zapytaj o wycenę
                    </button>
                    <Link
                      href="/#uslugi"
                      className="inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-8 py-3 text-sm font-medium text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20"
                    >
                      Zobacz inne usługi
                    </Link>
                  </div>
                )}
              </div>

              <div className="relative">
                <div className="relative">
                  <div className="absolute inset-0 rounded-3xl bg-gradient-to-br from-[#d3bb73]/20 to-[#0f1119]/20 blur-3xl"></div>
                  <div className="relative rounded-3xl border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 p-8 backdrop-blur-sm">
                    {descriptionSection?.icon}
                    <h3 className="mb-4 text-2xl font-light text-[#e5e4e2]">
                      {descriptionSection?.title}
                    </h3>
                    <p className="font-light text-[#e5e4e2]/70">
                      {descriptionSection?.description}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage> */}
        <section className="px-6 pt-6">
          <div className="mx-auto max-w-7xl">
            <CategoryBreadcrumb pageSlug={pageSlug} />
          </div>
        </section>
        {children}
      </div>
    </PageLayout>
  );
}
