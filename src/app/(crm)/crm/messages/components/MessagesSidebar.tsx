'use client';

import { useEffect, useMemo, useState } from 'react';
import { Inbox, Send, File as FileEdit, Trash2, Mail, FormInput, GripVertical } from 'lucide-react';
import type { MessageFolder, MessageUnreadCounts } from '@/store/api/messagesApi';
import { useUserPreferences } from '@/app/(crm)/crm/PreferencesClientProvider';

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
  unreadCounts?: MessageUnreadCounts;
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
  unreadCounts,
}: MessagesSidebarProps) {
  const { preferences, setPreference } = useUserPreferences();
  const userAccounts = emailAccounts.filter(
    (a) => a.id !== 'all' && a.id !== 'contact_form',
  );
  const [orderedAccountIds, setOrderedAccountIds] = useState<string[]>([]);
  const [draggedAccountId, setDraggedAccountId] = useState<string | null>(null);

  const hasContactForm = emailAccounts.some((a) => a.id === 'contact_form');

  useEffect(() => {
    const availableIds = userAccounts.map((account) => account.id);
    const savedOrder = preferences.messages?.mailboxOrder || [];
    const nextOrder = [
      ...savedOrder.filter((accountId) => availableIds.includes(accountId)),
      ...availableIds.filter((accountId) => !savedOrder.includes(accountId)),
    ];
    setOrderedAccountIds(nextOrder);
  }, [emailAccounts, preferences.messages?.mailboxOrder]);

  const orderedAccounts = useMemo(() => {
    const accountsById = new Map(userAccounts.map((account) => [account.id, account]));
    const effectiveOrder =
      orderedAccountIds.length > 0
        ? orderedAccountIds
        : userAccounts.map((account) => account.id);
    return effectiveOrder
      .map((accountId) => accountsById.get(accountId))
      .filter((account): account is EmailAccount => Boolean(account));
  }, [orderedAccountIds, userAccounts]);

  const moveAccount = (targetAccountId: string) => {
    if (!draggedAccountId || draggedAccountId === targetAccountId) return;
    setOrderedAccountIds((current) => {
      const next = [...current];
      const sourceIndex = next.indexOf(draggedAccountId);
      const targetIndex = next.indexOf(targetAccountId);
      if (sourceIndex === -1 || targetIndex === -1) return current;
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, draggedAccountId);
      return next;
    });
  };

  const saveAccountOrder = () => {
    setDraggedAccountId(null);
    setPreference('messages', {
      ...(preferences.messages || {}),
      mailboxOrder: orderedAccountIds,
    });
  };

  const renderUnreadBadge = (count = 0, active = false) =>
    count > 0 ? (
      <span
        className={`ml-auto inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
          active ? 'bg-[#1c1f33] text-[#d3bb73]' : 'bg-red-500/90 text-white'
        }`}
      >
        {count > 99 ? '99+' : count}
      </span>
    ) : null;

  return (
    <aside className="hidden h-full min-h-0 w-64 shrink-0 overflow-hidden border-r border-[#d3bb73]/20 bg-[#1c1f33] lg:flex lg:flex-col">

    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
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
            {renderUnreadBadge(
              unreadCounts?.total,
              selectedAccount === 'all' && filterType === 'all',
            )}
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
              {renderUnreadBadge(
                unreadCounts?.contactForm,
                selectedAccount === 'contact_form',
              )}
            </button>
          )}
        </div>

        {userAccounts.length > 0 && (
          <div className="space-y-4">
            {orderedAccounts.map((account) => (
              <div
                key={account.id}
                draggable
                onDragStart={(event) => {
                  setDraggedAccountId(account.id);
                  event.dataTransfer.effectAllowed = 'move';
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                  moveAccount(account.id);
                }}
                onDrop={(event) => {
                  event.preventDefault();
                }}
                onDragEnd={saveAccountOrder}
                className={`rounded-md transition-opacity ${
                  draggedAccountId === account.id ? 'opacity-50' : 'opacity-100'
                }`}
              >
                <div
                  className="mb-1.5 flex cursor-grab items-center gap-1.5 px-2 text-xs font-semibold uppercase tracking-wide text-[#e5e4e2]/50 active:cursor-grabbing"
                  title="Przeciągnij, aby zmienić kolejność skrzynki"
                >
                  <GripVertical className="h-3.5 w-3.5 shrink-0 text-[#d3bb73]/45" />
                  <span className="truncate">
                    {account.display_name || account.account_name || account.email_address}
                  </span>
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
                          {key === 'received' &&
                            renderUnreadBadge(unreadCounts?.byAccount[account.id], isActive)}
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
