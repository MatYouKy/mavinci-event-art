'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import {
  Building2,
  Key,
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  HelpCircle,
  ExternalLink,
  Shield,
  Settings
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import KSeFConfigForm from '@/components/crm/KSeFConfigForm';

interface MyCompany {
  id: string;
  name: string;
  legal_name: string;
  nip: string;
  street: string;
  building_number: string;
  apartment_number: string | null;
  city: string;
  postal_code: string;
  has_ksef: boolean;
}

export default function KSeFSettingsPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const [companies, setCompanies] = useState<MyCompany[]>([]);
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    fetchCompanies();
  }, []);

  const fetchCompanies = async () => {
    try {
      setLoading(true);

      const { data: companiesData, error: companiesError } = await supabase
        .from('my_companies')
        .select('*')
        .eq('is_active', true)
        .order('is_default', { ascending: false });

      if (companiesError) throw companiesError;

      const { data: credentialsData, error: credentialsError } = await supabase
        .from('ksef_credentials')
        .select('my_company_id');

      if (credentialsError) throw credentialsError;

      const credentialMap = new Set(
        credentialsData?.map((c) => c.my_company_id) || []
      );

      const companiesWithStatus = (companiesData || []).map((company) => ({
        ...company,
        has_ksef: credentialMap.has(company.id),
      }));

      setCompanies(companiesWithStatus);

      if (companiesWithStatus.length > 0 && !selectedCompany) {
        setSelectedCompany(companiesWithStatus[0].id);
      }
    } catch (err) {
      console.error('Error fetching companies:', err);
      showSnackbar('Błąd podczas wczytywania firm', 'error');
    } finally {
      setLoading(false);
    }
  };

  const selectedCompanyData = companies.find((c) => c.id === selectedCompany);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-lg text-[#d3bb73]">Ładowanie...</div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <button
          onClick={() => router.push('/crm/settings')}
          className="mb-4 flex items-center gap-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
        >
          <ArrowLeft className="h-4 w-4" />
          Powrót do ustawień
        </button>

        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[#d3bb73]/10">
              <Key className="h-6 w-6 text-[#d3bb73]" />
            </div>
            <div>
              <h1 className="text-3xl font-light text-[#e5e4e2]">Konfiguracja KSeF</h1>
              <p className="text-[#e5e4e2]/60">
                Zarządzaj integracją z Krajowym Systemem e-Faktur
              </p>
            </div>
          </div>

          <button
            onClick={() => setShowHelp(!showHelp)}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
          >
            <HelpCircle className="h-4 w-4" />
            {showHelp ? 'Ukryj pomoc' : 'Pokaż pomoc'}
          </button>
        </div>

        {showHelp && (
          <div className="mb-6 rounded-xl border border-blue-500/20 bg-blue-500/5 p-6">
            <div className="mb-4 flex items-start gap-3">
              <Shield className="mt-1 h-5 w-5 text-blue-400" />
              <div>
                <h3 className="mb-2 font-medium text-blue-400">
                  Jak skonfigurować KSeF?
                </h3>
                <ol className="space-y-3 text-sm text-[#e5e4e2]/80">
                  <li className="flex gap-2">
                    <span className="font-medium text-blue-400">1.</span>
                    <div>
                      <strong>Uzyskaj token autoryzacyjny</strong>
                      <p className="mt-1 text-[#e5e4e2]/60">
                        Zaloguj się na platformie KSeF pod adresem{' '}
                        <a
                          href="https://ksef.mf.gov.pl"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-400 hover:underline"
                        >
                          ksef.mf.gov.pl
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium text-blue-400">2.</span>
                    <div>
                      <strong>Wygeneruj token</strong>
                      <p className="mt-1 text-[#e5e4e2]/60">
                        W panelu KSeF przejdź do sekcji &quot;Tokeny&quot; i wygeneruj nowy
                        token dla swojej aplikacji
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium text-blue-400">3.</span>
                    <div>
                      <strong>Wprowadź dane w systemie</strong>
                      <p className="mt-1 text-[#e5e4e2]/60">
                        Wybierz firmę z listy poniżej i wklej token oraz hasło w odpowiednie
                        pola
                      </p>
                    </div>
                  </li>
                  <li className="flex gap-2">
                    <span className="font-medium text-blue-400">4.</span>
                    <div>
                      <strong>Testuj połączenie</strong>
                      <p className="mt-1 text-[#e5e4e2]/60">
                        Kliknij &quot;Testuj połączenie&quot; aby sprawdzić czy dane są poprawne
                      </p>
                    </div>
                  </li>
                </ol>
              </div>
            </div>
          </div>
        )}
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
          <Building2 className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <h3 className="mb-2 text-lg font-medium text-[#e5e4e2]">Brak skonfigurowanych firm</h3>
          <p className="mb-6 text-[#e5e4e2]/60">
            Przed skonfigurowaniem KSeF musisz dodać przynajmniej jedną firmę
          </p>
          <button
            onClick={() => router.push('/crm/settings/my-companies')}
            className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
          >
            <Building2 className="h-4 w-4" />
            Zarządzaj firmami
          </button>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[300px,1fr]">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h3 className="mb-4 flex items-center gap-2 text-sm font-medium uppercase tracking-wider text-[#e5e4e2]/60">
              <Building2 className="h-4 w-4" />
              Wybierz firmę
            </h3>

            <div className="space-y-2">
              {companies.map((company) => (
                <button
                  key={company.id}
                  onClick={() => setSelectedCompany(company.id)}
                  className={`w-full rounded-lg border p-4 text-left transition-colors ${
                    selectedCompany === company.id
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10'
                      : 'border-[#d3bb73]/10 bg-[#0f1119] hover:bg-[#1c1f33]'
                  }`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="font-medium text-[#e5e4e2]">{company.name}</span>
                    {company.has_ksef ? (
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-400" />
                    )}
                  </div>
                  <div className="text-xs text-[#e5e4e2]/60">NIP: {company.nip}</div>
                  <div className="mt-2 text-xs">
                    {company.has_ksef ? (
                      <span className="text-green-400">KSeF skonfigurowany</span>
                    ) : (
                      <span className="text-amber-400">Wymaga konfiguracji</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            <div className="mt-6 border-t border-[#d3bb73]/10 pt-6">
              <button
                onClick={() => router.push('/crm/settings/my-companies')}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#0f1119] px-4 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]"
              >
                <Settings className="h-4 w-4" />
                Zarządzaj firmami
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            {selectedCompanyData ? (
              <>
                <div className="mb-6">
                  <h2 className="text-xl font-light text-[#e5e4e2]">
                    {selectedCompanyData.legal_name}
                  </h2>
                  <div className="mt-2 space-y-1 text-sm text-[#e5e4e2]/60">
                    <div>NIP: {selectedCompanyData.nip}</div>
                    <div>
                      {selectedCompanyData.street} {selectedCompanyData.building_number}
                      {selectedCompanyData.apartment_number && `/${selectedCompanyData.apartment_number}`}
                      , {selectedCompanyData.postal_code} {selectedCompanyData.city}
                    </div>
                  </div>
                </div>

                <KSeFConfigForm companyId={selectedCompany!} onUpdate={fetchCompanies} />
              </>
            ) : (
              <div className="py-12 text-center">
                <AlertCircle className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
                <p className="text-[#e5e4e2]/60">Wybierz firmę z listy</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
