'use client';

import { useState, useMemo } from 'react';
import { useGetAllPagesQuery } from '@/store/api/analyticsApi';
import { FileText, ChevronRight, ChevronDown, BarChart3, Edit, Search } from 'lucide-react';
import Link from 'next/link';

interface PageNode {
  url: string;
  title: string;
  visits: number;
  children: PageNode[];
}

export default function PageManagementPage() {
  const [dateRange] = useState(30);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set(['/']));

  const { data: pages, isLoading } = useGetAllPagesQuery({ dateRange });

  const pageTree = useMemo(() => {
    if (!pages) return [];

    const tree: PageNode[] = [];
    const pathMap = new Map<string, PageNode>();

    pages.forEach(page => {
      const node: PageNode = {
        url: page.url,
        title: page.title,
        visits: page.visits,
        children: [],
      };
      pathMap.set(page.url, node);
    });

    pages.forEach(page => {
      const parts = page.url.split('/').filter(Boolean);

      if (parts.length === 0) {
        tree.push(pathMap.get(page.url)!);
      } else {
        const parentPath = '/' + parts.slice(0, -1).join('/');
        const parent = pathMap.get(parentPath === '/' ? '/' : parentPath);

        if (parent) {
          parent.children.push(pathMap.get(page.url)!);
        } else {
          tree.push(pathMap.get(page.url)!);
        }
      }
    });

    return tree;
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
        <div className="flex items-center justify-between p-3 hover:bg-[#1c1f33]/50 rounded-lg transition-colors group">
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
                className="flex items-center gap-1 px-3 py-1 bg-[#1c1f33] text-[#e5e4e2]/30 rounded text-sm cursor-not-allowed"
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

  return (
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-light text-[#e5e4e2]">Zarządzanie stroną</h1>
            <p className="text-[#e5e4e2]/60 mt-1">Struktura i statystyki podstron</p>
          </div>

          <Link
            href="/crm/analytics"
            className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors text-sm"
          >
            <BarChart3 className="w-4 h-4" />
            Analytics Dashboard
          </Link>
        </div>

        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
          <div className="mb-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#e5e4e2]/40" />
              <input
                type="text"
                placeholder="Szukaj strony..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-3 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none transition-colors"
              />
            </div>
          </div>

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

        <div className="bg-[#1c1f33]/60 border border-[#d3bb73]/10 rounded-xl p-6">
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
