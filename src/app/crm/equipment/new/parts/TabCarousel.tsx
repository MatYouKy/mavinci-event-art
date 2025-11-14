'use client';


export type EquipmentTab =
  | 'details'
  | 'technical'
  | 'components'
  | 'units'
  | 'gallery'
  | 'history'
  | 'notes';

type Props = {
  activeTab: EquipmentTab;
  setActiveTab: (t: EquipmentTab) => void;
  units?: number; // licznik (np. jednostek), opcjonalnie
};

const tabLabel: Record<Exclude<EquipmentTab, 'details' | 'history' | 'components'>, string> = {
  technical: 'Techniczne',
  units: 'Magazyn',
  gallery: 'Galeria',
  notes: 'Notatki',
};

export function TabCarousel({ activeTab, setActiveTab, units }: Omit<Props, 'details'>) {
  const allTabs: EquipmentTab[] = [
    'technical',
    'components',
    'units',
    'gallery',
    'notes',
  ];

  return (
    <div className="no-scrollbar -mx-2 mb-4 flex snap-x gap-2 overflow-x-auto px-2 py-1">
      {allTabs.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => setActiveTab(t)}
          className={`snap-start rounded-lg px-3 py-2 text-sm transition-colors
            ${activeTab === t ? 'bg-[#d3bb73] text-[#1c1f33]' : 'bg-[#0f1119] text-[#e5e4e2]/80 hover:bg-[#171a29]'}
          `}
          title={tabLabel[t]}
        >
          <span>{tabLabel[t]}</span>
          {t === 'units' && typeof units === 'number' && (
            <span className="ml-2 rounded bg-black/20 px-1.5 py-0.5 text-xs">{units}</span>
          )}
        </button>
      ))}
    </div>
  );
}