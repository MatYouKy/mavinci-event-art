'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Music, Monitor, Award, Settings, Sparkles, Shield } from 'lucide-react';
import DJPackagesEditor from './sections/DJPackagesEditor';
import DJGalleryEditor from './sections/DJGalleryEditor';
import { useEditMode } from '@/contexts/EditModeContext';
import { RelatedServicesSection } from '../konferencje/sections/RelatedServicesSection';

const iconMap: Record<string, any> = {
  music: Music,
  monitor: Monitor,
  award: Award,
  settings: Settings,
  sparkles: Sparkles,
  shield: Shield,
};

export default function DJPage() {
  const { isEditMode } = useEditMode();
  const [intro, setIntro] = useState<any>(null);
  const [features, setFeatures] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);
  const [relatedServices, setRelatedServices] = useState<any[]>([]);
  const [allServiceItems, setAllServiceItems] = useState<any[]>([]);
  const [selectedServiceIds, setSelectedServiceIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [
        heroRes,
        introRes,
        featuresRes,
        themesRes,
        benefitsRes,
        relatedServicesRes,
        allServiceItemsRes,
      ] = await Promise.all([
        supabase
          .from('dj_hero_page_images')
          .select('*')
          .eq('section', 'hero')
          .eq('is_active', true)
          .maybeSingle(),
        supabase.from('dj_intro').select('*').single(),
        supabase.from('dj_features').select('*').eq('is_visible', true).order('order_index'),
        supabase.from('dj_themes').select('*').eq('is_visible', true).order('order_index'),
        supabase.from('dj_benefits').select('*').eq('is_visible', true).order('order_index'),
        supabase
          .from('dj_related_services')
          .select(`*, service_item:conferences_service_items(*)`)
          .eq('is_active', true)
          .order('display_order'),
        supabase
          .from('conferences_service_items')
          .select('*')
          .eq('is_active', true)
          .order('display_order'),
      ]);

      if (introRes.error) console.error('dj_intro error:', introRes.error);
      if (featuresRes.error) console.error('dj_features error:', featuresRes.error);
      if (themesRes.error) console.error('dj_themes error:', themesRes.error);
      if (benefitsRes.error) console.error('dj_benefits error:', benefitsRes.error);
      if (relatedServicesRes.error)
        console.error('dj_related_services error:', relatedServicesRes.error);

      if (introRes.data) setIntro(introRes.data);
      if (featuresRes.data) setFeatures(featuresRes.data);
      if (themesRes.data) setThemes(themesRes.data);
      if (benefitsRes.data) setBenefits(benefitsRes.data);

      if (relatedServicesRes.data) {
        setRelatedServices(relatedServicesRes.data.map((r) => r.service_item));
        setSelectedServiceIds(new Set(relatedServicesRes.data.map((r) => r.service_item_id)));
      }
      if (allServiceItemsRes.data) setAllServiceItems(allServiceItemsRes.data);

      if (heroRes.error) console.error('dj_hero_page_images error:', heroRes.error);
    } catch (error) {
      console.error('Error fetching DJ data:', error);
    }
  };

  return (
    <main className="min-h-screen bg-[#0f1119]">
      {intro && (
        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h1 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">{intro.title}</h1>
              <p className="mb-6 text-xl font-light text-[#d3bb73]">{intro.subtitle}</p>
              <div className="mx-auto mb-8 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="mx-auto max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/80">
                {intro.description}
              </p>
            </motion.div>
          </div>
        </section>
      )}

      <DJPackagesEditor />

      {features.length > 0 && (
        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Dlaczego My?</h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = iconMap[feature.icon_name] || Music;
                return (
                  <motion.div
                    key={feature.id}
                    initial={{ opacity: 0, scale: 0.95 }}
                    whileInView={{ opacity: 1, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1 }}
                    className="rounded-2xl border border-[#d3bb73]/10 bg-[#0f1119]/50 p-6 backdrop-blur-sm transition-all duration-300 hover:border-[#d3bb73]/30"
                  >
                    <div className="mb-4 inline-flex rounded-xl bg-[#d3bb73]/10 p-3 text-[#d3bb73]">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="mb-2 text-xl font-light text-[#e5e4e2]">{feature.title}</h3>
                    <p className="font-light text-[#e5e4e2]/60">{feature.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <DJGalleryEditor />

      {themes.length > 0 && (
        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">DJ-e Tematyczni</h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
                Specjalizujemy się w różnych stylach muzycznych
              </p>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {themes.map((theme, index) => (
                <motion.div
                  key={theme.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="rounded-2xl bg-[#1c1f33]/50 p-6 transition-all duration-300 hover:bg-[#1c1f33]"
                >
                  <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">{theme.title}</h3>
                  <p className="mb-4 text-sm font-light text-[#e5e4e2]/70">{theme.description}</p>
                  {theme.music_styles && theme.music_styles.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {theme.music_styles.map((style: string, i: number) => (
                        <span
                          key={i}
                          className="rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]"
                        >
                          {style}
                        </span>
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {benefits.length > 0 && (
        <section className="bg-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Jak Pracujemy?</h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {benefits.map((benefit, index) => (
                <motion.div
                  key={benefit.id}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33]/30 p-6 transition-all duration-300 hover:border-[#d3bb73]/30"
                >
                  <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">{benefit.title}</h3>
                  <p className="text-sm font-light text-[#e5e4e2]/60">{benefit.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}
      <RelatedServicesSection
        isEditMode={isEditMode}
        selectedServiceIds={selectedServiceIds}
        setSelectedServiceIds={setSelectedServiceIds}
        allServiceItems={allServiceItems}
        loadData={fetchData}
        relatedServices={relatedServices}
        tableName="dj_related_services"
      />

      <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
        <div className="mx-auto max-w-4xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <Music className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Potrzebujesz DJ-a na Swoją Imprezę?
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Skontaktuj się z nami, aby omówić szczegóły. Stworzymy ofertę szytą na miarę Twoich
              potrzeb - repertuar, sprzęt, czas trwania.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Zapytaj o ofertę
            </a>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
