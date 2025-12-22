'use client';

import { useState, useEffect } from 'react';
import { Mail, Plus, Trash2, Eye, EyeOff, Edit, CheckSquare, Square } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useRouter } from 'next/navigation';

interface EmailAccount {
  id: string;
  account_name: string;
  email_address: string;
  account_type: 'personal' | 'shared' | 'system';
  department: string | null;
  description: string | null;
  is_active: boolean;
  employee_id: string | null;
}

interface AccountAssignment {
  id: string;
  email_account_id: string;
  employee_id: string;
  can_send: boolean;
  can_receive: boolean;
}

interface NotificationPreferences {
  contact_form_messages: boolean;
  system_messages: boolean;
}

interface Props {
  employeeId: string;
  employeeEmail: string;
  isAdmin: boolean;
}

export default function EmployeeEmailAccountsTab({ employeeId, employeeEmail, isAdmin }: Props) {
  const router = useRouter();
  const [allAccounts, setAllAccounts] = useState<EmailAccount[]>([]);
  const [assignments, setAssignments] = useState<AccountAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>({
    contact_form_messages: true,
    system_messages: true
  });

  useEffect(() => {
    fetchAccountsAndAssignments();
    fetchNotificationPreferences();
  }, [employeeId]);

  const fetchAccountsAndAssignments = async () => {
    try {
      setLoading(true);

      // Fetch ALL active accounts (personal, shared, system)
      const [accountsRes, assignmentsRes] = await Promise.all([
        supabase
          .from('employee_email_accounts')
          .select('id, account_name, email_address, account_type, department, description, is_active, employee_id')
          .eq('is_active', true)
          .order('account_type', { ascending: false })
          .order('account_name', { ascending: true }),

        supabase
          .from('employee_email_account_assignments')
          .select('*')
          .eq('employee_id', employeeId)
      ]);

      if (accountsRes.error) throw accountsRes.error;
      if (assignmentsRes.error) throw assignmentsRes.error;

      setAllAccounts(accountsRes.data || []);
      setAssignments(assignmentsRes.data || []);
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchNotificationPreferences = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('preferences')
        .eq('id', employeeId)
        .single();

      if (error) throw error;

      if (data?.preferences?.notifications) {
        setNotificationPrefs({
          contact_form_messages: data.preferences.notifications.contact_form_messages ?? true,
          system_messages: data.preferences.notifications.system_messages ?? true
        });
      }
    } catch (err) {
      console.error('Error fetching notification preferences:', err);
    }
  };

  const updateNotificationPreference = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!isAdmin) {
      alert('Tylko administrator może zmieniać te ustawienia');
      return;
    }

    try {
      // Pobierz aktualne preferencje
      const { data: currentData, error: fetchError } = await supabase
        .from('employees')
        .select('preferences')
        .eq('id', employeeId)
        .single();

      if (fetchError) throw fetchError;

      const currentPrefs = currentData?.preferences || {};
      const currentNotifications = currentPrefs.notifications || {};

      // Zaktualizuj konkretny klucz
      const updatedNotifications = {
        ...currentNotifications,
        [key]: value
      };

      // Zapisz do bazy
      const { error: updateError } = await supabase
        .from('employees')
        .update({
          preferences: {
            ...currentPrefs,
            notifications: updatedNotifications
          }
        })
        .eq('id', employeeId);

      if (updateError) throw updateError;

      // Zaktualizuj state lokalny
      setNotificationPrefs(prev => ({
        ...prev,
        [key]: value
      }));

      console.log(`Preferencja ${key} została zaktualizowana na ${value}`);
    } catch (err) {
      console.error('Error updating notification preference:', err);
      alert('Błąd podczas aktualizacji preferencji: ' + JSON.stringify(err));
    }
  };

  const isAssigned = (accountId: string): boolean => {
    return assignments.some(a => a.email_account_id === accountId);
  };

  const toggleAssignment = async (accountId: string, accountType: string) => {
    console.log('toggleAssignment called:', { accountId, accountType, isAdmin, employeeId });

    if (!isAdmin) {
      alert('Tylko administrator może zarządzać przypisaniami kont email');
      return;
    }

    const assigned = isAssigned(accountId);
    console.log('Current assignment status:', assigned);

    try {
      if (assigned) {
        const assignment = assignments.find(a => a.email_account_id === accountId);
        if (!assignment) {
          console.error('Assignment not found');
          return;
        }

        console.log('Deleting assignment:', assignment.id);
        const { error } = await supabase
          .from('employee_email_account_assignments')
          .delete()
          .eq('id', assignment.id);

        if (error) {
          console.error('Delete error:', error);
          throw error;
        }
        alert('Konto zostało odebrane pracownikowi');
      } else {
        if (accountType === 'personal') {
          alert('Konta osobiste są automatycznie przypisane do właściciela');
          return;
        }

        const userData = await supabase.auth.getUser();
        console.log('Creating assignment for:', { accountId, employeeId, assignedBy: userData.data.user?.id });

        const { error } = await supabase
          .from('employee_email_account_assignments')
          .insert({
            email_account_id: accountId,
            employee_id: employeeId,
            can_send: true,
            can_receive: true,
            assigned_by: userData.data.user?.id
          });

        if (error) {
          console.error('Insert error:', error);
          throw error;
        }
        alert('Konto zostało przypisane do pracownika');
      }

      await fetchAccountsAndAssignments();
    } catch (err) {
      console.error('Error toggling assignment:', err);
      alert('Błąd podczas zarządzania przypisaniem: ' + JSON.stringify(err));
    }
  };

  if (loading) {
    return <div className="text-[#e5e4e2]/60 text-center py-8">Ładowanie...</div>;
  }

  const personalAccounts = allAccounts.filter(a => a.account_type === 'personal' && a.employee_id === employeeId);
  const sharedAccounts = allAccounts.filter(a => a.account_type === 'shared');
  const systemAccounts = allAccounts.filter(a => a.account_type === 'system');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">Konta Email</h3>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            {isEditing
              ? 'Tryb edycji - przypisuj lub odbieraj dostęp do kont wspólnych'
              : 'Zarządzaj kontami email dostępnymi dla pracownika'
            }
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-2 bg-[#1c1f33] border border-[#d3bb73]/20 text-[#e5e4e2] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#1c1f33]/80"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => router.push('/crm/settings/email-accounts')}
                  className="flex items-center gap-2 bg-[#d3bb73]/20 border border-[#d3bb73]/40 text-[#d3bb73] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/30"
                >
                  <Plus className="w-4 h-4" />
                  Dodaj konta
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
              >
                <Edit className="w-4 h-4" />
                Zarządzaj dostępem
              </button>
            )}
          </div>
        )}
      </div>

      {allAccounts.length === 0 ? (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-12 text-center">
          <Mail className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60 mb-4">Brak skonfigurowanych kont email</p>
          {isAdmin && (
            <button
              onClick={() => router.push('/crm/settings/email-accounts')}
              className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
            >
              Dodaj konta email w ustawieniach
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Konta osobiste */}
          <div>
            <h4 className="text-[#d3bb73] font-medium mb-3 flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Konta osobiste
            </h4>
            <p className="text-xs text-[#e5e4e2]/60 mb-3">
              Konta przypisane bezpośrednio do tego pracownika
            </p>
            {personalAccounts.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/40 italic">Brak kont osobistych</p>
            ) : (
              <div className="space-y-2">
                {personalAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    isAssigned={true}
                    onToggle={() => {}}
                    isAdmin={false}
                    isPersonal={true}
                    isEditing={isEditing}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Konta wspólne */}
          <div>
            <h4 className="text-[#d3bb73] font-medium mb-3 flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Konta wspólne (działowe)
            </h4>
            <p className="text-xs text-[#e5e4e2]/60 mb-3">
              Konta współdzielone przez zespół. Admin może przypisywać dostęp.
            </p>
            {sharedAccounts.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/40 italic">Brak kont wspólnych</p>
            ) : (
              <div className="space-y-2">
                {sharedAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    isAssigned={isAssigned(account.id)}
                    onToggle={() => toggleAssignment(account.id, account.account_type)}
                    isAdmin={isAdmin}
                    isPersonal={false}
                    isEditing={isEditing}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Konta systemowe */}
          <div>
            <h4 className="text-[#d3bb73] font-medium mb-3 flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Konta systemowe
            </h4>
            <p className="text-xs text-[#e5e4e2]/60 mb-3">
              Konta używane do automatycznych powiadomień systemowych. Dostępne dla wszystkich.
            </p>
            {systemAccounts.length === 0 ? (
              <p className="text-sm text-[#e5e4e2]/40 italic">Brak kont systemowych</p>
            ) : (
              <div className="space-y-2">
                {systemAccounts.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    isAssigned={true}
                    onToggle={() => {}}
                    isAdmin={false}
                    isPersonal={false}
                    isEditing={isEditing}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Preferencje powiadomień */}
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h4 className="text-[#d3bb73] font-medium flex items-center gap-2">
              <Mail className="w-5 h-5" />
              Preferencje powiadomień
            </h4>
            <p className="text-xs text-[#e5e4e2]/60 mt-1">
              Kontroluj, jakie typy wiadomości pracownik może widzieć
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 bg-[#0d0f1a] rounded-lg border border-[#d3bb73]/10">
            <div className="flex-1">
              <p className="text-sm font-medium text-[#e5e4e2]">
                Wiadomości z formularza kontaktowego
              </p>
              <p className="text-xs text-[#e5e4e2]/50 mt-0.5">
                Powiadomienia o nowych wiadomościach z formularza na stronie
              </p>
            </div>
            <button
              onClick={() => updateNotificationPreference('contact_form_messages', !notificationPrefs.contact_form_messages)}
              disabled={!isAdmin || !isEditing}
              className={`
                relative w-12 h-6 rounded-full transition-colors
                ${notificationPrefs.contact_form_messages
                  ? 'bg-[#d3bb73]'
                  : 'bg-[#e5e4e2]/20'
                }
                ${(!isAdmin || !isEditing) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span
                className={`
                  absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform
                  ${notificationPrefs.contact_form_messages ? 'translate-x-6' : 'translate-x-0'}
                `}
              />
            </button>
          </div>

          <div className="flex items-center justify-between p-3 bg-[#0d0f1a] rounded-lg border border-[#d3bb73]/10">
            <div className="flex-1">
              <p className="text-sm font-medium text-[#e5e4e2]">
                Wiadomości systemowe
              </p>
              <p className="text-xs text-[#e5e4e2]/50 mt-0.5">
                Automatyczne powiadomienia systemowe i alerty
              </p>
            </div>
            <button
              onClick={() => updateNotificationPreference('system_messages', !notificationPrefs.system_messages)}
              disabled={!isAdmin || !isEditing}
              className={`
                relative w-12 h-6 rounded-full transition-colors
                ${notificationPrefs.system_messages
                  ? 'bg-[#d3bb73]'
                  : 'bg-[#e5e4e2]/20'
                }
                ${(!isAdmin || !isEditing) ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span
                className={`
                  absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform
                  ${notificationPrefs.system_messages ? 'translate-x-6' : 'translate-x-0'}
                `}
              />
            </button>
          </div>
        </div>

        {!isEditing && (
          <p className="text-xs text-[#e5e4e2]/40 mt-3 italic">
            Włącz tryb edycji, aby zmienić preferencje powiadomień
          </p>
        )}
      </div>

      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl p-4">
        <h5 className="text-[#d3bb73] font-medium mb-2">Informacje</h5>
        <ul className="text-sm text-[#e5e4e2]/70 space-y-1 list-disc list-inside">
          <li><strong>Konta osobiste:</strong> Przypisane automatycznie do właściciela</li>
          <li><strong>Konta wspólne:</strong> Mogą być przypisane do wielu pracowników przez admina</li>
          <li><strong>Konta systemowe:</strong> Dostępne automatycznie dla wszystkich pracowników</li>
          <li><strong>Widok wiadomości:</strong> W /crm/messages widzisz tylko wiadomości z przypisanych kont</li>
        </ul>
      </div>
    </div>
  );
}

function AccountRow({
  account,
  isAssigned,
  onToggle,
  isAdmin,
  isPersonal,
  isEditing
}: {
  account: EmailAccount;
  isAssigned: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  isPersonal: boolean;
  isEditing: boolean;
}) {
  const getAccountTypeLabel = (type: string) => {
    switch(type) {
      case 'personal': return 'Osobiste';
      case 'shared': return 'Wspólne';
      case 'system': return 'Systemowe';
      default: return type;
    }
  };

  const getAccountTypeColor = (type: string) => {
    switch(type) {
      case 'personal': return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'shared': return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'system': return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      default: return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div
      className={`
        bg-[#0f1119] border rounded-lg p-4 transition-all
        ${isAssigned
          ? 'border-[#d3bb73]/40 bg-[#d3bb73]/5'
          : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/20'
        }
      `}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h5 className="text-[#e5e4e2] font-medium truncate">
              {account.account_name}
            </h5>
            <span className={`px-2 py-0.5 rounded text-xs border ${getAccountTypeColor(account.account_type)}`}>
              {getAccountTypeLabel(account.account_type)}
            </span>
            {isAssigned && (
              <span className="px-2 py-0.5 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs border border-[#d3bb73]/30">
                Przypisane
              </span>
            )}
          </div>
          <p className="text-sm text-[#e5e4e2]/70 flex items-center gap-2">
            <Mail className="w-4 h-4" />
            {account.email_address}
          </p>
          {account.department && (
            <p className="text-xs text-[#e5e4e2]/50 mt-1">
              Dział: {account.department}
            </p>
          )}
          {account.description && (
            <p className="text-xs text-[#e5e4e2]/50 mt-1">
              {account.description}
            </p>
          )}
        </div>

        {isEditing && isAdmin && !isPersonal && account.account_type !== 'system' && (
          <button
            onClick={onToggle}
            className={`
              flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${isAssigned
                ? 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                : 'bg-[#d3bb73]/20 text-[#d3bb73] border border-[#d3bb73]/30 hover:bg-[#d3bb73]/30'
              }
            `}
          >
            {isAssigned ? (
              <>
                <CheckSquare className="w-4 h-4" />
                Odbierz
              </>
            ) : (
              <>
                <Square className="w-4 h-4" />
                Przypisz
              </>
            )}
          </button>
        )}
        {!isEditing && isPersonal && (
          <span className="px-3 py-1.5 rounded-lg text-xs bg-blue-500/10 text-blue-400 border border-blue-500/20">
            Właściciel
          </span>
        )}
        {!isEditing && account.account_type === 'system' && (
          <span className="px-3 py-1.5 rounded-lg text-xs bg-purple-500/10 text-purple-400 border border-purple-500/20">
            Dla wszystkich
          </span>
        )}
      </div>
    </div>
  );
}
