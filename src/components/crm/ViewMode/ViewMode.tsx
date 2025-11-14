import React, { Dispatch, FC, SetStateAction } from 'react';
import { ViewModeType } from '@/components/UI/types/view.type';
import { LayoutGrid, List, TableIcon } from 'lucide-react';

interface ViewModeProps {
  viewMode: ViewModeType;
  setViewMode: Dispatch<SetStateAction<ViewModeType>>;
}

export const ViewMode: FC<ViewModeProps> = ({ viewMode, setViewMode }) => {
  return (
    <div className="inline-flex rounded-lg overflow-hidden border border-[#d3bb73]/20">
      <button
        onClick={() => setViewMode('list')}
        className={`px-2.5 py-1.5 text-sm ${viewMode === 'list' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2] bg-[#0f1119]'}`}
        aria-pressed={viewMode === 'list'}
        title="Widok listy"
      >
        <List className="h-4 w-4" />
      </button>
      <button
        onClick={() => setViewMode('table')}
        className={`px-2.5 py-1.5 text-sm ${viewMode === 'table' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2] bg-[#0f1119]'}`}
        aria-pressed={viewMode === 'table'}
        title="Widok tabeli"
      >
        <TableIcon className="h-4 w-4 rotate-90" />
      </button>
      <button
        onClick={() => setViewMode('grid')}
        className={`px-2.5 py-1.5 text-sm ${viewMode === 'grid' ? 'bg-[#d3bb73] text-[#1c1f33]' : 'text-[#e5e4e2] bg-[#0f1119]'}`}
        aria-pressed={viewMode === 'grid'}
        title="Widok kafelków"
      >
        <LayoutGrid className="h-4 w-4" />
      </button>
    </div>
  );
};
