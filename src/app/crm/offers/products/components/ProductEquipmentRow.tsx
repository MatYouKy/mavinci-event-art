import { ChevronDown, Loader2, Package, Trash2 } from 'lucide-react';
import { ProductEquipmentViewRow } from '../hooks/useManageProduct';
import { useEffect, useState } from 'react';
import Popover from '@/components/UI/Tooltip';
import { useKitByIdLazy } from '@/app/crm/equipment/hooks/useKitByIdLazy';
import { ProductEquipmentMode } from '../../types';

export const ProductEquipmentRow = ({
  item,
  canEdit,
  updatingId,
  handleUpdateEquipmentQuantity,
  handleDeleteEquipment,
}: {
  item: ProductEquipmentViewRow;
  canEdit: boolean;
  updatingId: string;
  handleUpdateEquipmentQuantity: (equipmentId: string, quantity: number) => void;
  handleDeleteEquipment: (equipmentId: string) => Promise<void>;
}) => {
  const isKit = item.mode === 'kit';
  const [quantity, setQuantity] = useState(item.quantity);
  const [isEditing, setIsEditing] = useState(false);
  const [isExpanded, setIsExpanded] = useState<Record<string, boolean>>({});
  const { loadKit, kit } = useKitByIdLazy();
  useEffect(() => {
    if (isKit && item.item?.id) {
      loadKit(item.item.id);
      setIsExpanded((prev) => ({ ...prev, [item.id]: false }));
    }
  }, [isKit, item.item?.id, loadKit, item.id]);

  const handleQuantityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuantity(Number(e.target.value));
  };

  const handleQuantitySave = () => {
    handleUpdateEquipmentQuantity(item.id, quantity);
    setIsEditing(false);
  };

  const handleQuantityCancel = () => {
    setQuantity(item.quantity);
    setIsEditing(false);
  };

  const handleQuantityDelete = () => {
    handleDeleteEquipment(item.id);
    setIsEditing(false);
  };

  const handleQuantityEdit = (action: boolean) => {
    setIsEditing(action);
  };

  const handleToggleExpand = (id: string) => {
    setIsExpanded((prev) => {
      const next = { ...prev };
      next[id] = !next[id];
      return next;
    });
  };

  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
        {isKit && (
          <button
            onClick={() => handleToggleExpand(item.id)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ChevronDown
              className={`h-4 w-4 transition-transform ${isExpanded[item.id] ? 'rotate-180' : ''}`}
            />
          </button>
        )}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {/* THUMB */}
          {isKit ? (
            kit?.thumbnail_url ? (
              <Popover
                trigger={
                  <div className="relative h-10 w-10">
                    <img
                      src={kit.thumbnail_url}
                      alt={kit.name}
                      className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                    />

                    {/* KIT BADGE */}
                    <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                      <Package className="h-3 w-3 text-[#1c1f33]" />
                    </div>
                  </div>
                }
                content={
                  <img
                    src={kit.thumbnail_url}
                    alt={kit.name}
                    className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                  />
                }
                openOn="hover"
              />
            ) : (
              <div className="relative flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
                <Package className="h-5 w-5 text-[#e5e4e2]/40" />

                {/* KIT BADGE */}
                <div className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#d3bb73] shadow">
                  <Package className="h-3 w-3 text-[#1c1f33]" />
                </div>
              </div>
            )
          ) : item.item?.thumbnail_url ? (
            <Popover
              trigger={
                <img
                  src={item.item.thumbnail_url}
                  alt={item.item.name}
                  className="h-10 w-10 cursor-pointer rounded border border-[#d3bb73]/20 object-cover transition-all hover:ring-2 hover:ring-[#d3bb73]"
                />
              }
              content={
                <img
                  src={item.item.thumbnail_url}
                  alt={item.item.name}
                  className="h-auto cursor-pointer rounded-lg object-contain transition-all"
                />
              }
              openOn="hover"
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
              <Package className="h-5 w-5 text-[#e5e4e2]/40" />
            </div>
          )}

          {/* NAZWA */}
          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-[#e5e4e2]">
                {item.item?.name || 'Nieznany'}
              </span>
            </div>

            {!isKit && item.item && (
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
          </div>
        </div>

        <div className="flex items-center gap-4 text-sm text-[#e5e4e2]/40">
          {!isKit && item.item?.available_quantity && (
            <span className="hidden md:inline">
              dostępne {item.item.available_quantity} szt. w magazynie
            </span>
          )}

          {/* ilość */}
          {updatingId === item.id && (
            <div className="flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#d3bb73]" />
            </div>
          )}
          {canEdit && !isKit ? (
            isEditing ? (
              <span className="inline-flex items-center gap-2">
                <button
                  className="rounded bg-[#d3bb73] px-2 py-0.5 text-black hover:bg-[#e5c97a]"
                  onClick={handleQuantitySave}
                  title="Zapisz"
                >
                  ✓
                </button>

                <button
                  className="rounded border border-[#d3bb73]/30 px-2 py-0.5 text-[#e5e4e2]/70 hover:text-red-400"
                  onClick={handleQuantityCancel}
                  title="Anuluj"
                >
                  ✕
                </button>

                <input
                  type="number"
                  min={1}
                  max={item.item.available_quantity}
                  value={quantity}
                  onChange={handleQuantityChange}
                  className="w-16 rounded border border-[#d3bb73]/20 bg-[#1c1f33] px-2 py-0.5 text-sm text-[#e5e4e2]"
                  autoFocus
                />

                <span className="text-[#e5e4e2]/60">szt.</span>
                {/* <span className="text-[#e5e4e2]/40">max {maxSet || 1}</span> */}
              </span>
            ) : (
              <span
                className="cursor-pointer text-[#e5e4e2] hover:text-[#d3bb73]"
                onClick={handleQuantityEdit.bind(null, true)}
              >
                {item.quantity} <span className="text-[#e5e4e2]/60">szt.</span>
              </span>
            )
          ) : (
            <span className="text-[#e5e4e2]">
              {item.quantity} <span className="text-[#e5e4e2]/60">szt.</span>
            </span>
          )}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2 rounded-lg p-2 pt-2 text-red-400/60 transition-colors hover:bg-red-400/10 hover:text-red-400">
            <button onClick={handleQuantityDelete}>
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {isKit && isExpanded[item.id] && kit?.equipment_kit_items?.length > 0 && (
        <div className="ml-9 mt-1 space-y-1">
          {kit?.equipment_kit_items?.map((kitItem: any, idx: number) => {
            const equipmentItem = {
              id: kitItem.id,
              product_id: item.product_id,
              equipment_item_id: kitItem.equipment_id,
              equipment_kit_id: item.item.id,
              is_optional: kitItem.is_optional,
              notes: kitItem.notes,
              created_at: new Date().toISOString(),
              quantity: kitItem.quantity,
              item: kitItem.equipment_items,
              mode: 'item' as ProductEquipmentMode,
            };
            return (
              <ProductEquipmentRow
                item={equipmentItem}
                canEdit={false}
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
