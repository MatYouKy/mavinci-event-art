'use client';

import { useState } from 'react';
import { X, Mail, Server, Lock, Globe, CheckCircle2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface AddSystemEmailModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ReceiveProtocol = 'imap' | 'pop3';

export default function AddSystemEmailModal({
  isOpen,
  onClose,
  onSuccess,
}: AddSystemEmailModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [receiveProtocol, setReceiveProtocol] = useState<ReceiveProtocol>('imap');

  const [formData, setFormData] = useState({
    accountName: '',
    fromName: '',
    emailAddress: '',
    smtpHost: '',
    smtpPort: '587',
    smtpUsername: '',
    smtpPassword: '',
    smtpUseTls: true,
    receiveHost: '',
    receivePort: '993',
    receiveUsername: '',
    receivePassword: '',
    receiveUseSsl: true,
    isSystemAccount: false,
    isActive: true,
  });

  const handleProtocolChange = (protocol: ReceiveProtocol) => {
    setReceiveProtocol(protocol);
    setFormData((prev) => ({
      ...prev,
      receivePort: protocol === 'imap' ? '993' : '995',
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.accountName || !formData.emailAddress || !formData.smtpHost || !formData.receiveHost) {
      showSnackbar('Wypełnij wszystkie wymagane pola', 'error');
      return;
    }

    try {
      setLoading(true);

      if (formData.isSystemAccount) {
        await supabase
          .from('employee_email_accounts')
          .update({ is_system_account: false })
          .eq('is_system_account', true);
      }

      const { error } = await supabase.from('employee_email_accounts').insert([
        {
          account_name: formData.accountName,
          from_name: formData.fromName,
          email_address: formData.emailAddress,
          smtp_host: formData.smtpHost,
          smtp_port: parseInt(formData.smtpPort),
          smtp_username: formData.smtpUsername,
          smtp_password: formData.smtpPassword,
          smtp_use_tls: formData.smtpUseTls,
          imap_host: formData.receiveHost,
          imap_port: parseInt(formData.receivePort),
          imap_username: formData.receiveUsername,
          imap_password: formData.receivePassword,
          imap_use_ssl: formData.receiveUseSsl,
          is_system_account: formData.isSystemAccount,
          is_active: formData.isActive,
          is_default: false,
        },
      ]);

      if (error) throw error;

      showSnackbar('Konto email zostało dodane', 'success');
      onSuccess();
      onClose();
      setFormData({
        accountName: '',
        fromName: '',
        emailAddress: '',
        smtpHost: '',
        smtpPort: '587',
        smtpUsername: '',
        smtpPassword: '',
        smtpUseTls: true,
        receiveHost: '',
        receivePort: '993',
        receiveUsername: '',
        receivePassword: '',
        receiveUseSsl: true,
        isSystemAccount: false,
        isActive: true,
      });
    } catch (err) {
      console.error('Error adding email account:', err);
      showSnackbar('Błąd podczas dodawania konta email', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (field: string, value: string | boolean | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-[#1c1f33] rounded-xl border border-[#d3bb73]/20 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#d3bb73]/20 bg-[#1c1f33] p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/10">
              <Mail className="h-5 w-5 text-[#d3bb73]" />
            </div>
            <div>
              <h2 className="text-xl font-light text-[#e5e4e2]">Dodaj konto email</h2>
              <p className="text-sm text-[#e5e4e2]/60">Konfiguracja SMTP i protokołu odbierania</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-[#e5e4e2]/60 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          <div className="space-y-6">
            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[#d3bb73]">
                <Mail className="h-5 w-5" />
                Podstawowe informacje
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Nazwa konta <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.accountName}
                    onChange={(e) => handleInputChange('accountName', e.target.value)}
                    placeholder="np. Email systemowy, Biuro, Kadry"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Nazwa nadawcy <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.fromName}
                    onChange={(e) => handleInputChange('fromName', e.target.value)}
                    placeholder="np. Mavinci CRM, System Mavinci"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Adres email <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={formData.emailAddress}
                    onChange={(e) => handleInputChange('emailAddress', e.target.value)}
                    placeholder="system@mavinci.pl"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[#d3bb73]">
                <Server className="h-5 w-5" />
                Konfiguracja SMTP (wysyłanie)
              </h3>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Host SMTP <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.smtpHost}
                    onChange={(e) => handleInputChange('smtpHost', e.target.value)}
                    placeholder="smtp.example.com"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Port SMTP <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.smtpPort}
                    onChange={(e) => handleInputChange('smtpPort', e.target.value)}
                    placeholder="587"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                  <p className="mt-1 text-xs text-[#e5e4e2]/50">Zazwyczaj 587 (TLS) lub 465 (SSL)</p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Użytkownik SMTP</label>
                  <input
                    type="text"
                    value={formData.smtpUsername}
                    onChange={(e) => handleInputChange('smtpUsername', e.target.value)}
                    placeholder="system@mavinci.pl"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Hasło SMTP</label>
                  <input
                    type="password"
                    value={formData.smtpPassword}
                    onChange={(e) => handleInputChange('smtpPassword', e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:bg-[#0f1119]">
                    <input
                      type="checkbox"
                      checked={formData.smtpUseTls}
                      onChange={(e) => handleInputChange('smtpUseTls', e.target.checked)}
                      className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#e5e4e2]">Użyj TLS</div>
                      <div className="text-xs text-[#e5e4e2]/60">Zalecane dla połączeń SMTP</div>
                    </div>
                    <Lock className="h-5 w-5 text-[#d3bb73]/60" />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-medium text-[#d3bb73]">
                <Globe className="h-5 w-5" />
                Konfiguracja odbierania (IMAP/POP3)
              </h3>

              <div className="mb-4 flex gap-3">
                <button
                  type="button"
                  onClick={() => handleProtocolChange('imap')}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                    receiveProtocol === 'imap'
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                      : 'border-[#d3bb73]/20 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {receiveProtocol === 'imap' && <CheckCircle2 className="h-4 w-4" />}
                    IMAP
                  </div>
                  <div className="mt-1 text-xs opacity-70">Synchronizacja folderów</div>
                </button>
                <button
                  type="button"
                  onClick={() => handleProtocolChange('pop3')}
                  className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                    receiveProtocol === 'pop3'
                      ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                      : 'border-[#d3bb73]/20 text-[#e5e4e2]/60 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]'
                  }`}
                >
                  <div className="flex items-center justify-center gap-2">
                    {receiveProtocol === 'pop3' && <CheckCircle2 className="h-4 w-4" />}
                    POP3
                  </div>
                  <div className="mt-1 text-xs opacity-70">Pobieranie wiadomości</div>
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Host {receiveProtocol.toUpperCase()} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.receiveHost}
                    onChange={(e) => handleInputChange('receiveHost', e.target.value)}
                    placeholder={`${receiveProtocol}.example.com`}
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Port {receiveProtocol.toUpperCase()} <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="number"
                    value={formData.receivePort}
                    onChange={(e) => handleInputChange('receivePort', e.target.value)}
                    placeholder={receiveProtocol === 'imap' ? '993' : '995'}
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                    required
                  />
                  <p className="mt-1 text-xs text-[#e5e4e2]/50">
                    {receiveProtocol === 'imap' ? '993 (SSL) lub 143 (STARTTLS)' : '995 (SSL) lub 110 (bez szyfrowania)'}
                  </p>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Użytkownik {receiveProtocol.toUpperCase()}
                  </label>
                  <input
                    type="text"
                    value={formData.receiveUsername}
                    onChange={(e) => handleInputChange('receiveUsername', e.target.value)}
                    placeholder="system@mavinci.pl"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                    Hasło {receiveProtocol.toUpperCase()}
                  </label>
                  <input
                    type="password"
                    value={formData.receivePassword}
                    onChange={(e) => handleInputChange('receivePassword', e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg border border-[#d3bb73]/30 bg-[#1c1f33] px-4 py-2.5 text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none focus:ring-1 focus:ring-[#d3bb73]"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:bg-[#0f1119]">
                    <input
                      type="checkbox"
                      checked={formData.receiveUseSsl}
                      onChange={(e) => handleInputChange('receiveUseSsl', e.target.checked)}
                      className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                    />
                    <div className="flex-1">
                      <div className="text-sm font-medium text-[#e5e4e2]">Użyj SSL</div>
                      <div className="text-xs text-[#e5e4e2]/60">Zalecane dla bezpiecznych połączeń</div>
                    </div>
                    <Lock className="h-5 w-5 text-[#d3bb73]/60" />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[#d3bb73]/10 bg-[#0f1119] p-6">
              <h3 className="mb-4 text-lg font-medium text-[#d3bb73]">Dodatkowe opcje</h3>

              <div className="space-y-3">
                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:bg-[#0f1119]">
                  <input
                    type="checkbox"
                    checked={formData.isSystemAccount}
                    onChange={(e) => handleInputChange('isSystemAccount', e.target.checked)}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#e5e4e2]">Ustaw jako konto systemowe</div>
                    <div className="text-xs text-[#e5e4e2]/60">
                      To konto będzie używane do wysyłania automatycznych wiadomości (zaproszenia, oferty, faktury)
                    </div>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-[#d3bb73]/60" />
                </label>

                <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-[#d3bb73]/10 bg-[#1c1f33] p-4 transition-colors hover:bg-[#0f1119]">
                  <input
                    type="checkbox"
                    checked={formData.isActive}
                    onChange={(e) => handleInputChange('isActive', e.target.checked)}
                    className="h-5 w-5 rounded border-[#d3bb73]/30 bg-[#0f1119] text-[#d3bb73] focus:ring-[#d3bb73]/50"
                  />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-[#e5e4e2]">Konto aktywne</div>
                    <div className="text-xs text-[#e5e4e2]/60">Konto może być używane do wysyłania i odbierania wiadomości</div>
                  </div>
                  <CheckCircle2 className="h-5 w-5 text-[#d3bb73]/60" />
                </label>
              </div>
            </div>
          </div>

          <div className="mt-6 flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[#d3bb73] px-6 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:opacity-50"
            >
              {loading ? 'Dodawanie...' : 'Dodaj konto email'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/30 px-6 py-3 font-medium text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
            >
              Anuluj
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
