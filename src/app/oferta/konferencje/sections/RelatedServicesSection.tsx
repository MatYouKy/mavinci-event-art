import { supabase } from '@/lib/supabase';
import { ArrowLeft, CheckCircle, Package } from 'lucide-react';
import React, { FC, useEffect, useRef, useState } from 'react';

import Link from 'next/link';
import { iconMap } from '../ConferencesPage';

interface RelatedServicesSectionProps {
  isEditMode: boolean;
  selectedServiceIds: Set<string>;
  relatedServices: any[];
  setSelectedServiceIds: (ids: Set<string>) => void;
  allServiceItems: any[];
  loadData: () => void;
}

export const RelatedServicesSection:FC<RelatedServicesSectionProps> = ({ isEditMode, selectedServiceIds, setSelectedServiceIds, allServiceItems, loadData, relatedServices }) => {
  const [isSaving, setIsSaving] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [triplicatedServices, setTriplicatedServices] = useState<any[]>([]);
  const carouselRef = useRef<HTMLDivElement>(null);


  
  useEffect(() => {
    if (relatedServices.length > 0) {
      setTriplicatedServices([...relatedServices, ...relatedServices, ...relatedServices]);
      setCurrentIndex(relatedServices.length);
    }
  }, [relatedServices]);

  const handleNext = () => {
    setCurrentIndex((prev) => {
      const next = prev + 1;
      if (next >= relatedServices.length * 2) {
        setTimeout(() => {
          setCurrentIndex(relatedServices.length);
        }, 700);
      }
      return next;
    });
  };

  const handlePrev = () => {
    setCurrentIndex((prev) => {
      const next = prev - 1;
      if (next < relatedServices.length) {
        setTimeout(() => {
          setCurrentIndex(relatedServices.length * 2 - 1);
        }, 700);
      }
      return next;
    });
  };
  return (
    <section className="py-20 px-6 bg-gradient-to-b from-[#0f1119] to-[#1c1f33]">
            <div className="max-w-7xl mx-auto">
              <div className="text-center mb-12">
                <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                  Zobacz co najczęściej  <span className="text-[#d3bb73]">Dobierają </span>Organizatorzy
                </h2>
                <p className="text-[#e5e4e2]/70 text-lg">
                  Poznaj szczegóły naszych rozwiązań technicznych
                </p>
              </div>

              {isEditMode && (
                <div className="mb-8 bg-[#1c1f33] border-2 border-[#d3bb73] rounded-xl p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-[#d3bb73] text-lg font-medium">Tryb edycji - Wybierz usługi do wyświetlenia</h3>
                    <span className="text-[#e5e4e2]/60 text-sm">
                      Wybrano: {selectedServiceIds.size}
                    </span>
                  </div>
                  <p className="text-[#e5e4e2]/70 text-sm mb-4">
                    Wybierz usługi, które mają być wyświetlane w tej sekcji. Zmiany zapisują się automatycznie.
                  </p>
                  <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[600px] overflow-y-auto pr-2">
                    {allServiceItems.map((item) => (
                      <label
                        key={item.id}
                        className={`flex items-start gap-3 p-3 bg-[#0f1119] border rounded-lg cursor-pointer transition-all ${
                          selectedServiceIds.has(item.id)
                            ? 'border-[#d3bb73] bg-[#d3bb73]/5'
                            : 'border-[#d3bb73]/20 hover:border-[#d3bb73]/40'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={selectedServiceIds.has(item.id)}
                          onChange={async (e) => {
                            const newSelected = new Set(selectedServiceIds);
                            setIsSaving(true);

                            try {
                              if (e.target.checked) {
                                newSelected.add(item.id);
                                setSelectedServiceIds(newSelected);

                                const { error } = await supabase
                                  .from('conferences_related_services')
                                  .insert({
                                    service_item_id: item.id,
                                    display_order: newSelected.size
                                  });

                                if (error) {
                                  console.error('Failed to add service:', error);
                                  newSelected.delete(item.id);
                                  setSelectedServiceIds(newSelected);
                                }
                              } else {
                                newSelected.delete(item.id);
                                setSelectedServiceIds(newSelected);

                                const { error } = await supabase
                                  .from('conferences_related_services')
                                  .delete()
                                  .eq('service_item_id', item.id);

                                if (error) {
                                  console.error('Failed to remove service:', error);
                                  newSelected.add(item.id);
                                  setSelectedServiceIds(newSelected);
                                }
                              }
                            } finally {
                              setTimeout(() => setIsSaving(false), 500);
                            }
                          }}
                          className="mt-1 w-5 h-5 rounded border-[#d3bb73] text-[#d3bb73] focus:ring-[#d3bb73] focus:ring-offset-0 cursor-pointer"
                        />

                        {item.thumbnail_url && (
                          <div className="w-16 h-16 rounded-lg overflow-hidden bg-[#0f1119] border border-[#d3bb73]/10 flex-shrink-0">
                            <img
                              src={item.thumbnail_url}
                              alt={item.name}
                              className="w-full h-full object-cover"
                            />
                          </div>
                        )}

                        <div className="flex-1 min-w-0">
                          <span className="text-[#e5e4e2] text-sm font-medium block mb-1">{item.name}</span>
                          {item.description && (
                            <span className="text-[#e5e4e2]/60 text-xs line-clamp-2">{item.description}</span>
                          )}
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="mt-6 flex items-center justify-between pt-4 border-t border-[#d3bb73]/20">
                    <div className="flex items-center gap-2">
                      {isSaving ? (
                        <span className="text-[#d3bb73] text-sm flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          Zapisywanie...
                        </span>
                      ) : (
                        <span className="text-green-500 text-sm flex items-center gap-2">
                          <CheckCircle className="w-4 h-4" />
                          Zapisano automatycznie
                        </span>
                      )}
                    </div>

                    <button
                      onClick={() => loadData()}
                      className="px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Odśwież podgląd
                    </button>
                  </div>
                </div>
              )}

              {/* Infinite Carousel */}
              <div className="relative overflow-hidden" ref={carouselRef}>
                <div
                  className="flex gap-6 transition-transform duration-700 ease-out"
                  style={{ transform: `translateX(-${currentIndex * (100 / 3)}%)` }}
                >
                  {triplicatedServices.map((service, idx) => {
                    const Icon = iconMap[service.icon] || Package;
                    return (
                      <Link
                        key={`${service.id}-${idx}`}
                        href={`/uslugi/${service.slug}`}
                        className="flex-shrink-0 w-full sm:w-[calc(50%-12px)] lg:w-[calc(33.333%-16px)] group bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl overflow-hidden hover:border-[#d3bb73]/40 transition-all hover:-translate-y-1"
                      >
                        {service.thumbnail_url && (
                          <div className="aspect-video overflow-hidden bg-[#0f1119]">
                            <img
                              src={service.thumbnail_url}
                              alt={service.name}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                            />
                          </div>
                        )}
                        <div className="p-6">
                          <div className="w-12 h-12 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center mb-4 group-hover:bg-[#d3bb73]/20 transition-colors">
                            <Icon className="w-6 h-6 text-[#d3bb73]" />
                          </div>
                          <h3 className="text-[#e5e4e2] text-lg font-medium mb-2 group-hover:text-[#d3bb73] transition-colors">
                            {service.name}
                          </h3>
                          {service.description && (
                            <p className="text-[#e5e4e2]/60 text-sm line-clamp-2">
                              {service.description}
                            </p>
                          )}
                        </div>
                      </Link>
                    );
                  })}
                </div>

                {/* Navigation Arrows */}
                {relatedServices.length > 3 && (
                  <>
                    <button
                      onClick={handlePrev}
                      className="absolute left-0 top-1/2 -translate-y-1/2 bg-[#d3bb73] text-[#1c1f33] p-3 rounded-full hover:bg-[#d3bb73]/90 transition-all z-10 shadow-lg"
                      aria-label="Previous services"
                    >
                      <ArrowLeft className="w-6 h-6" />
                    </button>
                    <button
                      onClick={handleNext}
                      className="absolute right-0 top-1/2 -translate-y-1/2 bg-[#d3bb73] text-[#1c1f33] p-3 rounded-full hover:bg-[#d3bb73]/90 transition-all z-10 shadow-lg"
                      aria-label="Next services"
                    >
                      <ArrowLeft className="w-6 h-6 rotate-180" />
                    </button>
                  </>
                )}
              </div>

              {/* Dots Indicator */}
              {relatedServices.length > 1 && (
                <div className="flex justify-center gap-2 mt-8">
                  {relatedServices.map((_, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCurrentIndex(idx + relatedServices.length)}
                      className={`w-2 h-2 rounded-full transition-all ${
                        currentIndex % relatedServices.length === idx
                          ? 'bg-[#d3bb73] w-8'
                          : 'bg-[#d3bb73]/30 hover:bg-[#d3bb73]/50'
                      }`}
                      aria-label={`Go to service ${idx + 1}`}
                    />
                  ))}
                </div>
              )}

              <div className="text-center mt-12">
                <Link
                  href="/uslugi"
                  className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-all"
                >
                  Zobacz wszystkie usługi
                  <ArrowLeft className="w-4 h-4 rotate-180" />
                </Link>
              </div>
            </div>
          </section>
  )
}
