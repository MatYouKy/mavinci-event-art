'use client';

import Head from 'next/head';
import { PartyPopper, Heart, CheckCircle2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import { PageHeroImage } from '@/components/PageHeroImage';
import { EditableContent } from '@/components/EditableContent';
import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';

export default function IntegracjePage() {
  const features = [
    'Pikniki firmowe',
    'Imprezy okolicznościowe',
    'BBQ i catering',
    'Konkursy i zabawy',
    'Oprawa muzyczna',
    'Animacje dla dzieci',
    'Dekoracje tematyczne',
    'Pełna organizacja',
  ];

  const canonicalUrl = 'https://mavinci.pl/oferta/integracje';
  const serviceName = 'Integracje firmowe';

  // 🔗 JSON-LD: Service + Breadcrumb w jednym @graph
  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Service',
        name: serviceName,
        description:
          'Organizacja imprez integracyjnych dla firm: pikniki, wydarzenia okolicznościowe, animacje, oprawa muzyczna i pełna obsługa techniczna.',
        url: canonicalUrl,
        provider: {
          '@type': 'Organization',
          name: 'MAVINCI Event & ART',
          url: 'https://mavinci.pl',
        },
        areaServed: {
          '@type': 'Country',
          name: 'Polska',
        },
        audience: {
          '@type': 'Audience',
          audienceType: 'Firmy i organizacje',
        },
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Strona główna',
            item: 'https://mavinci.pl/',
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'Oferta',
            item: 'https://mavinci.pl/uslugi',
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: serviceName,
            item: canonicalUrl,
          },
        ],
      },
    ],
  };

  return (
    <>
      <Head>
        <title>{`${serviceName} – MAVINCI Event & ART`}</title>
        <meta
          name="description"
          content="Organizujemy imprezy integracyjne dla firm: pikniki, imprezy okolicznościowe, animacje, konkursy, oprawa muzyczna i pełna organizacja wydarzenia."
        />
        <meta
          name="keywords"
          content="integracje firmowe, imprezy integracyjne, piknik firmowy, event firmowy, impreza pracownicza, organizacja integracji, MAVINCI"
        />

        <meta property="og:type" content="website" />
        <meta property="og:title" content={`${serviceName} – MAVINCI Event & ART`} />
        <meta
          property="og:description"
          content="Profesjonalna organizacja imprez integracyjnych dla firm: pikniki, animacje, konkursy i pełna obsługa eventu."
        />
        <meta property="og:url" content={canonicalUrl} />
        <meta
          property="og:image"
          content="https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop"
        />
        <meta property="og:site_name" content="MAVINCI Event & ART" />
        <meta property="og:locale" content="pl_PL" />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={`${serviceName} – MAVINCI Event & ART`} />
        <meta
          name="twitter:description"
          content="Integracje firmowe z pełną organizacją, oprawą muzyczną i animacjami – MAVINCI Event & ART."
        />
        <meta
          name="twitter:image"
          content="https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630&fit=crop"
        />

        <link rel="canonical" href={canonicalUrl} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd),
          }}
        />
      </Head>

      <Navbar />
      <main className="min-h-screen bg-[#0f1119]">
        <PageHeroImage
          section="integracje"
          defaultImage="https://images.pexels.com/photos/1395967/pexels-photo-1395967.jpeg?auto=compress&cs=tinysrgb&w=1920"
          defaultOpacity={0.2}
          className="py-24 md:py-32 overflow-hidden"
        >
          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* ✅ Breadcrumb: Start → Usługi → Integracje firmowe */}


            <Link
              href="/oferta"
              className="inline-flex items-center gap-2 text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors mb-8"
            >
              <ArrowLeft className="w-4 h-4" />
              Powrót do oferty
            </Link>

            <div className="grid lg:grid-cols-2 gap-12 items-center">
              
              <div>
                <div className="inline-flex items-center gap-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-full px-6 py-2 mb-6">
                  <PartyPopper className="w-5 h-5 text-[#d3bb73]" />
                  <EditableContent
                    section="integracje-hero-badge"
                    tableName="integracje_content"
                    defaultTitle="Imprezy Firmowe"
                    defaultContent=""
                    className="inline"
                    titleClassName="text-[#d3bb73] text-sm font-medium"
                    contentClassName="hidden"
                    titleTag="span"
                    ariaLabel="Kategoria usługi"
                  />
                </div>

                <EditableContent
                  section="integracje-hero-title"
                  tableName="integracje_content"
                  defaultTitle="Integracje Firmowe"
                  defaultContent=""
                  className="mb-6"
                  titleClassName="text-4xl md:text-6xl font-light text-[#e5e4e2]"
                  contentClassName="hidden"
                  titleTag="h1"
                  ariaLabel="Główny tytuł strony"
                />

                <EditableContent
                  section="integracje-hero-description"
                  tableName="integracje_content"
                  defaultTitle=""
                  defaultContent="Organizujemy imprezy integracyjne, które budują więzi w zespole i tworzą wspaniałą atmosferę. Pikniki, zabawy i wydarzenia okolicznościowe z pełną obsługą."
                  className="mb-8"
                  titleClassName="hidden"
                  contentClassName="text-[#e5e4e2]/70 text-lg font-light leading-relaxed"
                  contentTag="p"
                  ariaLabel="Główny opis usługi"
                />

                <div className="flex flex-wrap gap-4">
                  <a
                    href="/#kontakt"
                    className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
                  >
                    Zapytaj o wycenę
                  </a>
                  <Link
                    href="/oferta"
                    className="inline-flex items-center gap-2 bg-[#d3bb73]/10 border border-[#d3bb73]/30 text-[#d3bb73] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/20 transition-colors"
                  >
                    Zobacz inne oferty
                  </Link>
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 bg-gradient-to-br from-[#d3bb73]/20 to-[#800020]/20 rounded-3xl blur-3xl" />
                <div className="relative bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/20 rounded-3xl p-8">
                  <Heart className="w-24 h-24 text-[#d3bb73] mb-6" />
                  <EditableContent
                    section="integracje-hero-card"
                    tableName="integracje_content"
                    defaultTitle="Wspólna Zabawa"
                    defaultContent="Imprezy integracyjne to doskonała okazja do lepszego poznania się zespołu w luźnej, przyjaznej atmosferze."
                    className=""
                    titleClassName="text-2xl font-light text-[#e5e4e2] mb-4"
                    contentClassName="text-[#e5e4e2]/70 font-light"
                    titleTag="h2"
                    contentTag="p"
                    ariaLabel="Dodatkowe informacje"
                  />
                </div>
              </div>
            </div>
          </div>
        </PageHeroImage>

        <section className="pt-6 px-6 border-t border-b border-[#d3bb73]/20">
        <div className="max-w-7xl mx-auto">
        <CategoryBreadcrumb productName={serviceName} />
        </div>
        </section>

        <section className="py-24 bg-[#0f1119]">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-4">
                Co Oferujemy
              </h2>
              <div className="h-1 w-24 bg-gradient-to-r from-transparent via-[#d3bb73] to-transparent mx-auto" />
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
              {features.map((feature, index) => (
                <div
                  key={index}
                  className="flex items-start gap-3 bg-gradient-to-br from-[#1c1f33]/80 to-[#1c1f33]/40 backdrop-blur-sm border border-[#d3bb73]/10 rounded-xl p-6 hover:border-[#d3bb73]/30 transition-all duration-300"
                >
                  <CheckCircle2 className="w-5 h-5 text-[#d3bb73] flex-shrink-0 mt-0.5" />
                  <span className="text-[#e5e4e2]/90 font-light">{feature}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-24 bg-gradient-to-br from-[#0f1119] to-[#1c1f33]">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
            <PartyPopper className="w-16 h-16 text-[#d3bb73] mx-auto mb-6" />
            <h2 className="text-3xl md:text-4xl font-light text-[#e5e4e2] mb-6">
              Zorganizujmy Imprezę Integracyjną!
            </h2>
            <p className="text-[#e5e4e2]/70 text-lg font-light mb-8 max-w-2xl mx-auto">
              Skontaktuj się z nami, aby omówić szczegóły Twojej imprezy. Zapewnimy pełną
              organizację i niezapomnianą atmosferę.
            </p>
            <a
              href="/#kontakt"
              className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-8 py-3 rounded-full text-sm font-medium hover:bg-[#d3bb73]/90 transition-colors"
            >
              Skontaktuj się z nami
            </a>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}