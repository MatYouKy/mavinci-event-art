'use client';

import { useState, useEffect } from 'react';
import { Mail, Plus, Trash2, Eye, EyeOff, Edit, Save, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface EmailAccount {
  id: string;
  account_name: string;
  email_address: string;
  imap_host: string;
  imap_port: number;
  imap_username: string;
  imap_password: string;
  imap_use_ssl: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  signature: string | null;
  is_default: boolean;
  is_active: boolean;
}

interface Props {
  employeeId: string;
  employeeEmail: string;
  isAdmin: boolean;
}

export default function EmployeeEmailAccountsTab({ employeeId, employeeEmail, isAdmin }: Props) {
  const [accounts, setAccounts] = useState<EmailAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchAccounts();
  }, [employeeId]);

  const fetchAccounts = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('employee_email_accounts')
        .select('*')
        .eq('employee_id', employeeId)
        .order('is_default', { ascending: false });

      if (error) throw error;
      setAccounts(data || []);
    } catch (err) {
      console.error('Error fetching email accounts:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!isAdmin) {
      alert('Tylko administrator może usuwać konta email');
      return;
    }

    if (!confirm('Czy na pewno chcesz usunąć to konto email?')) return;

    try {
      const { error } = await supabase
        .from('employee_email_accounts')
        .delete()
        .eq('id', id);

      if (error) throw error;
      alert('Konto email zostało usunięte');
      fetchAccounts();
    } catch (err) {
      console.error('Error deleting account:', err);
      alert('Błąd podczas usuwania konta');
    }
  };

  const toggleDefault = async (id: string) => {
    if (!isAdmin) return;

    try {
      await supabase
        .from('employee_email_accounts')
        .update({ is_default: false })
        .eq('employee_id', employeeId);

      const { error } = await supabase
        .from('employee_email_accounts')
        .update({ is_default: true })
        .eq('id', id);

      if (error) throw error;
      alert('Konto domyślne zostało zmienione');
      fetchAccounts();
    } catch (err) {
      console.error('Error updating default:', err);
      alert('Błąd podczas zmiany konta domyślnego');
    }
  };

  if (loading) {
    return <div className="text-[#e5e4e2]/60 text-center py-8">Ładowanie...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-light text-[#e5e4e2]">Konta Email</h3>
          <p className="text-sm text-[#e5e4e2]/60 mt-1">
            Zarządzaj kontami email przypisanymi do pracownika
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg text-sm font-medium hover:bg-[#d3bb73]/90"
          >
            <Plus className="w-4 h-4" />
            Dodaj konto
          </button>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-12 text-center">
          <Mail className="w-16 h-16 text-[#e5e4e2]/20 mx-auto mb-4" />
          <p className="text-[#e5e4e2]/60 mb-4">Brak skonfigurowanych kont email</p>
          {isAdmin && (
            <button
              onClick={() => setShowAddModal(true)}
              className="text-[#d3bb73] hover:text-[#d3bb73]/80 text-sm"
            >
              Dodaj pierwsze konto
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {accounts.map((account) => (
            <div
              key={account.id}
              className="bg-[#1c1f33] border border-[#d3bb73]/10 rounded-xl p-6"
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h4 className="text-[#e5e4e2] font-medium text-lg">
                      {account.account_name}
                    </h4>
                    {account.is_default && (
                      <span className="px-2 py-1 bg-[#d3bb73]/20 text-[#d3bb73] rounded text-xs">
                        Domyślne
                      </span>
                    )}
                    {!account.is_active && (
                      <span className="px-2 py-1 bg-red-500/20 text-red-400 rounded text-xs">
                        Nieaktywne
                      </span>
                    )}
                  </div>
                  <p className="text-[#e5e4e2]/70 text-sm flex items-center gap-2">
                    <Mail className="w-4 h-4" />
                    {account.email_address}
                  </p>
                </div>
                {isAdmin && (
                  <div className="flex items-center gap-2">
                    {!account.is_default && (
                      <button
                        onClick={() => toggleDefault(account.id)}
                        className="text-xs text-[#d3bb73] hover:text-[#d3bb73]/80 px-3 py-1 rounded border border-[#d3bb73]/30 hover:border-[#d3bb73]/50"
                      >
                        Ustaw domyślne
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(account.id)}
                      className="p-2 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
                <div className="space-y-3">
                  <h5 className="text-[#d3bb73] font-medium mb-2">IMAP (Odbieranie)</h5>
                  <InfoRow label="Serwer" value={`${account.imap_host}:${account.imap_port}`} />
                  <InfoRow label="Login" value={account.imap_username} />
                  <div className="flex items-center gap-2">
                    <InfoRow
                      label="Hasło"
                      value={showPasswords[account.id] ? account.imap_password : '••••••••'}
                    />
                    <button
                      onClick={() => setShowPasswords({
                        ...showPasswords,
                        [account.id]: !showPasswords[account.id]
                      })}
                      className="p-1 hover:bg-[#0f1119] rounded"
                    >
                      {showPasswords[account.id] ? (
                        <EyeOff className="w-4 h-4 text-[#e5e4e2]/60" />
                      ) : (
                        <Eye className="w-4 h-4 text-[#e5e4e2]/60" />
                      )}
                    </button>
                  </div>
                  <InfoRow label="SSL" value={account.imap_use_ssl ? 'Tak' : 'Nie'} />
                </div>

                <div className="space-y-3">
                  <h5 className="text-[#d3bb73] font-medium mb-2">SMTP (Wysyłanie)</h5>
                  <InfoRow label="Serwer" value={`${account.smtp_host}:${account.smtp_port}`} />
                  <InfoRow label="Login" value={account.smtp_username} />
                  <InfoRow
                    label="Hasło"
                    value={showPasswords[`${account.id}-smtp`] ? account.smtp_password : '••••••••'}
                  />
                  <InfoRow label="TLS" value={account.smtp_use_tls ? 'Tak' : 'Nie'} />
                </div>
              </div>

              {account.signature && (
                <div className="mt-4 pt-4 border-t border-[#d3bb73]/10">
                  <p className="text-xs text-[#e5e4e2]/60 mb-2">Podpis email:</p>
                  <pre className="text-sm text-[#e5e4e2]/70 whitespace-pre-wrap font-mono bg-[#0f1119] p-3 rounded">
                    {account.signature}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {showAddModal && (
        <AddEmailAccountModal
          isOpen={showAddModal}
          onClose={() => setShowAddModal(false)}
          employeeId={employeeId}
          employeeEmail={employeeEmail}
          onAdded={fetchAccounts}
        />
      )}
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

function AddEmailAccountModal({
  isOpen,
  onClose,
  employeeId,
  employeeEmail,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeEmail: string;
  onAdded: () => void;
}) {
  const [formData, setFormData] = useState({
    account_name: '',
    from_name: '',
    email_address: '',
    imap_host: 'imap.gmail.com',
    imap_port: 993,
    imap_username: '',
    imap_password: '',
    imap_use_ssl: true,
    smtp_host: 'smtp.gmail.com',
    smtp_port: 587,
    smtp_username: '',
    smtp_password: '',
    smtp_use_tls: true,
    signature: '',
    is_default: false,
    is_active: true,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async () => {
    if (!formData.account_name || !formData.from_name || !formData.email_address) {
      alert('Wypełnij wymagane pola (Nazwa konta, Nazwa wyświetlana, Adres email)');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('employee_email_accounts').insert([
        {
          ...formData,
          employee_id: employeeId,
        },
      ]);

      if (error) throw error;

      alert('✅ Konto email zostało pomyślnie dodane!');
      onAdded();
      onClose();
    } catch (err) {
      console.error('Error adding email account:', err);
      alert('❌ Błąd podczas dodawania konta email: ' + (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    if (!formData.smtp_host || !formData.smtp_username || !formData.smtp_password) {
      alert('Wypełnij dane SMTP aby przetestować połączenie');
      return;
    }

    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        alert('Musisz być zalogowany');
        return;
      }

      // Create temporary account for testing
      const tempAccount = {
        id: 'test-' + Date.now(),
        ...formData,
        employee_id: employeeId,
      };

      // Try to send a test email using our send-email function
      const apiUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-email`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: formData.email_address,
          subject: 'Test połączenia SMTP',
          body: '<p>To jest testowa wiadomość sprawdzająca poprawność konfiguracji SMTP.</p>',
          emailAccountId: tempAccount.id,
        }),
      });

      const result = await response.json();

      if (result.success) {
        alert('✅ Połączenie SMTP działa poprawnie! Test email został wysłany.');
      } else {
        alert('❌ Test połączenia nie powiódł się: ' + result.error);
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      alert('❌ Błąd podczas testowania połączenia: ' + (error as Error).message);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-[#0f1119] border border-[#d3bb73]/20 rounded-xl p-6 max-w-2xl w-full my-8">
        <h2 className="text-xl font-light text-[#e5e4e2] mb-6">Dodaj konto email</h2>

        <div className="space-y-6 max-h-[70vh] overflow-y-auto pr-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa konta *</label>
              <input
                type="text"
                value={formData.account_name}
                onChange={(e) => setFormData({ ...formData, account_name: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                placeholder="np. Biuro główne"
              />
            </div>
            <div>
              <label className="block text-sm text-[#e5e4e2]/60 mb-2">Nazwa wyświetlana *</label>
              <input
                type="text"
                value={formData.from_name}
                onChange={(e) => setFormData({ ...formData, from_name: e.target.value })}
                className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                placeholder="np. Jan Kowalski"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Adres email *</label>
            <input
              type="email"
              value={formData.email_address}
              onChange={(e) => setFormData({ ...formData, email_address: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
              placeholder="biuro@firma.pl"
            />
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <h3 className="text-[#d3bb73] font-medium mb-4">Konfiguracja IMAP (odbieranie)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Serwer IMAP</label>
                <input
                  type="text"
                  value={formData.imap_host}
                  onChange={(e) => setFormData({ ...formData, imap_host: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Port</label>
                <input
                  type="number"
                  value={formData.imap_port}
                  onChange={(e) => setFormData({ ...formData, imap_port: parseInt(e.target.value) })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Login IMAP</label>
                <input
                  type="text"
                  value={formData.imap_username}
                  onChange={(e) => setFormData({ ...formData, imap_username: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Hasło IMAP</label>
                <input
                  type="password"
                  value={formData.imap_password}
                  onChange={(e) => setFormData({ ...formData, imap_password: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>

          <div className="border-t border-[#d3bb73]/10 pt-4">
            <h3 className="text-[#d3bb73] font-medium mb-4">Konfiguracja SMTP (wysyłanie)</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Serwer SMTP</label>
                <input
                  type="text"
                  value={formData.smtp_host}
                  onChange={(e) => setFormData({ ...formData, smtp_host: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Port</label>
                <input
                  type="number"
                  value={formData.smtp_port}
                  onChange={(e) => setFormData({ ...formData, smtp_port: parseInt(e.target.value) })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Login SMTP</label>
                <input
                  type="text"
                  value={formData.smtp_username}
                  onChange={(e) => setFormData({ ...formData, smtp_username: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
              <div>
                <label className="block text-sm text-[#e5e4e2]/60 mb-2">Hasło SMTP</label>
                <input
                  type="password"
                  value={formData.smtp_password}
                  onChange={(e) => setFormData({ ...formData, smtp_password: e.target.value })}
                  className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2]"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm text-[#e5e4e2]/60 mb-2">Podpis email</label>
            <textarea
              value={formData.signature}
              onChange={(e) => setFormData({ ...formData, signature: e.target.value })}
              className="w-full bg-[#1c1f33] border border-[#d3bb73]/20 rounded-lg px-4 py-2 text-[#e5e4e2] min-h-[100px]"
              placeholder="Pozdrawiam,&#10;Jan Kowalski"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_default}
                onChange={(e) => setFormData({ ...formData, is_default: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-[#e5e4e2]">Ustaw jako domyślne</span>
            </label>
          </div>
        </div>

        <div className="flex gap-3 pt-6 mt-6 border-t border-[#d3bb73]/10">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex-1 bg-[#d3bb73] text-[#1c1f33] px-4 py-2 rounded-lg font-medium hover:bg-[#d3bb73]/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Zapisywanie...' : 'Dodaj konto'}
          </button>
          <button
            onClick={onClose}
            disabled={saving || testing}
            className="px-4 py-2 rounded-lg text-[#e5e4e2]/60 hover:bg-[#1c1f33] disabled:opacity-50"
          >
            Anuluj
          </button>
        </div>
      </div>
    </div>
  );
}
