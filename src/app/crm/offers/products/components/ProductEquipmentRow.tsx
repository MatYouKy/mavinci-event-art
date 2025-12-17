import { Loader2, Package, Trash2 } from 'lucide-react';
import { ProductEquipmentViewRow } from '../hooks/useManageProduct';
import { useState } from 'react';
import Popover from '@/components/UI/Tooltip';

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

  console.log('item', item);

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

  return (
    <div>
      <div className="flex items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] px-4 py-2.5 transition-colors hover:border-[#d3bb73]/20">
        {/* {isKit && (
          <button
            onClick={() => onToggleExpand?.(row.id)}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </button>
        )} */}

        <div className="flex min-w-0 flex-1 items-center gap-3">
          {isKit ? (
            <span className="text-base">🎁</span>
          ) : item.item?.thumbnail_url ? (
            <Popover
              trigger={
                <img
                  src={item.item.thumbnail_url}
                  alt={item.item.name}
                  className="h-10 w-10 rounded border border-[#d3bb73]/20 object-cover cursor-pointer hover:ring-2 hover:ring-[#d3bb73] transition-all"
                />
              }
              content={
                <img
                  src={item.item.thumbnail_url}
                  alt={item.item.name}
                  className="h-auto rounded-lg object-contain cursor-pointer transition-all"
                />
              }
              openOn="hover"  
            />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[#d3bb73]/20 bg-[#1c1f33]">
              <Package className="h-5 w-5 text-[#e5e4e2]/30" />
            </div>
          )}

          <div className="flex min-w-0 flex-col">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate font-medium text-[#e5e4e2]">
                {isKit ? item.item?.name : item.item?.name || 'Nieznany'}
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

      {/* {isKit && expanded && item?.kit?.items && (
        <div className="ml-9 mt-1 space-y-1">
          {row.kit.items.map((kitItem: any, idx: number) => (
            <div
              key={idx}
              className="flex items-center gap-3 rounded border border-[#d3bb73]/5 bg-[#0f1119]/50 px-4 py-2 text-sm"
            >
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="text-[#e5e4e2]/80">{kitItem?.equipment?.name}</span>
                <span className="text-xs text-[#e5e4e2]/45">{kitItem?.equipment?.category?.name}</span>
              </div>

              <span className="font-medium text-[#e5e4e2]/60">
                {Number(kitItem.quantity || 0) * Number(item.quantity || 0)} szt.
              </span>
            </div>
          ))}
        </div>
      )} */}
    </div>
  );
};
