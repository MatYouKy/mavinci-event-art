'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase/browser';
import TenderList from './components/TenderList';
import TenderFilters from './components/TenderFilters';
import TenderStats from './components/TenderStats';
import ImportControls from './components/ImportControls';
import TenderDetailModal from './components/TenderDetailModal';
import Link from 'next/link';
import { RefreshCw, Download, Settings } from 'lucide-react';

export interface Tender {
  id: string;
  external_id: string;
  source: string;
  title: string;
  description: string;
  contracting_authority: string;
  cpv_codes: string[];
  location: string;
  publication_date: string | null;
  submission_deadline: string | null;
  estimated_value: number;
  currency: string;
  source_url: string;
  relevance_score: number;
  is_matched: boolean;
  status: string;
  is_watched: boolean;
  is_hidden: boolean;
  assigned_to: string | null;
  notes: string;
  manual_relevance: string | null;
  created_at: string;
  updated_at: string;
}

export interface TenderFiltersState {
  search: string;
  source: string;
  status: string;
  isMatched: string;
  isWatched: boolean;
  showHidden: boolean;
  minScore: number;
  sortBy: string;
  showExpired: boolean;
  sortDir: 'asc' | 'desc';
}

const defaultFilters: TenderFiltersState = {
  search: '',
  source: '',
  status: '',
  isMatched: 'matched',
  isWatched: false,
  showHidden: false,
  showExpired: true,
  minScore: 0,
  sortBy: 'smart',
  sortDir: 'desc',
};

export default function TendersPage() {
  const [tenders, setTenders] = useState<Tender[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<TenderFiltersState>(defaultFilters);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedTender, setSelectedTender] = useState<Tender | null>(null);
  const [page, setPage] = useState(0);
  const pageSize = 25;

  const fetchTenders = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase.from('tenders').select('*', { count: 'exact' });

      if (filters.search) {
        query = query.or(
          `title.ilike.%${filters.search}%,description.ilike.%${filters.search}%,contracting_authority.ilike.%${filters.search}%`,
        );
      }

      if (filters.source) {
        query = query.eq('source', filters.source);
      }

      if (filters.status) {
        query = query.eq('status', filters.status);
      }

      if (filters.isMatched === 'matched') {
        query = query.or('is_matched.eq.true,is_watched.eq.true,manual_relevance.eq.relevant');
      } else if (filters.isMatched === 'unmatched') {
        query = query.eq('is_matched', false);
      } else if (filters.isMatched === 'smart') {
        query = query.or('is_matched.eq.true,is_watched.eq.true,manual_relevance.eq.relevant');
      }

      if (filters.isWatched) {
        query = query.eq('is_watched', true);
      }

      if (!filters.showHidden) {
        query = query.or('is_hidden.eq.false,is_hidden.is.null');
      }

      if (filters.showExpired === false) {
        const now = new Date().toISOString();
        query = query.or(
          `submission_deadline.gte.${now},submission_deadline.is.null`,
        );
      }

      if (filters.minScore > 0) {
        query = query.gte('relevance_score', filters.minScore);
      }

      if (filters.sortBy === 'smart') {
        query = query
          .order('manual_relevance', { ascending: false, nullsFirst: false })
          .order('is_matched', { ascending: false })
          .order('is_watched', { ascending: false })
          .order('relevance_score', { ascending: false })
          .order('submission_deadline', { ascending: true, nullsFirst: false })
          .order('publication_date', { ascending: false, nullsFirst: false });
      } else {
        query = query.order(filters.sortBy, {
          ascending: filters.sortDir === 'asc',
          nullsFirst: false,
        });
      }
      query = query.range(page * pageSize, (page + 1) * pageSize - 1);

      const { data, count, error } = await query;

      if (error) throw error;
      setTenders(data || []);
      setTotalCount(count || 0);
    } catch (err) {
      console.error('Error fetching tenders:', err);
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    fetchTenders();
  }, [fetchTenders]);

  const handleExport = () => {
    const csvRows = [
      [
        'Tytuł',
        'Zamawiający',
        'Źródło',
        'CPV',
        'Lokalizacja',
        'Termin',
        'Ocena',
        'Status',
        'URL',
      ].join(';'),
      ...tenders.map((t) =>
        [
          `"${t.title.replace(/"/g, '""')}"`,
          `"${t.contracting_authority.replace(/"/g, '""')}"`,
          t.source,
          t.cpv_codes.join(', '),
          t.location,
          t.submission_deadline || '',
          t.relevance_score,
          t.status,
          t.source_url,
        ].join(';'),
      ),
    ];
    const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `przetargi-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const updateTender = async (id: string, updates: Partial<Tender>) => {
    const { error } = await supabase
      .from('tenders')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (!error) {
      setTenders((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
      if (selectedTender?.id === id) {
        setSelectedTender((prev) => (prev ? { ...prev, ...updates } : null));
      }
    }
  };

  const totalPages = Math.ceil(totalCount / pageSize);

  return (
    <div className="p-6 lg:p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-light text-[#e5e4e2]">Monitor Przetargów</h1>
          <p className="mt-1 text-sm text-[#e5e4e2]/50">{totalCount} przetargów w bazie</p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/crm/tenders/config"
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]"
          >
            <Settings className="h-4 w-4" />
            Konfiguracja
          </Link>
          <button
            onClick={handleExport}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2]/70 transition-colors hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]"
          >
            <Download className="h-4 w-4" />
            Eksportuj CSV
          </button>
          <button
            onClick={fetchTenders}
            disabled={loading}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Odśwież
          </button>
        </div>
      </div>

      <TenderStats />

      <ImportControls onImportComplete={fetchTenders} />

      <TenderFilters
        filters={filters}
        onChange={(f) => {
          setFilters(f);
          setPage(0);
        }}
      />

      <TenderList
        tenders={tenders}
        loading={loading}
        onSelect={setSelectedTender}
        onUpdate={updateTender}
      />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm text-[#e5e4e2]/50">
            Strona {page + 1} z {totalPages}
          </span>
          <div className="flex gap-2">
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              className="rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-sm text-[#e5e4e2]/70 disabled:opacity-30"
            >
              Poprzednia
            </button>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page >= totalPages - 1}
              className="rounded-lg border border-[#d3bb73]/20 px-3 py-1.5 text-sm text-[#e5e4e2]/70 disabled:opacity-30"
            >
              Następna
            </button>
          </div>
        </div>
      )}

      {selectedTender && (
        <TenderDetailModal
          tender={selectedTender}
          onClose={() => setSelectedTender(null)}
          onUpdate={updateTender}
        />
      )}
    </div>
  );
}
