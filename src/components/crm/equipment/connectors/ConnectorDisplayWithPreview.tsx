import Image from 'next/image';
import Popover from '@/components/UI/Tooltip';
import { ConnectorType } from '@/store/slices/equipmentSlice';

export function ConnectorDisplayWithPreview({ connector }: { connector: ConnectorType | null }) {
  if (!connector) {
    return <div className="text-[#e5e4e2]">-</div>;
  }

  return (
    <div className="flex items-center gap-3 text-[#e5e4e2]">
      {connector.thumbnail_url ? (
        <Popover
          trigger={
            <Image
              src={connector.thumbnail_url}
              alt={connector.name}
              width={40}
              height={40}
              className="h-10 w-10 cursor-pointer rounded-lg border border-[#d3bb73]/20 object-cover"
            />
          }
          content={
            <Image
              src={connector.thumbnail_url}
              alt={connector.name ?? 'Wtyk'}
              width={300}
              height={300}
              className="h-auto max-h-[300px] w-[300px] cursor-pointer rounded-lg object-contain"
            />
          }
          openOn="hover"
        />
      ) : (
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] text-xs text-[#e5e4e2]/30">
          —
        </div>
      )}

      <div>
        <div className="text-sm font-medium">{connector.name}</div>
        {connector.common_uses && (
          <div className="text-xs text-[#e5e4e2]/45">{connector.common_uses}</div>
        )}
      </div>
    </div>
  );
}