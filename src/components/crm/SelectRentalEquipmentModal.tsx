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
}

export default function SelectRentalEquipmentModal({
  isOpen,
  onClose,
  onSelect,
  currentEquipmentName,
}: SelectRentalEquipmentModalProps) {
  const { showSnackbar } = useSnackbar();

  const [step, setStep] = useState<'subcontractor' | 'equipment'>('subcontractor');
  const [subcontractors, setSubcontractors] = useState<Subcontractor[]>([]);
  const [selectedSubcontractor, setSelectedSubcontractor] = useState<Subcontractor | null>(null);
  const [equipmentList, setEquipmentList] = useState<RentalEquipment[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchSubcontractors();
    }
  }, [isOpen]);

  const fetchSubcontractors = async () => {
    try {
      setLoading(true);
      // Pobierz podwykonawców którzy mają usługę rental
      const { data: services, error: servicesError } = await supabase
        .from('subcontractor_services')
        .select('subcontractor_id')
        .eq('service_type', 'rental')
        .eq('is_active', true);

      if (servicesError) throw servicesError;

      if (!services || services.length === 0) {
        setSubcontractors([]);
        return;
      }

      const subcontractorIds = services.map((s) => s.subcontractor_id);

      // Pobierz organizacje powiązane z podwykonawcami
      const { data: organizations, error: orgError } = await supabase
        .from('organizations')
        .select('id, name, alias, subcontractor_id')
        .in('subcontractor_id', subcontractorIds)
        .not('subcontractor_id', 'is', null);

      if (orgError) throw orgError;

      // Zmapuj na format z company_name
      const mappedSubcontractors =
        organizations?.map((org) => ({
          id: org.subcontractor_id,
          company_name: org.name,
          alias: org.alias,
        })) || [];

      setSubcontractors(mappedSubcontractors);
    } catch (error: any) {
      console.error('Error fetching subcontractors:', error);
      showSnackbar('Błąd podczas ładowania podwykonawców', 'error');
    } finally {
      setLoading(false);
    }
  };

  const fetchEquipment = async (subcontractorId: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
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
          warehouse_categories (
            name
          )
        `,
        )
        .eq('subcontractor_id', subcontractorId)
        .eq('is_active', true)
        .order('name');

      if (error) throw error;

      // Przekształć dane aby dodać category z warehouse_categories
      const transformedData = (data || []).map((item: any) => ({
        ...item,
        category: item.warehouse_categories?.name || null,
      }));

      setEquipmentList(transformedData);
    } catch (error: any) {
      console.error('Error fetching equipment:', error);
      showSnackbar('Błąd podczas ładowania sprzętu', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSubcontractor = async (subcontractor: Subcontractor) => {
    setSelectedSubcontractor(subcontractor);
    setStep('equipment');
    await fetchEquipment(subcontractor.id);
  };

  const handleSelectEquipment = (equipment: RentalEquipment) => {
    if (!selectedSubcontractor) return;

    onSelect(
      selectedSubcontractor.id,
      equipment.id,
      equipment.name,
      selectedSubcontractor.alias || selectedSubcontractor.company_name,
    );
    handleClose();
  };

  const handleClose = () => {
    setStep('subcontractor');
    setSelectedSubcontractor(null);
    setEquipmentList([]);
    setSearchTerm('');
    onClose();
  };

  const handleBack = () => {
    setStep('subcontractor');
    setSelectedSubcontractor(null);
    setEquipmentList([]);
    setSearchTerm('');
  };

  const filteredSubcontractors = subcontractors.filter((sub) =>
    (sub.alias || sub.company_name).toLowerCase().includes(searchTerm.toLowerCase()),
  );

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
              {step === 'subcontractor' ? 'Wybierz podwykonawcę' : 'Wybierz sprzęt'}
            </h3>
            {currentEquipmentName && (
              <p className="text-sm text-[#e5e4e2]/50">
                Zamiennik dla:{' '}
                <span className="font-medium text-[#d3bb73]">{currentEquipmentName}</span>
              </p>
            )}
            {step === 'equipment' && selectedSubcontractor && (
              <p className="text-sm text-[#e5e4e2]/50">
                Podwykonawca:{' '}
                <span className="font-medium text-[#d3bb73]">
                  {selectedSubcontractor.alias || selectedSubcontractor.company_name}
                </span>
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

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder={
                step === 'subcontractor' ? 'Szukaj podwykonawcy...' : 'Szukaj sprzętu...'
              }
              className="w-full rounded-lg border border-gray-700 bg-[#252837] py-2 pl-10 pr-4 text-white placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
            />
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[60vh] space-y-2 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-[#d3bb73]"></div>
            </div>
          ) : step === 'subcontractor' ? (
            // Lista podwykonawców
            filteredSubcontractors.length === 0 ? (
              <div className="py-12 text-center">
                <Building2 className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/30" />
                <p className="text-[#e5e4e2]/60">
                  {searchTerm
                    ? 'Nie znaleziono podwykonawców'
                    : 'Brak podwykonawców z usługą rental'}
                </p>
              </div>
            ) : (
              filteredSubcontractors.map((sub) => (
                <button
                  key={sub.id}
                  onClick={() => handleSelectSubcontractor(sub)}
                  className="flex w-full items-center justify-between rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-4 transition-all hover:border-[#d3bb73]/30 hover:bg-[#0f1119]/80"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]">
                      <Building2 className="h-6 w-6 text-[#d3bb73]" />
                    </div>
                    <div className="text-left">
                      <div className="font-medium text-[#e5e4e2]">
                        {sub.alias || sub.company_name}
                      </div>
                      {sub.alias && (
                        <div className="text-xs text-[#e5e4e2]/50">{sub.company_name}</div>
                      )}
                    </div>
                  </div>
                  <div className="text-[#d3bb73]">→</div>
                </button>
              ))
            )
          ) : (
            // Lista sprzętu
            <>
              <button
                onClick={handleBack}
                className="mb-2 text-sm text-[#d3bb73] hover:text-[#c4a859]"
              >
                ← Powrót do wyboru podwykonawcy
              </button>
              {filteredEquipment.length === 0 ? (
                <div className="py-12 text-center">
                  <Package className="mx-auto mb-3 h-12 w-12 text-[#e5e4e2]/30" />
                  <p className="text-[#e5e4e2]/60">
                    {searchTerm ? 'Nie znaleziono sprzętu' : 'Brak sprzętu w katalogu'}
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
                          {eq.daily_rental_price && (
                            <span className="text-green-400">{eq.daily_rental_price} zł/dzień</span>
                          )}
                          <span>Dostępne: {eq.quantity_available}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg bg-[#d3bb73] p-2">
                      <Check className="h-5 w-5 text-[#1c1f33]" />
                    </div>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
