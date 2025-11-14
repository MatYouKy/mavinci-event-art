'use client';

import { useState } from 'react';
import { X, Eye, EyeOff, Lock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useCurrentEmployee } from '@/hooks/useCurrentEmployee';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  employeeName: string;
  employeeEmail: string;
}

export default function AdminResetPasswordModal({
  isOpen,
  onClose,
  employeeId,
  employeeName,
  employeeEmail,
}: Props) {
  const { showSnackbar } = useSnackbar();
  const { employee: currentEmployee } = useCurrentEmployee();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
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

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      newErrors.newPassword = passwordError;
    }

    if (newPassword !== confirmPassword) {
      newErrors.confirmPassword = 'Hasła nie są identyczne';
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setLoading(true);

    try {
      if (!currentEmployee?.id) {
        throw new Error('Nie można zidentyfikować użytkownika');
      }

      const response = await fetch('/api/reset-employee-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          employeeId,
          newPassword,
          requesterId: currentEmployee.id,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Błąd podczas resetowania hasła');
      }

      showSnackbar(`Hasło dla ${employeeName} zostało zmienione pomyślnie`, 'success');
      onClose();
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      showSnackbar(error.message || 'Błąd podczas resetowania hasła', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setNewPassword('');
    setConfirmPassword('');
    setErrors({});
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d3bb73]/10">
              <Lock className="h-5 w-5 text-[#d3bb73]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">Resetuj hasło pracownika</h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {employeeName} ({employeeEmail})
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 p-6">
          <div className="flex gap-3 rounded-lg border border-orange-500/20 bg-orange-500/10 p-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-orange-400" />
            <div className="text-sm text-orange-200">
              <p className="mb-1 font-medium">Uwaga!</p>
              <p>
                Ta akcja natychmiast zmieni hasło dla pracownika. Poinformuj go o nowym haśle przez
                bezpieczny kanał komunikacji.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3">
            <p className="mb-2 text-sm text-blue-200">Hasło musi spełniać następujące wymagania:</p>
            <ul className="space-y-1 text-xs text-blue-200/80">
              <li>• Minimum 8 znaków</li>
              <li>• Co najmniej jedna wielka litera</li>
              <li>• Co najmniej jedna mała litera</li>
              <li>• Co najmniej jedna cyfra</li>
            </ul>
          </div>

          <div>
            <label htmlFor="newPassword" className="mb-2 block text-sm font-medium text-[#e5e4e2]">
              Nowe hasło
            </label>
            <div className="relative">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full rounded-lg border bg-[#0f1119] py-3 pl-4 pr-12 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none ${
                  errors.newPassword ? 'border-red-500/50' : 'border-[#d3bb73]/20'
                }`}
                placeholder="Wprowadź nowe hasło"
                required
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
              >
                {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {errors.newPassword && (
              <p className="mt-1 text-sm text-red-400">{errors.newPassword}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="mb-2 block text-sm font-medium text-[#e5e4e2]"
            >
              Potwierdź nowe hasło
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full rounded-lg border bg-[#0f1119] py-3 pl-4 pr-12 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none ${
                  errors.confirmPassword ? 'border-red-500/50' : 'border-[#d3bb73]/20'
                }`}
                placeholder="Potwierdź nowe hasło"
                required
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
              >
                {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
            {errors.confirmPassword && (
              <p className="mt-1 text-sm text-red-400">{errors.confirmPassword}</p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 rounded-lg bg-[#0f1119] px-4 py-3 font-medium text-[#e5e4e2] transition-colors hover:bg-[#0f1119]/80"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 rounded-lg bg-[#d3bb73] px-4 py-3 font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Zmieniam hasło...' : 'Zmień hasło'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
