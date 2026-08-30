import { ChevronDown, ChevronRight, List, Loader2, Package, RotateCcw, Table2, Wrench } from 'lucide-react';
import React, { FC, useMemo, useState } from 'react';
import { ProductEquipmentViewRow, useManageProduct } from '../hooks/useManageProduct';
import { useParams } from 'next/navigation';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { ProductEquipmentRow } from './ProductEquipmentRow';

interface IProductEquipment {
  canEdit: boolean;
  setShowAddEquipmentModal: (show: boolean) => void;
  productVariantId?: string | null;
  productVariantName?: string | null;
  isInherited?: boolean;
  onCustomizeVariant?: () => Promise<void>;
  onResetInheritance?: () => Promise<void>;
}

type ViewMode = 'table' | 'list';

export const ProductEquipment: FC<IProductEquipment> = ({
  canEdit,
  setShowAddEquipmentModal,
  productVariantId = null,
  productVariantName = null,
  isInherited = false,
  onCustomizeVariant,
  onResetInheritance,
}) => {
  const { showSnackbar } = useSnackbar();
  const productId = useParams().id as string;
  const { items, isLoading, remove, update, updatingId } = useManageProduct({
    productId,
    productVariantId: isInherited ? null : productVariantId,
  });

  const [viewMode, setViewMode] = useState<ViewMode>('table');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(['required', 'optional']),
  );

  const handleUpdateEquipmentQuantity = async (equipmentId: string, quantity: number) => {
    if (quantity < 1) return;

    try {
      await update({ id: equipmentId, next: { quantity } });
    } catch (error) {
      console.error('Error updating quantity:', error);
      showSnackbar('Błąd podczas aktualizacji ilości', 'error');
    }
  };

  const handleDeleteEquipment = async (equipmentId: string) => {
    try {
      await remove(equipmentId, productId);
      showSnackbar('Sprzęt usunięty', 'success');
    } catch (error) {
      console.error('Error deleting equipment:', error);
      showSnackbar('Błąd podczas usuwania sprzętu', 'error');
    }
  };

  const toggleCategory = (categoryKey: string) => {
    setExpandedCategories((current) => {
      const next = new Set(current);
      if (next.has(categoryKey)) {
        next.delete(categoryKey);
      } else {
        next.add(categoryKey);
      }
      return next;
    });
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
        const key = categoryId || 'no-category';

        if (!categoryGroups.has(key)) {
          categoryGroups.set(key, []);
        }
        categoryGroups.get(key)!.push(item);
      });

      const categories = Array.from(categoryGroups.entries()).map(([key, categoryItems]) => {
        const firstItem = categoryItems[0];
        return {
          key: `${group.key}-${key}`,
          categoryName: firstItem.item?.warehouse_categories?.name || 'Bez kategorii',
          items: categoryItems,
        };
      });

      return {
        ...group,
        categories: categories.sort((a, b) => a.categoryName.localeCompare(b.categoryName)),
      };
    });
  }, [groupedByOptional]);

  const renderRow = (item: ProductEquipmentViewRow, variant: ViewMode) => (
    <ProductEquipmentRow
      key={item.id}
      item={item}
      canEdit={canEdit && !isInherited}
      updatingId={updatingId}
      variant={variant}
      handleUpdateEquipmentQuantity={handleUpdateEquipmentQuantity}
      handleDeleteEquipment={handleDeleteEquipment}
    />
  );

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
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Wrench className="h-5 w-5 text-[#d3bb73]" />
          <div>
            <h2 className="text-lg font-medium text-[#e5e4e2]">
              {productVariantName ? `Sprzęt wariantu: ${productVariantName}` : 'Bazowy sprzęt produktu'} ({items.length})
            </h2>
            <p className="mt-0.5 text-xs text-[#e5e4e2]/45">
              {productVariantName
                ? isInherited
                  ? 'Zakres jest dziedziczony z produktu bazowego.'
                  : 'Własny zakres wariantu zastępuje zakres bazowy.'
                : 'Zakres używany przez produkt bez wariantu oraz jako domyślny dla pustych wariantów.'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {items.length > 0 && (
            <div className="flex rounded-lg border border-[#d3bb73]/15 bg-[#0f1119] p-1">
              <button
                type="button"
                onClick={() => setViewMode('table')}
                aria-label="Widok tabeli"
                aria-pressed={viewMode === 'table'}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'table'
                    ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                }`}
              >
                <Table2 className="h-4 w-4" />
                <span className="hidden sm:inline">Tabela</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('list')}
                aria-label="Widok listy"
                aria-pressed={viewMode === 'list'}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                    : 'text-[#e5e4e2]/50 hover:text-[#e5e4e2]'
                }`}
              >
                <List className="h-4 w-4" />
                <span className="hidden sm:inline">Lista</span>
              </button>
            </div>
          )}

          {canEdit && (productVariantId && isInherited ? (
            <button
              type="button"
              onClick={() => void onCustomizeVariant?.()}
              className="rounded-lg bg-[#d3bb73]/20 px-3 py-1.5 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
            >
              Dostosuj wariant
            </button>
          ) : (
            <>
              {productVariantId && onResetInheritance && (
                <button
                  type="button"
                  onClick={() => void onResetInheritance()}
                  className="flex items-center gap-1.5 rounded-lg bg-white/5 px-3 py-1.5 text-sm text-[#e5e4e2]/70 hover:bg-white/10"
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Dziedzicz bazowe
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAddEquipmentModal(true)}
                className="rounded-lg bg-[#d3bb73]/20 px-3 py-1.5 text-sm text-[#d3bb73] transition-colors hover:bg-[#d3bb73]/30"
              >
                + Dodaj sprzęt / pakiet
              </button>
            </>
          ))}
        </div>
      </div>

      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-[#e5e4e2]/60">Brak przypisanego sprzętu</p>
      ) : viewMode === 'table' ? (
        <div className="overflow-x-auto rounded-lg border border-[#d3bb73]/10">
          <div className="min-w-[940px]">
            <div className="grid grid-cols-[minmax(280px,2fr)_minmax(150px,1fr)_120px_160px_100px_48px] items-center gap-3 border-b border-[#d3bb73]/10 bg-[#252942] px-4 py-2 text-xs font-medium uppercase tracking-wide text-[#e5e4e2]/50">
              <span>Sprzęt</span>
              <span>Kategoria</span>
              <span>Status</span>
              <span>Dostępność</span>
              <span>Ilość</span>
              <span className="sr-only">Akcje</span>
            </div>
            <div className="divide-y divide-[#d3bb73]/10">
              {items.map((item) => renderRow(item, 'table'))}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedByCategory.map((group) => (
            <div key={group.key} className="space-y-2">
              <button
                type="button"
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
                  {group.categories.map((category) => {
                    const hasVisibleCategory = category.categoryName !== 'Bez kategorii';

                    return (
                      <div key={category.key} className={hasVisibleCategory ? 'space-y-2' : ''}>
                        {hasVisibleCategory && (
                          <div className="flex items-center gap-2 px-2 py-1">
                            <Package className="h-4 w-4 text-[#d3bb73]/60" />
                            <span className="text-sm font-medium text-[#e5e4e2]/80">
                              {category.categoryName} ({category.items.length})
                            </span>
                          </div>
                        )}
                        <div className="space-y-2">
                          {category.items.map((item) => renderRow(item, 'list'))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
