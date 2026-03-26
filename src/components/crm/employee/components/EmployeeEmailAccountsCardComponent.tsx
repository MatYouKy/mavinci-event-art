import React, { memo } from 'react';
import { Mail } from 'lucide-react';

function EmployeeEmailAccountsCardComponent({ emailAccounts }: { emailAccounts: any[] }) {
  if (!emailAccounts?.length) return null;

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-4 flex items-center gap-2 text-lg font-light text-[#e5e4e2]">
        <Mail className="h-5 w-5" />
        Konta Email
      </h3>

      <div className="space-y-2">
        {emailAccounts.map((account) => (
          <div key={account.id} className="flex items-center gap-2 text-[#e5e4e2]/80">
            <Mail className="h-4 w-4 text-[#d3bb73]" />
            <span>{account.email_address}</span>
            {account.is_primary && (
              <span className="rounded bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                Główne
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default memo(EmployeeEmailAccountsCardComponent);