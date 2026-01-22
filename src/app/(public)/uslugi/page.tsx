import { unstable_noStore as noStore } from 'next/cache';

import { Metadata } from 'next';
import PageLayout from '@/components/Layout/PageLayout';
import { UslugiPageClient } from './UslugiPageClient';
import { notFound } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import { cookies } from 'next/headers';
async function loadServiceData(slug: string) {
  noStore(); // Prevent caching for dynamic data
  const supabase = createSupabaseServerClient(cookies());

  const { data: serviceData, error: serviceError } = await supabase
    .from('conferences_service_items')
    .select(
      `
      *,
      items:conferences_service_items(*)
    `,
    )
    .eq('is_active', true)
    .order('display_order');

  if (!serviceData || serviceError) {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const data = await loadServiceData('uslugi');

  if (!data) {
    return {
      title: 'Lista Usług Eventowych| MAVINCI Event & ART',
    };
  }

  const { service, heroImage } = data;
  const canonicalUrl = `https://mavinci.pl/uslugi`;

  // Use hero image for OG, fallback to thumbnail, then default
  const ogImageUrl =
    'https://fuuljhhuhfojtmmfmskq.supabase.co/storage/v1/object/public/site-images/hero/1760341625716-d0b65e.jpg';

  return {
    title: service.seo_title || `${service.name} | MAVINCI Event & ART`,
    description:
      service.seo_description ||
      'Poznaj wszystkie nasze usługi eventowe: technika konferencyjna, nagłośnienie, oświetlenie, multimedia, streaming, sceny i atrakcje. Profesjonalna obsługa eventów',
    keywords:
      'usługi eventowe, kompleksowa obsługa eventów, obsługa techniczna konferencji, nagłośnienie konferencyjne, oświetlenie eventowe, multimedia eventowe, technika sceniczna, technika estradowa, realizacja wydarzeń, realizacja konferencji',
    alternates: {
      canonical: canonicalUrl,
    },

    openGraph: {
      type: 'website',
      url: canonicalUrl,
      title: service.seo_title || service.name,
      description: service.seo_description || service.description,
      images: [
        {
          url: ogImageUrl,
          alt: heroImage?.alt_text || service.name,
        },
      ],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title: service.seo_title,
      description: service.seo_description || service.description,
      images: [ogImageUrl],
    },
  };
}

export default function UslugiPage() {
  return (
    <PageLayout pageSlug="uslugi" cookieStore={cookies()}>
      <UslugiPageClient />
    </PageLayout>
  );
}
