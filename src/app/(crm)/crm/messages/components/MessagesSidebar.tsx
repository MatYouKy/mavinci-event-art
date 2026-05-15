'use client';

import { Inbox, Send, File as FileEdit, Trash2, Mail, FormInput } from 'lucide-react';
import type { MessageFolder } from '@/store/api/messagesApi';

interface EmailAccount {
  id: string;
  email_address: string;
  display_name?: string;
  account_name?: string;
  account_type?: 'personal' | 'shared' | 'system';
}

interface MessagesSidebarProps {
  emailAccounts: EmailAccount[];
  selectedAccount: string;
  setSelectedAccount: (id: string) => void;
  filterType: MessageFolder;
  setFilterType: (folder: MessageFolder) => void;
  hasContactFormAccess: boolean;
  canManage: boolean;
}

const folderItems: Array<{
  key: MessageFolder;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { key: 'received', label: 'Odebrane', icon: Inbox },
  { key: 'sent', label: 'Wysłane', icon: Send },
  { key: 'drafts', label: 'Wersje robocze', icon: FileEdit },
  { key: 'trash', label: 'Kosz', icon: Trash2 },
];

export function MessagesSidebar({
  emailAccounts,
  selectedAccount,
  setSelectedAccount,
  filterType,
  setFilterType,
  hasContactFormAccess,
  canManage,
}: MessagesSidebarProps) {
  const userAccounts = emailAccounts.filter(
    (a) => a.id !== 'all' && a.id !== 'contact_form',
  );
  const hasContactForm = emailAccounts.some((a) => a.id === 'contact_form');

  return (
    <aside className="hidden w-64 shrink-0 border-r border-[#d3bb73]/20 bg-[#1c1f33] lg:block">
      <div className="p-4">
        <div className="mb-4">
          <button
            onClick={() => {
              setSelectedAccount('all');
              setFilterType('all');
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
              selectedAccount === 'all' && filterType === 'all'
                ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                : 'text-[#e5e4e2]/80 hover:bg-white/5'
            }`}
          >
            <Mail className="h-4 w-4" />
            Wszystkie wiadomości
          </button>
          {(hasContactFormAccess || canManage) && hasContactForm && (
            <button
              onClick={() => {
                setSelectedAccount('contact_form');
                setFilterType('contact_form');
              }}
              className={`mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                selectedAccount === 'contact_form'
                  ? 'bg-[#d3bb73]/20 text-[#d3bb73]'
                  : 'text-[#e5e4e2]/80 hover:bg-white/5'
              }`}
            >
              <FormInput className="h-4 w-4" />
              Formularz kontaktowy
            </button>
          )}
        </div>

        {userAccounts.length > 0 && (
          <div className="space-y-4">
            {userAccounts.map((account) => (
              <div key={account.id}>
                <div className="mb-2 truncate px-3 text-xs font-semibold uppercase tracking-wide text-[#e5e4e2]/50">
                  {account.display_name || account.account_name || account.email_address}
                </div>
                <ul className="space-y-0.5">
                  {folderItems.map(({ key, label, icon: Icon }) => {
                    const isActive = selectedAccount === account.id && filterType === key;
                    return (
                      <li key={key}>
                        <button
                          onClick={() => {
                            setSelectedAccount(account.id);
                            setFilterType(key);
                          }}
                          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            isActive
                              ? 'bg-[#d3bb73] text-[#1c1f33]'
                              : 'text-[#e5e4e2]/80 hover:bg-white/5'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                          {label}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
