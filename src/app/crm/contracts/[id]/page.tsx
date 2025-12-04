'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { ArrowLeft, FileText, Building2, Calendar, User, Download, CreditCard as Edit, Send, CheckCircle } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import '@/styles/contractA4.css';

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
        .select(`
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name, event_date),
          template:contract_templates!template_id(name)
        `)
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

      const contractContent = `
        <link rel="stylesheet" href="/styles/contractA4.css" />
        <div class="contract-a4-container">
          <div class="contract-a4-page">
            ${contract.show_header_logo && contract.header_logo_url ? `
              <div class="contract-header-logo justify-${contract.header_logo_align || 'start'}">
                <img src="${contract.header_logo_url}" alt="Logo" style="height: ${contract.header_logo_height || 50}px" />
              </div>
            ` : ''}

            ${contract.show_center_logo && contract.center_logo_url ? `
              <div class="contract-center-logo">
                <img src="${contract.center_logo_url}" alt="Logo" style="height: ${contract.center_logo_height || 100}px" />
              </div>
            ` : ''}

            <div class="contract-content">
              ${contract.content || 'Brak treści umowy'}
            </div>

            ${contract.show_footer && contract.footer_content ? `
              <div class="contract-footer">
                ${contract.footer_content}
              </div>
            ` : ''}
          </div>
        </div>
      `;

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Umowa ${contract.contract_number}</title>
            <meta charset="UTF-8">
            <style>
              @import url('/styles/contractA4.css');

              body { margin: 0; padding: 0; }

              .contract-a4-container {
                background: #f5f5f5;
                padding: 20px;
                min-height: 100vh;
              }

              .contract-a4-page {
                position: relative;
                width: 210mm;
                height: 297mm;
                margin: 0 auto;
                padding: 20mm 25mm 30mm;
                background: white;
                box-shadow: 0 0 10px rgba(0, 0, 0, 0.1);
                font-family: Arial, sans-serif;
                font-size: 12pt;
                line-height: 1.6;
                color: #000;
                display: flex;
                flex-direction: column;
                box-sizing: border-box;
              }

              .contract-header-logo {
                width: 100%;
                display: flex;
                align-items: center;
                margin-bottom: 4mm;
                flex-shrink: 0;
              }

              .contract-header-logo.justify-start { justify-content: flex-start; }
              .contract-header-logo.justify-center { justify-content: center; }
              .contract-header-logo.justify-end { justify-content: flex-end; }

              .contract-header-logo img,
              .contract-center-logo img {
                height: auto;
                object-fit: contain;
              }

              .contract-center-logo {
                width: 100%;
                text-align: center;
                margin-bottom: 8mm;
                flex-shrink: 0;
              }

              .contract-content {
                flex: 1;
                text-align: justify;
                color: #000;
                font-family: Arial, sans-serif;
                font-size: 12pt;
                line-height: 1.6;
                white-space: pre-wrap;
              }

              .contract-footer {
                margin-top: auto;
                padding-top: 5mm;
                border-top: 1px solid #d3bb73;
                text-align: center;
                font-size: 10pt;
                color: #666;
                flex-shrink: 0;
              }

              @media print {
                @page { size: A4 portrait; margin: 0; }
                body { margin: 0; padding: 0; }
                .contract-a4-container { background: white; padding: 0; }
                .contract-a4-page {
                  width: 210mm;
                  height: 297mm;
                  margin: 0;
                  box-shadow: none;
                  page-break-after: always;
                }
              }
            </style>
          </head>
          <body>
            ${contractContent}
            <script>
              window.onload = function() {
                setTimeout(function() {
                  window.print();
                }, 500);
              };
            </script>
          </body>
        </html>
      `);

      printWindow.document.close();
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

      const { error } = await supabase
        .from('contracts')
        .update(updates)
        .eq('id', contractId);

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
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="min-h-screen bg-[#0a0d1a] flex items-center justify-center">
        <div className="text-[#e5e4e2]">Umowa nie została znaleziona</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-8">
          <button
            onClick={() => router.push('/crm/contracts')}
            className="p-2 text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div className="flex-1">
            <h1 className="text-3xl font-light text-[#e5e4e2] mb-2">
              {contract.contract_number}
            </h1>
            <p className="text-[#e5e4e2]/60">{contract.title}</p>
          </div>
          <span
            className={`px-4 py-2 rounded-lg text-sm ${
              statusColors[contract.status]
            }`}
          >
            {statusLabels[contract.status]}
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                Informacje podstawowe
              </h2>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <FileText className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Szablon</p>
                    <p className="text-[#e5e4e2]">
                      {contract.template?.name || 'Brak szablonu'}
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <Building2 className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                  <div>
                    <p className="text-sm text-[#e5e4e2]/60">Klient</p>
                    <p className="text-[#e5e4e2]">{getClientName()}</p>
                  </div>
                </div>

                {contract.event && (
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Event</p>
                      <p className="text-[#e5e4e2]">{contract.event.name}</p>
                    </div>
                  </div>
                )}

                {contract.valid_from && (
                  <div className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-[#d3bb73] mt-0.5" />
                    <div>
                      <p className="text-sm text-[#e5e4e2]/60">Okres ważności</p>
                      <p className="text-[#e5e4e2]">
                        {new Date(contract.valid_from).toLocaleDateString('pl-PL')}{' '}
                        -{' '}
                        {contract.valid_until
                          ? new Date(contract.valid_until).toLocaleDateString('pl-PL')
                          : 'bezterminowo'}
                      </p>
                    </div>
                  </div>
                )}

                {contract.signed_at && (
                  <div className="flex items-start gap-3">
                    <CheckCircle className="w-5 h-5 text-green-400 mt-0.5" />
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

            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                Podgląd umowy
              </h2>

              <div className="bg-white rounded-lg overflow-hidden">
                <div className="contract-a4-page">
                  {contract.show_header_logo && contract.header_logo_url && (
                    <div className={`contract-header-logo justify-${contract.header_logo_align || 'start'}`}>
                      <img
                        src={contract.header_logo_url}
                        alt="Logo"
                        style={{ height: `${contract.header_logo_height || 50}px` }}
                      />
                    </div>
                  )}

                  {contract.show_center_logo && contract.center_logo_url && (
                    <div className="contract-center-logo">
                      <img
                        src={contract.center_logo_url}
                        alt="Logo"
                        style={{ height: `${contract.center_logo_height || 100}px` }}
                      />
                    </div>
                  )}

                  <div className="contract-content" dangerouslySetInnerHTML={{ __html: contract.content }} />

                  {contract.show_footer && contract.footer_content && (
                    <div className="contract-footer" dangerouslySetInnerHTML={{ __html: contract.footer_content }} />
                  )}
                </div>
              </div>
            </div>

            {contract.notes && (
              <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
                <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Notatki</h2>
                <p className="text-[#e5e4e2]/80 whitespace-pre-wrap">
                  {contract.notes}
                </p>
              </div>
            )}
          </div>

          <div className="space-y-6">
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">Akcje</h2>

              <div className="space-y-3">
                {contract.status === 'draft' && (
                  <button
                    onClick={() => updateStatus('sent')}
                    className="w-full flex items-center justify-center gap-2 bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors"
                  >
                    <Send className="w-4 h-4" />
                    Wyślij umowę
                  </button>
                )}

                {contract.status === 'sent' && (
                  <button
                    onClick={() => updateStatus('signed')}
                    className="w-full flex items-center justify-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors"
                  >
                    <CheckCircle className="w-4 h-4" />
                    Oznacz jako podpisaną
                  </button>
                )}

                <button
                  onClick={() => router.push(`/crm/contracts/${contractId}/edit`)}
                  className="w-full flex items-center justify-center gap-2 bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]/30 px-4 py-2 rounded-lg hover:bg-[#d3bb73]/30 transition-colors"
                >
                  <Edit className="w-4 h-4" />
                  Edytuj umowę
                </button>

                <button
                  onClick={downloadPDF}
                  className="w-full flex items-center justify-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  Pobierz PDF
                </button>

                {contract.status !== 'cancelled' && (
                  <button
                    onClick={() => updateStatus('cancelled')}
                    className="w-full flex items-center justify-center gap-2 bg-red-500/20 text-red-400 px-4 py-2 rounded-lg hover:bg-red-500/30 transition-colors"
                  >
                    Anuluj umowę
                  </button>
                )}
              </div>
            </div>

            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
                Informacje systemowe
              </h2>

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
