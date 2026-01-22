import { Metadata } from 'next';
import { createSupabaseServerClient } from '@/lib/supabase/server.app';
import TeamPageClient from './TeamPageClient';
import PageLayout from '@/components/Layout/PageLayout';
import { getSeoForPage } from '@/lib/seo';
import { TeamMember } from '@/lib/supabase/types';
import { cookies } from 'next/headers';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function loadPageMetadata() {
  const supabase = createSupabaseServerClient(cookies());

  const { data: metadata } = await supabase
    .from('schema_org_page_metadata')
    .select('*')
    .eq('page_slug', 'zespol')
    .eq('is_active', true)
    .maybeSingle();

  const { data: globalConfig } = await supabase.from('schema_org_global').select('*').single();

  return { metadata, globalConfig };
}

export async function generateMetadata(): Promise<Metadata> {
  const { metadata } = await loadPageMetadata();

  const title = metadata?.title || 'Nasz Zespół | MAVINCI Event & ART';
  const description = metadata?.description || 'Poznaj profesjonalny zespół MAVINCI.';
  const keywords = metadata?.keywords || [];
  const ogImage = metadata?.og_image || 'https://mavinci.pl/logo-mavinci-crm.png';

  return {
    title,
    description,
    keywords: keywords.join(', '),
    alternates: {
      canonical: 'https://mavinci.pl/zespol',
    },
    openGraph: {
      type: 'website',
      url: 'https://mavinci.pl/zespol',
      title,
      description,
      images: [
        {
          url: ogImage,
          alt: title,
        },
      ],
      siteName: 'MAVINCI Event & ART',
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function TeamPage() {
  const { metadata, globalConfig } = await loadPageMetadata();
  const seo = await getSeoForPage('zespol', cookies());

  const areaServed =
    seo?.places.map((place) => ({
      '@type': 'Place',
      name: place.name,
      address: {
        '@type': 'PostalAddress',
        addressLocality: place.locality,
        postalCode: place.postal_code,
        addressRegion: place.region,
        addressCountry: {
          '@type': 'Country',
          name: place.country,
        },
      },
    })) || [];

  const customSchema = globalConfig
    ? {
        '@context': 'http://schema.org',
        '@type': metadata?.schema_type || 'AboutPage',
        name: metadata?.title || 'Nasz Zespół',
        description: metadata?.description,
        url: 'https://mavinci.pl/zespol',
        mainEntity: {
          '@type': 'Organization',
          name: globalConfig.organization_name,
          url: globalConfig.organization_url,
          logo: globalConfig.organization_logo,
          telephone: globalConfig.telephone,
          email: globalConfig.email,
          address: {
            '@type': 'PostalAddress',
            streetAddress: globalConfig.street_address,
            addressLocality: globalConfig.locality,
            postalCode: globalConfig.postal_code,
            addressRegion: globalConfig.region,
            addressCountry: globalConfig.country,
          },
          sameAs: [
            globalConfig.facebook_url,
            globalConfig.instagram_url,
            globalConfig.linkedin_url,
            globalConfig.youtube_url,
            globalConfig.twitter_url,
          ].filter(Boolean),
        },
        areaServed,
      }
    : undefined;

  const supabase = createSupabaseServerClient(cookies());

  const { data, error } = await supabase
    .from('employees')
    .select(
      'id, name, surname, nickname, email, avatar_url, team_page_metadata, role, occupation, show_on_website, website_bio, linkedin_url, instagram_url, facebook_url, order_index',
    )
    .eq('show_on_website', true)
    .order('order_index', { ascending: true })
    .order('created_at', { ascending: true });

  const initialTeam = (data ?? []).map((emp: any) => ({
    id: emp.id,
    name: `${emp.name || ''} ${emp.surname || ''}`.trim() || emp.nickname || 'Pracownik',
    position: emp.occupation || emp.role || '',
    role: emp.role || emp.occupation || '',
    email: emp.email,
    image: emp.avatar_url,
    image_metadata: emp.team_page_metadata,
    alt: `${emp.name || ''} ${emp.surname || ''}`.trim(),
    bio: emp.website_bio,
    linkedin: emp.linkedin_url,
    instagram: emp.instagram_url,
    facebook: emp.facebook_url,
  }));

  return (
    <PageLayout pageSlug="zespol" customSchema={customSchema} cookieStore={cookies()}>
      <TeamPageClient initialTeam={initialTeam as TeamMember[]} />
    </PageLayout>
  );
}
