import ResponsiveActionBar from '@/components/crm/ResponsiveActionBar';
import { EquipmentUnit } from '@/store/slices/equipmentSlice';
import { Copy, Edit, Trash2, History } from 'lucide-react';
import { useMemo } from 'react';
import Image from 'next/image';

type EquipmentUnitRowProps = {
  unit: EquipmentUnit;
  canEditHere: boolean;
  flags: {
    disable_units?: boolean;
    hide_events?: boolean;
    requires_serial?: boolean;
  };
  selected: boolean;
  onToggleSelect: (id: string) => void;
  handleShowEvents: (unit: EquipmentUnit) => void;
  handleDuplicateUnit: (unit: EquipmentUnit) => void;
  handleOpenModal: (unit: EquipmentUnit) => void;
  handleDeleteUnit: (id: string) => void;
  statusColors: Record<string, string>;
  statusLabels: Record<string, string>;
};

export function EquipmentUnitRow({
  unit,
  canEditHere,
  flags,
  selected,
  onToggleSelect,
  handleShowEvents,
  handleDuplicateUnit,
  handleOpenModal,
  handleDeleteUnit,
  statusColors,
  statusLabels,
}: EquipmentUnitRowProps) {
  const isUnavailable = unit.status === 'damaged' || unit.status === 'in_service';
  const canEdit = canEditHere && !flags.disable_units;

  const unitRowActions = useMemo(() => {
    const items = [];

    if (!flags.hide_events) {
      items.push({
        key: 'events',
        label: 'Historia zdarzeń',
        icon: <History className="h-4 w-4" />,
        onClick: () => handleShowEvents(unit),
        variant: 'default' as const,
      });
    }

    if (canEdit) {
      items.push(
        {
          key: 'duplicate',
          label: 'Duplikuj jednostkę',
          icon: <Copy className="h-4 w-4" />,
          onClick: () => handleDuplicateUnit(unit),
          variant: 'default' as const,
        },
        {
          key: 'edit',
          label: 'Edytuj',
          icon: <Edit className="h-4 w-4" />,
          onClick: () => handleOpenModal(unit),
          variant: 'primary' as const,
        },
        {
          key: 'delete',
          label: 'Usuń',
          icon: <Trash2 className="h-4 w-4" />,
          onClick: () => handleDeleteUnit(unit.id),
          variant: 'danger' as const,
        },
      );
    }

    return items;
  }, [
    unit,
    canEdit,
    flags.hide_events,
    handleShowEvents,
    handleDuplicateUnit,
    handleOpenModal,
    handleDeleteUnit,
  ]);

  return (
    <div
      className={`rounded-xl border bg-[#1c1f33] p-4 ${
        isUnavailable ? 'border-red-500/20 opacity-60' : 'border-[#d3bb73]/10'
      } ${selected ? 'ring-2 ring-[#d3bb73]' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        {canEditHere && !flags.disable_units && (
          <div className="flex items-center pt-1">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(unit.id)}
              className="h-5 w-5 rounded border-[#d3bb73]/20 text-[#d3bb73] focus:ring-[#d3bb73]"
            />
          </div>
        )}

        {unit.thumbnail_url && (
          <Image
            src={unit.thumbnail_url}
            alt="Miniaturka"
            className="h-20 w-20 rounded-lg border border-[#d3bb73]/20 object-cover"
            width={80}
            height={80}
          />
        )}

        <div className="flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-3">
            {flags.requires_serial ? (
              unit.unit_serial_number ? (
                <span className="font-mono font-medium text-[#e5e4e2]">
                  SN: {unit.unit_serial_number}
                </span>
              ) : (
                <span className="italic text-[#e5e4e2]/60">Brak numeru seryjnego</span>
              )
            ) : unit.unit_serial_number ? (
              <span className="font-mono font-medium text-[#e5e4e2]">
                SN: {unit.unit_serial_number}
              </span>
            ) : null}

            <span className={`rounded px-2 py-1 text-xs ${statusColors[unit.status]}`}>
              {statusLabels[unit.status]}
            </span>

            {isUnavailable && (
              <span className="rounded border border-red-500/30 bg-red-500/20 px-2 py-1 text-xs text-red-300">
                Niedostępny
              </span>
            )}

            {unit.estimated_repair_date && isUnavailable && (
              <span className="text-xs text-[#e5e4e2]/60">
                Szac. dostępność:{' '}
                {new Date(unit.estimated_repair_date).toLocaleDateString('pl-PL')}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
            {unit.storage_locations && (
              <div>
                <span className="text-[#e5e4e2]/60">Lokalizacja:</span>{' '}
                <span className="text-[#e5e4e2]">{unit.storage_locations.name}</span>
              </div>
            )}
            {unit.purchase_date && (
              <div>
                <span className="text-[#e5e4e2]/60">Zakup:</span>{' '}
                <span className="text-[#e5e4e2]">
                  {new Date(unit.purchase_date).toLocaleDateString('pl-PL')}
                </span>
              </div>
            )}
            {unit.last_service_date && (
              <div>
                <span className="text-[#e5e4e2]/60">Ostatni serwis:</span>{' '}
                <span className="text-[#e5e4e2]">
                  {new Date(unit.last_service_date).toLocaleDateString('pl-PL')}
                </span>
              </div>
            )}
          </div>

          {unit.condition_notes && (
            <div className="mt-2 text-sm text-[#e5e4e2]/60">
              <span className="font-medium">Notatki:</span> {unit.condition_notes}
            </div>
          )}
        </div>

        <div className="ml-4 flex gap-2">
          <ResponsiveActionBar actions={unitRowActions} disabledBackground />
        </div>
      </div>
    </div>
  );
}