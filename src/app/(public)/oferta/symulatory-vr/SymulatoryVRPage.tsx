'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/supabase/browser';
import { Zap, Gamepad2, Users, Palette, Trophy, ShieldCheck, ArrowRight } from 'lucide-react';

const iconMap: Record<string, any> = {
  zap: Zap,
  'gamepad-2': Gamepad2,
  users: Users,
  palette: Palette,
  trophy: Trophy,
  'shield-check': ShieldCheck,
};

export default function SymulatoryVRPage() {
  const [intro, setIntro] = useState<any>(null);
  const [equipment, setEquipment] = useState<any[]>([]);
  const [features, setFeatures] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  const [experiences, setExperiences] = useState<any[]>([]);
  const [benefits, setBenefits] = useState<any[]>([]);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [introRes, equipmentRes, featuresRes, galleryRes, experiencesRes, benefitsRes] =
        await Promise.all([
          supabase.from('vr_simulators_intro').select('*').single(),
          supabase
            .from('vr_equipment_types')
            .select('*')
            .eq('is_visible', true)
            .order('order_index'),
          supabase.from('vr_features').select('*').eq('is_visible', true).order('order_index'),
          supabase.from('vr_gallery').select('*').eq('is_visible', true).order('order_index'),
          supabase.from('vr_experiences').select('*').eq('is_visible', true).order('order_index'),
          supabase.from('vr_benefits').select('*').eq('is_visible', true).order('order_index'),
        ]);

      if (introRes.data) setIntro(introRes.data);
      if (equipmentRes.data) setEquipment(equipmentRes.data);
      if (featuresRes.data) setFeatures(featuresRes.data);
      if (galleryRes.data) setGallery(galleryRes.data);
      if (experiencesRes.data) setExperiences(experiencesRes.data);
      if (benefitsRes.data) setBenefits(benefitsRes.data);
    } catch (error) {
      console.error('Error fetching VR data:', error);
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

      {equipment.length > 0 && (
        <section className="bg-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Sprzęt i Urządzenia</h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
                Najnowszy sprzęt VR i profesjonalne stanowiska wyścigowe
              </p>
            </motion.div>

            <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
              {equipment.map((item, index) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="group overflow-hidden rounded-2xl bg-gradient-to-br from-[#1c1f33] to-[#1c1f33]/50 transition-all duration-300 hover:shadow-2xl hover:shadow-[#d3bb73]/10"
                >
                  {item.image_url && (
                    <div className="aspect-video overflow-hidden">
                      <img
                        src={item.image_url}
                        alt={item.title}
                        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110"
                      />
                    </div>
                  )}
                  <div className="p-6">
                    <h3 className="mb-3 text-2xl font-light text-[#e5e4e2]">{item.title}</h3>
                    <p className="mb-4 font-light leading-relaxed text-[#e5e4e2]/70">
                      {item.description}
                    </p>
                    {item.specs && (
                      <div className="space-y-1 text-sm text-[#d3bb73]/80">
                        {Object.entries(item.specs).map(([key, value]: [string, any]) => (
                          <div key={key} className="flex justify-between">
                            <span className="capitalize">{key.replace('_', ' ')}:</span>
                            <span className="font-medium text-[#e5e4e2]/60">
                              {Array.isArray(value)
                                ? value.join(', ')
                                : typeof value === 'boolean'
                                  ? value
                                    ? 'Tak'
                                    : 'Nie'
                                  : value}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
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
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Dlaczego warto?</h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {features.map((feature, index) => {
                const Icon = iconMap[feature.icon_name] || Zap;
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

      {gallery.length > 0 && (
        <section className="bg-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Galeria</h2>
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
                    alt={image.title || 'VR Gallery'}
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

      {experiences.length > 0 && (
        <section className="bg-gradient-to-br from-[#1c1f33] to-[#0f1119] px-6 py-24">
          <div className="mx-auto max-w-7xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              className="mb-16 text-center"
            >
              <h2 className="mb-4 text-4xl font-light text-[#e5e4e2]">Dostępne Doświadczenia VR</h2>
              <div className="mx-auto mb-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent" />
              <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
                Wybierz spośród setek gier i symulacji
              </p>
            </motion.div>

            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {experiences.map((exp, index) => (
                <motion.div
                  key={exp.id}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: index * 0.1 }}
                  className="rounded-2xl bg-[#1c1f33]/50 p-6 transition-all duration-300 hover:bg-[#1c1f33]"
                >
                  <div className="mb-3 inline-block rounded-lg bg-[#d3bb73]/10 px-3 py-1 text-xs font-medium text-[#d3bb73]">
                    {exp.category}
                  </div>
                  <h3 className="mb-3 text-xl font-light text-[#e5e4e2]">{exp.title}</h3>
                  <p className="font-light text-[#e5e4e2]/60">{exp.description}</p>
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
                Korzyści dla Twojego Eventu
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
                  className="flex gap-4 rounded-2xl border border-[#d3bb73]/10 bg-[#1c1f33]/30 p-6 transition-all duration-300 hover:border-[#d3bb73]/30"
                >
                  <div className="flex-shrink-0">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d3bb73]/10 text-[#d3bb73]">
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                  <div>
                    <h3 className="mb-2 text-lg font-light text-[#e5e4e2]">{benefit.title}</h3>
                    <p className="text-sm font-light text-[#e5e4e2]/60">{benefit.description}</p>
                  </div>
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
            <Gamepad2 className="mx-auto mb-6 h-16 w-16 text-[#d3bb73]" />
            <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] md:text-4xl">
              Dodaj Symulatory VR do Swojego Eventu
            </h2>
            <p className="mx-auto mb-8 max-w-2xl text-lg font-light text-[#e5e4e2]/70">
              Skontaktuj się z nami, aby poznać dostępne opcje. Dobierzemy najlepsze symulatory i
              doświadczenia VR dla Twojego wydarzenia.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
            >
              Skontaktuj się z nami
            </a>
          </motion.div>
        </div>
      </section>
    </main>
  );
}
