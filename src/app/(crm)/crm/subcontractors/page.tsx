'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase/browser';
import { settlementLabels } from '@/components/crm/subcontractors/profileValidation';
export default function Subcontractors() {
  const [rows, setRows] = useState<any[]>([]),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const all: any[] = [];
        for (let from = 0; ; from += 500) {
          const { data, error } = await supabase
            .from('subcontractors')
            .select(
              'id,company_name,contact_person,phone,email,subcontractor_service_catalog(name),default_settlement_type,status',
            )
            .order('company_name')
            .order('id')
            .range(from, from + 499);
          if (error) throw error;
          all.push(...data);
          if (data.length < 500) break;
        }
        if (live) setRows(all);
      } catch (e: any) {
        if (live) setError(e.message);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);
  const needle = query.toLocaleLowerCase('pl-PL');
  return (
    <main className="space-y-5 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl uppercase">Podwykonawcy</h1>
        <Link
          href="/crm/subcontractors/new"
          className="rounded-lg bg-[#d3bb73] px-4 py-2 text-[#250914]"
        >
          Dodaj podwykonawcę
        </Link>
      </header>
      <input
        aria-label="Wyszukaj podwykonawcę"
        placeholder="Nazwa, telefon, e-mail lub zakres usług"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded-lg border border-white/10 bg-white/5 p-3"
      />
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {loading ? (
        <p>Ładowanie…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {rows
            .filter((s) =>
              [
                s.company_name,
                s.phone,
                s.email,
                ...(s.subcontractor_service_catalog || []).map(
                  (service: { name: string }) => service.name,
                ),
              ].some((v) =>
                String(v || '')
                  .toLocaleLowerCase('pl-PL')
                  .includes(needle),
              ),
            )
            .map((s) => (
              <Link
                key={s.id}
                href={`/crm/subcontractors/${s.id}`}
                className="space-y-2 rounded-xl bg-white/5 p-4 hover:bg-white/10"
              >
                <h2 className="text-lg text-[#d3bb73]">{s.company_name}</h2>
                <p className="text-sm">
                  {s.subcontractor_service_catalog
                    ?.map((service: { name: string }) => service.name)
                    .join(' · ') || 'Usługi do uzupełnienia'}
                </p>
                <p className="text-sm opacity-65">{s.phone || s.email}</p>
                <p className="text-sm">
                  {settlementLabels[s.default_settlement_type] || 'Rozliczenie do ustalenia'}
                  {s.status === 'inactive' && (
                    <span className="ml-2 text-amber-300">Nieaktywny · do uzupełnienia</span>
                  )}
                </p>
              </Link>
            ))}
        </div>
      )}
    </main>
  );
}
