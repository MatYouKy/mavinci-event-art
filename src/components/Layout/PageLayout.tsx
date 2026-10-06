import { cookies } from 'next/headers';
import { JsonLd } from '@/components/Layout/JsonLd';
import { buildSchemaJsonLdForSlug } from '@/lib/seo-helpers';
import { buildBreadcrumbList } from '@/lib/SEO/breadcrumbs';
import { normalizePageSchema } from '@/lib/SEO/site';

interface PageLayoutProps {
  children: React.ReactNode;
  pageSlug: string;
  customSchema?: any;
  cookieStore?: ReturnType<typeof cookies>;
}

export default async function PageLayout({ children, pageSlug, customSchema, cookieStore }: PageLayoutProps) {
  const data = customSchema ?? await buildSchemaJsonLdForSlug(pageSlug, cookieStore ?? cookies());
  const schema = normalizePageSchema(data, pageSlug);
  const breadcrumb = pageSlug !== 'home' ? buildBreadcrumbList(`/${pageSlug}`) : null;
  return <>{schema && <JsonLd data={schema} />}{breadcrumb && <JsonLd data={breadcrumb} />}{children}</>;
}
