import { useCallback, useEffect, useState } from 'react';
import { CompanyNumbering, CompanyNumberingCard } from '../CompanyNumberingCard';
import { supabase } from '@/lib/supabase/browser';
import { AlertTriangle } from 'lucide-react';

export function InvoiceSettingsTab() {
  const [companies, setCompanies] = useState<CompanyNumbering[]>([]);
  const [loading, setLoading] = useState(true);
  const [existingNumbers, setExistingNumbers] = useState<string[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [companiesRes, invoicesRes] = await Promise.all([
        supabase
          .from('my_companies')
          .select('id, name, nip, invoice_prefix, last_invoice_number, last_proforma_number, last_advance_number, last_corrective_number, invoice_numbering_year, is_default')
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('name'),
        supabase
          .from('invoices')
          .select('invoice_number, my_company_id'),
      ]);

      if (companiesRes.error) throw companiesRes.error;

      const invoicesData = invoicesRes.data || [];
      setExistingNumbers(invoicesData.map((i: any) => i.invoice_number));

      const companiesWithCount = (companiesRes.data || []).map((c: any) => ({
        ...c,
        invoice_count: invoicesData.filter((i: any) => i.my_company_id === c.id).length,
      }));

      setCompanies(companiesWithCount);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="text-[#e5e4e2]/60">Ladowanie ustawien...</div>
      </div>
    );
  }

  if (companies.length === 0) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-[#1c1f33] p-8 text-center">
        <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-400" />
        <p className="text-[#e5e4e2]/80">Brak aktywnych firm. Dodaj firme w ustawieniach &quot;Moje firmy&quot;.</p>
      </div>
    );
  }

  const currentYear = new Date().getFullYear();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-[#e5e4e2]">Numeracja faktur wg firmy</h3>
          <p className="mt-1 text-sm text-[#e5e4e2]/40">
            Kazda firma ma oddzielna numeracje faktur. Rok: {currentYear}
          </p>
        </div>
        <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] px-4 py-2 text-center">
          <div className="text-xs text-[#e5e4e2]/40">Laczna liczba faktur</div>
          <div className="text-lg font-light text-[#d3bb73]">{existingNumbers.length}</div>
        </div>
      </div>

      <div className="space-y-3">
        {companies.map((company) => (
          <CompanyNumberingCard
            key={company.id}
            company={company}
            existingNumbers={existingNumbers}
            onSaved={fetchData}
          />
        ))}
      </div>

      <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-5">
        <h4 className="mb-3 text-sm font-medium text-[#e5e4e2]/70">Format numeracji</h4>
        <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
          <div className="flex items-center gap-3">
            <span className="rounded bg-[#0a0d1a] px-2 py-1 font-mono text-xs text-[#d3bb73]">[PREFIX/]{'{numer}'}/{currentYear}</span>
            <span className="text-[#e5e4e2]/40">Faktura VAT</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded bg-[#0a0d1a] px-2 py-1 font-mono text-xs text-blue-400">PRO/[PREFIX/]{'{numer}'}/{currentYear}</span>
            <span className="text-[#e5e4e2]/40">Proforma</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded bg-[#0a0d1a] px-2 py-1 font-mono text-xs text-amber-400">ZAL/[PREFIX/]{'{numer}'}/{currentYear}</span>
            <span className="text-[#e5e4e2]/40">Zaliczkowa</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded bg-[#0a0d1a] px-2 py-1 font-mono text-xs text-red-400">KOR/[PREFIX/]{'{numer}'}/{currentYear}</span>
            <span className="text-[#e5e4e2]/40">Korygujaca</span>
          </div>
        </div>
        <div className="mt-3 text-xs text-[#e5e4e2]/30">
          [PREFIX] - opcjonalny prefix firmy. Numeracja resetuje sie automatycznie z nowym rokiem.
        </div>
      </div>
    </div>
  );
}