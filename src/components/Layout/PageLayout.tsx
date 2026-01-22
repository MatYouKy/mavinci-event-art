// src/components/Layout/PageLayout.tsx (SERVER COMPONENT - bez 'use client')

import { JsonLd } from '@/components/Layout/JsonLd';
import { buildSchemaJsonLdForSlug } from '@/lib/seo-helpers';
interface PageLayoutProps {
  children: React.ReactNode;
  pageSlug: string;
  customSchema?: any;
  cookieStore: any;
}

export default async function PageLayout({ children, pageSlug, customSchema, cookieStore }: PageLayoutProps) {
  const schemaData = customSchema ?? (await buildSchemaJsonLdForSlug(pageSlug, cookieStore));

  return (
    <>
      {/* {schemaData && <JsonLd data={schemaData} />} */}
      {children}
    </>
  );
}