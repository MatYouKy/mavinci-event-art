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

      showSnackbar(
        `Hasło dla ${employeeName} zostało zmienione pomyślnie`,
        'success'
      );
      onClose();
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      console.error('Error resetting password:', error);
      showSnackbar(
        error.message || 'Błąd podczas resetowania hasła',
        'error'
      );
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
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleClose}
    >
      <div
        className="bg-[#1c1f33] rounded-lg border border-[#d3bb73]/20 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 border-b border-[#d3bb73]/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-[#d3bb73]/10 flex items-center justify-center">
              <Lock className="w-5 h-5 text-[#d3bb73]" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#e5e4e2]">
                Resetuj hasło pracownika
              </h2>
              <p className="text-sm text-[#e5e4e2]/60">
                {employeeName} ({employeeEmail})
              </p>
            </div>
          </div>
          <button
            onClick={handleClose}
            className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-lg p-3 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-orange-400 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-orange-200">
              <p className="font-medium mb-1">Uwaga!</p>
              <p>
                Ta akcja natychmiast zmieni hasło dla pracownika. Poinformuj go
                o nowym haśle przez bezpieczny kanał komunikacji.
              </p>
            </div>
          </div>

          <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
            <p className="text-sm text-blue-200 mb-2">
              Hasło musi spełniać następujące wymagania:
            </p>
            <ul className="space-y-1 text-xs text-blue-200/80">
              <li>• Minimum 8 znaków</li>
              <li>• Co najmniej jedna wielka litera</li>
              <li>• Co najmniej jedna mała litera</li>
              <li>• Co najmniej jedna cyfra</li>
            </ul>
          </div>

          <div>
            <label
              htmlFor="newPassword"
              className="block text-sm font-medium text-[#e5e4e2] mb-2"
            >
              Nowe hasło
            </label>
            <div className="relative">
              <input
                id="newPassword"
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full pl-4 pr-12 py-3 bg-[#0f1119] border rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73] transition-colors ${
                  errors.newPassword
                    ? 'border-red-500/50'
                    : 'border-[#d3bb73]/20'
                }`}
                placeholder="Wprowadź nowe hasło"
                required
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
              <p className="text-red-400 text-sm mt-1">{errors.newPassword}</p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className="block text-sm font-medium text-[#e5e4e2] mb-2"
            >
              Potwierdź nowe hasło
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full pl-4 pr-12 py-3 bg-[#0f1119] border rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:outline-none focus:border-[#d3bb73] transition-colors ${
                  errors.confirmPassword
                    ? 'border-red-500/50'
                    : 'border-[#d3bb73]/20'
                }`}
                placeholder="Potwierdź nowe hasło"
                required
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
              <p className="text-red-400 text-sm mt-1">
                {errors.confirmPassword}
              </p>
            )}
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={handleClose}
              className="flex-1 px-4 py-3 bg-[#0f1119] text-[#e5e4e2] rounded-lg hover:bg-[#0f1119]/80 transition-colors font-medium"
            >
              Anuluj
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 px-4 py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg hover:bg-[#d3bb73]/90 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Zmieniam hasło...' : 'Zmień hasło'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
