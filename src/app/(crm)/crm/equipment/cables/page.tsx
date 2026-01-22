'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Search, Cable, ArrowLeft, Edit, Trash2 } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import { useGetCablesListQuery, useDeleteCableMutation } from '../store/equipmentApi';

interface CableItem {
  id: string;
  name: string;
  length_meters: number | null;
  connector_in_type: { id: string; name: string; thumbnail_url: string | null } | null;
  connector_out_type: { id: string; name: string; thumbnail_url: string | null } | null;
  stock_quantity: number;
  thumbnail_url: string | null;
  warehouse_categories: { id: string; name: string } | null;
  storage_location: { id: string; name: string } | null;
}

export default function CablesListPage() {
  const router = useRouter();
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const { canCreateInModule, canManageModule } = useCurrentEmployee();

  const [searchTerm, setSearchTerm] = useState('');

  const { data: cables = [], isLoading, refetch } = useGetCablesListQuery();
  const [deleteCable] = useDeleteCableMutation();

  const filteredCables = cables.filter((cable: CableItem) =>
    cable.name?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleDelete = async (id: string, name: string) => {
    const confirmed = await showConfirm(
      'Usuń przewód',
      `Czy na pewno chcesz usunąć przewód "${name}"?`
    );
    if (!confirmed) return;

    try {
      await deleteCable(id).unwrap();
      showSnackbar('Przewód usunięty', 'success');
      refetch();
    } catch (e) {
      showSnackbar('Błąd podczas usuwania', 'error');
    }
  };

  return (
    <div className="min-h-screen bg-[#0f1117] text-[#e5e4e2] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/crm/equipment')}
              className="p-2 hover:bg-[#1c1f33] rounded-lg"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Cable className="w-6 h-6" />
              Przewody
            </h1>
          </div>

          {canCreateInModule('equipment') && (
            <button
              onClick={() => router.push('/crm/equipment/cables/new')}
              className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
            >
              <Plus className="w-4 h-4" />
              Dodaj przewód
            </button>
          )}
        </div>

        {/* Search */}
        <div className="mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#8a8988]" />
            <input
              type="text"
              placeholder="Szukaj przewodów..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg pl-10 pr-4 py-2 text-[#e5e4e2] placeholder-[#8a8988] focus:outline-none focus:border-[#d3bb73]"
            />
          </div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="text-center py-12 text-[#8a8988]">Ładowanie...</div>
        )}

        {/* Empty */}
        {!isLoading && filteredCables.length === 0 && (
          <div className="text-center py-12">
            <Cable className="w-16 h-16 mx-auto mb-4 text-[#8a8988]" />
            <p className="text-[#8a8988] mb-4">Brak przewodów</p>
            {canCreateInModule('equipment') && (
              <button
                onClick={() => router.push('/crm/equipment/cables/new')}
                className="inline-flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg hover:bg-[#d3bb73]/90"
              >
                <Plus className="w-4 h-4" />
                Dodaj pierwszy przewód
              </button>
            )}
          </div>
        )}

        {/* List */}
        {!isLoading && filteredCables.length > 0 && (
          <div className="grid gap-4">
            {filteredCables.map((cable: CableItem) => (
              <div
                key={cable.id}
                className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg p-4 hover:border-[#d3bb73]/40 transition-colors"
              >
                <div className="flex items-center gap-4">
                  {/* Thumbnail */}
                  <div className="w-16 h-16 bg-[#0f1117] rounded-lg flex items-center justify-center overflow-hidden flex-shrink-0">
                    {cable.thumbnail_url ? (
                      <img
                        src={cable.thumbnail_url}
                        alt={cable.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <Cable className="w-8 h-8 text-[#8a8988]" />
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-lg mb-1">{cable.name}</h3>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-[#8a8988]">
                      {cable.length_meters && (
                        <span>Długość: {cable.length_meters}m</span>
                      )}
                      {cable.connector_in_type && (
                        <span>Wejście: {cable.connector_in_type.name}</span>
                      )}
                      {cable.connector_out_type && (
                        <span>Wyjście: {cable.connector_out_type.name}</span>
                      )}
                      <span className="text-[#d3bb73]">
                        Ilość: {cable.stock_quantity || 0}
                      </span>
                    </div>
                    {cable.warehouse_categories && (
                      <div className="text-xs text-[#8a8988] mt-1">
                        Kategoria: {cable.warehouse_categories.name}
                      </div>
                    )}
                    {cable.storage_location && (
                      <div className="text-xs text-[#8a8988] mt-1">
                        Lokalizacja: {cable.storage_location.name}
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => router.push(`/crm/equipment/cables/${cable.id}`)}
                      className="p-2 hover:bg-[#0f1117] rounded-lg transition-colors"
                      title="Edytuj"
                    >
                      <Edit className="w-4 h-4" />
                    </button>
                    {canManageModule('equipment') && (
                      <button
                        onClick={() => handleDelete(cable.id, cable.name)}
                        className="p-2 hover:bg-red-500/10 text-red-400 rounded-lg transition-colors"
                        title="Usuń"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
