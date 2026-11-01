'use client';

import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useInvoiceFinanceAccess } from '@/hooks/useInvoiceFinanceAccess';
import { canFinanceCompany } from '@/lib/invoices/financeAccess';
import type { FinanceCompanyLevel } from '@/lib/financeCompanyAccess';

interface MyCompany {
  id: string;
  name: string;
  nip: string;
  is_default: boolean;
  is_active: boolean;
}

interface CompanySelectorProps {
  value: string | null;
  onChange: (companyId: string | null) => void;
  showAllOption?: boolean;
  className?: string;
  label?: string;
  /** Tylko działalności, w których pracownik może wystawiać faktury (poziom ≥ „Wystawianie faktur”). */
  requireIssue?: boolean;
  /** Ekrany finansów: tylko działalności z co najmniej tym poziomem dostępu do finansów. */
  minFinanceLevel?: FinanceCompanyLevel;
  emptyOptionLabel?: string;
}

export default function CompanySelector({
  value,
  onChange,
  showAllOption = true,
  className = '',
  label = 'Firma',
  requireIssue = false,
  minFinanceLevel,
  emptyOptionLabel = 'Wszystkie firmy',
}: CompanySelectorProps) {
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const { access: financeAccess, loading: financeAccessLoading } = useInvoiceFinanceAccess();
  const requiredLevel: FinanceCompanyLevel | null = requireIssue ? 'invoices_issue' : minFinanceLevel ?? null;

  useEffect(() => {
    if (requiredLevel && financeAccessLoading) return;
    loadCompanies();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [financeAccess, financeAccessLoading, requiredLevel]);

  const loadCompanies = async () => {
    try {
      // Działalności dostępne dla pracownika (id, nazwa, NIP) — bez danych finansowych działalności,
      // więc lista działa także w formularzach wydarzeń dla osób bez dostępu do finansów.
      // Funkcja pochodzi z migracji 20261101171000; do czasu jej wdrożenia lista z my_companies (RLS:
      // tylko działalności z dostępem do finansów).
      let rows: MyCompany[] = [];
      const accessible = await supabase.rpc('get_my_accessible_companies');
      if (!accessible.error) {
        rows = (accessible.data || []) as MyCompany[];
      } else {
        const fallback = await supabase
          .from('my_companies')
          .select('id, name, nip, is_default, is_active')
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('name');
        if (fallback.error) throw fallback.error;
        rows = (fallback.data || []) as MyCompany[];
      }

      let filtered = rows.filter((c) => c.is_active);

      if (requiredLevel) {
        filtered = filtered.filter((c) => canFinanceCompany(financeAccess, c.id, requiredLevel));
      }

      setCompanies(filtered);

      const allowedIdsFinal = filtered.map((c) => c.id);
      if (value && !allowedIdsFinal.includes(value)) {
        onChange(null);
      }

      if (!value && filtered.length > 0) {
        const defaultCompany = filtered.find((c) => c.is_default) || filtered[0];
        if (defaultCompany && !showAllOption) {
          onChange(defaultCompany.id);
        }
      }
    } catch (error) {
      console.error('Error loading companies:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <label className="mb-2 flex items-center gap-2 text-sm font-medium text-[#e5e4e2]">
        <Building2 className="h-4 w-4 text-[#d3bb73]" />
        {label}
      </label>
      <select
        value={value || ''}
        onChange={(e) => {
          const newValue = e.target.value || null;
          onChange(newValue);
        }}
        disabled={loading}
        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2.5 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none disabled:opacity-50"
      >
        {showAllOption && <option value="">{emptyOptionLabel}</option>}
        {companies.map((company) => (
          <option key={company.id} value={company.id}>
            {company.name} (NIP: {company.nip})
            {company.is_default && ' ⭐'}
          </option>
        ))}
      </select>
    </div>
  );
}
