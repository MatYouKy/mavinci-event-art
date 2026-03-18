'use client';

import { useState, useEffect } from 'react';
import { X, Search, Package, Building2, Check } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import Image from 'next/image';

interface SelectRentalEquipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (
    subcontractorId: string,
    equipmentId: string,
    equipmentName: string,
    subcontractorName: string,
  ) => void;
  currentEquipmentName?: string;
  warehouseCategoryId?: string | null;
}

interface Subcontractor {
  id: string;
  company_name: string;
  alias: string | null;
}

interface RentalEquipment {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  daily_rental_price: number | null;
  quantity_available: number;
  thumbnail_url: string | null;
  specifications: any;
  subcontractor_id: string;
  subcontractor_name?: string;
  subcontractor_alias?: string;
}

export default function SelectRentalEquipmentModal({
  isOpen,
  onClose,
  onSelect,
  currentEquipmentName,
  warehouseCategoryId,
}: SelectRentalEquipmentModalProps) {
  const { showSnackbar } = useSnackbar();

  const [step, setStep] = useState<'equipment' | 'confirm'>('equipment');
  const [equipmentList, setEquipmentList] = useState<RentalEquipment[]>([]);
  const [selectedEquipment, setSelectedEquipment] = useState<RentalEquipment | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchRentalEquipment();
    }
  }, [isOpen, warehouseCategoryId]);

  const fetchRentalEquipment = async () => {
    try {
      setLoading(true);

      let query = supabase
        .from('subcontractor_rental_equipment')
        .select(
          `
          id,
          name,
          description,
          daily_rental_price,
          quantity_available,
          thumbnail_url,
          specifications,
          subcontractor_id,
          warehouse_category_id,
          warehouse_categories (
            name
          )
        `,
        )
        .eq('is_active', true);

      // Filtruj po kategorii jeśli jest podana
      if (warehouseCategoryId) {
        query = query.eq('warehouse_category_id', warehouseCategoryId);
      }

      const { data, error } = await query.order('name');

      if (error) throw error;

      // Pobierz unikalne subcontractor_id
      const subcontractorIds = Array.from(
        new Set(data?.map((item) => item.subcontractor_id) || []),
      );

      // Pobierz organizacje dla tych subcontractors
      const { data: organizations } = await supabase
        .from('organizations')
        .select('id, name, alias, subcontractor_id')
        .in('subcontractor_id', subcontractorIds)
        .not('subcontractor_id', 'is', null);

      // Stwórz mapę subcontractor_id -> organization
      const orgMap = new Map();
      organizations?.forEach((org) => {
        if (!orgMap.has(org.subcontractor_id)) {
          orgMap.set(org.subcontractor_id, org);
        }
      });

      // Przekształć dane
      const transformedData = (data || []).map((item: any) => {
        const org = orgMap.get(item.subcontractor_id);
        return {
          id: item.id,
          name: item.name,
          description: item.description,
          daily_rental_price: item.daily_rental_price,
          quantity_available: item.quantity_available,
          thumbnail_url: item.thumbnail_url,
          specifications: item.specifications,
          category: item.warehouse_categories?.name || null,
          subcontractor_id: item.subcontractor_id,
          subcontractor_name: org?.name || null,
          subcontractor_alias: org?.alias || null,
        };
      });

      setEquipmentList(transformedData);
    } catch (error: any) {
      console.error('Error fetching rental equipment:', error);
      showSnackbar('Błąd podczas ładowania sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectEquipment = (equipment: RentalEquipment) => {
    setSelectedEquipment(equipment);
    setStep('confirm');
  };

  const handleConfirm = () => {
    if (!selectedEquipment) return;

    onSelect(
      selectedEquipment.subcontractor_id,
      selectedEquipment.id,
      selectedEquipment.name,
      selectedEquipment.subcontractor_alias ||
        selectedEquipment.subcontractor_name ||
        'Podwykonawca',
    );
    handleClose();
  };

  const handleClose = () => {
    setStep('equipment');
    setSelectedEquipment(null);
    setEquipmentList([]);
    setSearchTerm('');
    onClose();
  };

  const handleBack = () => {
    setStep('equipment');
    setSelectedEquipment(null);
    setSearchTerm('');
  };

  const filteredEquipment = equipmentList.filter(
    (eq) =>
      eq.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      eq.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      eq.category?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-4xl rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6 shadow-xl">
        {/* Header */}
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-medium text-[#e5e4e2]">
              {step === 'equipment' ? 'Wybierz sprzęt do wypożyczenia' : 'Potwierdź wybór'}
            </h3>
            {currentEquipmentName && (
              <p className="text-sm text-[#e5e4e2]/50">
                Zamiennik dla:{' '}
                <span className="font-medium text-[#d3bb73]">{currentEquipmentName}</span>
              </p>
            )}
          </div>
          <button
            onClick={handleClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        {step === 'equipment' && (
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Szukaj sprzętu..."
                className="w-full rounded-lg border border-gray-700 bg-[#252837] py-2 pl-10 pr-4 text-white placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Content */}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
            </div>
          ) : step === 'equipment' ? (
            // Lista sprzętu
            filteredEquipment.length === 0 ? (
              <div className="py-12 text-center">
                <Package className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/30" />
                <p className="text-[#e5e4e2]/60">
                  {searchTerm
                    ? 'Nie znaleziono sprzętu'
                    : warehouseCategoryId
                      ? 'Brak sprzętu w tej kategorii'
                      : 'Brak sprzętu do wypożyczenia'}
                </p>
              </div>
            ) : (
              filteredEquipment.map((eq) => (
                <button
                  key={eq.id}
                  onClick={() => handleSelectEquipment(eq)}
                  className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-all hover:border-[#d3bb73]/30 hover:bg-[#0f1119]/80"
                >
                  <div className="flex items-center gap-3">
                    {eq.thumbnail_url ? (
                      <Image
                        src={eq.thumbnail_url}
                        alt={eq.name}
                        width={48}
                        height={48}
                        className="h-12 w-12 rounded-lg border border-[#d3bb73]/20 object-cover"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
                        <Package className="h-6 w-6 text-[#e5e4e2]/30" />
                      </div>
                    )}
                    <div className="flex-1 text-left">
                      <div className="font-medium text-[#e5e4e2]">{eq.name}</div>
                      {eq.description && (
                        <div className="line-clamp-1 text-xs text-[#e5e4e2]/50">
                          {eq.description}
                        </div>
                      )}
                      <div className="mt-1 flex items-center gap-2 text-xs text-[#e5e4e2]/50">
                        {eq.category && (
                          <span className="rounded bg-[#d3bb73]/10 px-2 py-0.5 text-[#d3bb73]">
                            {eq.category}
                          </span>
                        )}
                        {eq.subcontractor_alias || eq.subcontractor_name ? (
                          <span className="flex items-center gap-1">
                            <Building2 className="h-3 w-3" />
                            {eq.subcontractor_alias || eq.subcontractor_name}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    {eq.daily_rental_price && (
                      <div className="mb-1 text-sm font-medium text-green-400">
                        {eq.daily_rental_price} zł/dzień
                      </div>
                    )}
                    <div className="text-xs text-[#e5e4e2]/50">
                      Dostępne: {eq.quantity_available}
                    </div>
                  </div>
                </button>
              ))
            )
          ) : (
            // Ekran potwierdzenia
            selectedEquipment && (
              <div className="space-y-4">
                <div className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6">
                  <div className="mb-4 flex items-center gap-4">
                    {selectedEquipment.thumbnail_url ? (
                      <Image
                        src={selectedEquipment.thumbnail_url}
                        alt={selectedEquipment.name}
                        width={96}
                        height={96}
                        className="h-24 w-24 rounded-lg border border-[#d3bb73]/20 object-cover"
                      />
                    ) : (
                      <div className="flex h-24 w-24 items-center justify-center rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
                        <Package className="h-12 w-12 text-[#e5e4e2]/30" />
                      </div>
                    )}
                    <div className="flex-1">
                      <h4 className="mb-1 text-xl font-medium text-[#e5e4e2]">
                        {selectedEquipment.name}
                      </h4>
                      {selectedEquipment.description && (
                        <p className="text-sm text-[#e5e4e2]/60">{selectedEquipment.description}</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 border-t border-[#d3bb73]/10 pt-4">
                    <div>
                      <div className="mb-1 text-xs text-[#e5e4e2]/50">Podwykonawca</div>
                      <div className="font-medium text-[#e5e4e2]">
                        {selectedEquipment.subcontractor_alias ||
                          selectedEquipment.subcontractor_name ||
                          'Nieznany'}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-xs text-[#e5e4e2]/50">Kategoria</div>
                      <div className="font-medium text-[#e5e4e2]">
                        {selectedEquipment.category || 'Brak'}
                      </div>
                    </div>
                    {selectedEquipment.daily_rental_price && (
                      <div>
                        <div className="mb-1 text-xs text-[#e5e4e2]/50">Cena wypożyczenia</div>
                        <div className="font-medium text-green-400">
                          {selectedEquipment.daily_rental_price} zł/dzień
                        </div>
                      </div>
                    )}
                    <div>
                      <div className="mb-1 text-xs text-[#e5e4e2]/50">Dostępność</div>
                      <div className="font-medium text-[#e5e4e2]">
                        {selectedEquipment.quantity_available} szt.
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={handleBack}
                    className="flex-1 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-[#e5e4e2] transition-colors hover:border-[#d3bb73]/40"
                  >
                    Anuluj
                  </button>
                  <button
                    onClick={handleConfirm}
                    className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#c4a859]"
                  >
                    Potwierdź wybór
                  </button>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
