import { X } from 'lucide-react';
import React, { FC } from 'react';

interface MessageMobileFilteredModalProps {
  setShowMobileFilters: (show: boolean) => void;
  selectedAccount: string;
  setSelectedAccount: (account: string) => void;
  emailAccounts: any[];
  filterType: string;
  setFilterType: (type: string) => void;
  hasContactFormAccess: boolean;
  canManage: boolean;
}

export const MessageMobileFilteredModal: FC<MessageMobileFilteredModalProps> = ({
  setShowMobileFilters,
  selectedAccount,
  setSelectedAccount,
  emailAccounts,
  filterType,
  setFilterType,
  hasContactFormAccess,
  canManage,
}) => {
  return (
    <div className="fixed inset-0 z-50 bg-black/60 p-4">
      <div className="mx-auto mt-16 w-full max-w-lg rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-medium text-[#e5e4e2]">Filtry</div>
          <button
            onClick={() => setShowMobileFilters(false)}
            className="rounded-lg p-2 text-[#e5e4e2]/70 hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-2 block text-xs text-[#e5e4e2]/70">Konto Email</label>
            <select
              value={selectedAccount}
              onChange={(e) => setSelectedAccount(e.target.value)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
            >
              {emailAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.display_name || account.from_name || account.email_address}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-xs text-[#e5e4e2]/70">Filtruj po typie</label>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value as any)}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-3 text-white focus:border-[#d3bb73] focus:outline-none"
            >
              <option value="all">Wszystkie</option>
              {(hasContactFormAccess || canManage) && (
                <option value="contact_form">Formularz</option>
              )}
              <option value="received">Odebrane</option>
              <option value="sent">Wysłane</option>
            </select>
          </div>
        </div>

        <div className="mt-4 flex gap-2">
          <button
            onClick={() => setShowMobileFilters(false)}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-3 text-[#1c1f33]"
          >
            Zastosuj
          </button>
        </div>
      </div>
    </div>
  );
};
