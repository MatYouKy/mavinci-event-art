'use client';

import { useState, useEffect } from 'react';
import { Building2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

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
}

export default function CompanySelector({
  value,
  onChange,
  showAllOption = true,
  className = '',
  label = 'Firma',
}: CompanySelectorProps) {
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCompanies();
  }, []);

  const loadCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from('my_companies')
        .select('id, name, nip, is_default, is_active')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');

      if (error) throw error;
      setCompanies(data || []);

      if (!value && data && data.length > 0) {
        const defaultCompany = data.find((c) => c.is_default);
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
        onChange={(e) => onChange(e.target.value || null)}
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
