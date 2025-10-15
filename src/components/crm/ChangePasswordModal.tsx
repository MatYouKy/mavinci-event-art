'use client';

import { useState } from 'react';
import { X, Eye, EyeOff, Lock } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function ChangePasswordModal({ isOpen, onClose }: Props) {
  const { showSnackbar } = useSnackbar();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!isOpen) return null;

  const validatePassword = (password: string): string | null => {
    if (password.length < 8) {
      return 'Hasło musi mieć minimum 8 znaków';
    }
    if (!/[A-Z]/.test(password)) {
      return 'Hasło musi zawierać co najmniej jedną wielką literę';
    }
    if (!/[a-z]/.test(password)) {
      return 'Hasło musi zawierać co najmniej jedną małą literę';
    }
    if (!/[0-9]/.test(password)) {
      return 'Hasło musi zawierać co najmniej jedną cyfrę';
    }
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});

    const newErrors: Record<string, string> = {};

    if (!currentPassword) {
      newErrors.currentPassword = 'Podaj aktualne hasło';
    }

    if (!newPassword) {
      newErrors.newPassword = 'Podaj nowe hasło';
    } else {
      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        newErrors.newPassword = passwordError;
      }
    }

    if (!confirmPassword) {
      newErrors.confirmPassword = 'Potwierdź nowe hasło';
    } else if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Hasła nie są identyczne';
    }

    if (currentPassword === newPassword) {
      newErrors.newPassword = 'Nowe hasło musi być inne niż aktualne';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    try {
      setLoading(true);

      const { data: { user }, error: sessionError } = await supabase.auth.getUser();

      if (sessionError || !user) {
        throw new Error('Nie można pobrać danych sesji');
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: currentPassword,
      });

      if (signInError) {
        setErrors({ currentPassword: 'Nieprawidłowe aktualne hasło' });
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      showSnackbar('Hasło zostało zmienione pomyślnie', 'success');
      handleClose();
    } catch (err: any) {
      console.error('Error changing password:', err);
      showSnackbar(err.message || 'Błąd podczas zmiany hasła', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrentPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setErrors({});
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-[#1c1f33] border-b border-[#d3bb73]/20 p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-[#d3bb73]/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#d3bb73]" />
            </div>
            <h2 className="text-xl font-light text-[#e5e4e2]">
              Zmień hasło
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4">
            <p className="text-sm text-blue-200">
              Twoje hasło musi spełniać następujące wymagania:
            </p>
            <ul className="mt-2 space-y-1 text-xs text-blue-200/80">
              <li>• Minimum 8 znaków</li>
              <li>• Co najmniej jedna wielka litera</li>
              <li>• Co najmniej jedna mała litera</li>
              <li>• Co najmniej jedna cyfra</li>
            </ul>
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Aktualne hasło
            </label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1119] border ${
                  errors.currentPassword
                    ? 'border-red-500/50'
                    : 'border-[#d3bb73]/30'
                } rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 pr-12`}
                placeholder="Wprowadź aktualne hasło"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 hover:text-[#e5e4e2] transition-colors"
              >
                {showCurrentPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.currentPassword && (
              <p className="mt-1 text-sm text-red-400">{errors.currentPassword}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Nowe hasło
            </label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1119] border ${
                  errors.newPassword ? 'border-red-500/50' : 'border-[#d3bb73]/30'
                } rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 pr-12`}
                placeholder="Wprowadź nowe hasło"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 hover:text-[#e5e4e2] transition-colors"
              >
                {showNewPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.newPassword && (
              <p className="mt-1 text-sm text-red-400">{errors.newPassword}</p>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium text-[#e5e4e2] mb-2">
              Potwierdź nowe hasło
            </label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full px-4 py-3 bg-[#0f1119] border ${
                  errors.confirmPassword
                    ? 'border-red-500/50'
                    : 'border-[#d3bb73]/30'
                } rounded-lg text-[#e5e4e2] focus:outline-none focus:ring-2 focus:ring-[#d3bb73]/50 pr-12`}
                placeholder="Potwierdź nowe hasło"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 hover:text-[#e5e4e2] transition-colors"
              >
                {showConfirmPassword ? (
                  <EyeOff className="w-5 h-5" />
                ) : (
                  <Eye className="w-5 h-5" />
                )}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-sm text-red-400">{errors.confirmPassword}</p>
            )}
          </div>

          <div className="flex gap-3 pt-4">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/30 text-[#e5e4e2] rounded-lg hover:bg-[#1c1f33] transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
            >
              {loading ? 'Zmieniam...' : 'Zmień hasło'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
