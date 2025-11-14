'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import {
  ArrowLeft,
  FileText,
  Building2,
  Calendar,
  User,
  Download,
  CreditCard as Edit,
  Send,
  CheckCircle,
} from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';

export default function ContractDetailsPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const contractId = params.id as string;

  const [contract, setContract] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchContract();
  }, [contractId]);

  const fetchContract = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('contracts')
        .select(
          `
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name, event_date),
          template:contract_templates!template_id(name)
        `,
        )
        .eq('id', contractId)
        .maybeSingle();

      if (error) throw error;
      if (data) setContract(data);
    } catch (err) {
      console.error('Error fetching contract:', err);
    } finally {
      setLoading(false);
    }
  };

  const downloadPDF = async () => {
    try {
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        showSnackbar('Zablokowano popup. Pozwól na wyświetlanie popup-ów.', 'warning');
        return;
      }

      const clientName =
        contract.client?.company_name ||
        `${contract.client?.first_name} ${contract.client?.last_name}`;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Umowa ${contract.contract_number}</title>
            <style>
              body { font-family: Arial, sans-serif; padding: 40px; max-width: 800px; margin: 0 auto; }
              h1 { color: #1c1f33; border-bottom: 2px solid #d3bb73; padding-bottom: 10px; }
              .section { margin: 20px 0; }
              .label { font-weight: bold; color: #666; }
              .value { margin-bottom: 10px; }
              .content { white-space: pre-wrap; line-height: 1.6; margin-top: 20px; font-family: monospace; }
            </style>
          </head>
          <body>
            <h1>Umowa nr ${contract.contract_number}</h1>
            <div class="section">
              <div class="value"><span class="label">Klient:</span> ${clientName}</div>
              <div class="value"><span class="label">Event:</span> ${contract.event?.name || 'Brak'}</div>
              <div class="value"><span class="label">Data utworzenia:</span> ${new Date(contract.created_at).toLocaleDateString('pl-PL')}</div>
              <div class="value"><span class="label">Wartość:</span> ${contract.total_amount ? contract.total_amount.toLocaleString('pl-PL') + ' PLN' : 'N/A'}</div>
            </div>
            <div class="content">
              ${contract.content || 'Brak treści umowy'}
            </div>
          </body>
        </html>
      `);

      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 250);

      showSnackbar('Otwarto okno drukowania', 'info');
    } catch (err) {
      console.error('Error generating PDF:', err);
      showSnackbar('Wystąpił błąd podczas generowania PDF', 'error');
    }
  };

  const updateStatus = async (status: string) => {
    try {
      const updates: any = { status };
      if (status === 'signed') {
        updates.signed_at = new Date().toISOString();
      }

      const { error } = await supabase.from('contracts').update(updates).eq('id', contractId);

      if (error) throw error;
      fetchContract();
    } catch (err) {
      console.error('Error updating status:', err);
      alert('Błąd podczas aktualizacji statusu');
    }
  };

  const getClientName = () => {
    if (!contract?.client) return 'Brak klienta';
    if (contract.client.company_name) return contract.client.company_name;
    return `${contract.client.first_name || ''} ${contract.client.last_name || ''}`.trim();
  };

  const statusLabels: Record<string, string> = {
    draft: 'Projekt',
    sent: 'Wysłana',
    signed: 'Podpisana',
    cancelled: 'Anulowana',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/20 text-gray-400',
    sent: 'bg-blue-500/20 text-blue-400',
    signed: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0d1a]">
        <div className="text-[#e5e4e2]">Umowa nie została znaleziona</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-8 flex items-center gap-4">
          <button
            onClick={() => router.push('/crm/contracts')}
            className="p-2 text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div className="flex-1">
            <h1 className="mb-2 text-3xl font-light text-[#e5e4e2]">{contract.contract_number}</h1>
            <p className="text-[#e5e4e2]/60">{contract.title}</p>
          </div>
          <span className={`rounded-lg px-4 py-2 text-sm ${statusColors[contract.status]}`}>
            {statusLabels[contract.status]}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje podstawowe</h2>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Szablon</p>
                    <p className="text-[#e5e4e2]">{contract.template?.name || 'Brak szablonu'}</p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                    <p className="text-[#e5e4e2]">{getClientName()}</p>
                  </div>
                </div>

                {contract.event && (
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Event</p>
                      <p className="text-[#e5e4e2]">{contract.event.name}</p>
                    </div>
                  </div>
                )}

                {contract.valid_from && (
                  <div className="flex items-start gap-3">
                    <Calendar className="mt-0.5 h-5 w-5 text-[#d3bb73]" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Okres ważności</p>
                      <p className="text-[#e5e4e2]">
                        {new Date(contract.valid_from).toLocaleDateString('pl-PL')} -{' '}
                        {contract.valid_until
                          ? new Date(contract.valid_until).toLocaleDateString('pl-PL')
                          : 'bezterminowo'}
                      </p>
                    </div>
                  </div>
                )}

                {contract.signed_at && (
                  <div className="flex items-start gap-3">
                    <CheckCircle className="mt-0.5 h-5 w-5 text-green-400" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Data podpisania</p>
                      <p className="text-[#e5e4e2]">
                        {new Date(contract.signed_at).toLocaleDateString('pl-PL')}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Treść umowy</h2>

              <div className="max-h-[600px] overflow-y-auto rounded-lg bg-white p-8 text-black">
                {contract.show_header_logo && contract.header_logo_url && (
                  <div className="mb-6 border-b border-gray-300 pb-4">
                    <img
                      src={contract.header_logo_url}
                      alt="Logo"
                      style={{ height: `${contract.header_logo_height || 50}px` }}
                      className="object-contain"
                    />
                  </div>
                )}

                {contract.show_center_logo && contract.center_logo_url && (
                  <div className="mb-12 text-center">
                    <img
                      src={contract.center_logo_url}
                      alt="Logo"
                      style={{ height: `${contract.center_logo_height || 100}px` }}
                      className="mx-auto object-contain"
                    />
                  </div>
                )}

                <div
                  className="whitespace-pre-wrap font-mono text-sm"
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {contract.content}
                </div>
              </div>
            </div>

            {contract.notes && (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
                <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Notatki</h2>
                <p className="whitespace-pre-wrap text-[#e5e4e2]/80">{contract.notes}</p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Akcje</h2>

              <div className="space-y-3">
                {contract.status === 'draft' && (
                  <button
                    onClick={() => updateStatus('sent')}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-500 px-4 py-2 text-white transition-colors hover:bg-blue-600"
                  >
                    <Send className="h-4 w-4" />
                    Wyślij umowę
                  </button>
                )}

                {contract.status === 'sent' && (
                  <button
                    onClick={() => updateStatus('signed')}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-green-500 px-4 py-2 text-white transition-colors hover:bg-green-600"
                  >
                    <CheckCircle className="h-4 w-4" />
                    Oznacz jako podpisaną
                  </button>
                )}

                <button
                  onClick={() => router.push(`/crm/contracts/${contractId}/edit`)}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/20 px-4 py-2 text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
                >
                  <Edit className="h-4 w-4" />
                  Edytuj umowę
                </button>

                <button
                  onClick={downloadPDF}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90"
                >
                  <Download className="h-4 w-4" />
                  Pobierz PDF
                </button>

                {contract.status !== 'cancelled' && (
                  <button
                    onClick={() => updateStatus('cancelled')}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-red-500/20 px-4 py-2 text-red-400 transition-colors hover:bg-red-500/30"
                  >
                    Anuluj umowę
                  </button>
                )}
              </div>
            </div>

            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje systemowe</h2>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-[#e5e4e2]/60">Utworzono</p>
                  <p className="text-[#e5e4e2]">
                    {new Date(contract.created_at).toLocaleString('pl-PL')}
                  </p>
                </div>

                <div>
                  <p className="text-[#e5e4e2]/60">Ostatnia aktualizacja</p>
                  <p className="text-[#e5e4e2]">
                    {new Date(contract.updated_at).toLocaleString('pl-PL')}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
