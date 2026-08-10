import { Building2, ChevronDown, Loader2, Package, Trash2 } from 'lucide-react';
import { ProductEquipmentViewRow } from '../hooks/useManageProduct';
import { type ChangeEvent, useEffect, useState } from 'react';
import Popover from '@/components/UI/Tooltip';
import { useKitByIdLazy } from '@/app/(crm)/crm/equipment/hooks/useKitByIdLazy';
import { ProductEquipmentMode } from '../../types';
import NextImage from 'next/image';

type ProductEquipmentRowProps = {
  item: ProductEquipmentViewRow;
  canEdit: boolean;
  updatingId: string | null;
  variant?: 'table' | 'list';
  nested?: boolean;
  handleUpdateEquipmentQuantity: (equipmentId: string, quantity: number) => Promise<void>;
  handleDeleteEquipment: (equipmentId: string) => Promise<void>;
};

export const ProductEquipmentRow = ({
  item,
  canEdit,
  updatingId,
  variant = 'list',
  nested = false,
  handleUpdateEquipmentQuantity,
  handleDeleteEquipment,
}: ProductEquipmentRowProps) => {
  const isKit = item.mode === 'kit';
  const isRental = item.mode === 'rental';
  const isUpdating = updatingId === item.id;

  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const { loadKit, kit } = useKitByIdLazy();

  const [quantity, setQuantity] = useState<number>(item.quantity ?? 1);

  useEffect(() => {
    setQuantity(item.quantity ?? 1);
  }, [item.quantity]);

  useEffect(() => {
    if (isKit && item.item?.id) {
      loadKit(item.item.id);
      setIsExpanded(false);
    }
  }, [isKit, item.item?.id, loadKit]);

  const handleQuantityChange = (event: ChangeEvent<HTMLInputElement>) => {
    setQuantity(Number(event.target.value));
  };

  const handleQuantitySave = async () => {
    if (!Number.isFinite(quantity) || quantity < 1) return;
    await handleUpdateEquipmentQuantity(item.id, quantity);
    setIsEditing(false);
  };

  const handleQuantityDelete = async () => {
    await handleDeleteEquipment(item.id);
    setIsEditing(false);
  };

  const categoryName = item.item?.warehouse_categories?.name || 'Bez kategorii';
  const availableQuantity = item.item?.available_quantity;

  const thumbnail = isKit ? (
    kit?.thumbnail_url ? (
      <Popover
        trigger={
          <div className="relative h-10 w-10">
            <NextImage
              src={kit.thumbnail_url}
              width={40}
              height={40}
              alt={kit.name}
              className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
            />
            <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
              <Package className="h-3 w-3 text-[#1c1f33]" />
            </div>
          </div>
        }
        content={
          <NextImage
            src={kit.thumbnail_url}
            width={320}
            height={320}
            alt={kit.name}
            className="h-auto max-w-[320px] rounded-lg object-contain"
          />
        }
        openOn="hover"
      />
    ) : (
      <div className="relative flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
        <Package className="h-5 w-5 text-[#e5e4e2]/40" />
        <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
          <Package className="h-3 w-3 text-[#1c1f33]" />
        </div>
      </div>
    )
  ) : item.item?.thumbnail_url ? (
    <Popover
      trigger={
        <NextImage
          src={item.item.thumbnail_url}
          width={40}
          height={40}
          alt={item.item.name}
          className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
        />
      }
      content={
        <NextImage
          src={item.item.thumbnail_url}
          width={320}
          height={320}
          alt={item.item.name}
          className="h-auto max-w-[320px] rounded-lg object-contain"
        />
      }
      openOn="hover"
    />
  ) : (
    <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
      <Package className="h-5 w-5 text-[#e5e4e2]/40" />
    </div>
  );

  const nameAndDetails = (
    <div className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-[#e5e4e2]">{item.item?.name || 'Nieznany'}</span>

      {!isKit && !isRental && item.item && (
        <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
          {item.item.brand && <span>{item.item.brand}</span>}
          {item.item.model && (
            <>
              {item.item.brand && <span>•</span>}
              <span>{item.item.model}</span>
            </>
          )}
        </div>
      )}

      {isRental && (
        <div className="flex items-center gap-1 text-xs text-green-400/80">
          <Building2 className="h-3 w-3" />
          <span>Sprzęt rental</span>
        </div>
      )}
    </div>
  );

  const quantityControl = isUpdating ? (
    <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />
  ) : canEdit && !isKit && !isRental ? (
    isEditing ? (
      <div className="flex items-center gap-1.5">
        <input
          type="number"
          min={1}
          max={availableQuantity ?? undefined}
          value={quantity}
          onChange={handleQuantityChange}
          className="w-14 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-sm text-[#e5e4e2]"
          autoFocus
        />
        <button
          type="button"
          className="rounded bg-[#d3bb73] px-2 py-0.5 text-black hover:bg-[#e5c97a]"
          onClick={handleQuantitySave}
          title="Zapisz"
        >
          ✓
        </button>
        <button
          type="button"
          className="rounded border border-[#d3bb73]/30 px-2 py-0.5 text-[#e5e4e2]/70 hover:text-red-400"
          onClick={() => {
            setQuantity(item.quantity ?? 1);
            setIsEditing(false);
          }}
          title="Anuluj"
        >
          ✕
        </button>
      </div>
    ) : (
      <button
        type="button"
        className="text-[#e5e4e2] hover:text-[#d3bb73]"
        onClick={() => setIsEditing(true)}
      >
        {item.quantity} <span className="text-[#e5e4e2]/60">szt.</span>
      </button>
    )
  ) : (
    <span className="text-[#e5e4e2]">
      {item.quantity} <span className="text-[#e5e4e2]/60">szt.</span>
    </span>
  );

  const deleteAction =
    canEdit && !isRental ? (
      <button
        type="button"
        onClick={handleQuantityDelete}
        className="rounded-lg p-2 text-red-400/60 transition-colors hover:bg-red-400/10 hover:text-red-400"
        title="Usuń sprzęt"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    ) : null;

  const expandedKitItems =
    isKit && isExpanded && kit?.equipment_kit_items?.length
      ? kit.equipment_kit_items.map((kitItem: any, index: number) => {
          const equipmentItem = {
            id: kitItem.id,
            product_id: item.product_id,
            equipment_item_id: kitItem.equipment_id,
            equipment_kit_id: item.item?.id ?? item.equipment_kit_id,
            rental_equipment_id: null,
            subcontractor_id: null,
            is_rental: null,
            replaced_by_rental_id: null,
            is_optional: kitItem.is_optional,
            notes: kitItem.notes,
            created_at: new Date().toISOString(),
            quantity: kitItem.quantity,
            item: kitItem.equipment_items,
            mode: 'item' as ProductEquipmentMode,
          } as ProductEquipmentViewRow;

          return (
            <ProductEquipmentRow
              key={kitItem.id ?? `${item.id}-${index}`}
              item={equipmentItem}
              canEdit={false}
              updatingId={updatingId}
              variant={variant}
              nested
              handleUpdateEquipmentQuantity={handleUpdateEquipmentQuantity}
              handleDeleteEquipment={handleDeleteEquipment}
            />
          );
        })
      : null;

  if (variant === 'table') {
    return (
      <div>
        <div className="grid grid-cols-[minmax(280px,2fr)_minmax(150px,1fr)_120px_160px_100px_48px] items-center gap-3 bg-[#0f1119] px-4 py-2.5 transition-colors hover:bg-[#131620]">
          <div className={`flex min-w-0 items-center gap-3 ${nested ? 'pl-8' : ''}`}>
            <div className="flex w-4 shrink-0 items-center justify-center">
              {isKit && (
                <button
                  type="button"
                  onClick={() => setIsExpanded((current) => !current)}
                  className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
                  aria-label={isExpanded ? 'Zwiń zawartość pakietu' : 'Rozwiń zawartość pakietu'}
                >
                  <ChevronDown
                    className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                  />
                </button>
              )}
            </div>
            {thumbnail}
            {nameAndDetails}
          </div>

          <span className="truncate text-sm text-[#e5e4e2]/60">{categoryName}</span>

          <span
            className={`w-fit rounded-full px-2 py-0.5 text-xs ${
              item.is_optional
                ? 'bg-[#6b7280]/20 text-[#e5e4e2]/60'
                : 'bg-[#d3bb73]/15 text-[#d3bb73]'
            }`}
          >
            {item.is_optional ? 'Opcjonalny' : 'Wymagany'}
          </span>

          <span className="text-sm text-[#e5e4e2]/50">
            {isKit
              ? 'Pakiet'
              : availableQuantity != null
                ? `${availableQuantity} szt. w magazynie`
                : '—'}
          </span>

          <div className="text-sm">{quantityControl}</div>
          <div className="flex justify-end">{deleteAction}</div>
        </div>

        {expandedKitItems && (
          <div className="divide-y divide-[#d3bb73]/5 border-t border-[#d3bb73]/10 bg-[#0a0d1a]">
            {expandedKitItems}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
        {isKit && (
          <button
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
            aria-label={isExpanded ? 'Zwiń zawartość pakietu' : 'Rozwiń zawartość pakietu'}
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
            />
          </button>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {thumbnail}
          {nameAndDetails}
        </div>

        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/40">
          {!isKit && !isRental && availableQuantity != null && (
            <span className="hidden md:inline">dostępne {availableQuantity} szt. w magazynie</span>
          )}
          {quantityControl}
        </div>

        {deleteAction}
      </div>

      {expandedKitItems && <div className="ml-9 mt-1 space-y-1">{expandedKitItems}</div>}
    </div>
  );
};
