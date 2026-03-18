'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PackageOpen, Search, Building2, DollarSign, Package, Eye, Trash2 } from 'lucide-react';

import { useGetAllRentalEquipmentQuery, useDeleteRentalEquipmentMutation } from '../../subcontractors/api/rentalApi';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

export default function RentalEquipmentListPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { employee, loading: employeeLoading } = useCurrentEmployee();

  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const {
    data: rentalEquipment = [],
    isLoading: equipmentLoading,
    isError: equipmentError,
    refetch,
  } = useGetAllRentalEquipmentQuery(undefined, {
    refetchOnMountOrArgChange: true,
  });

  const [deleteEquipmentMutation] = useDeleteRentalEquipmentMutation();

  const canView = employee?.permissions?.includes('equipment_view');
  const canManage = employee?.permissions?.includes('equipment_manage');

  const filteredEquipment = rentalEquipment.filter((item) => {
    const categoryName = item.warehouse_categories?.name || item.category;

    const matchesSearch =
      !searchTerm ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.subcontractor?.company_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      categoryName?.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesCategory = categoryFilter === 'all' || categoryName === categoryFilter;

    return matchesSearch && matchesCategory && item.is_active;
  });

  const uniqueCategories = Array.from(
    new Set(
      rentalEquipment
        .map((item) => item.warehouse_categories?.name || item.category)
        .filter(Boolean)
    ),
  );

  const handleDelete = async (e: React.MouseEvent, item: any) => {
    e.stopPropagation();

    if (!confirm(`Czy na pewno chcesz usunąć "${item.name}"? Ta operacja jest nieodwracalna.`)) {
      return;
    }

    try {
      await deleteEquipmentMutation(item.id).unwrap();
      showSnackbar('Sprzęt został usunięty', 'success');
      refetch();
    } catch (err: any) {
      showSnackbar(err?.message || 'Błąd podczas usuwania', 'error');
    }
  };

  if (employeeLoading || equipmentLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-[#e5e4e2]">Ładowanie...</div>
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="py-12 text-center">
        <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
        <p className="text-[#e5e4e2]/60">Brak uprawnień do przeglądania sprzętu</p>
      </div>
    );
  }

  if (equipmentError) {
    return (
      <div className="py-12 text-center">
        <Package className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
        <p className="text-[#e5e4e2]/60">Błąd podczas ładowania sprzętu</p>
        <button onClick={() => refetch()} className="mt-4 text-[#d3bb73] hover:underline">
          Spróbuj ponownie
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0d1a] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center gap-3">
          <PackageOpen className="h-8 w-8 text-[#d3bb73]" />
          <div>
            <h1 className="text-2xl font-semibold text-[#e5e4e2]">Sprzęt wynajmu</h1>
            <p className="text-sm text-[#e5e4e2]/60">
              Sprzęt dostępny od podwykonawców ({filteredEquipment.length})
            </p>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap gap-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
            <input
              type="text"
              placeholder="Szukaj po nazwie, podwykonawcy lub kategorii..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-2 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
          >
            <option value="all">Wszystkie kategorie</option>
            {uniqueCategories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>

        {filteredEquipment.length === 0 ? (
          <div className="py-12 text-center">
            <PackageOpen className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/10" />
            <p className="text-[#e5e4e2]/40">
              {searchTerm || categoryFilter !== 'all'
                ? 'Nie znaleziono sprzętu spełniającego kryteria'
                : 'Brak dostępnego sprzętu wynajmu'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredEquipment.map((item) => (
              <div
                key={item.id}
                className="group cursor-pointer rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] p-6 transition-all hover:border-[#d3bb73]/40 hover:shadow-lg"
                onClick={() => router.push(`/crm/subcontractors/rental/${item.id}`)}
              >
                {item.thumbnail_url ? (
                  <div className="mb-4 aspect-video overflow-hidden rounded-lg">
                    <img
                      src={item.thumbnail_url}
                      alt={item.name}
                      className="h-full w-full object-cover transition-transform group-hover:scale-110"
                    />
                  </div>
                ) : (
                  <div className="mb-4 flex aspect-video items-center justify-center rounded-lg bg-[#d3bb73]/10">
                    <PackageOpen className="h-16 w-16 text-[#d3bb73]/40" />
                  </div>
                )}

                <h3 className="mb-2 text-lg font-semibold text-[#e5e4e2] group-hover:text-[#d3bb73]">
                  {item.name}
                </h3>

                {item.description && (
                  <p className="mb-3 line-clamp-2 text-sm text-[#e5e4e2]/60">{item.description}</p>
                )}

                <div className="mb-3 flex items-center gap-2 text-sm text-[#e5e4e2]/60">
                  <Building2 className="h-4 w-4" />
                  <span>{item.subcontractor?.company_name || 'Nieznany podwykonawca'}</span>
                </div>

                {(item.warehouse_categories?.name || item.category) && (
                  <div className="mb-3">
                    <span className="inline-block rounded-full bg-[#d3bb73]/10 px-3 py-1 text-xs text-[#d3bb73]">
                      {item.warehouse_categories?.name || item.category}
                    </span>
                  </div>
                )}

                <div className="flex items-center justify-between border-t border-[#d3bb73]/10 pt-3">
                  <div className="flex items-center gap-1 text-sm">
                    <DollarSign className="h-4 w-4 text-[#d3bb73]" />
                    <span className="text-[#e5e4e2]">
                      {item.daily_rental_price
                        ? `${item.daily_rental_price.toLocaleString('pl-PL')} zł/dzień`
                        : 'Cena do ustalenia'}
                    </span>
                  </div>

                  <div className="flex items-center gap-1 text-sm text-[#e5e4e2]/60">
                    <Package className="h-4 w-4" />
                    <span>{item.quantity_available || 0} szt.</span>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <button className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73]/10 px-4 py-2 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/20">
                    <Eye className="h-4 w-4" />
                    Zobacz szczegóły
                  </button>
                  {canManage && (
                    <button
                      onClick={(e) => handleDelete(e, item)}
                      className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-900/20 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-900/30"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
