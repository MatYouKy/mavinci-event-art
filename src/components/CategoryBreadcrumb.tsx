'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home } from 'lucide-react';
import { supabase } from '@/lib/supabase';

import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/UI/breadcrumb';

import { categoryNavLinks, type CategoryNode } from './Navbar';

interface CategoryBreadcrumbProps {
  productName?: string;
}

export function CategoryBreadcrumb({ productName }: CategoryBreadcrumbProps) {
  const pathname = usePathname();
  const [dynamicTree, setDynamicTree] = useState<CategoryNode[] | null>(null);
  const [loading, setLoading] = useState(true);

  // 🔥 1. Ładujemy dynamiczne kategorie usług
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

  // 🔥 2. Budowanie ścieżki breadcrumb
  const buildTrail = (nodes: CategoryNode[], path: string): CategoryNode[] | null => {
    for (const node of nodes) {
      if (node.href.startsWith('/#')) continue; // pomijamy anchor

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

    if (!productName) {
      return baseTrail;
    }

    const last = baseTrail[baseTrail.length - 1];

    // jeśli productName jest taki sam jak ostatni element breadcrumb (case-insensitive),
    // to NIE dokładamy go drugi raz
    if (last && last.label.toLowerCase() === productName.toLowerCase()) {
      return baseTrail;
    }

    return [
      ...baseTrail,
      {
        label: productName,
        href: '#',
      },
    ];
  }, [tree, pathname, productName, loading]);

  if (loading || trail.length === 0) return null;

  return (
    <Breadcrumb className="mb-4">
      <BreadcrumbList className="text-white">
        {/* HOME */}
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/" className="text-white/80 hover:text-[#d3bb73] transition-colors">
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
            <BreadcrumbItem key={`${item.href}-${index}`} className="text-white">
              <BreadcrumbSeparator className="text-white/40" />

              {isLast ? (
                // ⭐ OSTATNI ELEMENT – highlight
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
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}