'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { Music, Monitor, Award, Settings, Sparkles, Shield, Check, Star } from 'lucide-react';

const iconMap: Record<string, any> = {
  'music': Music,
  'monitor': Monitor,
  'award': Award,
  'settings': Settings,
  'sparkles': Sparkles,
  'shield': Shield,
};

export default function DJPage() {
  const [intro, setIntro] = useState<any>(null);
  const [packages, setPackages] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  const [themes, setThemes] = useState<any[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [introRes, packagesRes, featuresRes, galleryRes, themesRes, benefitsRes] = await Promise.all([
        supabase.from('dj_intro').select('*').single(),
        supabase.from('dj_packages').select('*').eq('is_visible', true).order('order_index'),
        supabase.from('dj_features').select('*').eq('is_visible', true).order('order_index'),
        supabase.from('dj_gallery').select('*').eq('is_visible', true).order('order_index'),
        supabase.from('dj_themes').select('*').eq('is_visible', true).order('order_index'),
        supabase.from('dj_benefits').select('*').eq('is_visible', true).order('order_index'),
      ]);

      if (introRes.data) setIntro(introRes.data);
      if (packagesRes.data) setPackages(packagesRes.data);
      if (featuresRes.data) setFeatures(featuresRes.data);
      if (galleryRes.data) setGallery(galleryRes.data);
      if (themesRes.data) setThemes(themesRes.data);
      if (benefitsRes.data) setBenefits(benefitsRes.data);
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
              <h1 className="mb-4 text-4xl font-light text-[#e5e4e2] md:text-5xl">
                {intro.title}
              </h1>
              <p className="mb-6 text-xl font-light text-[#d3bb73]">
                {intro.subtitle}
              </p>
              <div className="mx-auto mb-8 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="mx-auto max-w-3xl text-lg font-light leading-relaxed text-[#e5e4e2]/80">
                {intro.description}
              </p>
            </motion.div>
          </div>
        </section>
      )}

      {packages.length > 0 && (
        <section className="bg-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
                Pakiety DJ
              </h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
                Wybierz pakiet dopasowany do Twojego eventu
              </p>
            </motion.div>

            <div className="grid gap-8 md:grid-cols-3">
              {packages.map((pkg, index) => (
                <motion.div
                  key={pkg.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className={`group relative overflow-hidden rounded-2xl p-8 transition-all duration-300 ${
                    pkg.level === 'Premium'
                      ? 'border-2 border-[#d3bb73] bg-gradient-to-br from-[#d3bb73]/10 to-[#1c1f33] shadow-2xl shadow-[#d3bb73]/20'
                      : 'border border-[#d3bb73]/20 bg-gradient-to-br from-[#1c1f33] to-[#1c1f33]/50 hover:border-[#d3bb73]/40'
                  }`}
                >
                  {pkg.level === 'Premium' && (
                    <div className="absolute right-4 top-4">
                      <div className="flex items-center gap-1 rounded-full bg-[#d3bb73] px-3 py-1 text-xs font-medium text-[#1c1f33]">
                        <Star className="h-3 w-3" />
                        Najpopularniejszy
                      </div>
                    </div>
                  )}

                  <div className="mb-6">
                    <h3 className="mb-2 text-2xl font-light text-[#e5e4e2]">
                      {pkg.name}
                    </h3>
                    <div className="mb-4 flex items-baseline gap-2">
                      <span className="text-4xl font-light text-[#d3bb73]">
                        {pkg.price_from?.toLocaleString('pl-PL')}
                      </span>
                      <span className="text-sm text-[#e5e4e2]/60">PLN</span>
                    </div>
                    <p className="mb-4 text-sm font-light text-[#e5e4e2]/70">
                      {pkg.duration}
                    </p>
                  </div>

                  <p className="mb-6 font-light leading-relaxed text-[#e5e4e2]/80">
                    {pkg.description}
                  </p>

                  {pkg.features && pkg.features.length > 0 && (
                    <ul className="mb-6 space-y-2">
                      {pkg.features.map((feature: string, i: number) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-[#e5e4e2]/70">
                          <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#d3bb73]" />
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  <a
                    href="/#kontakt"
                    className={`inline-block w-full rounded-full py-3 text-center text-sm font-medium transition-colors ${
                      pkg.level === 'Premium'
                        ? 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90'
                        : 'border border-[#d3bb73] text-[#d3bb73] hover:bg-[#d3bb73]/10'
                    }`}
                  >
                    Zapytaj o ofertę
                  </a>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {features.length > 0 && (
        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
                Dlaczego My?
              </h2>
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
                    <h3 className="mb-2 text-xl font-light text-[#e5e4e2]">
                      {feature.title}
                    </h3>
                    <p className="font-light text-[#e5e4e2]/60">
                      {feature.description}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {gallery.length > 0 && (
        <section className="bg-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
                Galeria
              </h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {gallery.map((image, index) => (
                <motion.div
                  key={image.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="group relative aspect-[4/3] overflow-hidden rounded-2xl"
                >
                  <img
                    src={image.image_url}
                    alt={image.title || 'DJ Gallery'}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                  />
                  {image.title && (
                    <div className="absolute inset-0 flex items-end bg-gradient-to-t from-black/80 to-transparent p-6 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                      <p className="font-light text-white">{image.title}</p>
                    </div>
                  )}
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

      {themes.length > 0 && (
        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
                DJ-e Tematyczni
              </h2>
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
                  <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">
                    {theme.title}
                  </h3>
                  <p className="mb-4 text-sm font-light text-[#e5e4e2]/70">
                    {theme.description}
                  </p>
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
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">
                Jak Pracujemy?
              </h2>
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
                  <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">
                    {benefit.title}
                  </h3>
                  <p className="text-sm font-light text-[#e5e4e2]/60">
                    {benefit.description}
                  </p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      )}

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
              Skontaktuj się z nami, aby omówić szczegóły. Stworzymy ofertę szytą na miarę Twoich potrzeb - repertuar, sprzęt, czas trwania.
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
