'use client';

import { useState, useMemo, useEffect } from 'react';
import { useGetAllPagesQuery } from '@/store/api/analyticsApi';
import { FileText, ChevronRight, ChevronDown, BarChart3, Edit, Search, Code } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import MarketingWorkspace from '@/components/crm/marketing/MarketingWorkspace';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { hasPermission, isAdmin } from '@/lib/permissions';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';

interface PageNode {
  url: string;
  title: string;
  visits: number;
  children: PageNode[];
}

export default function PageManagementPage() {
  const searchParams = useSearchParams();
  const { employee } = useCurrentEmployee();
  const canViewMarketing = Boolean(employee && (isAdmin(employee) ||
    ['marketing_campaigns_view', 'marketing_campaigns_manage', 'marketing_campaigns_approve'].some((permission) => hasPermission(employee, permission))));
  const [section, setSection] = useState<'marketing' | 'website'>(
    searchParams.get('tab') === 'website' ? 'website' : 'marketing',
  );
  useEffect(() => {
    setSection(searchParams.get('tab') === 'website' ? 'website' : 'marketing');
  }, [searchParams]);
  const [dateRange] = useState(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['/']));

  const { data: pages, isLoading, error: pagesError } = useGetAllPagesQuery(
    { dateRange },
    { skip: section === 'marketing' },
  );

  const topPageVisits = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase('pl-PL');
    return (pages || [])
      .filter((page) => !query || `${page.title} ${page.url}`.toLocaleLowerCase('pl-PL').includes(query))
      .slice().sort((left, right) => right.visits - left.visits).slice(0, 8)
      .map((page) => ({ name: page.title === page.url ? page.url : `${page.title} (${page.url})`, visits: page.visits }));
  }, [pages, searchQuery]);

  const pageTree = useMemo(() => {
    const getVisits = (url: string) => pages?.find(p => p.url === url)?.visits || 0;

    const hardcodedStructure: PageNode[] = [
      {
        url: '/',
        title: 'Strona główna',
        visits: getVisits('/'),
        children: [],
      },
      {
        url: '/o-nas',
        title: 'O nas',
        visits: getVisits('/o-nas'),
        children: [],
      },
      {
        url: '/uslugi',
        title: 'Usługi',
        visits: getVisits('/uslugi'),
        children: [
          { url: '/uslugi/kasyno', title: 'Kasyno', visits: getVisits('/uslugi/kasyno'), children: [] },
          { url: '/uslugi/naglosnienie', title: 'Nagłośnienie', visits: getVisits('/uslugi/naglosnienie'), children: [] },
          { url: '/uslugi/streaming', title: 'Streaming', visits: getVisits('/uslugi/streaming'), children: [] },
          { url: '/uslugi/quizy-teleturnieje', title: 'Quizy i Teleturnieje', visits: getVisits('/uslugi/quizy-teleturnieje'), children: [] },
          { url: '/uslugi/symulatory-vr', title: 'Symulatory VR', visits: getVisits('/uslugi/symulatory-vr'), children: [] },
          { url: '/uslugi/technika-sceniczna', title: 'Technika Sceniczna', visits: getVisits('/uslugi/technika-sceniczna'), children: [] },
          { url: '/uslugi/wieczory-tematyczne', title: 'Wieczory Tematyczne', visits: getVisits('/uslugi/wieczory-tematyczne'), children: [] },
          { url: '/uslugi/konferencje', title: 'Konferencje', visits: getVisits('/uslugi/konferencje'), children: [] },
          { url: '/uslugi/integracje', title: 'Integracje', visits: getVisits('/uslugi/integracje'), children: [] },
        ],
      },
      {
        url: '/portfolio',
        title: 'Portfolio',
        visits: getVisits('/portfolio'),
        children: [],
      },
      {
        url: '/zespol',
        title: 'Zespół',
        visits: getVisits('/zespol'),
        children: [],
      },
    ];

    return hardcodedStructure;
  }, [pages]);

  const filteredTree = useMemo(() => {
    if (!searchQuery) return pageTree;

    const filterNodes = (nodes: PageNode[]): PageNode[] => {
      return nodes.reduce<PageNode[]>((acc, node) => {
        const matchesSearch =
          node.url.toLowerCase().includes(searchQuery.toLowerCase()) ||
          node.title.toLowerCase().includes(searchQuery.toLowerCase());

        const filteredChildren = filterNodes(node.children);

        if (matchesSearch || filteredChildren.length > 0) {
          acc.push({
            ...node,
            children: filteredChildren,
          });
        }

        return acc;
      }, []);
    };

    return filterNodes(pageTree);
  }, [pageTree, searchQuery]);

  const toggleNode = (url: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(url)) {
      newExpanded.delete(url);
    } else {
      newExpanded.add(url);
    }
    setExpandedNodes(newExpanded);
  };

  const PageTreeNode = ({ node, level = 0 }: { node: PageNode; level?: number }) => {
    const hasChildren = node.children.length > 0;
    const isExpanded = expandedNodes.has(node.url);

    return (
      <div style={{ marginLeft: `${level * 24}px` }}>
        <div className="group flex items-center justify-between rounded-lg p-3 transition-colors hover:bg-[#5a1d37]">
          <div className="flex items-center gap-3 flex-1">
            {hasChildren && (
              <button
                onClick={() => toggleNode(node.url)}
                className="text-[#d3bb73] hover:text-[#d3bb73]/80 transition-colors"
              >
                {isExpanded ? (
                  <ChevronDown className="w-4 h-4" />
                ) : (
                  <ChevronRight className="w-4 h-4" />
                )}
              </button>
            )}
            {!hasChildren && <div className="w-4" />}

            <FileText className="w-4 h-4 text-[#d3bb73]/60" />

            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[#e5e4e2] font-light">{node.title}</span>
                <span className="text-xs text-[#e5e4e2]/40">{node.url}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="text-sm text-[#d3bb73] font-medium">
              {node.visits} wizyt
            </div>

            <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <Link
                href={`/crm/page/analytics?url=${encodeURIComponent(node.url)}`}
                className="flex items-center gap-1 px-3 py-1 bg-[#d3bb73]/10 text-[#d3bb73] rounded hover:bg-[#d3bb73]/20 transition-colors text-sm"
              >
                <BarChart3 className="w-3 h-3" />
                Analityka
              </Link>

              {/* TODO: Implement edit page */}
              <button
                disabled
                className="flex cursor-not-allowed items-center gap-1 rounded bg-[#351020] px-3 py-1 text-sm text-[#e5e4e2]/30"
              >
                <Edit className="w-3 h-3" />
                Edytuj
              </button>
            </div>
          </div>
        </div>

        {isExpanded && hasChildren && (
          <div className="mt-1">
            {node.children.map(child => (
              <PageTreeNode key={child.url} node={child} level={level + 1} />
            ))}
          </div>
        )}
      </div>
    );
  };

  if (section === 'marketing') {
    return (
      <div className="min-h-screen bg-[#210811] p-6">
        <div className="mx-auto max-w-7xl space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-light text-[#e5e4e2]">Strona, marketing i ruch</h1>
              <p className="mt-1 text-[#e5e4e2]/60">
                Wyniki wszystkich marek zarządzanych w CRM
              </p>
            </div>
            <div className="flex rounded-xl border border-[#d3bb73]/20 bg-[#351020] p-1">
              <button
                onClick={() => setSection('marketing')}
                className="rounded-lg bg-[#6a2340] px-4 py-2 text-xs text-white"
              >
                Marketing i ADS
              </button>
              <button
                onClick={() => setSection('website')}
                className="rounded-lg px-4 py-2 text-xs text-[#e5e4e2]/55 hover:bg-[#5a1d37] hover:text-white"
              >
                Struktura strony
              </button>
            </div>
          </div>
          <MarketingWorkspace initialCompanyId={searchParams.get('company') || undefined} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#210811] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Zarządzanie stroną</h1>
            <p className="text-[#e5e4e2]/60 mt-1">Struktura i statystyki podstron</p>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => setSection('marketing')}
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#6a2340] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#7a2a49]"
            >
              <BarChart3 className="h-4 w-4" />
              Marketing i ADS
            </button>
            <Link
              href="/crm/page/schema-org"
              className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#351020] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/40 hover:bg-[#5a1d37]"
            >
              <Code className="w-4 h-4" />
              Schema.org
            </Link>
            <Link
              href="/crm/page/analytics"
              className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
            >
              <BarChart3 className="w-4 h-4" />
              Analytics
            </Link>
          </div>
        </div>

        {canViewMarketing && <MarketingWorkspace initialCompanyId={searchParams.get('company') || undefined} />}

        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#351020] p-6">
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj strony..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#210811] py-3 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>

          <section className="mb-6 rounded-xl bg-[#210811]/60 p-4 sm:p-5">
            <h2 className="text-base font-light text-[#e5e4e2]">Najczęściej odwiedzane strony</h2>
            <p className="mt-1 text-xs text-[#e5e4e2]/45">Do 8 stron z największą liczbą zarejestrowanych wizyt · ostatnie {dateRange} dni{searchQuery.trim() ? ' · zgodnie z wyszukiwaniem' : ''}.</p>
            {isLoading ? <p className="py-8 text-sm text-[#e5e4e2]/45" role="status">Ładowanie statystyk…</p>
              : pagesError ? <p className="py-6 text-sm text-amber-200" role="alert">Nie udało się pobrać statystyk odwiedzin. Wykres nie jest dostępny.</p>
                : <div className="mt-4"><CrmCartesianChart
                  data={topPageVisits}
                  categoryKey="name"
                  series={[{ key: 'visits', label: 'Wizyty', color: '#d3bb73' }]}
                  kind="bar"
                  horizontal
                  height={Math.max(220, topPageVisits.length * 44)}
                  valueFormatter={(value) => new Intl.NumberFormat('pl-PL').format(value)}
                  ariaLabel={`Najczęściej odwiedzane strony w ostatnich ${dateRange} dniach`}
                  showLegend={false}
                  emptyMessage={searchQuery.trim() ? 'Brak zarejestrowanych wizyt dla stron pasujących do wyszukiwania.' : 'Brak zarejestrowanych wizyt w tym okresie.'}
                /></div>}
          </section>

          {isLoading ? (
            <div className="text-center py-12 text-[#e5e4e2]/50">Ładowanie struktury strony...</div>
          ) : filteredTree.length === 0 ? (
            <div className="text-center py-12 text-[#e5e4e2]/50">
              {searchQuery ? 'Nie znaleziono stron pasujących do zapytania' : 'Brak danych'}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTree.map(node => (
                <PageTreeNode key={node.url} node={node} />
              ))}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#411326]/60 p-6">
          <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Legenda</h2>
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div className="flex items-center gap-2 text-[#e5e4e2]/70">
              <FileText className="w-4 h-4 text-[#d3bb73]/60" />
              <span>Podstrona</span>
            </div>
            <div className="flex items-center gap-2 text-[#e5e4e2]/70">
              <BarChart3 className="w-4 h-4 text-[#d3bb73]" />
              <span>Analityka - szczegółowe statystyki</span>
            </div>
            <div className="flex items-center gap-2 text-[#e5e4e2]/70">
              <Edit className="w-4 h-4 text-[#e5e4e2]/30" />
              <span>Edytuj - edycja treści (wkrótce)</span>
            </div>
            <div className="flex items-center gap-2 text-[#e5e4e2]/70">
              <ChevronRight className="w-4 h-4 text-[#d3bb73]" />
              <span>Rozwiń/zwiń podstrony</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
