'use client';
import { JsonLd } from '@/components/Layout/JsonLd';
import { buildSchemaJsonLdForSlug } from '@/lib/seo-helpers';
import { useState, useEffect } from 'react';

export default function PageLayout({ children, pageSlug }: { children: React.ReactNode, pageSlug: string }) {
  const loadSchemaData = async () => {
    const schemaData = await buildSchemaJsonLdForSlug(pageSlug);
    return schemaData;
  };
  console.log('pageSlug', pageSlug);

  const [schemaData, setSchemaData] = useState<any>(null);
  console.log('schemaData', schemaData);

  useEffect(() => {
    loadSchemaData().then(setSchemaData);
  }, [pageSlug]);

  return (
    <>
      {schemaData && <JsonLd data={schemaData} />}
      {children}
    </>
  );
}