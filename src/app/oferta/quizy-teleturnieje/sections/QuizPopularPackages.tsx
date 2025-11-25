'use client';

import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Edit2, Plus, Package } from 'lucide-react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useWebsiteEdit } from '@/hooks/useWebsiteEdit';
import { CustomIcon } from '@/components/UI/CustomIcon/CustomIcon';
import QuizPackageEditModal from './QuizPackageEditModal';

interface PopularPackage {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  icon_id: string | null;
  order_index: number;
}

export default function QuizPopularPackages() {
  const { canEdit } = useWebsiteEdit();
  const [packages, setPackages] = useState<PopularPackage[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    fetchPackages();

    const channel = supabase
      .channel('quiz_packages_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quiz_popular_packages' }, (payload) => {
        if (payload.eventType === 'INSERT') {
          setPackages(prev => [...prev, payload.new as PopularPackage].sort((a, b) => a.order_index - b.order_index));
        } else if (payload.eventType === 'UPDATE') {
          setPackages(prev => prev.map(p => p.id === payload.new.id ? payload.new as PopularPackage : p));
        } else if (payload.eventType === 'DELETE') {
          setPackages(prev => prev.filter(p => p.id !== payload.old.id));
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const fetchPackages = async () => {
    try {
      const { data, error } = await supabase
        .from('quiz_popular_packages')
        .select('*')
        .eq('is_visible', true)
        .order('order_index', { ascending: true });

      if (error) throw error;
      setPackages(data || []);
    } catch (error) {
      console.error('Error fetching packages:', error);
    }
  };

  const nextSlide = () => {
    setCurrentIndex((prev) => (prev + 1) % packages.length);
  };

  const prevSlide = () => {
    setCurrentIndex((prev) => (prev - 1 + packages.length) % packages.length);
  };

  if (packages.length === 0 && !canEdit) return null;

  return (
    <>
      <section className="relative bg-[#0f1119] px-6 py-24 overflow-hidden">
        <div className="absolute left-0 top-1/4 h-96 w-96 rounded-full bg-[#d3bb73]/5 blur-3xl" />
        <div className="absolute right-0 bottom-1/4 h-96 w-96 rounded-full bg-[#800020]/5 blur-3xl" />

        <div className="relative z-10 mx-auto max-w-7xl">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="mb-16 text-center"
          >
            <h2 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
              Zobacz co najczesciej <span className="text-[#d3bb73]">Dobieraja</span> Organizatorzy
            </h2>
            <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Poznaj szczegoly naszych rozwiazan technicznych
            </p>

            {canEdit && (
              <button
                onClick={() => setIsAdding(true)}
                className="mt-6 inline-flex items-center gap-2 rounded-full border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-6 py-3 text-sm font-light text-[#d3bb73] transition-all hover:bg-[#d3bb73]/20"
              >
                <Plus className="h-4 w-4" />
                Dodaj pakiet
              </button>
            )}
          </motion.div>

          {packages.length === 0 ? (
            <div className="text-center text-[#e5e4e2]/60">
              <Package className="mx-auto mb-4 h-16 w-16 text-[#d3bb73]/40" />
              <p>Brak pakietow do wyswietlenia</p>
            </div>
          ) : (
            <div className="relative">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {packages.slice(currentIndex, currentIndex + 3).concat(packages.slice(0, Math.max(0, currentIndex + 3 - packages.length))).map((pkg, i) => (
                  <motion.div
                    key={pkg.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.1 }}
                    className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c1f33] to-[#0f1119] p-8 shadow-2xl border border-[#d3bb73]/20"
                  >
                    {canEdit && (
                      <button
                        onClick={() => setEditingId(pkg.id)}
                        className="absolute right-4 top-4 z-30 rounded-full bg-[#d3bb73]/10 p-2 text-[#d3bb73] backdrop-blur-sm transition-colors hover:bg-[#d3bb73]/20"
                      >
                        <Edit2 className="h-4 w-4" />
                      </button>
                    )}

                    {pkg.icon_id ? (
                      <div className="mb-6 inline-flex rounded-xl bg-[#d3bb73]/10 p-4 ring-1 ring-[#d3bb73]/20">
                        <CustomIcon iconId={pkg.icon_id} className="h-12 w-12 text-[#d3bb73]" />
                      </div>
                    ) : (
                      <div className="mb-6 inline-flex h-[80px] w-[80px] items-center justify-center rounded-xl bg-[#d3bb73]/10 ring-1 ring-[#d3bb73]/20">
                        <Package className="h-10 w-10 text-[#d3bb73]" />
                      </div>
                    )}

                    <h3 className="mb-3 text-2xl font-light text-[#e5e4e2]">
                      {pkg.title}
                    </h3>

                    <p className="mb-6 font-light leading-relaxed text-[#e5e4e2]/70">
                      {pkg.description}
                    </p>

                    {pkg.image_url && (
                      <div className="aspect-video overflow-hidden rounded-xl">
                        <img
                          src={pkg.image_url}
                          alt={pkg.title}
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>

              {packages.length > 3 && (
                <>
                  <button
                    onClick={prevSlide}
                    className="absolute left-0 top-1/2 z-30 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-4 text-[#d3bb73] backdrop-blur-sm transition-all hover:bg-[#d3bb73]/20 md:-left-20"
                  >
                    <ChevronLeft className="h-6 w-6" />
                  </button>

                  <button
                    onClick={nextSlide}
                    className="absolute right-0 top-1/2 z-30 -translate-y-1/2 rounded-full bg-[#d3bb73]/10 p-4 text-[#d3bb73] backdrop-blur-sm transition-all hover:bg-[#d3bb73]/20 md:-right-20"
                  >
                    <ChevronRight className="h-6 w-6" />
                  </button>

                  <div className="mt-12 flex justify-center gap-2">
                    {packages.map((_, index) => (
                      <button
                        key={index}
                        onClick={() => setCurrentIndex(index)}
                        className={`h-2 rounded-full transition-all ${
                          index === currentIndex
                            ? 'w-8 bg-[#d3bb73]'
                            : 'w-2 bg-[#d3bb73]/30 hover:bg-[#d3bb73]/50'
                        }`}
                      />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </section>

      {(editingId || isAdding) && (
        <QuizPackageEditModal
          packageId={editingId}
          onClose={() => {
            setEditingId(null);
            setIsAdding(false);
          }}
        />
      )}
    </>
  );
}
