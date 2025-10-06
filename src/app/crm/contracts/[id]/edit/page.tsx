'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { Save, ArrowLeft, Eye } from 'lucide-react';

export default function EditContractPage() {
  const params = useParams();
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const contractId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [contract, setContract] = useState<any>(null);
  const [formData, setFormData] = useState({
    content: '',
    total_amount: '',
  });
  const [logoSettings, setLogoSettings] = useState({
    header_logo_url: '',
    header_logo_height: 50,
    center_logo_url: '',
    center_logo_height: 100,
    show_header_logo: false,
    show_center_logo: false,
  });

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
          template:contract_templates!template_id(*)
        `)
        .eq('id', contractId)
        .maybeSingle();

      if (error) throw error;

      if (data) {
        setContract(data);
        setFormData({
          content: data.content || data.template?.content || '',
          total_amount: data.total_amount?.toString() || '',
        });

        if (data.template) {
          setLogoSettings({
            header_logo_url: data.template.header_logo_url || '',
            header_logo_height: data.template.header_logo_height || 50,
            center_logo_url: data.template.center_logo_url || '',
            center_logo_height: data.template.center_logo_height || 100,
            show_header_logo: data.template.show_header_logo || false,
            show_center_logo: data.template.show_center_logo || false,
          });
        }
      }
    } catch (err) {
      console.error('Error fetching contract:', err);
      showSnackbar('Błąd podczas wczytywania umowy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      setSaving(true);

      const updates: any = {
        content: formData.content,
        updated_at: new Date().toISOString(),
      };

      if (formData.total_amount) {
        updates.total_amount = parseFloat(formData.total_amount);
      }

      const { error } = await supabase
        .from('contracts')
        .update(updates)
        .eq('id', contractId);

      if (error) throw error;

      showSnackbar('Umowa zapisana pomyślnie!', 'success');
      router.push(`/crm/contracts/${contractId}`);
    } catch (err) {
      console.error('Error saving contract:', err);
      showSnackbar('Błąd podczas zapisywania umowy', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[#e5e4e2]/60">Nie znaleziono umowy</div>
      </div>
    );
  }

  const clientName = contract.client?.company_name ||
    `${contract.client?.first_name} ${contract.client?.last_name}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/crm/contracts/${contractId}`)}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <ArrowLeft className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">
              Edycja umowy
            </h1>
            <p className="text-sm text-[#e5e4e2]/60 mt-1">
              {contract.contract_number} - {clientName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 bg-[#1c1f33] text-[#e5e4e2] px-4 py-2 rounded-lg hover:bg-[#1c1f33]/80 transition-colors"
          >
            <Eye className="w-5 h-5" />
            {showPreview ? 'Edycja' : 'Podgląd'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-6 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50"
          >
            <Save className="w-5 h-5" />
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Treść umowy
            </label>

            {showPreview ? (
              <div className="bg-white text-black p-12 rounded-lg min-h-[600px]">
                {logoSettings.show_header_logo && logoSettings.header_logo_url && (
                  <div className="mb-8">
                    <img
                      src={logoSettings.header_logo_url}
                      alt="Logo nagłówka"
                      style={{ height: `${logoSettings.header_logo_height}px` }}
                      className="object-contain"
                    />
                  </div>
                )}

                {logoSettings.show_center_logo && logoSettings.center_logo_url && (
                  <div className="mb-12 text-center">
                    <img
                      src={logoSettings.center_logo_url}
                      alt="Logo"
                      style={{ height: `${logoSettings.center_logo_height}px` }}
                      className="object-contain mx-auto"
                    />
                  </div>
                )}

                <div className="whitespace-pre-wrap font-mono text-sm" style={{ whiteSpace: 'pre-wrap' }}>
                  {formData.content || 'Brak treści'}
                </div>
              </div>
            ) : (
              <textarea
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-3 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73] font-mono text-sm resize-none"
                rows={25}
                placeholder="Treść umowy..."
              />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
            <h2 className="text-lg font-light text-[#e5e4e2] mb-4">
              Informacje
            </h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Klient
                </label>
                <div className="text-[#e5e4e2]">{clientName}</div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Event
                </label>
                <div className="text-[#e5e4e2]">
                  {contract.event?.name || 'Brak'}
                </div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Numer umowy
                </label>
                <div className="text-[#e5e4e2]">{contract.contract_number}</div>
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Wartość (PLN)
                </label>
                <input
                  type="number"
                  value={formData.total_amount}
                  onChange={(e) =>
                    setFormData({ ...formData, total_amount: e.target.value })
                  }
                  className="w-full bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] focus:outline-none focus:border-[#d3bb73]"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>

              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">
                  Status
                </label>
                <div className="text-[#e5e4e2] capitalize">
                  {contract.status === 'draft' && 'Szkic'}
                  {contract.status === 'sent' && 'Wysłana'}
                  {contract.status === 'signed' && 'Podpisana'}
                  {contract.status === 'cancelled' && 'Anulowana'}
                </div>
              </div>
            </div>
          </div>

          {logoSettings.show_header_logo && logoSettings.header_logo_url && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h3 className="text-sm font-medium text-[#e5e4e2] mb-3">
                Logo nagłówka
              </h3>
              <div className="border border-[#d3bb73]/10 rounded-lg p-3 bg-[#0f1119]">
                <img
                  src={logoSettings.header_logo_url}
                  alt="Logo nagłówka"
                  style={{ height: `${logoSettings.header_logo_height}px` }}
                  className="object-contain"
                />
              </div>
            </div>
          )}

          {logoSettings.show_center_logo && logoSettings.center_logo_url && (
            <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
              <h3 className="text-sm font-medium text-[#e5e4e2] mb-3">
                Logo centralne
              </h3>
              <div className="border border-[#d3bb73]/10 rounded-lg p-3 bg-[#0f1119] text-center">
                <img
                  src={logoSettings.center_logo_url}
                  alt="Logo centralne"
                  style={{ height: `${logoSettings.center_logo_height}px` }}
                  className="object-contain mx-auto"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
