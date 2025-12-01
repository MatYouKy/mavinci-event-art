'use client';

import { useState, useEffect } from 'react';
import { FileText, Download, Edit, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Props {
  eventId: string;
}

interface ContractData {
  client_name: string;
  client_nip: string;
  client_address: string;
  client_city: string;
  client_postal_code: string;
  executor_name: string;
  executor_nip: string;
  executor_address: string;
  executor_city: string;
  executor_postal_code: string;
  event_name: string;
  event_date: string;
  event_location: string;
  scope_from_offer: string;
  budget_amount: number;
  contract_number: string;
}

export function EventContractTab({ eventId }: Props) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [contractData, setContractData] = useState<ContractData | null>(null);
  const [editedData, setEditedData] = useState<Partial<ContractData>>({});

  useEffect(() => {
    fetchContractData();
  }, [eventId]);

  const fetchContractData = async () => {
    try {
      setLoading(true);

      const { data: event, error: eventError } = await supabase
        .from('events')
        .select(`
          id,
          name,
          event_date,
          budget,
          organization_id,
          location_id,
          locations:location_id(name, formatted_address),
          organizations:organization_id(
            name,
            nip,
            address,
            city,
            postal_code
          )
        `)
        .eq('id', eventId)
        .single();

      if (eventError) throw eventError;

      const { data: offers } = await supabase
        .from('offers')
        .select('description, total_price')
        .eq('event_id', eventId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const contractNumber = `UMW/${new Date().getFullYear()}/${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

      const contract: ContractData = {
        client_name: event.organizations?.name || '',
        client_nip: event.organizations?.nip || '',
        client_address: event.organizations?.address || '',
        client_city: event.organizations?.city || '',
        client_postal_code: event.organizations?.postal_code || '',
        executor_name: 'MAVINCI Mateusz Kwiatkowski',
        executor_nip: '5242932863',
        executor_address: 'ul. Przykładowa 1',
        executor_city: 'Warszawa',
        executor_postal_code: '00-001',
        event_name: event.name || '',
        event_date: event.event_date || '',
        event_location: event.locations?.name || event.locations?.formatted_address || '',
        scope_from_offer: offers?.description || '',
        budget_amount: event.budget || offers?.total_price || 0,
        contract_number: contractNumber,
      };

      setContractData(contract);
      setEditedData(contract);
    } catch (err) {
      console.error('Error fetching contract data:', err);
      showSnackbar('Błąd podczas ładowania danych umowy', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = () => {
    setContractData({ ...contractData, ...editedData } as ContractData);
    setEditMode(false);
    showSnackbar('Dane umowy zostały zaktualizowane', 'success');
  };

  const handleCancel = () => {
    setEditedData(contractData || {});
    setEditMode(false);
  };

  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
        <div className="text-center text-[#e5e4e2]/60">Ładowanie danych umowy...</div>
      </div>
    );
  }

  if (!contractData) {
    return (
      <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-8">
        <div className="text-center text-[#e5e4e2]/60">Brak danych do wygenerowania umowy</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6">
        <div>
          <h2 className="text-2xl font-light text-[#e5e4e2] mb-1">Umowa na realizację wydarzenia</h2>
          <p className="text-sm text-[#e5e4e2]/60">
            Szablon umowy z danymi klienta i wykonawcy
          </p>
        </div>
        <div className="flex items-center gap-3">
          {editMode ? (
            <>
              <button
                onClick={handleCancel}
                className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                <X className="w-4 h-4" />
                Anuluj
              </button>
              <button
                onClick={handleSave}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Save className="w-4 h-4" />
                Zapisz
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setEditMode(true)}
                className="flex items-center gap-2 px-4 py-2 bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] hover:bg-[#d3bb73]/5"
              >
                <Edit className="w-4 h-4" />
                Edytuj
              </button>
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Download className="w-4 h-4" />
                Pobierz PDF
              </button>
            </>
          )}
        </div>
      </div>

      <div className="contract-preview bg-white text-black rounded-xl p-12 mx-auto" style={{ maxWidth: '210mm' }}>
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold mb-2">UMOWA NR {contractData.contract_number}</h1>
          <p className="text-sm text-gray-600">na realizację wydarzenia</p>
        </div>

        <div className="mb-8 text-sm">
          <p className="mb-1">
            Zawarta w dniu {new Date().toLocaleDateString('pl-PL')} pomiędzy:
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-8">
          <div>
            <h3 className="font-bold mb-3">ZAMAWIAJĄCY:</h3>
            <div className="text-sm space-y-1">
              {editMode ? (
                <>
                  <input
                    type="text"
                    value={editedData.client_name || ''}
                    onChange={(e) => setEditedData({ ...editedData, client_name: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 mb-1"
                    placeholder="Nazwa klienta"
                  />
                  <input
                    type="text"
                    value={editedData.client_nip || ''}
                    onChange={(e) => setEditedData({ ...editedData, client_nip: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 mb-1"
                    placeholder="NIP"
                  />
                  <input
                    type="text"
                    value={editedData.client_address || ''}
                    onChange={(e) => setEditedData({ ...editedData, client_address: e.target.value })}
                    className="w-full border border-gray-300 rounded px-2 py-1 mb-1"
                    placeholder="Adres"
                  />
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={editedData.client_postal_code || ''}
                      onChange={(e) => setEditedData({ ...editedData, client_postal_code: e.target.value })}
                      className="w-24 border border-gray-300 rounded px-2 py-1"
                      placeholder="Kod"
                    />
                    <input
                      type="text"
                      value={editedData.client_city || ''}
                      onChange={(e) => setEditedData({ ...editedData, client_city: e.target.value })}
                      className="flex-1 border border-gray-300 rounded px-2 py-1"
                      placeholder="Miasto"
                    />
                  </div>
                </>
              ) : (
                <>
                  <p className="font-medium">{contractData.client_name}</p>
                  {contractData.client_nip && <p>NIP: {contractData.client_nip}</p>}
                  {contractData.client_address && <p>{contractData.client_address}</p>}
                  {(contractData.client_postal_code || contractData.client_city) && (
                    <p>
                      {contractData.client_postal_code} {contractData.client_city}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          <div>
            <h3 className="font-bold mb-3">WYKONAWCA:</h3>
            <div className="text-sm space-y-1">
              <p className="font-medium">{contractData.executor_name}</p>
              <p>NIP: {contractData.executor_nip}</p>
              <p>{contractData.executor_address}</p>
              <p>
                {contractData.executor_postal_code} {contractData.executor_city}
              </p>
            </div>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-bold mb-3">§ 1. PRZEDMIOT UMOWY</h3>
          <div className="text-sm space-y-2">
            <p>
              1. Przedmiotem umowy jest realizacja wydarzenia pod nazwą:{' '}
              <span className="font-medium">{contractData.event_name}</span>
            </p>
            <p>
              2. Data wydarzenia: <span className="font-medium">{new Date(contractData.event_date).toLocaleDateString('pl-PL')}</span>
            </p>
            <p>
              3. Miejsce wydarzenia: <span className="font-medium">{contractData.event_location}</span>
            </p>
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-bold mb-3">§ 2. ZAKRES USŁUG</h3>
          <div className="text-sm">
            {editMode ? (
              <textarea
                value={editedData.scope_from_offer || ''}
                onChange={(e) => setEditedData({ ...editedData, scope_from_offer: e.target.value })}
                rows={6}
                className="w-full border border-gray-300 rounded px-3 py-2"
                placeholder="Zakres usług z oferty..."
              />
            ) : (
              <p className="whitespace-pre-wrap">{contractData.scope_from_offer || 'Zakres usług zgodnie z ofertą'}</p>
            )}
          </div>
        </div>

        <div className="mb-6">
          <h3 className="font-bold mb-3">§ 3. WYNAGRODZENIE</h3>
          <div className="text-sm space-y-2">
            <p>
              1. Za wykonanie przedmiotu umowy Zamawiający zobowiązuje się zapłacić Wykonawcy wynagrodzenie w wysokości:{' '}
              {editMode ? (
                <input
                  type="number"
                  value={editedData.budget_amount || 0}
                  onChange={(e) => setEditedData({ ...editedData, budget_amount: parseFloat(e.target.value) })}
                  className="w-32 border border-gray-300 rounded px-2 py-1 inline-block"
                />
              ) : (
                <span className="font-medium">{contractData.budget_amount.toFixed(2)} PLN brutto</span>
              )}
            </p>
            <p>2. Płatność nastąpi przelewem na podstawie faktury VAT w terminie 14 dni od daty wystawienia.</p>
          </div>
        </div>

        <div className="mb-8">
          <h3 className="font-bold mb-3">§ 4. POSTANOWIENIA KOŃCOWE</h3>
          <div className="text-sm space-y-2">
            <p>1. Umowa została sporządzona w dwóch jednobrzmiących egzemplarzach, po jednym dla każdej ze stron.</p>
            <p>2. W sprawach nieuregulowanych niniejszą umową mają zastosowanie przepisy Kodeksu cywilnego.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mt-12">
          <div className="text-center">
            <div className="border-t border-black pt-2 mt-16">
              <p className="text-sm font-medium">Podpis Zamawiającego</p>
            </div>
          </div>
          <div className="text-center">
            <div className="border-t border-black pt-2 mt-16">
              <p className="text-sm font-medium">Podpis Wykonawcy</p>
            </div>
          </div>
        </div>
      </div>

      <style jsx global>{`
        @media print {
          body * {
            visibility: hidden;
          }

          .contract-preview, .contract-preview * {
            visibility: visible;
          }

          .contract-preview {
            position: absolute;
            left: 0;
            top: 0;
            width: 210mm;
            min-height: 297mm;
            margin: 0;
            padding: 20mm;
            background: white;
            box-shadow: none;
            border-radius: 0;
          }

          @page {
            size: A4;
            margin: 0;
          }
        }
      `}</style>
    </div>
  );
}
