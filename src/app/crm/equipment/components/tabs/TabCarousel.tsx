import { Dispatch, SetStateAction } from 'react';
import { EquipmentTabsCarouselType } from '../../types/equipment.types';

interface TabCarouselProps {
  activeTab: string;
  setActiveTab: Dispatch<SetStateAction<EquipmentTabsCarouselType>>;
  equipment: any;
  units: number;
}

interface Tab {
  id: EquipmentTabsCarouselType;
  label: string;
}

export function TabCarousel({ activeTab, setActiveTab, equipment, units }: TabCarouselProps) {
  const tabs: Tab[] = [
    { id: 'details', label: 'Podstawowe' },
    { id: 'technical', label: 'Parametry techniczne' },
    // { id: 'purchase', label: 'Informacje zakupowe' },
    // { id: 'components', label: `Skład zestawu (${equipment?.equipment_components?.length || 0})` },
    { id: 'units', label: `Jednostki (${units || 0})` },
    { id: 'gallery', label: `Galeria (${equipment?.gallery?.length || 0})` },
    // { id: 'history', label: 'Historia' },
  ];
  return (
    <div className="relative border-b border-[#d3bb73]/10">
      <div className="flex items-center gap-2 overflow-x-auto px-2">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-shrink-0 whitespace-nowrap px-4 py-2 text-sm transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-[#d3bb73] text-[#d3bb73]'
                : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
    </div>
  );
}
