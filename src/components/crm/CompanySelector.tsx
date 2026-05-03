'use client';

import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

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
  requireIssue?: boolean;
}

export default function CompanySelector({
  value,
  onChange,
  showAllOption = true,
  className = '',
  label = 'Firma',
  requireIssue = false,
}: CompanySelectorProps) {
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [loading, setLoading] = useState(true);
  const { employee: currentEmployee, isAdmin } = useCurrentEmployee();

  useEffect(() => {
    loadCompanies();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentEmployee, isAdmin]);

  const loadCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('my_companies')
        .select('id, name, nip, is_default, is_active')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;

      const allowed = (() => {
        if (isAdmin) return null;
        const ids = (currentEmployee as any)?.my_company_ids;
        if (!Array.isArray(ids) || ids.length === 0) return null;
        return ids as string[];
      })();

      let filtered = allowed
        ? (data || []).filter((c) => allowed.includes(c.id))
        : data || [];

      if (requireIssue && !isAdmin) {
        const perms = (currentEmployee as any)?.invoice_company_permissions || {};
        filtered = filtered.filter((c) => Array.isArray(perms[c.id]) && perms[c.id].includes('issue'));
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
        {showAllOption && <option value="">Wszystkie firmy</option>}
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
