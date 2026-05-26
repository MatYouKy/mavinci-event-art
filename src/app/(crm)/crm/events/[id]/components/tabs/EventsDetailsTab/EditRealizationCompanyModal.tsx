import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/browser';
import Image from 'next/image';
import { Building2 } from 'lucide-react';

type RealizationCompanyOption = {
  id: string;
  name: string;
  legal_name: string | null;
  nip: string | null;
  email: string | null;
  phone: string | null;
  logo_url: string | null;
};

export function EditRealizationCompanyModal({
  currentCompanyId,
  onClose,
  onSave,
}: {
  currentCompanyId?: string | null;
  onClose: () => void;
  onSave: (companyId: string) => Promise<void>;
}) {
  const [companies, setCompanies] = useState<RealizationCompanyOption[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState(currentCompanyId ?? '');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);


  useEffect(() => {
    const loadCompanies = async () => {
      setLoading(true);

      const { data: companiesData, error: companiesError } = await supabase
        .from('my_companies')
        .select('id, name, legal_name, nip, email, phone, logo_url, is_default')
        .eq('is_active', true)
        .order('is_default', { ascending: false })
        .order('name');

      if (companiesError) {
        console.error('Error loading companies:', companiesError);
        setLoading(false);
        return;
      }

      const companyIds = (companiesData ?? []).map((company) => company.id);

      const { data: brandLogos, error: brandLogosError } = await supabase
        .from('company_brandbook_logos')
        .select('company_id, url')
        .in('company_id', companyIds)
        .eq('label', 'signature');

      if (brandLogosError) {
        console.error('Error loading brandbook logos:', brandLogosError);
      }

      const brandLogoByCompanyId = new Map(
        (brandLogos ?? []).map((logo) => [logo.company_id, logo.url]),
      );

      const resolveLogoUrl = (url?: string | null) => {
        if (!url) return null;
        if (/^https?:\/\//i.test(url) || url.startsWith('data:')) return url;

        return `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${url}`;
      };

      setCompanies(
        (companiesData ?? []).map((company) => {
          const logoPath = brandLogoByCompanyId.get(company.id) || company.logo_url || null;

          return {
            ...company,
            logo_url: resolveLogoUrl(logoPath),
          };
        }),
      );

      setLoading(false);
    };

    loadCompanies();
  }, []);

  const handleSubmit = async () => {
    if (!selectedCompanyId) return;

    setSaving(true);
    try {
      await onSave(selectedCompanyId);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-5">
          <h3 className="text-lg font-light text-[#e5e4e2]">Zmień firmę realizującą</h3>

          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            ×
          </button>
        </div>

        <div className="max-h-[60vh] space-y-2 overflow-y-auto p-5">
          {loading ? (
            <div className="py-8 text-center text-sm text-[#e5e4e2]/60">Ładowanie firm...</div>
          ) : companies.length === 0 ? (
            <div className="py-8 text-center text-sm text-[#e5e4e2]/60">Brak aktywnych firm</div>
          ) : (
            companies.map((company) => {
              const selected = selectedCompanyId === company.id;

              return (
                <button
                  key={company.id}
                  type="button"
                  onClick={() => setSelectedCompanyId(company.id)}
                  className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                    selected
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/30 hover:bg-[#0a0d1a]/60'
                  }`}
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5">
                    {company.logo_url ? (
                      <Image
                        src={company.logo_url}
                        alt={company.name}
                        width={40}
                        height={40}
                        className="h-10 w-10 object-contain"
                      />
                    ) : (
                      <Building2 className="h-5 w-5 text-[#d3bb73]" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-[#e5e4e2]">
                      {company.legal_name || company.name}
                    </div>

                    <div className="mt-0.5 text-xs text-[#e5e4e2]/50">
                      {company.nip ? `NIP: ${company.nip}` : company.email || ''}
                    </div>
                  </div>

                  {selected && <span className="text-xs text-[#d3bb73]">Wybrana</span>}
                </button>
              );
            })
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#0a0d1a]"
          >
            Anuluj
          </button>

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!selectedCompanyId || saving}
            className="rounded-lg bg-[#d3bb73] px-5 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-40"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}