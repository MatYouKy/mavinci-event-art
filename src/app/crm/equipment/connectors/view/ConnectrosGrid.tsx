import { Edit2, Plug, Trash2 } from 'lucide-react';
import { IConnectorType } from '../connector.type';
import { FC } from 'react';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

interface ConnectrosGridProps {
  connectors: IConnectorType[];
  onEdit: (connector: IConnectorType, e: React.MouseEvent) => void;
  onDelete: (_id: string, e: React.MouseEvent) => void;
  canManage: boolean;
}

export const ConnectrosGrid: FC<ConnectrosGridProps> = ({
  connectors,
  onEdit,
  onDelete,
  canManage,
}) => {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {connectors.map((c) => {

        return (
          <div
            key={c._id}
            className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:border-[#d3bb73]/30"
          >
            <div className="flex items-start gap-4">
              <div className="flex h-20 w-20 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#0f1119]">
                <ThumbnailHoverPopper
                  src={c.thumbnail_url}
                  alt={c.name}
                  size={80}
                  previewMax={240}
                  nullIcon={<Plug />}
                  className="h-8 w-8 text-[#e5e4e2]/20"
                />
              </div>

              <div className="min-w-0 flex-1">
                <h3 className="mb-1 text-lg font-medium text-[#e5e4e2]">{c.name}</h3>
                {c.description && (
                  <p className="mb-2 line-clamp-2 text-sm text-[#e5e4e2]/60">{c.description}</p>
                )}
                {c.common_uses && (
                  <p className="line-clamp-2 text-xs text-[#d3bb73]/80">
                    <span className="font-medium">Zastosowanie:</span> {c.common_uses}
                  </p>
                )}
              </div>
            </div>

            {canManage && (
              <div className="mt-4 flex items-center justify-between border-t border-[#d3bb73]/10 pt-4">
                <span className={`text-xs ${c.is_active ? 'text-emerald-300' : 'text-gray-400'}`}>
                  {c.is_active ? 'Aktywny' : 'Nieaktywny'}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={(e) => onEdit(c, e)}
                    className="flex items-center gap-2 rounded-lg bg-[#0f1119] px-3 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                  >
                    <Edit2 className="h-4 w-4" />
                    Edytuj
                  </button>
                  <button
                    onClick={(e) => onDelete(c._id, e)}
                    className="flex items-center gap-2 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400 transition-colors hover:bg-red-500/20"
                  >
                    <Trash2 className="h-4 w-4" />
                    Usuń
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
