import type {
  EquipmentItemRow,
  EquipmentKitRow,
} from '@/app/(crm)/crm/equipment/types/equipment.types';
import { Loader2, Package, Wrench, ChevronDown, ChevronRight } from 'lucide-react';
import React, { FC, useMemo, useState } from 'react';
import { ProductEquipmentViewRow, useManageProduct } from '../hooks/useManageProduct';
import { useParams } from 'next/navigation';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { ProductEquipmentRow } from './ProductEquipmentRow';

interface IProductEquipment {
  canEdit: boolean;
  setShowAddEquipmentModal: (show: boolean) => void;
}

type GroupedEquipment = {
  categoryId: string | null;
  categoryName: string;
  items: ProductEquipmentViewRow[];
  isRequired: boolean;
};

export const ProductEquipment: FC<IProductEquipment> = ({ canEdit, setShowAddEquipmentModal }) => {
  const { showSnackbar } = useSnackbar();
  const params = useParams().id as string;
  const { items, isLoading, isFetching, remove, update, updatingId } = useManageProduct({
    productId: params as string,
  });

  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['required', 'optional']),
  );

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

  const toggleCategory = (categoryKey: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(categoryKey)) {
      newExpanded.delete(categoryKey);
    } else {
      newExpanded.add(categoryKey);
    }
    setExpandedCategories(newExpanded);
  };

  const groupedByOptional = useMemo(() => {
    const required: ProductEquipmentViewRow[] = [];
    const optional: ProductEquipmentViewRow[] = [];

    items.forEach((item) => {
      if (item.is_optional) {
        optional.push(item);
      } else {
        required.push(item);
      }
    });

    const result: Array<{
      key: string;
      title: string;
      items: ProductEquipmentViewRow[];
      color: string;
    }> = [];

    if (required.length > 0) {
      result.push({
        key: 'required',
        title: `Wymagany sprzęt (${required.length})`,
        items: required,
        color: '#d3bb73',
      });
    }

    if (optional.length > 0) {
      result.push({
        key: 'optional',
        title: `Sprzęt opcjonalny (${optional.length})`,
        items: optional,
        color: '#6b7280',
      });
    }

    return result;
  }, [items]);

  const groupedByCategory = useMemo(() => {
    return groupedByOptional.map((group) => {
      const categoryGroups = new Map<string, ProductEquipmentViewRow[]>();

      group.items.forEach((item) => {
        const categoryId = item.item?.warehouse_category_id || null;
        const categoryName = item.item?.warehouse_categories?.name || 'Bez kategorii';
        const key = categoryId || 'no-category';

        if (!categoryGroups.has(key)) {
          categoryGroups.set(key, []);
        }
        categoryGroups.get(key)!.push(item);
      });

      const categories = Array.from(categoryGroups.entries()).map(([key, items]) => {
        const firstItem = items[0];
        return {
          key: `${group.key}-${key}`,
          categoryId: firstItem.item?.warehouse_category_id || null,
          categoryName: firstItem.item?.warehouse_categories?.name || 'Bez kategorii',
          items,
        };
      });

      return {
        ...group,
        categories: categories.sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
      };
    });
  }, [groupedByOptional]);

  if (isLoading) {
    return (
      <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#d3bb73]" />
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-[#d3bb73]" />
          <h2 className="text-lg font-medium text-[#e5e4e2]">Sprzęt produktu ({items.length})</h2>
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
        <div className="space-y-4">
          {groupedByCategory.map((group) => (
            <div key={group.key} className="space-y-2">
              <button
                onClick={() => toggleCategory(group.key)}
                className="flex w-full items-center gap-2 rounded-lg bg-[#252942] px-3 py-2 text-left hover:bg-[#2d3152]"
                style={{ borderLeft: `3px solid ${group.color}` }}
              >
                {expandedCategories.has(group.key) ? (
                  <ChevronDown className="h-4 w-4" style={{ color: group.color }} />
                ) : (
                  <ChevronRight className="h-4 w-4" style={{ color: group.color }} />
                )}
                <span className="font-medium text-[#e5e4e2]">{group.title}</span>
              </button>

              {expandedCategories.has(group.key) && (
                <div className="ml-4 space-y-3">
                  {group.categories.map((category) => (
                    <div key={category.key} className="space-y-2">
                      <div className="flex items-center gap-2 px-2 py-1">
                        <Package className="h-4 w-4 text-[#d3bb73]/60" />
                        <span className="text-sm font-medium text-[#e5e4e2]/80">
                          {category.categoryName} ({category.items.length})
                        </span>
                      </div>
                      <div className="space-y-2">
                        {category.items.map((item) => (
                          <ProductEquipmentRow
                            key={item.id}
                            item={item}
                            canEdit={canEdit}
                            updatingId={updatingId}
                            handleUpdateEquipmentQuantity={handleUpdateEquipmentQuantity}
                            handleDeleteEquipment={handleDeleteEquipment}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
