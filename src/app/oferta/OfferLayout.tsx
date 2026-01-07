import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import PageLayout from '@/components/Layout/PageLayout';
import React from 'react';

interface OfferLayoutProps {
  children: React.ReactNode;
  pageSlug: string;
  section: string;
  customSchema?: any;
  initialImageUrl?: string;
  initialTitle?: string;
  initialDescription?: string;
  whiteWordsCount?: number;
}

export default function OfferLayout({
  children,
  pageSlug,
  section,
  customSchema,
  initialImageUrl,
  initialTitle,
  initialDescription,
  whiteWordsCount,
}: OfferLayoutProps) {
  return (
    <PageLayout pageSlug={pageSlug} customSchema={customSchema}>
      <div className="min-h-screen bg-[#0f1119]">
        <EditableHeroSectionServer
          section={section}
          pageSlug={pageSlug}
          initialImageUrl={initialImageUrl}
          initialTitle={initialTitle}
          initialDescription={initialDescription}
          whiteWordsCount={whiteWordsCount}
        />
        <section className="px-6 pt-6 min-h-[50px]">
          <div className="mx-auto max-w-7xl min-h-[50px]">
            <CategoryBreadcrumb pageSlug={pageSlug} />
          </div>
        </section>
        {children}
      </div>
    </PageLayout>
  );
}
