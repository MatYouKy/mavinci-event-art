'use client';

import { supabase } from '@/lib/supabase/browser';
import { ArrowLeft, CheckCircle, Package } from 'lucide-react';
import React, { FC, useEffect, useMemo, useState } from 'react';

import Link from 'next/link';
import { iconMap } from '../ConferencesPage';
import { ResponsiveCarousel } from '@/components/ResponsiveCarousel';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Image from 'next/image';
import { capitalize } from '@/utils/capitalize';

interface RelatedServiceItem {
  id: string;
  name: string;
  slug?: string;
  icon?: string | null;
  description?: string | null;
  thumbnail_url?: string | null;
  hero_image_url?: string | null;
  is_active?: boolean;
  service_item_id?: string;
  image_metadata?: any;
  [key: string]: any;
}

interface RelatedServicesSectionProps {
  isEditMode: boolean;
  relatedServices: RelatedServiceItem[];
  allServiceItems: RelatedServiceItem[];
  tableName?: string;
  onSelectionChange?: (ids: string[]) => void;
  onRefreshPreview?: () => void;
  cityCases?: any;
}

export const RelatedServicesSection: FC<RelatedServicesSectionProps> = ({
  isEditMode,
  relatedServices,
  allServiceItems,
  tableName = 'conferences_related_services',
  onSelectionChange,
  onRefreshPreview,
  cityCases,
}) => {
  const [isSaving, setIsSaving] = useState(false);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());
  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    const ids = new Set(
      relatedServices.map((service) => service.service_item_id ?? service.id).filter(Boolean),
    );
    setSelectedServiceIds(ids);
  }, [relatedServices]);

  const filteredRelatedServices = useMemo(() => {
    return relatedServices.filter((service) => service?.is_active && !!service.hero_image_url);
  }, [relatedServices]);

  const updateSelectedIds = (next: Set<string>) => {
    setSelectedServiceIds(new Set(next));
    onSelectionChange?.(Array.from(next));
  };

  const handleToggleService = async (item: RelatedServiceItem, checked: boolean) => {
    const next = new Set(selectedServiceIds);
    setIsSaving(true);

    try {
      if (checked) {
        next.add(item.id);
        updateSelectedIds(next);

        const { error } = await supabase.from(tableName).insert({
          service_item_id: item.id,
          display_order: next.size,
        });

        if (error) {
          next.delete(item.id);
          updateSelectedIds(next);
          showSnackbar('Błąd podczas dodawania usługi', 'error');
          return;
        }

        showSnackbar('Usługa dodana', 'success');
      } else {
        next.delete(item.id);
        updateSelectedIds(next);

        const { error } = await supabase.from(tableName).delete().eq('service_item_id', item.id);

        if (error) {
          next.add(item.id);
          updateSelectedIds(next);
          showSnackbar('Błąd podczas usuwania usługi', 'error');
          return;
        }

        showSnackbar('Usługa usunięta', 'success');
      }

      onRefreshPreview?.();
    } finally {
      setTimeout(() => setIsSaving(false), 500);
    }
  };

  return (
    <section className="bg-gradient-to-b from-[#0f1119] to-[#1c1f33] px-6 py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-12 text-center">
          <h2 className="mb-4 text-3xl font-light text-[#e5e4e2] md:text-4xl">
            Zobacz co najczęściej <span className="text-[#d3bb73]">Dobierają </span>Organizatorzy <span className="text-[#d3bb73]">{cityCases?.locative ? `${cityCases.locative_preposition ? cityCases.locative_preposition : 'w'} ${capitalize(cityCases.locative)}` : 'Olsztynie'}</span>
          </h2>
          <p className="text-lg text-[#e5e4e2]/70">
            Poznaj szczegóły naszych rozwiązań technicznych
          </p>
        </div>

        {isEditMode && (
          <div className="mb-8 rounded-xl border-2 border-[#d3bb73] bg-[#1c1f33] p-6">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium text-[#d3bb73]">
                Tryb edycji - Wybierz usługi do wyświetlenia
              </h3>
              <span className="text-sm text-[#e5e4e2]/60">Wybrano: {selectedServiceIds.size}</span>
            </div>

            <p className="mb-4 text-sm text-[#e5e4e2]/70">
              Wybierz usługi, które mają być wyświetlane w tej sekcji. Zmiany zapisują się
              automatycznie.
            </p>

            <div className="grid max-h-[600px] gap-3 overflow-y-auto pr-2 sm:grid-cols-2 lg:grid-cols-3">
              {allServiceItems.map((item) => (
                <label
                  key={item.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border bg-[#0f1119] p-3 transition-all ${
                    selectedServiceIds.has(item.id)
                      ? 'border-[#d3bb73] bg-[#d3bb73]/5'
                      : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedServiceIds.has(item.id)}
                    onChange={(e) => handleToggleService(item, e.target.checked)}
                    className="mt-1 h-5 w-5 cursor-pointer rounded border-[#d3bb73] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0"
                  />

                  {item.thumbnail_url && (
                    <div className="relative h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]">
                      <div
                        className="absolute inset-0"
                        style={
                          item.image_metadata?.desktop?.position
                            ? {
                                transform: `translate(${(item.image_metadata.desktop.position.posX - 50) * 0.5}%, ${(item.image_metadata.desktop.position.posY - 50) * 0.5}%) scale(${item.image_metadata.desktop.position.scale})`,
                                transformOrigin: 'center',
                              }
                            : undefined
                        }
                      >
                        <Image
                          src={item.thumbnail_url}
                          alt={item.name}
                          className="h-full w-full object-cover"
                          width={100}
                          height={100}
                        />
                      </div>
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <span className="mb-1 block text-sm font-medium text-[#e5e4e2]">
                      {item.name}
                    </span>
                    {item.description && (
                      <span className="line-clamp-2 text-xs text-[#e5e4e2]/60">
                        {item.description}
                      </span>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-[#d3bb73]/20 pt-4">
              <div className="flex items-center gap-2">
                {isSaving ? (
                  <span className="flex items-center gap-2 text-sm text-[#d3bb73]">
                    <svg
                      className="h-4 w-4 animate-spin"
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Zapisywanie...
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-sm text-green-500">
                    <CheckCircle className="h-4 w-4" />
                    Zapisano automatycznie
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => onRefreshPreview?.()}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Odśwież podgląd
              </button>
            </div>
          </div>
        )}

        {filteredRelatedServices.length > 0 && (
          <ResponsiveCarousel
            key={filteredRelatedServices.length}
            items={filteredRelatedServices}
            responsive={{
              desktop: 3,
              tablet: 2,
              mobile: 1,
            }}
            autoPlay={!isEditMode}
            autoPlayDelay={4000}
            showArrows
            renderItem={(item, idx) => {
              if (!item) return null;
              const Icon = iconMap[item?.icon] || Package;

              return (
                <Link
                  key={`${item.id}-${idx}`}
                  href={`/uslugi/${item.slug}`}
                  className="group relative w-full flex-shrink-0 overflow-hidden rounded-xl transition-all hover:-translate-y-1 hover:border-[#d3bb73]/40 sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)]"
                >
                  <div className="relative aspect-[4/5] overflow-hidden rounded-lg bg-[#0f1119] sm:aspect-[8/9]">
                    <div
                      className="absolute inset-0 transition-transform duration-500 group-hover:scale-110"
                      style={
                        item.image_metadata?.desktop?.position
                          ? {
                              transform: `translate(${(item.image_metadata.desktop.position.posX - 50) * 0.5}%, ${(item.image_metadata.desktop.position.posY - 50) * 0.5}%) scale(${item.image_metadata.desktop.position.scale})`,
                              transformOrigin: 'center',
                            }
                          : undefined
                      }
                    >
                      <Image
                        src={item.thumbnail_url}
                        alt={item.name}
                        className="h-full w-full object-cover"
                        width={100}
                        height={100}
                      />
                    </div>

                    <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent" />

                    <div className="absolute bottom-2 left-6 mb-4 flex flex-col gap-2">
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-[#d3bb73]/10 transition-colors group-hover:bg-[#d3bb73]/20">
                        <Icon className="h-6 w-6 text-[#d3bb73]" />
                      </div>

                      <div className="relative z-10">
                        <h3 className="mb-2 text-lg font-medium text-[#e5e4e2] transition-colors group-hover:text-[#d3bb73]">
                          {item.name}
                        </h3>
                        {item.description && (
                          <p className="line-clamp-2 text-sm text-[#e5e4e2]/60">
                            {item.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              );
            }}
          />
        )}

        <div className="mt-12 text-center">
          <Link
            href="/uslugi"
            className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-all hover:bg-[#d3bb73]/90"
          >
            Zobacz wszystkie usługi
            <ArrowLeft className="h-4 w-4 rotate-180" />
          </Link>
        </div>
      </div>
    </section>
  );
};