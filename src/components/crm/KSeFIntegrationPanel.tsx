'use client';

import { useState, useEffect } from 'react';
import {
  Settings,
  Download,
  Upload,
  RefreshCw,
  CheckCircle,
  AlertCircle,
  Key,
  Building2,
  Calendar,
  FileText,
  Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface KSeFCredentials {
  id: string;
  my_company_id: string;
  nip: string;
  is_test_environment: boolean;
  session_token?: string;
  session_expires_at?: string;
  is_active: boolean;
  my_company?: {
    id: string;
    name: string;
    nip: string;
  };
}

interface KSeFInvoice {
  id: string;
  invoice_id?: string;
  ksef_reference_number: string;
  invoice_type: 'issued' | 'received';
  sync_status: 'pending' | 'synced' | 'error';
  sync_error?: string;
  ksef_issued_at: string;
  synced_at: string;
}

interface SyncLog {
  id: string;
  sync_type: string;
  status: string;
  invoices_count: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
}

export default function KSeFIntegrationPanel() {
  const [allCredentials, setAllCredentials] = useState<KSeFCredentials[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const [issuedInvoices, setIssuedInvoices] = useState<KSeFInvoice[]>([]);
  const [receivedInvoices, setReceivedInvoices] = useState<KSeFInvoice[]>([]);
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>([]);
  const [activeTab, setActiveTab] = useState<'issued' | 'received' | 'logs'>('issued');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { showSnackbar } = useSnackbar();
  const { showDialog } = useDialog();

  const selectedCredentials = allCredentials.find(c => c.my_company_id === selectedCompanyId);

  useEffect(() => {
    loadCredentials();
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadInvoices();
      loadSyncLogs();
    }
  }, [selectedCompanyId]);

  const loadCredentials = async () => {
    try {
      const { data, error } = await supabase
        .from('ksef_selectedCredentials')
        .select(`
          *,
          my_company:my_companies(id, name, nip)
        `)
        .eq('is_active', true);

      if (error) throw error;
      setAllCredentials(data || []);

      if (data && data.length > 0 && !selectedCompanyId) {
        setSelectedCompanyId(data[0].my_company_id);
      }
    } catch (error) {
      console.error('Error loading selectedCredentials:', error);
    }
  };

  const loadInvoices = async () => {
    try {
      const { data, error } = await supabase
        .from('ksef_invoices')
        .select('*')
        .order('ksef_issued_at', { ascending: false });

      if (error) throw error;

      setIssuedInvoices(data?.filter((inv) => inv.invoice_type === 'issued') || []);
      setReceivedInvoices(data?.filter((inv) => inv.invoice_type === 'received') || []);
    } catch (error) {
      console.error('Error loading invoices:', error);
    }
  };

  const loadSyncLogs = async () => {
    try {
      const { data, error } = await supabase
        .from('ksef_sync_log')
        .select('*')
        .order('started_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setSyncLogs(data || []);
    } catch (error) {
      console.error('Error loading sync logs:', error);
    }
  };

  const handleAuthenticate = async () => {
    if (!selectedCredentials) {
      showSnackbar('Skonfiguruj najpierw dane KSeF dla wybranej firmy', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ksef-api?action=authenticate&organizationId=${selectedCredentials.my_company_id}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Błąd autoryzacji');
      }

      showSnackbar('Pomyślnie uwierzytelniono w KSeF', 'success');
      await loadCredentials();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd autoryzacji', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSyncInvoices = async (type: 'issued' | 'received') => {
    if (!selectedCredentials?.session_token) {
      showSnackbar('Najpierw uwierzytelnij się w KSeF', 'error');
      return;
    }

    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const action = type === 'issued' ? 'get-issued-invoices' : 'get-received-invoices';

      const params = new URLSearchParams({
        action,
        organizationId: selectedCredentials.organization_id,
      });

      if (dateFrom) params.append('dateFrom', dateFrom);
      if (dateTo) params.append('dateTo', dateTo);

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ksef-api?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Błąd synchronizacji');
      }

      const data = await response.json();
      showSnackbar(
        `Zsynchronizowano ${data.invoiceList?.length || 0} faktur`,
        'success'
      );
      await loadInvoices();
      await loadSyncLogs();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd synchronizacji', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleViewInvoiceXml = async (ksefReferenceNumber: string) => {
    if (!selectedCredentials?.session_token) {
      showSnackbar('Najpierw uwierzytelnij się w KSeF', 'error');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({
        action: 'get-invoice-xml',
        organizationId: selectedCredentials.organization_id,
        ksefReferenceNumber,
      });

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ksef-api?${params.toString()}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
          },
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Błąd pobierania XML');
      }

      const data = await response.json();
      showDialog({
        title: 'XML Faktury',
        message: `<pre class="max-h-96 overflow-auto text-xs">${data.xml}</pre>`,
        confirmText: 'Zamknij',
      });
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd pobierania XML', 'error');
    }
  };

  const isSessionActive = () => {
    if (!selectedCredentials?.session_expires_at) return false;
    return new Date(selectedCredentials.session_expires_at) > new Date();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2]">Integracja KSeF</h2>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            Krajowy System e-Faktur - synchronizacja faktur
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => setShowSetup(true)}
            className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#252945] px-4 py-2 text-sm text-[#e5e4e2] hover:border-[#d3bb73]/40"
          >
            <Settings className="h-4 w-4" />
            Konfiguracja
          </button>
          <button
            onClick={handleAuthenticate}
            disabled={loading || !selectedCredentials}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Key className="h-4 w-4" />
            {loading ? 'Uwierzytelnianie...' : 'Uwierzytelnij'}
          </button>
        </div>
      </div>

      {/* Company selector */}
      {allCredentials.length > 0 && (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-4">
          <label className="mb-2 block text-sm text-[#e5e4e2]">Wybierz firmę</label>
          <select
            value={selectedCompanyId}
            onChange={(e) => setSelectedCompanyId(e.target.value)}
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            {allCredentials.map((cred) => (
              <option key={cred.id} value={cred.my_company_id}>
                {cred.my_company?.name || cred.nip} - NIP: {cred.nip}
              </option>
            ))}
          </select>
        </div>
      )}

      {allCredentials.length === 0 && (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-8 text-center">
          <Building2 className="mx-auto mb-4 h-12 w-12 text-[#e5e4e2]/20" />
          <p className="mb-4 text-[#e5e4e2]/60">
            Brak skonfigurowanych firm. Najpierw dodaj firmę i skonfiguruj jej dane KSeF.
          </p>
          <button
            onClick={() => setShowSetup(true)}
            className="text-[#d3bb73] hover:text-[#d3bb73]/80"
          >
            Skonfiguruj KSeF
          </button>
        </div>
      )}

      {/* Status */}
      {selectedCredentials && (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-[#d3bb73]" />
              <div>
                <p className="text-sm font-medium text-[#e5e4e2]">
                  NIP: {selectedCredentials.nip}
                </p>
                <p className="text-xs text-[#e5e4e2]/60">
                  Środowisko: {selectedCredentials.is_test_environment ? 'Testowe' : 'Produkcyjne'}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {isSessionActive() ? (
                <>
                  <CheckCircle className="h-5 w-5 text-green-400" />
                  <span className="text-sm text-green-400">Sesja aktywna</span>
                </>
              ) : (
                <>
                  <AlertCircle className="h-5 w-5 text-orange-400" />
                  <span className="text-sm text-orange-400">Wymagana autoryzacja</span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Date filters */}
      <div className="flex items-center gap-4 rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-4">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-[#d3bb73]" />
          <span className="text-sm text-[#e5e4e2]">Okres:</span>
        </div>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1.5 text-sm text-[#e5e4e2]"
        />
        <span className="text-sm text-[#e5e4e2]/60">do</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
          className="rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-1.5 text-sm text-[#e5e4e2]"
        />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-[#d3bb73]/20 bg-[#252945] p-1">
        <button
          onClick={() => setActiveTab('issued')}
          className={`flex-1 rounded px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'issued'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <Upload className="mr-2 inline-block h-4 w-4" />
          Wystawione ({issuedInvoices.length})
        </button>
        <button
          onClick={() => setActiveTab('received')}
          className={`flex-1 rounded px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'received'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <Download className="mr-2 inline-block h-4 w-4" />
          Otrzymane ({receivedInvoices.length})
        </button>
        <button
          onClick={() => setActiveTab('logs')}
          className={`flex-1 rounded px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'logs'
              ? 'bg-[#d3bb73] text-[#1c1f33]'
              : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
          }`}
        >
          <FileText className="mr-2 inline-block h-4 w-4" />
          Historia ({syncLogs.length})
        </button>
      </div>

      {/* Content */}
      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945]">
        {/* Action bar */}
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-4">
          <h3 className="font-medium text-[#e5e4e2]">
            {activeTab === 'issued' && 'Faktury wystawione'}
            {activeTab === 'received' && 'Faktury otrzymane'}
            {activeTab === 'logs' && 'Historia synchronizacji'}
          </h3>
          {activeTab !== 'logs' && (
            <button
              onClick={() => handleSyncInvoices(activeTab)}
              disabled={syncing || !isSessionActive()}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Synchronizacja...' : 'Synchronizuj'}
            </button>
          )}
        </div>

        {/* Invoices list */}
        {(activeTab === 'issued' || activeTab === 'received') && (
          <div className="divide-y divide-[#d3bb73]/10">
            {(activeTab === 'issued' ? issuedInvoices : receivedInvoices).length === 0 ? (
              <div className="p-8 text-center text-[#e5e4e2]/40">
                Brak faktur do wyświetlenia
              </div>
            ) : (
              (activeTab === 'issued' ? issuedInvoices : receivedInvoices).map((invoice) => (
                <div
                  key={invoice.id}
                  className="flex items-center justify-between p-4 hover:bg-[#1c1f33]/50"
                >
                  <div className="flex items-center gap-4">
                    <div
                      className={`rounded-full p-2 ${
                        invoice.sync_status === 'synced'
                          ? 'bg-green-400/10'
                          : invoice.sync_status === 'error'
                            ? 'bg-red-400/10'
                            : 'bg-yellow-400/10'
                      }`}
                    >
                      {invoice.sync_status === 'synced' && (
                        <CheckCircle className="h-4 w-4 text-green-400" />
                      )}
                      {invoice.sync_status === 'error' && (
                        <AlertCircle className="h-4 w-4 text-red-400" />
                      )}
                      {invoice.sync_status === 'pending' && (
                        <RefreshCw className="h-4 w-4 text-yellow-400" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-[#e5e4e2]">
                        {invoice.ksef_reference_number}
                      </p>
                      <p className="text-sm text-[#e5e4e2]/60">
                        {new Date(invoice.ksef_issued_at).toLocaleDateString('pl-PL')}
                      </p>
                      {invoice.sync_error && (
                        <p className="text-xs text-red-400">{invoice.sync_error}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleViewInvoiceXml(invoice.ksef_reference_number)}
                    className="flex items-center gap-2 rounded px-3 py-1.5 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/10"
                  >
                    <Eye className="h-4 w-4" />
                    Zobacz XML
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Sync logs */}
        {activeTab === 'logs' && (
          <div className="divide-y divide-[#d3bb73]/10">
            {syncLogs.length === 0 ? (
              <div className="p-8 text-center text-[#e5e4e2]/40">
                Brak historii synchronizacji
              </div>
            ) : (
              syncLogs.map((log) => (
                <div key={log.id} className="p-4 hover:bg-[#1c1f33]/50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={`rounded-full p-2 ${
                          log.status === 'success' ? 'bg-green-400/10' : 'bg-red-400/10'
                        }`}
                      >
                        {log.status === 'success' ? (
                          <CheckCircle className="h-4 w-4 text-green-400" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-400" />
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-[#e5e4e2]">
                          Synchronizacja:{' '}
                          {log.sync_type === 'issued' ? 'Wystawione' : 'Otrzymane'}
                        </p>
                        <p className="text-sm text-[#e5e4e2]/60">
                          {new Date(log.started_at).toLocaleString('pl-PL')}
                        </p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="font-medium text-[#e5e4e2]">
                        {log.invoices_count} faktur
                      </p>
                      {log.error_message && (
                        <p className="text-xs text-red-400">{log.error_message}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Setup modal */}
      {showSetup && (
        <KSeFSetupModal
          selectedCredentials={selectedCredentials}
          onClose={() => setShowSetup(false)}
          onSave={() => {
            setShowSetup(false);
            loadCredentials();
          }}
        />
      )}
    </div>
  );
}

function KSeFSetupModal({
  selectedCredentials,
  onClose,
  onSave,
}: {
  selectedCredentials: KSeFCredentials | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [nip, setNip] = useState(selectedCredentials?.nip || '');
  const [token, setToken] = useState('');
  const [isTestEnv, setIsTestEnv] = useState(selectedCredentials?.is_test_environment ?? true);
  const [myCompanyId, setMyCompanyId] = useState(selectedCredentials?.my_company_id || '');
  const [loading, setLoading] = useState(false);
  const [myCompanies, setMyCompanies] = useState<any[]>([]);

  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadMyCompanies();
  }, []);

  const loadMyCompanies = async () => {
    const { data } = await supabase
      .from('my_companies')
      .select('id, name, nip')
      .eq('is_active', true)
      .order('is_default', { ascending: false });
    setMyCompanies(data || []);
  };

  const handleSave = async () => {
    if (!nip || !token || !myCompanyId) {
      showSnackbar('Wszystkie pola są wymagane', 'error');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        my_company_id: myCompanyId,
        nip,
        token,
        is_test_environment: isTestEnv,
        is_active: true,
      };

      if (selectedCredentials) {
        const { error } = await supabase
          .from('ksef_credentials')
          .update(payload)
          .eq('id', selectedCredentials.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('ksef_credentials').insert(payload);
        if (error) throw error;
      }

      showSnackbar('Dane KSeF zapisane pomyślnie', 'success');
      onSave();
    } catch (error: any) {
      showSnackbar(error.message || 'Błąd zapisu', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33]">
        <div className="border-b border-[#d3bb73]/10 p-6">
          <h3 className="text-xl font-light text-[#e5e4e2]">Konfiguracja KSeF</h3>
        </div>
        <div className="space-y-4 p-6">
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]">Moja firma</label>
            <select
              value={myCompanyId}
              onChange={(e) => setMyCompanyId(e.target.value)}
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            >
              <option value="">Wybierz firmę</option>
              {myCompanies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name} ({company.nip})
                </option>
              ))}
            </select>
            {myCompanies.length === 0 && (
              <p className="mt-2 text-xs text-[#e5e4e2]/60">
                Najpierw dodaj firmę w <a href="/crm/settings/my-companies" className="text-[#d3bb73]">Ustawieniach → Moje firmy</a>
              </p>
            )}
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]">NIP</label>
            <input
              type="text"
              value={nip}
              onChange={(e) => setNip(e.target.value)}
              placeholder="1234567890"
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]">Token autoryzacyjny</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Wprowadź token z KSeF"
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="isTestEnv"
              checked={isTestEnv}
              onChange={(e) => setIsTestEnv(e.target.checked)}
              className="h-4 w-4 rounded border-[#d3bb73]/20 bg-[#252945]"
            />
            <label htmlFor="isTestEnv" className="text-sm text-[#e5e4e2]">
              Środowisko testowe
            </label>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
          >
            Anuluj
          </button>
          <button
            onClick={handleSave}
            disabled={loading}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {loading ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>
    </div>
  );
}
