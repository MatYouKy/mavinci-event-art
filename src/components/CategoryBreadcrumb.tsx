'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Edit2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/lib/supabase';
import { useEditMode } from '@/contexts/EditModeContext';
import { PageMetadataModal } from './PageMetadataModal';

import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/UI/breadcrumb';

import { categoryNavLinks, type CategoryNode } from './Navbar';
import { BreadcrumbJsonLd } from './Layout/BreadcrumbJsonLd';

interface CategoryBreadcrumbProps {
  productName?: string;
  pageSlug?: string; // np. "oferta/konferencje"
}

export function CategoryBreadcrumb({ productName, pageSlug }: CategoryBreadcrumbProps) {
  const pathname = usePathname();
  const { isEditMode } = useEditMode();
  const [dynamicTree, setDynamicTree] = useState<CategoryNode[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMetadataModalOpen, setIsMetadataModalOpen] = useState(false);

  // 1. dynamiczne usługi
  useEffect(() => {
    const loadServices = async () => {
      try {
        const { data, error } = await supabase
          .from('conferences_service_categories')
          .select(`
            id,
            name,
            slug,
            is_active,
            display_order,
            items:conferences_service_items(*)
          `)
          .eq('is_active', true)
          .order('display_order');

        if (error) {
          console.error('Error loading services:', error);
          return;
        }

        const servicesChildren: CategoryNode[] =
          data?.map((service: any) => ({
            label: service.name,
            href: `/uslugi/${service.slug}`,
          })) ?? [];

        const updatedTree = categoryNavLinks.map((node) =>
          node.href === '/uslugi'
            ? { ...node, children: servicesChildren }
            : node
        );

        setDynamicTree(updatedTree);
      } catch (err) {
        console.error('Error loading services:', err);
      } finally {
        setLoading(false);
      }
    };

    loadServices();
  }, []);

  const tree = useMemo(() => dynamicTree ?? categoryNavLinks, [dynamicTree]);

  // 2. budowa ścieżki
  const buildTrail = (nodes: CategoryNode[], path: string): CategoryNode[] | null => {
    for (const node of nodes) {
      if (node.href.startsWith('/#')) continue;

      const isExactMatch = path === node.href;
      const isChildPath =
        path !== '/' && node.href !== '/' && path.startsWith(node.href + '/');

      if (isExactMatch || isChildPath) {
        if (node.children?.length) {
          const childTrail = buildTrail(node.children, path);
          if (childTrail) return [node, ...childTrail];
        }
        return [node];
      }
    }
    return null;
  };

  const trail = useMemo(() => {
    if (!tree || loading) return [];

    const baseTrail = buildTrail(tree, pathname) ?? [];

    if (!productName) return baseTrail;

    const last = baseTrail[baseTrail.length - 1];
    if (last && last.label.toLowerCase() === productName.toLowerCase()) {
      return baseTrail;
    }

    return [...baseTrail, { label: productName, href: '#' }];
  }, [tree, pathname, productName, loading]);

  const normalizedPathSlug = pathname.replace(/^\/+|\/+$/g, '');
  const normalizedPropSlug = pageSlug ? pageSlug.replace(/^\/+|\/+$/g, '') : '';
  const currentPageSlug = normalizedPropSlug || normalizedPathSlug;

  if (loading || trail.length === 0) return null;

  const lastTrailItem = trail[trail.length - 1];
  const currentPageName = lastTrailItem?.label || productName || '';

  return (
    <>
      <AnimatePresence mode="wait">
        {!loading && trail.length > 0 && (
          <motion.div
            key={currentPageSlug || pathname}
            initial={{ opacity: 0, y: -32 }}        // start: wyżej, niewidoczny
            animate={{ opacity: 1, y: 0 }}          // koniec: w swoim miejscu
            exit={{ opacity: 0, y: -32 }}           // przy przejściu na inną stronę
            transition={{
              delay: 1,                             // ⬅️ 1 sekunda po załadowaniu
              duration: 0.45,
              ease: 'easeOut',
            }}
            className="flex items-center gap-3 mb-4"
          >
            <Breadcrumb className="flex-1">
              <BreadcrumbList className="text-white">
                {/* HOME */}
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      href="/"
                      className="text-white/80 hover:text-[#d3bb73] transition-colors"
                    >
                      <span className="inline-flex items-center gap-1.5">
                        <Home className="h-4 w-4" />
                        <span className="hidden sm:inline">Start</span>
                      </span>
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>

                {trail.map((item, index) => {
                  const isLast = index === trail.length - 1;

                  return (
                    <Fragment key={`${item.href}-${index}`}>
                      <BreadcrumbSeparator className="text-white/40" />
                      <BreadcrumbItem className="text-white">
                        {isLast ? (
                          <BreadcrumbPage className="text-[#d3bb73] font-medium">
                            {item.label}
                          </BreadcrumbPage>
                        ) : (
                          <BreadcrumbLink
                            asChild
                            className="text-white/80 hover:text-[#d3bb73] transition-colors"
                          >
                            <Link href={item.href}>{item.label}</Link>
                          </BreadcrumbLink>
                        )}
                      </BreadcrumbItem>
                    </Fragment>
                  );
                })}
              </BreadcrumbList>
            </Breadcrumb>

            {isEditMode && currentPageSlug && (
              <button
                onClick={() => setIsMetadataModalOpen(true)}
                className="px-3 py-1.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded hover:bg-[#d3bb73]/30 transition-colors flex items-center gap-2 text-sm"
                title="Edytuj metadata strony (keywords, title, description)"
              >
                <Edit2 className="w-4 h-4" />
                <span className="hidden sm:inline">Metadata</span>
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {isMetadataModalOpen && currentPageSlug && (
        <PageMetadataModal
          isOpen={isMetadataModalOpen}
          onClose={() => setIsMetadataModalOpen(false)}
          pageSlug={currentPageSlug}
          pageName={currentPageName}
        />
      )}

      <BreadcrumbJsonLd
        items={trail.map((t) => ({ name: t.label, href: t.href }))}
        baseUrl="https://mavinci.pl"
      />
    </>
  );
}