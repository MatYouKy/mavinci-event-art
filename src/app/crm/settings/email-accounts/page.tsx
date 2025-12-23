'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { Mail, Plus, CreditCard as Edit, Trash2, Eye, EyeOff, Building2, User, Settings } from 'lucide-react';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';
import AddSystemEmailModal from '@/components/crm/AddSystemEmailModal';

interface EmailAccount {
  id: string;
  account_name: string;
  email_address: string;
  account_type: 'personal' | 'shared' | 'system';
  department: string | null;
  description: string | null;
  is_active: boolean;
  employee_id: string | null;
  employees?: {
    name: string;
    surname: string;
  };
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
}

export default function EmailAccountsManagementPage() {
  const router = useRouter();
  const { employee: currentEmployee } = useCurrentEmployee();
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingAccount, setEditingAccount] = useState<EmailAccount | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  const isAdmin =
    currentEmployee?.permissions?.includes('admin') ||
    currentEmployee?.permissions?.includes('messages_manage');

  useEffect(() => {
    if (isAdmin) {
      fetchAccounts();
    }
  }, [isAdmin]);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select(
          `
          *,
          employees!employee_email_accounts_employee_id_fkey (
            name,
            surname
          )
        `,
        )
        .order('is_active', { ascending: false })
        .order('account_type', { ascending: true })
        .order('account_name', { ascending: true });

      if (error) throw error;
      setAccounts(data || []);
    } catch (err) {
      console.error('Error fetching accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Czy na pewno chcesz usunąć to konto email?')) return;

    try {
      const { error } = await supabase
        .from('employee_email_accounts')
        .update({ is_active: false })
        .eq('id', id);

      if (error) throw error;
      alert('Konto zostało dezaktywowane');
      fetchAccounts();
    } catch (err) {
      console.error('Error deleting account:', err);
      alert('Błąd podczas usuwania konta');
    }
  };

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-center">
          <Mail className="mx-auto mb-4 h-16 w-16 text-[#e5e4e2]/20" />
          <h2 className="mb-2 text-2xl font-bold text-white">Brak dostępu</h2>
          <p className="text-[#e5e4e2]/60">Tylko administratorzy mogą zarządzać kontami email.</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119]">
        <div className="text-[#e5e4e2]/60">Ładowanie...</div>
      </div>
    );
  }

  const personalAccounts = accounts.filter((a) => a.account_type === 'personal');
  const sharedAccounts = accounts.filter((a) => a.account_type === 'shared');
  const systemAccounts = accounts.filter((a) => a.account_type === 'system');

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
    <div className="min-h-screen bg-[#0f1119] p-6">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="mb-2 text-3xl font-bold text-[#e5e4e2]">Zarządzanie kontami email</h1>
            <p className="text-[#e5e4e2]/60">
              Zarządzaj kontami email osobistymi, wspólnymi i systemowymi
            </p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            <Plus className="h-5 w-5" />
            Dodaj konto
          </button>
        </div>

        <div className="space-y-8">
          {/* System Accounts */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <Settings className="h-6 w-6 text-purple-400" />
              <h2 className="text-xl font-semibold text-[#e5e4e2]">Konta systemowe</h2>
              <span className="rounded border border-purple-500/30 bg-purple-500/20 px-2 py-1 text-xs text-purple-400">
                {systemAccounts.length}
              </span>
            </div>
            <p className="mb-4 text-sm text-[#e5e4e2]/60">
              Konta używane do automatycznych powiadomień. Dostępne dla wszystkich pracowników.
            </p>
            {systemAccounts.length === 0 ? (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center">
                <p className="text-[#e5e4e2]/40">Brak kont systemowych</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {systemAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    onEdit={setEditingAccount}
                    onDelete={handleDelete}
                    showPassword={showPasswords[account.id]}
                    togglePassword={(id) =>
                      setShowPasswords({ ...showPasswords, [id]: !showPasswords[id] })
                    }
                    getTypeLabel={getAccountTypeLabel}
                    getTypeColor={getAccountTypeColor}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Shared Accounts */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <Building2 className="h-6 w-6 text-green-400" />
              <h2 className="text-xl font-semibold text-[#e5e4e2]">Konta wspólne</h2>
              <span className="rounded border border-green-500/30 bg-green-500/20 px-2 py-1 text-xs text-green-400">
                {sharedAccounts.length}
              </span>
            </div>
            <p className="mb-4 text-sm text-[#e5e4e2]/60">
              Konta współdzielone przez zespół. Przypisywane do pracowników przez admina.
            </p>
            {sharedAccounts.length === 0 ? (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center">
                <p className="text-[#e5e4e2]/40">Brak kont wspólnych</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {sharedAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    onEdit={setEditingAccount}
                    onDelete={handleDelete}
                    showPassword={showPasswords[account.id]}
                    togglePassword={(id) =>
                      setShowPasswords({ ...showPasswords, [id]: !showPasswords[id] })
                    }
                    getTypeLabel={getAccountTypeLabel}
                    getTypeColor={getAccountTypeColor}
                  />
                ))}
              </div>
            )}
          </section>

          {/* Personal Accounts */}
          <section>
            <div className="mb-4 flex items-center gap-3">
              <User className="h-6 w-6 text-blue-400" />
              <h2 className="text-xl font-semibold text-[#e5e4e2]">Konta osobiste</h2>
              <span className="rounded border border-blue-500/30 bg-blue-500/20 px-2 py-1 text-xs text-blue-400">
                {personalAccounts.length}
              </span>
            </div>
            <p className="mb-4 text-sm text-[#e5e4e2]/60">
              Konta przypisane do konkretnych pracowników. Dostępne tylko dla właściciela.
            </p>
            {personalAccounts.length === 0 ? (
              <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-8 text-center">
                <p className="text-[#e5e4e2]/40">Brak kont osobistych</p>
              </div>
            ) : (
              <div className="grid gap-4">
                {personalAccounts.map((account) => (
                  <AccountCard
                    key={account.id}
                    account={account}
                    onEdit={setEditingAccount}
                    onDelete={handleDelete}
                    showPassword={showPasswords[account.id]}
                    togglePassword={(id) =>
                      setShowPasswords({ ...showPasswords, [id]: !showPasswords[id] })
                    }
                    getTypeLabel={getAccountTypeLabel}
                    getTypeColor={getAccountTypeColor}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      {showAddModal && (
        <AddSystemEmailModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            fetchAccounts();
            setShowAddModal(false);
          }}
        />
      )}

      {editingAccount && (
        <EditEmailAccountModal
          isOpen={!!editingAccount}
          account={editingAccount}
          onClose={() => setEditingAccount(null)}
          onUpdated={() => {
            fetchAccounts();
            setEditingAccount(null);
          }}
        />
      )}
    </div>
  );
}

function AccountCard({
  account,
  onEdit,
  onDelete,
  showPassword,
  togglePassword,
  getTypeLabel,
  getTypeColor,
}: {
  account: EmailAccount;
  onEdit: (account: EmailAccount) => void;
  onDelete: (id: string) => void;
  showPassword: boolean;
  togglePassword: (id: string) => void;
  getTypeLabel: (type: string) => string;
  getTypeColor: (type: string) => string;
}) {
  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6 transition-all hover:border-[#d3bb73]/20">
      <div className="mb-4 flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-2 flex items-center gap-3">
            <h3 className="text-lg font-medium text-[#e5e4e2]">{account.account_name}</h3>
            <span
              className={`rounded border px-2 py-1 text-xs ${getTypeColor(account.account_type)}`}
            >
              {getTypeLabel(account.account_type)}
            </span>
          </div>
          <p className="mb-1 flex items-center gap-2 text-sm text-[#e5e4e2]/70">
            <Mail className="h-4 w-4" />
            {account.email_address}
          </p>
          {account.department && (
            <p className="text-xs text-[#e5e4e2]/50">Dział: {account.department}</p>
          )}
          {account.description && (
            <p className="text-xs text-[#e5e4e2]/50">{account.description}</p>
          )}
          {account.employees && (
            <p className="text-xs text-[#e5e4e2]/50">
              Właściciel: {account.employees.name} {account.employees.surname}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => onEdit(account)}
            className="rounded-lg p-2 transition-colors hover:bg-[#d3bb73]/10"
            title="Edytuj"
          >
            <Edit className="h-4 w-4 text-[#d3bb73]" />
          </button>
          <button
            onClick={() => onDelete(account.id)}
            className="rounded-lg p-2 transition-colors hover:bg-red-500/10"
            title="Usuń"
          >
            <Trash2 className="h-4 w-4 text-red-400" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 text-sm md:grid-cols-2">
        <div className="space-y-2">
          <h4 className="font-medium text-[#d3bb73]">IMAP (Odbieranie)</h4>
          <InfoRow label="Serwer" value={`${account.imap_host}:${account.imap_port}`} />
          <InfoRow label="Login" value={account.imap_username} />
          <div className="flex items-center gap-2">
            <InfoRow label="Hasło" value={showPassword ? account.imap_password : '••••••••'} />
            <button
              onClick={() => togglePassword(account.id)}
              className="rounded p-1 hover:bg-[#0f1119]"
            >
              {showPassword ? (
                <EyeOff className="h-4 w-4 text-[#e5e4e2]/60" />
              ) : (
                <Eye className="h-4 w-4 text-[#e5e4e2]/60" />
              )}
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <h4 className="font-medium text-[#d3bb73]">SMTP (Wysyłanie)</h4>
          <InfoRow label="Serwer" value={`${account.smtp_host}:${account.smtp_port}`} />
          <InfoRow label="Login" value={account.smtp_username} />
          <InfoRow label="Hasło" value={showPassword ? account.smtp_password : '••••••••'} />
        </div>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span className="text-xs text-[#e5e4e2]/60">{label}</span>
      <p className="text-[#e5e4e2]">{value}</p>
    </div>
  );
}

function EditEmailAccountModal({
  isOpen,
  account,
  onClose,
  onUpdated,
}: {
  isOpen: boolean;
  account: EmailAccount;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const [formData, setFormData] = useState({
    account_name: account.account_name,
    email_address: account.email_address,
    account_type: account.account_type,
    department: account.department || '',
    description: account.description || '',
    imap_host: account.imap_host,
    imap_port: account.imap_port,
    imap_username: account.imap_username,
    imap_password: account.imap_password,
    smtp_host: account.smtp_host,
    smtp_port: account.smtp_port,
    smtp_username: account.smtp_username,
    smtp_password: account.smtp_password,
  });
  const [saving, setSaving] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('employee_email_accounts')
        .update({
          account_name: formData.account_name,
          email_address: formData.email_address,
          account_type: formData.account_type,
          department: formData.department || null,
          description: formData.description || null,
          imap_host: formData.imap_host,
          imap_port: formData.imap_port,
          imap_username: formData.imap_username,
          imap_password: formData.imap_password,
          smtp_host: formData.smtp_host,
          smtp_port: formData.smtp_port,
          smtp_username: formData.smtp_username,
          smtp_password: formData.smtp_password,
          updated_at: new Date().toISOString(),
        })
        .eq('id', account.id);

      if (error) throw error;
      alert('Konto zostało zaktualizowane');
      onUpdated();
    } catch (err) {
      console.error('Error updating account:', err);
      alert('Błąd podczas aktualizacji konta');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-3xl rounded-xl border border-[#d3bb73]/20 bg-[#0f1119] p-6">
        <h2 className="mb-6 text-xl font-light text-[#e5e4e2]">Edytuj konto email</h2>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Nazwa konta *</label>
              <input
                type="text"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Typ konta *</label>
              <select
                value={formData.account_type}
                onChange={(e) => setFormData({ ...formData, account_type: e.target.value as any })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              >
                <option value="personal">Osobiste</option>
                <option value="shared">Wspólne</option>
                <option value="system">Systemowe</option>
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Adres email *</label>
            <input
              type="email"
              value={formData.email_address}
              onChange={(e) => setFormData({ ...formData, email_address: e.target.value })}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
            />
          </div>

          {formData.account_type === 'shared' && (
            <div>
              <label className="mb-2 block text-sm text-[#e5e4e2]/60">Dział</label>
              <input
                type="text"
                value={formData.department}
                onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
                placeholder="np. Biuro, Finanse, Kadry"
              />
            </div>
          )}

          <div>
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Opis</label>
            <textarea
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              className="min-h-[80px] w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              placeholder="Krótki opis konta"
            />
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <h3 className="mb-4 font-medium text-[#d3bb73]">IMAP</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={formData.imap_host}
                onChange={(e) => setFormData({ ...formData, imap_host: e.target.value })}
                placeholder="Serwer IMAP"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
              <input
                type="number"
                value={formData.imap_port}
                onChange={(e) => setFormData({ ...formData, imap_port: parseInt(e.target.value) })}
                placeholder="Port"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
              <input
                type="text"
                value={formData.imap_username}
                onChange={(e) => setFormData({ ...formData, imap_username: e.target.value })}
                placeholder="Login"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
              <input
                type="password"
                value={formData.imap_password}
                onChange={(e) => setFormData({ ...formData, imap_password: e.target.value })}
                placeholder="Hasło"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <h3 className="mb-4 font-medium text-[#d3bb73]">SMTP</h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="text"
                value={formData.smtp_host}
                onChange={(e) => setFormData({ ...formData, smtp_host: e.target.value })}
                placeholder="Serwer SMTP"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
              <input
                type="number"
                value={formData.smtp_port}
                onChange={(e) => setFormData({ ...formData, smtp_port: parseInt(e.target.value) })}
                placeholder="Port"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
              <input
                type="text"
                value={formData.smtp_username}
                onChange={(e) => setFormData({ ...formData, smtp_username: e.target.value })}
                placeholder="Login"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
              <input
                type="password"
                value={formData.smtp_password}
                onChange={(e) => setFormData({ ...formData, smtp_password: e.target.value })}
                placeholder="Hasło"
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-4 py-2 text-[#e5e4e2]"
              />
            </div>
          </div>
        </div>

        <div className="mt-6 flex gap-3 border-t border-[#d3bb73]/10 pt-6">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-50"
          >
            {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
          </button>
          <button
            onClick={onClose}
            disabled={saving}
            className="rounded-lg px-4 py-2 text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
