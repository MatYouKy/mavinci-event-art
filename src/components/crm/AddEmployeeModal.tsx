/* eslint-disable react-hooks/rules-of-hooks */
'use client';

import { useState, useEffect } from 'react';
import { X, Loader2, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';

interface AddEmployeeModalProps {
  onClose: () => void;
  onSuccess: () => void;
  isOpen: boolean;
}

interface AccessLevel {
  id: string;
  name: string;
  description: string | null;
}

export default function AddEmployeeModal({ onClose, onSuccess, isOpen }: AddEmployeeModalProps) {
  const { showSnackbar } = useSnackbar();
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [accessLevels, setAccessLevels] = useState<AccessLevel[]>([]);
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
    surname: '',
    nickname: '',
    phone_number: '',
    role: 'unassigned',
    access_level_id: '',
    occupation: '',
  });
  const [error, setError] = useState('');
  const { showDialog } = useDialog();

  if (!isOpen) return null;

  useEffect(() => {
    fetchAccessLevels();
  }, []);

  const fetchAccessLevels = async () => {
    try {
      const { data, error } = await supabase
        .from('access_levels')
        .select('id, name, description')
        .order('name');

      if (error) throw error;
      setAccessLevels(data || []);
    } catch (err: any) {
      console.error('Error fetching access levels:', err);
    }
  };

  const copyToClipboard = async (text: string, successMsg: string) => {
    try {
      await navigator.clipboard.writeText(text);
      showSnackbar(successMsg, 'success');
    } catch {
      // fallback dla przeglądarek / braku uprawnień
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand('copy');
        showSnackbar(successMsg, 'success');
      } finally {
        document.body.removeChild(ta);
      }
    }
  };

  const generateRandomPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData((prev) => ({ ...prev, password }));
    setShowPassword(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // Validate required fields
      if (!formData.email || !formData.password || !formData.name || !formData.surname) {
        setError('Wypełnij wszystkie wymagane pola');
        setLoading(false);
        return;
      }

      // Get current session
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        throw new Error('Brak sesji użytkownika');
      }

      // Get Supabase URL from environment
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

      if (!supabaseUrl) {
        throw new Error('Missing Supabase configuration');
      }

      // Call edge function to create employee with user token
      const response = await fetch(`${supabaseUrl}/functions/v1/create-employee`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(formData),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Nie udało się utworzyć pracownika');
      }

      // Show success message with credentials info
      showDialog({
        title: '✅ Pracownik utworzony',
        type: 'success',
        message: (
          <div className="space-y-4 text-left">
            <p className="text-[#e5e4e2]/80 text-sm">
              Zapisz dane logowania i przekaż pracownikowi. Hasło można zmienić po pierwszym logowaniu.
            </p>
      
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#13161f] p-3">
              <div className="text-xs text-[#d3bb73] mb-1">Email</div>
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm text-[#e5e4e2] break-all">{formData.email}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(formData.email, 'Skopiowano email')}
                  className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/15 px-3 py-1.5 text-xs text-[#e5e4e2] hover:bg-[#d3bb73]/25 transition-colors"
                >
                  Kopiuj
                </button>
              </div>
            </div>
      
            <div className="rounded-lg border border-[#d3bb73]/20 bg-[#13161f] p-3">
              <div className="text-xs text-[#d3bb73] mb-1">Hasło tymczasowe</div>
              <div className="flex items-center justify-between gap-2">
                <code className="text-sm text-[#e5e4e2] break-all">{formData.password}</code>
                <button
                  type="button"
                  onClick={() => copyToClipboard(formData.password, 'Skopiowano hasło')}
                  className="rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/15 px-3 py-1.5 text-xs text-[#e5e4e2] hover:bg-[#d3bb73]/25 transition-colors"
                >
                  Kopiuj
                </button>
              </div>
            </div>
      
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  copyToClipboard(
                    `Email: ${formData.email}\nHasło: ${formData.password}`,
                    'Skopiowano dane logowania'
                  )
                }
                className="flex-1 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/15 px-3 py-2 text-sm text-[#e5e4e2] hover:bg-[#d3bb73]/25 transition-colors"
              >
                Kopiuj całość
              </button>
            </div>
          </div>
        ),
        buttons: [
          {
            label: 'OK',
            onClick: () => {
              onSuccess(); // zamkniesz modal i odświeżysz listę jak masz w onSuccess
            },
            variant: 'primary',
          },
        ],
      });

      // Success
      onSuccess();
    } catch (err: any) {
      console.error('Error creating employee:', err);
      setError(err.message || 'Wystąpił błąd podczas tworzenia pracownika');
    } finally {
      setLoading(false);
    }
  };

  const roles = [
    { value: 'admin', label: 'Administrator' },
    { value: 'manager', label: 'Menedżer' },
    { value: 'event_manager', label: 'Menedżer eventów' },
    { value: 'sales', label: 'Sprzedaż' },
    { value: 'logistics', label: 'Logistyka' },
    { value: 'technician', label: 'Technik' },
    { value: 'support', label: 'Wsparcie' },
    { value: 'freelancer', label: 'Freelancer' },
    { value: 'dj', label: 'DJ' },
    { value: 'mc', label: 'Konferansjer' },
    { value: 'assistant', label: 'Asystent' },
    { value: 'unassigned', label: 'Nieprzypisany' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] p-6">
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-xl font-medium text-[#e5e4e2]">Dodaj nowego pracownika</h3>
          <button
            onClick={onClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Imię <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Nazwisko <span className="text-red-400">*</span>
              </label>
              <input
                type="text"
                value={formData.surname}
                onChange={(e) => setFormData((prev) => ({ ...prev, surname: e.target.value }))}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                required
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Pseudonim / Nick
            </label>
            <input
              type="text"
              value={formData.nickname}
              onChange={(e) => setFormData((prev) => ({ ...prev, nickname: e.target.value }))}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Email <span className="text-red-400">*</span>
              </label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData((prev) => ({ ...prev, email: e.target.value }))}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Telefon</label>
              <input
                type="tel"
                value={formData.phone_number}
                onChange={(e) => setFormData((prev) => ({ ...prev, phone_number: e.target.value }))}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Hasło <span className="text-red-400">*</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData((prev) => ({ ...prev, password: e.target.value }))}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 pr-10 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[#e5e4e2]/60 hover:text-[#e5e4e2]"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <button
                type="button"
                onClick={generateRandomPassword}
                className="whitespace-nowrap rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/20 px-3 py-2 text-sm text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/30"
              >
                Generuj
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Rola</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData((prev) => ({ ...prev, role: e.target.value }))}
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              >
                {roles.map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">
                Poziom dostępu
              </label>
              <select
                value={formData.access_level_id}
                onChange={(e) =>
                  setFormData((prev) => ({ ...prev, access_level_id: e.target.value }))
                }
                className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              >
                <option value="">Wybierz poziom dostępu</option>
                {accessLevels.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-[#e5e4e2]">Stanowisko</label>
            <input
              type="text"
              value={formData.occupation}
              onChange={(e) => setFormData((prev) => ({ ...prev, occupation: e.target.value }))}
              className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1019] px-3 py-2 text-[#e5e4e2] focus:border-[#d3bb73]/50 focus:outline-none"
              placeholder="np. Kierownik projektu, Technik audio"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[#d3bb73]/30 px-4 py-2 text-[#e5e4e2] transition-colors hover:bg-[#d3bb73]/10"
              disabled={loading}
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-4 py-2 font-medium text-[#0f1019] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {loading ? 'Tworzenie...' : 'Utwórz pracownika'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
