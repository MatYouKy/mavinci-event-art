import { Metadata } from 'next';

import Hero from '@/components/Hero';
import Stats from '@/components/Stats';
import Divider from '@/components/Divider';
import Services from '@/components/Services';
import OfertaSection from '@/components/OfertaSection';
import Portfolio from '@/components/Portfolio';
import DividerTwo from '@/components/DividerTwo';
import Team from '@/components/Team';
import DividerThree from '@/components/DividerThree';
import Process from '@/components/Process';
import DividerFour from '@/components/DividerFour';
import Contact from '@/components/Contact';
import WebsiteEditPanel from '@/components/WebsiteEditPanel';
import PageLayout from '@/components/Layout/PageLayout';
import HomeExpertise from '@/components/HomeExpertise';
import HomeQuestions from '@/components/HomeQuestions';
import { SITE, ORGANIZATION_ID, WEBSITE_ID } from '@/lib/SEO/site';
import { getPublicPageMetadata, publicSupabase } from '@/lib/SEO/publicData';
import { getPremiumConferenceCategories } from '@/lib/Pages/Home/getPremiumCategories';
import { getHeroServices } from '@/lib/Pages/Home/getHeroServices';
import { servicePages } from '@/lib/Pages/Services/servicePages';

import { cache } from 'react';
import { getPortfolioProjects } from '@/lib/Pages/Home/getPortfolioProjects';
import { getTeamMembers } from '@/lib/Pages/Home/getTeamMembers';
import { cookies } from 'next/headers';

export const getPremiumConferenceCategoriesCached = cache(getPremiumConferenceCategories);
export const getHeroServicesCached = cache(getHeroServices);
export const getPortfolioProjectsCached = cache(getPortfolioProjects);
export const getTeamMembersCached = cache(getTeamMembers);
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const getHomeMetadata = cache(async () => {
  const metadata = await getPublicPageMetadata('home');
  return {
    title: metadata?.title || SITE.title,
    description: metadata?.description || SITE.description,
    image: metadata?.og_image || `${SITE.url}/logo-mavinci-crm.png`,
  };
});

export async function generateMetadata(): Promise<Metadata> {
  const { title, description, image } = await getHomeMetadata();
  return {
    title: { absolute: title }, description, alternates: { canonical: SITE.url },
    openGraph: { type: 'website', url: SITE.url, title, description, siteName: SITE.name,
      locale: 'pl_PL', images: [{ url: image, alt: SITE.name }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  };
}

export default async function HomePage() {
  const [categories, services, portfolioProjects, teamMembers, hero, pageMetadata] = await Promise.all([
    getPremiumConferenceCategoriesCached(), getHeroServicesCached(servicePages),
    getPortfolioProjectsCached(), getTeamMembersCached(),
    publicSupabase().from('site_images').select('*').eq('section', 'hero')
      .eq('is_active', true).order('order_index').limit(1).maybeSingle(),
    getHomeMetadata(),
  ]);
  const customSchema = {
    '@context': 'https://schema.org', '@type': 'WebPage', '@id': `${SITE.url}/#webpage`,
    url: SITE.url, name: pageMetadata.title, description: pageMetadata.description, inLanguage: 'pl-PL',
    isPartOf: { '@id': WEBSITE_ID }, about: { '@id': ORGANIZATION_ID },
  };
  return (
    <PageLayout pageSlug="home" customSchema={customSchema} cookieStore={cookies()}>
      <main className="min-h-screen">
        <Hero initialHeroImage={hero.data} />
        <Stats />
        <Divider />
        <Services categories={categories} />
        <OfertaSection services={services} />
        <Portfolio portfolioProjects={portfolioProjects} />
        <DividerTwo />
        <Team teamMembers={teamMembers} isEditMode={false} />
        <HomeExpertise />
        <DividerThree />
        <Process />
        <DividerFour />
        <HomeQuestions />
        <Contact />
        <WebsiteEditPanel />
      </main>
    </PageLayout>
  );
}
