import { CategoryBreadcrumb } from '@/components/CategoryBreadcrumb';
import EditableHeroSectionServer from '@/components/EditableHeroSectionServer';
import PageLayout from '@/components/Layout/PageLayout';
import React from 'react';

interface ServiceLayoutProps {
  children: React.ReactNode;
  pageSlug: string;
  section: string;
}

export default function ServiceLayout({
  children,
  pageSlug,
  section,
}: ServiceLayoutProps) {
  return (
    <PageLayout pageSlug={pageSlug}>
      <div className="min-h-screen bg-[#0f1119]">
        <EditableHeroSectionServer
          section={section}
          pageSlug={pageSlug}
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
