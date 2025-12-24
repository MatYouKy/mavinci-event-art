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
  can_receive_contact_forms: boolean;
}

interface Props {
  employeeId: string;
  employeeEmail: string;
  isAdmin: boolean;
}

interface Employee {
  can_receive_contact_forms: boolean;
  personal_email: string | null;
  notification_email_preference: 'work' | 'personal' | 'both' | 'none';
}

export default function EmployeeEmailAccountsTab({ employeeId, employeeEmail, isAdmin }: Props) {
  const router = useRouter();
  const [allAccounts, setAllAccounts] = useState<EmailAccount[]>([]);
  const [assignments, setAssignments] = useState<AccountAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [isEditingPersonalEmail, setIsEditingPersonalEmail] = useState(false);
  const [personalEmailInput, setPersonalEmailInput] = useState('');
  const [notificationPreference, setNotificationPreference] = useState<'work' | 'personal' | 'both' | 'none'>('work');

  useEffect(() => {
    fetchAccountsAndAssignments();
    fetchEmployee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employeeId]);

  useEffect(() => {
    if (employee) {
      setPersonalEmailInput(employee.personal_email || '');
      setNotificationPreference(employee.notification_email_preference || 'work');
    }
  }, [employee]);

  const fetchEmployee = async () => {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select('can_receive_contact_forms, personal_email, notification_email_preference')
        .eq('id', employeeId)
        .maybeSingle();

      if (error) throw error;
      setEmployee(data);
    } catch (err) {
      console.error('Error fetching employee:', err);
    }
  };

  const fetchAccountsAndAssignments = async () => {
    try {
      setLoading(true);

      // Fetch ALL active accounts (personal, shared, system)
      const [accountsRes, assignmentsRes] = await Promise.all([
        supabase
          .from('employee_email_accounts')
          .select(
            'id, account_name, email_address, account_type, department, description, is_active, employee_id',
          )
          .eq('is_active', true)
          .order('account_type', { ascending: false })
          .order('account_name', { ascending: true }),

        supabase
          .from('employee_email_account_assignments')
          .select('*')
          .eq('employee_id', employeeId),
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

  const isAssigned = (accountId: string): boolean => {
    return assignments.some((a) => a.email_account_id === accountId);
  };

  const toggleAssignment = async (accountId: string, accountType: string) => {
    if (!isAdmin) {
      alert('Tylko administrator może zarządzać przypisaniami kont email');
      return;
    }

    const assigned = isAssigned(accountId);

    try {
      if (assigned) {
        const assignment = assignments.find((a) => a.email_account_id === accountId);
        if (!assignment) return;

        const { error } = await supabase
          .from('employee_email_account_assignments')
          .delete()
          .eq('id', assignment.id);

        if (error) throw error;
        alert('✓ Dostęp do konta został odebrany.');
      } else {
        if (accountType === 'personal') {
          alert('Konta osobiste są automatycznie przypisane do właściciela');
          return;
        }

        const userData = await supabase.auth.getUser();

        const { error } = await supabase.from('employee_email_account_assignments').insert({
          email_account_id: accountId,
          employee_id: employeeId,
          can_send: true,
          can_receive: true,
          can_receive_contact_forms: false,
          assigned_by: userData.data.user?.id,
        });

        if (error) throw error;
        alert('✓ Konto zostało przypisane.');
      }

      await fetchAccountsAndAssignments();
    } catch (err) {
      console.error('Error toggling assignment:', err);
      alert('Błąd podczas zarządzania przypisaniem: ' + JSON.stringify(err));
    }
  };

  const toggleContactFormAccess = async () => {
    if (!isAdmin) return;

    try {
      const { error } = await supabase
        .from('employees')
        .update({
          can_receive_contact_forms: !employee?.can_receive_contact_forms,
        })
        .eq('id', employeeId);

      if (error) throw error;

      await fetchEmployee();
      alert('✓ Dostęp do formularza kontaktowego został zaktualizowany.');
    } catch (err) {
      console.error('Error toggling contact form access:', err);
      alert('Błąd podczas zmiany dostępu do formularza: ' + JSON.stringify(err));
    }
  };

  const updatePersonalEmail = async () => {
    if (!isAdmin) {
      alert('Tylko administrator może edytować email osobisty');
      return;
    }

    try {
      const emailToSave = personalEmailInput.trim() || null;

      if (notificationPreference === 'personal' || notificationPreference === 'both') {
        if (!emailToSave) {
          alert('Email osobisty jest wymagany gdy preferencja powiadomień to "personal" lub "both"');
          return;
        }
      }

      const { error } = await supabase
        .from('employees')
        .update({
          personal_email: emailToSave,
          notification_email_preference: notificationPreference,
        })
        .eq('id', employeeId);

      if (error) throw error;

      await fetchEmployee();
      setIsEditingPersonalEmail(false);
      alert('✓ Email osobisty został zaktualizowany.');
    } catch (err: any) {
      console.error('Error updating personal email:', err);
      alert('Błąd podczas aktualizacji: ' + (err?.message || JSON.stringify(err)));
    }
  };

  const cancelEditPersonalEmail = () => {
    setPersonalEmailInput(employee?.personal_email || '');
    setNotificationPreference(employee?.notification_email_preference || 'work');
    setIsEditingPersonalEmail(false);
  };

  if (loading) {
    return <div className="py-8 text-center text-[#e5e4e2]/60">Ładowanie...</div>;
  }

  const personalAccounts = allAccounts.filter(
    (a) => a.account_type === 'personal' && a.employee_id === employeeId,
  );
  const sharedAccounts = allAccounts.filter((a) => a.account_type === 'shared');
  const systemAccounts = allAccounts.filter((a) => a.account_type === 'system');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">Konta Email</h3>
          <p className="mt-1 text-sm text-[#e5e4e2]/60">
            {isEditing
              ? 'Zaznacz/odznacz checkboxy przy kontach wspólnych i systemowych - zmiany są zapisywane automatycznie'
              : 'Lista kont email dostępnych dla pracownika. Admin może zarządzać dostępem do kont wspólnych i systemowych.'}
          </p>
        </div>
        {isAdmin && (
          <div className="flex gap-2">
            {isEditing ? (
              <>
                <button
                  onClick={() => setIsEditing(false)}
                  className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#1c1f33]/80"
                >
                  Anuluj
                </button>
                <button
                  onClick={() => router.push('/crm/settings/email-accounts')}
                  className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/40 bg-[#d3bb73]/20 px-4 py-2 text-sm font-medium text-[#d3bb73] hover:bg-[#d3bb73]/30"
                >
                  <Plus className="h-4 w-4" />
                  Dodaj konta
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
              >
                <Edit className="h-4 w-4" />
                Zarządzaj dostępem
              </button>
            )}
          </div>
        )}
      </div>

      {allAccounts.length === 0 ? (
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-12 text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <p className="mb-4 text-[#e5e4e2]/60">Brak skonfigurowanych kont email</p>
          {isAdmin && (
            <button
              onClick={() => router.push('/crm/settings/email-accounts')}
              className="text-sm text-[#d3bb73] hover:text-[#d3bb73]/80"
            >
              Dodaj konta email w ustawieniach
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {/* Email osobisty pracownika - tylko admin */}
          {isAdmin && (
            <div className="border-b border-[#d3bb73]/10 pb-6">
              <h4 className="mb-3 flex items-center gap-2 font-medium text-[#d3bb73]">
                <Mail className="h-5 w-5" />
                Email osobisty pracownika
              </h4>
              <p className="mb-3 text-xs text-[#e5e4e2]/60">
                Email prywatny pracownika używany do powiadomień poza systemem. Tylko admin może edytować.
              </p>
              <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
                {isEditingPersonalEmail ? (
                  <div className="space-y-4">
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Email osobisty
                      </label>
                      <input
                        type="email"
                        value={personalEmailInput}
                        onChange={(e) => setPersonalEmailInput(e.target.value)}
                        placeholder="np. jan.kowalski@gmail.com"
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
                      />
                    </div>
                    <div>
                      <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                        Preferencja powiadomień email
                      </label>
                      <select
                        value={notificationPreference}
                        onChange={(e) => setNotificationPreference(e.target.value as any)}
                        className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-4 py-2 text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                      >
                        <option value="work">Tylko służbowy ({employeeEmail})</option>
                        <option value="personal">Tylko osobisty</option>
                        <option value="both">Oba (służbowy + osobisty)</option>
                        <option value="none">Brak emaili (tylko powiadomienia w systemie)</option>
                      </select>
                      <p className="mt-1 text-xs text-[#e5e4e2]/50">
                        Wybierz na jaki adres wysyłać powiadomienia o wydarzeniach i zadaniach
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={updatePersonalEmail}
                        className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
                      >
                        Zapisz
                      </button>
                      <button
                        onClick={cancelEditPersonalEmail}
                        className="rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-sm font-medium text-[#e5e4e2] hover:bg-[#1c1f33]/80"
                      >
                        Anuluj
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="mb-2 flex items-center gap-2">
                        <p className="font-medium text-[#e5e4e2]">
                          {employee?.personal_email || (
                            <span className="italic text-[#e5e4e2]/40">Nie ustawiono</span>
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-[#e5e4e2]/60">
                        Preferencja powiadomień:{' '}
                        <span className="font-medium text-[#d3bb73]">
                          {notificationPreference === 'work' && 'Tylko służbowy'}
                          {notificationPreference === 'personal' && 'Tylko osobisty'}
                          {notificationPreference === 'both' && 'Oba (służbowy + osobisty)'}
                          {notificationPreference === 'none' && 'Brak emaili'}
                        </span>
                      </p>
                    </div>
                    <button
                      onClick={() => setIsEditingPersonalEmail(true)}
                      className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] px-3 py-1.5 text-sm font-medium text-[#e5e4e2] hover:bg-[#1c1f33]"
                    >
                      <Edit className="h-4 w-4" />
                      Edytuj
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Konta osobiste */}
          <div>
            <h4 className="mb-3 flex items-center gap-2 font-medium text-[#d3bb73]">
              <Mail className="h-5 w-5" />
              Konta osobiste
            </h4>
            <p className="mb-3 text-xs text-[#e5e4e2]/60">
              Konta przypisane bezpośrednio do tego pracownika
            </p>
            {personalAccounts.length === 0 ? (
              <p className="text-sm italic text-[#e5e4e2]/40">Brak kont osobistych</p>
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
            <h4 className="mb-3 flex items-center gap-2 font-medium text-[#d3bb73]">
              <Mail className="h-5 w-5" />
              Konta wspólne (działowe)
            </h4>
            <p className="mb-3 text-xs text-[#e5e4e2]/60">
              Konta współdzielone przez zespół. Admin może przypisywać dostęp.
            </p>
            {sharedAccounts.length === 0 ? (
              <p className="text-sm italic text-[#e5e4e2]/40">Brak kont wspólnych</p>
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
            <h4 className="mb-3 flex items-center gap-2 font-medium text-[#d3bb73]">
              <Mail className="h-5 w-5" />
              Konta systemowe
            </h4>
            <p className="mb-3 text-xs text-[#e5e4e2]/60">
              Konta używane do automatycznych powiadomień systemowych. Admin przypisuje dostęp.
            </p>
            {systemAccounts.length === 0 ? (
              <p className="text-sm italic text-[#e5e4e2]/40">Brak kont systemowych</p>
            ) : (
              <div className="space-y-2">
                {systemAccounts.map((account) => (
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

          {/* Dostęp do formularza kontaktowego - niezależna sekcja */}
          <div className="border-t border-[#d3bb73]/10 pt-6">
            <h4 className="mb-3 flex items-center gap-2 font-medium text-[#d3bb73]">
              <CheckSquare className="h-5 w-5" />
              Formularz kontaktowy
            </h4>
            <p className="mb-3 text-xs text-[#e5e4e2]/60">
              Dostęp do wiadomości z formularza kontaktowego na stronie. Niezależny od kont email.
            </p>
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-full bg-green-500/20 p-2">
                    <CheckSquare className="h-5 w-5 text-green-400" />
                  </div>
                  <div>
                    <p className="font-medium text-[#e5e4e2]">Dostęp do formularza kontaktowego</p>
                    <p className="text-xs text-[#e5e4e2]/60">
                      {employee?.can_receive_contact_forms
                        ? 'Pracownik widzi wiadomości z formularza'
                        : 'Pracownik nie ma dostępu do formularza'}
                    </p>
                  </div>
                </div>
                <button
                  onClick={toggleContactFormAccess}
                  disabled={!isAdmin || !isEditing}
                  className={`rounded-lg p-2 transition-all ${
                    !isAdmin || !isEditing ? 'cursor-not-allowed opacity-50' : 'hover:bg-[#0f1119]'
                  }`}
                  title={
                    !isAdmin
                      ? 'Tylko admin może zarządzać'
                      : !isEditing
                        ? 'Włącz tryb edycji'
                        : employee?.can_receive_contact_forms
                          ? 'Odbierz dostęp'
                          : 'Nadaj dostęp'
                  }
                >
                  {employee?.can_receive_contact_forms ? (
                    <CheckSquare className="h-6 w-6 text-green-400" />
                  ) : (
                    <Square className="h-6 w-6 text-[#e5e4e2]/30" />
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-4">
        <h5 className="mb-2 font-medium text-[#d3bb73]">Jak to działa?</h5>
        <ul className="space-y-2 text-sm text-[#e5e4e2]/70">
          <li className="flex gap-2">
            <span className="font-bold text-[#d3bb73]">•</span>
            <span>
              <strong>Email osobisty:</strong> Admin ustawia prywatny email pracownika i wybiera gdzie wysyłać powiadomienia (służbowy/osobisty/oba/brak)
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#d3bb73]">•</span>
            <span>
              <strong>Konta osobiste:</strong> Przypisane automatycznie do właściciela, nie można
              ich odebrać
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#d3bb73]">•</span>
            <span>
              <strong>Konta wspólne i systemowe:</strong> Admin przypisuje dostęp ręcznie - kliknij
              &quot;Zarządzaj dostępem&quot; i zaznacz checkbox przy koncie
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#d3bb73]">•</span>
            <span>
              <strong>Formularz kontaktowy:</strong> Niezależna opcja kontrolująca dostęp do
              wiadomości z formularza na stronie
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#d3bb73]">•</span>
            <span>
              <strong>Efekt w /crm/messages:</strong> Pracownik widzi tylko wiadomości z kont, do
              których ma dostęp
            </span>
          </li>
          <li className="flex gap-2">
            <span className="font-bold text-[#d3bb73]">•</span>
            <span>
              <strong>Zarządzanie kontami:</strong> Edycja/usuwanie/dodawanie kont w /crm/settings
              (tylko admin)
            </span>
          </li>
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
  isEditing,
}: {
  account: EmailAccount;
  isAssigned: boolean;
  onToggle: () => void;
  isAdmin: boolean;
  isPersonal: boolean;
  isEditing: boolean;
}) {
  const getAccountTypeLabel = (type: string) => {
    switch (type) {
      case 'personal':
        return 'Osobiste';
      case 'shared':
        return 'Wspólne';
      case 'system':
        return 'Systemowe';
      default:
        return type;
    }
  };

  const getAccountTypeColor = (type: string) => {
    switch (type) {
      case 'personal':
        return 'bg-blue-500/20 text-blue-400 border-blue-500/30';
      case 'shared':
        return 'bg-green-500/20 text-green-400 border-green-500/30';
      case 'system':
        return 'bg-purple-500/20 text-purple-400 border-purple-500/30';
      default:
        return 'bg-gray-500/20 text-gray-400 border-gray-500/30';
    }
  };

  return (
    <div
      className={`rounded-lg border bg-[#0f1119] p-4 transition-all ${
        isAssigned
          ? 'border-[#d3bb73]/40 bg-[#d3bb73]/5'
          : 'border-[#d3bb73]/10 hover:border-[#d3bb73]/20'
      } `}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex items-center gap-2">
            <h5 className="truncate font-medium text-[#e5e4e2]">{account.account_name}</h5>
            <span
              className={`rounded border px-2 py-0.5 text-xs ${getAccountTypeColor(account.account_type)}`}
            >
              {getAccountTypeLabel(account.account_type)}
            </span>
            {isAssigned && !isEditing && (
              <span className="rounded border border-[#d3bb73]/30 bg-[#d3bb73]/20 px-2 py-0.5 text-xs text-[#d3bb73]">
                Przypisane
              </span>
            )}
          </div>
          <p className="flex items-center gap-2 text-sm text-[#e5e4e2]/70">
            <Mail className="h-4 w-4" />
            {account.email_address}
          </p>
          {account.department && (
            <p className="mt-1 text-xs text-[#e5e4e2]/50">Dział: {account.department}</p>
          )}
          {account.description && (
            <p className="mt-1 text-xs text-[#e5e4e2]/50">{account.description}</p>
          )}
        </div>

        {isEditing && isAdmin && !isPersonal && (
          <div className="flex flex-col items-end gap-2">
            <label className="group flex cursor-pointer items-center gap-3">
              <input type="checkbox" checked={isAssigned} onChange={onToggle} className="hidden" />
              <div
                className={`relative h-5 w-5 rounded border-2 transition-all ${
                  isAssigned
                    ? 'border-[#d3bb73] bg-[#d3bb73]'
                    : 'border-[#e5e4e2]/30 group-hover:border-[#d3bb73]/50'
                } `}
              >
                {isAssigned && (
                  <CheckSquare
                    className="absolute inset-0.5 h-4 w-4 text-[#1c1f33]"
                    strokeWidth={3}
                  />
                )}
              </div>
              <span className="text-sm text-[#e5e4e2]/70 group-hover:text-[#e5e4e2]">
                {isAssigned ? 'Ma dostęp' : 'Brak dostępu'}
              </span>
            </label>
          </div>
        )}
        {!isEditing && isPersonal && (
          <span className="rounded-lg border border-blue-500/20 bg-blue-500/10 px-3 py-1.5 text-xs text-blue-400">
            Właściciel
          </span>
        )}
      </div>
    </div>
  );
}
