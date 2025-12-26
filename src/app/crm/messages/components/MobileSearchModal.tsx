import { Search, X } from 'lucide-react';
import React, { FC } from 'react';

interface MobileSearchModalProps {
  setShowMobileSearch: (show: boolean) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  handleAdvancedSearch: () => void;
  handleClearSearch: () => void;
}

export const MobileSearchModal: FC<MobileSearchModalProps> = ({ setShowMobileSearch, searchQuery, setSearchQuery, handleAdvancedSearch, handleClearSearch }) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4">
    <div className="mx-auto mt-16 w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium text-[#e5e4e2]">Szukaj</div>
        <button
          onClick={() => setShowMobileSearch(false)}
          className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-white/5"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#e5e4e2]/40" />
        <input
          autoFocus
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && searchQuery.trim()) {
              handleAdvancedSearch();
              setShowMobileSearch(false);
            }
          }}
          placeholder="Szukaj..."
          className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-4 text-base text-white placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
        />
      </div>

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => {
            if (searchQuery.trim()) handleAdvancedSearch();
            setShowMobileSearch(false);
          }}
          disabled={!searchQuery.trim()}
          className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-3 text-[#1c1f33] disabled:opacity-50"
        >
          Szukaj
        </button>
        {searchQuery.trim() && (
          <button
            onClick={() => {
              handleClearSearch();
              setShowMobileSearch(false);
            }}
            className="rounded-lg bg-red-500/20 px-4 py-3 text-red-400"
          >
            Wyczyść
          </button>
        )}
      </div>
    </div>
  </div>
    );
};
