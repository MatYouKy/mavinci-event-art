'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase/browser';
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
        .select(
          `
          *,
          client:clients!client_id(company_name, first_name, last_name),
          event:events!event_id(name, event_date),
          template:contract_templates!template_id(*)
        `,
        )
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

      const { error } = await supabase.from('contracts').update(updates).eq('id', contractId);

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
      <div className="flex items-center justify-center p-8">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
      </div>
    );
  }

  if (!contract) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-[#e5e4e2]/60">Nie znaleziono umowy</div>
      </div>
    );
  }

  const clientName =
    contract.client?.company_name || `${contract.client?.first_name} ${contract.client?.last_name}`;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button
            onClick={() => router.push(`/crm/contracts/${contractId}`)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ArrowLeft className="h-6 w-6" />
          </button>
          <div>
            <h1 className="text-2xl font-light text-[#e5e4e2]">Edycja umowy</h1>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">
              {contract.contract_number} - {clientName}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPreview(!showPreview)}
            className="flex items-center gap-2 rounded-lg bg-[#1c1f33] px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#1c1f33]/80"
          >
            <Eye className="h-5 w-5" />
            {showPreview ? 'Edycja' : 'Podgląd'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-2 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            <Save className="h-5 w-5" />
            {saving ? 'Zapisywanie...' : 'Zapisz'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Treść umowy</label>

            {showPreview ? (
              <div className="min-h-[600px] rounded-lg bg-white p-12 text-black">
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
                      className="mx-auto object-contain"
                    />
                  </div>
                )}

                <div
                  className="whitespace-pre-wrap font-mono text-sm"
                  style={{ whiteSpace: 'pre-wrap' }}
                >
                  {formData.content || 'Brak treści'}
                </div>
              </div>
            ) : (
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                className="w-full resize-none rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 font-mono text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                rows={25}
                placeholder="Treść umowy..."
              />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
            <h2 className="mb-4 text-lg font-light text-[#e5e4e2]">Informacje</h2>

            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Klient</label>
                <div className="text-[#e5e4e2]">{clientName}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Event</label>
                <div className="text-[#e5e4e2]">{contract.event?.name || 'Brak'}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Numer umowy</label>
                <div className="text-[#e5e4e2]">{contract.contract_number}</div>
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Wartość (PLN)</label>
                <input
                  type="number"
                  value={formData.total_amount}
                  onChange={(e) => setFormData({ ...formData, total_amount: e.target.value })}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  placeholder="0.00"
                  step="0.01"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm text-[#e5e4e2]/60">Status</label>
                <div className="capitalize text-[#e5e4e2]">
                  {contract.status === 'draft' && 'Szkic'}
                  {contract.status === 'sent' && 'Wysłana'}
                  {contract.status === 'signed' && 'Podpisana'}
                  {contract.status === 'cancelled' && 'Anulowana'}
                </div>
              </div>
            </div>
          </div>

          {logoSettings.show_header_logo && logoSettings.header_logo_url && (
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Logo nagłówka</h3>
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3">
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
            <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
              <h3 className="mb-3 text-sm font-medium text-[#e5e4e2]">Logo centralne</h3>
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-3 text-center">
                <img
                  src={logoSettings.center_logo_url}
                  alt="Logo centralne"
                  style={{ height: `${logoSettings.center_logo_height}px` }}
                  className="mx-auto object-contain"
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
