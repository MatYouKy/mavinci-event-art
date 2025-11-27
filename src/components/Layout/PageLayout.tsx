'use client';
import { JsonLd } from '@/components/Layout/JsonLd';
import { buildSchemaJsonLdForSlug } from '@/lib/seo-helpers';
import { useState, useEffect } from 'react';

interface PageLayoutProps {
  children: React.ReactNode;
  pageSlug: string;
  customSchema?: any;
}

export default function PageLayout({ children, pageSlug, customSchema }: PageLayoutProps) {
  const loadSchemaData = async () => {
    // If customSchema provided, use it instead of loading from DB
    if (customSchema) {
      return customSchema;
    }
    const schemaData = await buildSchemaJsonLdForSlug(pageSlug);
    return schemaData;
  };

  const [schemaData, setSchemaData] = useState<any>(customSchema || null);

  useEffect(() => {
    loadSchemaData().then(setSchemaData);
  }, [pageSlug, customSchema]);

  return (
    <>
      {schemaData && <JsonLd data={schemaData} />}
      {children}
    </>
  );
}