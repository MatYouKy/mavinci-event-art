'use client';

import { useEffect, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import { ServiceCard } from '@/components/ServiceCard';
import { supabase } from '@/lib/supabase';

interface Service {
  id: string;
  slug: string;
  title: string;
  description: string;
  icon_name: string;
  color_from: string;
  color_to: string;
  border_color: string;
  hero_image_url: string | null;
  hero_opacity: number;
  order_index: number;
  image_metadata?: any;
}

export default function OfertaPageClient() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadServices();
  }, []);

  async function loadServices() {
    try {
      const servicePages = [
        { slug: 'naglosnienie', table: 'naglosnienie_page_images', icon: 'Mic', order: 1 },
        { slug: 'konferencje', table: 'konferencje_page_images', icon: 'Presentation', order: 2 },
        { slug: 'streaming', table: 'streaming_page_images', icon: 'Video', order: 3 },
        { slug: 'symulatory-vr', table: 'symulatory-vr_page_images', icon: 'Gamepad2', order: 4 },
        { slug: 'quizy-teleturnieje', table: 'quizy-teleturnieje_page_images', icon: 'Sparkles', order: 5 },
        { slug: 'integracje', table: 'integracje_page_images', icon: 'Users', order: 6 },
        { slug: 'kasyno', table: 'kasyno_page_images', icon: 'Sparkles', order: 7 },
        { slug: 'wieczory-tematyczne', table: 'wieczory-tematyczne_page_images', icon: 'Lamp', order: 8 },
        { slug: 'technika-sceniczna', table: 'technika-sceniczna_page_images', icon: 'Monitor', order: 9 },
      ];

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

  if (loading) {
    return (
      <>
        <main className="min-h-screen bg-gradient-to-b from-[#0f1119] to-[#1c1f33] pt-28 pb-20">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center">
              <div className="animate-pulse text-[#d3bb73]">Ładowanie usług...</div>
            </div>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar />

      <main className="min-h-screen bg-gradient-to-b from-[#0f1119] to-[#1c1f33] pt-28 pb-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-6">
            <CategoryBreadcrumb pageSlug="oferta" />
          </div>

          <div className="text-center mb-16">
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-light text-[#e5e4e2] mb-6">
              Nasza <span className="text-[#d3bb73] font-normal">Oferta</span>
            </h1>
            <p className="text-lg text-[#e5e4e2]/70 max-w-3xl mx-auto">
              Oferujemy kompleksową obsługę techniczną i organizację eventów.
              Wybierz usługę, która Cię interesuje i poznaj szczegóły.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
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
                heroOpacity={service.hero_opacity}
                imageMetadata={service.image_metadata}
                index={index}
              />
            ))}
          </div>

          <div className="mt-16 text-center">
            <Link
              href="/#kontakt"
              className="inline-flex items-center gap-2 px-8 py-4 bg-[#d3bb73] text-[#1c1f33] rounded-full font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 hover:scale-105 hover:shadow-lg hover:shadow-[#d3bb73]/40"
            >
              Skontaktuj się z nami
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>

        <style jsx>{`
          @keyframes fadeInUp {
            from {
              opacity: 0;
              transform: translateY(30px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }
        `}</style>
      </main>

      <Footer />
    </>
  );
}
