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
  organization_id: string;
  nip: string;
  is_test_environment: boolean;
  session_token?: string;
  session_expires_at?: string;
  is_active: boolean;
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
  const [credentials, setCredentials] = useState<KSeFCredentials | null>(null);
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

  useEffect(() => {
    loadCredentials();
    loadInvoices();
    loadSyncLogs();
  }, []);

  const loadCredentials = async () => {
    try {
      const { data, error } = await supabase
        .from('ksef_credentials')
        .select('*')
        .eq('is_active', true)
        .single();

      if (error && error.code !== 'PGRST116') throw error;
      setCredentials(data);
    } catch (error) {
      console.error('Error loading credentials:', error);
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
    if (!credentials) {
      showSnackbar('Skonfiguruj najpierw dane KSeF', 'error');
      return;
    }

    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/ksef-api?action=authenticate&organizationId=${credentials.organization_id}`,
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
    if (!credentials?.session_token) {
      showSnackbar('Najpierw uwierzytelnij się w KSeF', 'error');
      return;
    }

    setSyncing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const action = type === 'issued' ? 'get-issued-invoices' : 'get-received-invoices';

      const params = new URLSearchParams({
        action,
        organizationId: credentials.organization_id,
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
    if (!credentials?.session_token) {
      showSnackbar('Najpierw uwierzytelnij się w KSeF', 'error');
      return;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const params = new URLSearchParams({
        action: 'get-invoice-xml',
        organizationId: credentials.organization_id,
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
    if (!credentials?.session_expires_at) return false;
    return new Date(credentials.session_expires_at) > new Date();
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
            disabled={loading || !credentials}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Key className="h-4 w-4" />
            {loading ? 'Uwierzytelnianie...' : 'Uwierzytelnij'}
          </button>
        </div>
      </div>

      {/* Status */}
      {credentials && (
        <div className="rounded-xl border border-[#d3bb73]/20 bg-[#252945] p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Building2 className="h-5 w-5 text-[#d3bb73]" />
              <div>
                <p className="text-sm font-medium text-[#e5e4e2]">
                  NIP: {credentials.nip}
                </p>
                <p className="text-xs text-[#e5e4e2]/60">
                  Środowisko: {credentials.is_test_environment ? 'Testowe' : 'Produkcyjne'}
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
          credentials={credentials}
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
  credentials,
  onClose,
  onSave,
}: {
  credentials: KSeFCredentials | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [nip, setNip] = useState(credentials?.nip || '');
  const [token, setToken] = useState('');
  const [isTestEnv, setIsTestEnv] = useState(credentials?.is_test_environment ?? true);
  const [organizationId, setOrganizationId] = useState(credentials?.organization_id || '');
  const [loading, setLoading] = useState(false);
  const [organizations, setOrganizations] = useState<any[]>([]);

  const { showSnackbar } = useSnackbar();

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    const { data } = await supabase.from('organizations').select('id, name, nip');
    setOrganizations(data || []);
  };

  const handleSave = async () => {
    if (!nip || !token || !organizationId) {
      showSnackbar('Wszystkie pola są wymagane', 'error');
      return;
    }

    setLoading(true);
    try {
      const payload = {
        organization_id: organizationId,
        nip,
        token,
        is_test_environment: isTestEnv,
        is_active: true,
      };

      if (credentials) {
        const { error } = await supabase
          .from('ksef_credentials')
          .update(payload)
          .eq('id', credentials.id);
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
            <label className="mb-2 block text-sm text-[#e5e4e2]">Organizacja</label>
            <select
              value={organizationId}
              onChange={(e) => setOrganizationId(e.target.value)}
              className="w-full rounded border border-[#d3bb73]/20 bg-[#252945] px-3 py-2 text-[#e5e4e2]"
            >
              <option value="">Wybierz organizację</option>
              {organizations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name} ({org.nip})
                </option>
              ))}
            </select>
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
