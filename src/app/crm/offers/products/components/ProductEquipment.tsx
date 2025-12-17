import type { EquipmentItemRow, EquipmentKitRow } from '@/app/crm/equipment/types/equipment.types';
import { Loader2, Package, Wrench } from 'lucide-react';
import React, { FC } from 'react';
import { ProductEquipmentViewRow, useManageProduct } from '../hooks/useManageProduct';
import { useParams } from 'next/navigation';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { div } from 'framer-motion/client';
import { ProductEquipmentRow } from './ProductEquipmentRow';

interface IProductEquipment {
  canEdit: boolean;
  setShowAddEquipmentModal: (show: boolean) => void;
}

export const ProductEquipment: FC<IProductEquipment> = ({
  canEdit,
  setShowAddEquipmentModal, 
}) => {
  const { showSnackbar } = useSnackbar();
  const params = useParams().id as string;
  const { items, isLoading, isFetching, remove, update, updatingId } = useManageProduct({
    productId: params as string,
  });

  const handleUpdateEquipmentQuantity = async (equipmentId: string, quantity: number) => {
    if (quantity < 1) return;

    try {
      update({ id: equipmentId, next: { quantity } });
    } catch (error) {
      console.error('Error updating quantity:', error);
      showSnackbar('Błąd podczas aktualizacji ilości', 'error');
    }
  };

  const handleDeleteEquipment = async (equipmentId: string) => {
    try {
      remove(equipmentId, params as string);

      showSnackbar('Sprzęt usunięty', 'success');
    } catch (error) {
      console.error('Error deleting equipment:', error);
      showSnackbar('Błąd podczas usuwania sprzętu', 'error');
    }
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-[#d3bb73]" />
          <h2 className="text-lg font-medium text-[#e5e4e2]">Wymagany sprzęt</h2>
        </div>
        {canEdit && (
          <button
            onClick={() => setShowAddEquipmentModal(true)}
            className="rounded-lg bg-[#d3bb73]/20 px-3 py-1 text-sm text-[#d3bb73] hover:bg-[#d3bb73]/30"
          >
            + Dodaj sprzęt / pakiet
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => {
            const isRowUpdating = updatingId === item.id;

            {isRowUpdating ? (
              <Loader2 className="h-4 w-4 text-[#d3bb73] animate-spin" />
            ) : (
              <input
                type="number"
                value={item.quantity}
                onChange={(e) => handleUpdateEquipmentQuantity(item.id, parseInt(e.target.value) || 1)}
                min="1"
                className="w-20 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
              />
            )}
            return (
              <ProductEquipmentRow
                item={item} 
                canEdit={canEdit} 
                updatingId={updatingId} 
                handleUpdateEquipmentQuantity={handleUpdateEquipmentQuantity} 
                handleDeleteEquipment={handleDeleteEquipment}
              />
          );
          })}
        </div>
      )}
    </div>
  );
};


