'use client';

import { Service, servicePages } from '@/app/oferta/OfertaPageClient';
import { PortfolioProject, supabase } from '@/lib/supabase';
import { Icon } from '@mui/material';
import {
  ArrowRight,
  Mic,
  Presentation,
  Monitor,
  Gamepad2,
  Sparkles,
  Users,
  Video,
  Lamp,
  Dices,
  Eye,
  ArrowUpRight,
  Loader2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ServiceCard } from './ServiceCard';

export default function OfertaSection() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  async function loadServices() {
    try {
      const servicesData: Service[] = [];

      for (const page of servicePages) {
        try {
          const { data, error } = await supabase
            .from(page.table)
            .select('*')
            .eq('section', 'hero')
            .eq('is_active', true)
            .maybeSingle();

          if (error) {
            console.error(`Error loading ${page.table}:`, error);
            continue;
          }

          if (data) {
            servicesData.push({
              id: data.id,
              slug: page.slug,
              title: data.title || page.slug,
              description: data.description || '',
              icon_name: page.icon,
              color_from: 'blue-500/20',
              color_to: 'blue-600/20',
              border_color: 'border-blue-500/30',
              hero_image_url: data.image_url,
              hero_opacity: parseFloat(data.opacity) || 1,
              order_index: page.order,
              image_metadata: data.image_metadata,
            });
          }
        } catch (err) {
          console.error(`Error processing ${page.slug}:`, err);
        }
      }

      servicesData.sort((a, b) => a.order_index - b.order_index);
      setServices(servicesData);
    } catch (error) {
      console.error('Error loading services:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadServices();
  }, []);

  if (loading) {
    return (
      <section className="flex justify-center items-center h-full">
        <Loader2 className="h-10 w-10 animate-spin text-[#d3bb73]" />
      </section>
    );
  }

  return (
    <section
      id="oferta"
      className="relative overflow-hidden bg-gradient-to-b from-[#1c1f33] to-[#0f1119] py-24 md:py-32"
    >
      <div className="absolute inset-0 opacity-5">
        <div className="absolute left-1/3 top-1/3 h-96 w-96 rounded-full bg-[#d3bb73] blur-3xl"></div>
        <div className="absolute bottom-1/3 right-1/3 h-96 w-96 rounded-full bg-[#800020] blur-3xl"></div>
      </div>

      <div className="relative z-10 mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-16 text-center">
          <span className="mb-4 block text-sm font-light uppercase tracking-widest text-[#d3bb73] md:text-base">
            Nasza Oferta
          </span>
          <h2 className="mb-6 text-3xl font-light text-[#e5e4e2] sm:text-4xl md:text-5xl">
            Specjalizacje i Rozwiązania
          </h2>
          <p className="mx-auto max-w-2xl text-lg font-light text-[#e5e4e2]/70">
            Dedykowane strony z pełną informacją o naszych kluczowych usługach
          </p>
          <div className="mx-auto mt-6 h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent"></div>
        </div>

        <div className="mb-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {services.map((service, index) => (
            <ServiceCard
              key={service.id}
              slug={service.slug}
              title={service.title}
              description={service.description}
              iconName={service.icon_name}
              colorFrom={service.color_from}
              colorTo={service.color_to}
              borderColor={service.border_color}
              heroImageUrl={service.hero_image_url || undefined}
              heroOpacity={0.9}
              imageMetadata={service.image_metadata}
              index={index}
            />
          ))}
        </div>

        <div className="text-center">
          <Link
            href="/oferta"
            className="inline-flex items-center gap-2 rounded-full bg-[#d3bb73] px-8 py-3 text-sm font-medium text-[#1c1f33] transition-all duration-200 hover:bg-[#d3bb73]/90"
          >
            Zobacz pełną ofertę
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
