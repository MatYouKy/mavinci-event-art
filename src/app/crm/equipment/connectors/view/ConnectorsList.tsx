import { Edit2, ImageIcon, Trash2 } from 'lucide-react';
import React, { FC } from 'react';
import { IConnectorType } from '../connector.type';
import { ThumbnailHoverPopper } from '@/components/UI/ThumbnailPopover';

interface ConnectorsListProps {
  connectors: IConnectorType[];
  onEdit: (connector: IConnectorType, e: React.MouseEvent) => void;
  onDelete: (_id: string, e: React.MouseEvent) => void;
  canManage: boolean;
}

export const ConnectorsList: FC<ConnectorsListProps> = ({
  connectors,
  onEdit,
  onDelete,
  canManage,
}) => {
  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]">
      <div className="sticky top-0 grid grid-cols-[50px_1fr_120px_80px] gap-2 border-b border-[#d3bb73]/20 bg-[#d3bb73]/10 px-4 py-2 text-xs font-medium text-[#e5e4e2]">
        <div></div>
        <div>Nazwa</div>
        <div className="text-center">Aktywność</div>
        <div className="text-center">Akcje</div>
      </div>
      {connectors.map((c) => (
        <div
          key={c._id}
          className="grid grid-cols-[50px_1fr_120px_80px] items-center gap-2 border-b border-[#d3bb73]/5 px-4 py-3 transition-colors hover:bg-[#d3bb73]/5"
        >
          <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded bg-[#0f1119]">
            {c.thumbnail_url ? (
              <ThumbnailHoverPopper src={c.thumbnail_url} alt={c.name} size={36} previewMax={260} />
            ) : (
              <ImageIcon className="h-4 w-4 text-[#e5e4e2]/20" />
            )}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#e5e4e2]">{c.name}</div>
            {c.description && (
              <div className="line-clamp-1 text-xs text-[#e5e4e2]/50">{c.description}</div>
            )}
          </div>
          <div className="text-center text-xs">
            <span
              className={`rounded px-2 py-1 ${c.is_active ? 'bg-emerald-500/10 text-emerald-300' : 'bg-gray-500/10 text-gray-300'}`}
            >
              {c.is_active ? 'Aktywny' : 'Nieaktywny'}
            </span>
          </div>
          {canManage ? (
            <div className="flex items-center justify-center gap-1">
              <button
                onClick={(e) => onEdit(c, e)}
                className="rounded bg-[#0f1119] p-1.5 text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
                title="Edytuj"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={(e) => onDelete(c._id, e)}
                className="rounded bg-red-500/10 p-1.5 text-red-400 transition-colors hover:bg-red-500/20"
                title="Usuń"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div />
          )}
        </div>
      ))}
    </div>
  );
};
