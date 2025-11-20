import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import PageLayout from '@/components/Layout/PageLayout';
import { PageHeroImageProps } from '@/components/PageHeroImage';
import React from 'react';

interface OfferLayoutProps extends PageHeroImageProps {
  children: React.ReactNode;
  pageSlug: string;
  heroImageBucket?: string;
  defaultHeroImage?: string;
  section: string;
  whiteWordsCount?: number;
  etykieta: { title: string; icon: React.ReactNode };
  descriptionSection?: { title: string; description: string; icon: React.ReactNode };
}

export default function OfferLayout({
  children,
  pageSlug,
  section = 'konferencje-hero',
  whiteWordsCount = 2,
  etykieta,
}: OfferLayoutProps) {
  return (
    <PageLayout pageSlug={pageSlug}>
      <div className="min-h-screen bg-[#0f1119]">
        <EditableHeroSectionServer
          section={section}
          pageSlug={pageSlug}
          labelTag={etykieta}
          whiteWordsCount={whiteWordsCount}
          buttonText="Zobacz inne oferty"
        />
        <section className="px-6 pt-6">
          <div className="mx-auto max-w-7xl">
            <CategoryBreadcrumb pageSlug={pageSlug} />
          </div>
        </section>
        {children}
      </div>
    </PageLayout>
  );
}
