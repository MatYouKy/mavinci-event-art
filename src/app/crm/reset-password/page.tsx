'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Eye, EyeOff, CheckCircle } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function ResetPasswordPage() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [validToken, setValidToken] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session) {
        setValidToken(true);
      } else {
        setError('Link resetowania hasła jest nieprawidłowy lub wygasł');
      }
    };

    checkSession();
  }, []);

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

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Hasła nie są identyczne');
      return;
    }

    try {
      setLoading(true);

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) throw updateError;

      setSuccess(true);

      setTimeout(() => {
        router.push('/crm/login');
      }, 3000);
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas zmiany hasła');
      setLoading(false);
    }
  };

  if (!validToken && !error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119] px-4">
        <div className="text-lg text-[#d3bb73]">Sprawdzanie linku...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0f1119] px-4">
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 text-center shadow-2xl">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-500/10">
              <CheckCircle className="h-8 w-8 text-green-400" />
            </div>
            <h2 className="mb-2 text-2xl font-light text-[#e5e4e2]">Hasło zostało zmienione!</h2>
            <p className="mb-6 text-[#e5e4e2]/60">
              Możesz teraz zalogować się używając nowego hasła
            </p>
            <p className="text-sm text-[#e5e4e2]/40">
              Za chwilę zostaniesz przekierowany na stronę logowania...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1119] px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10">
              <Lock className="h-8 w-8 text-[#d3bb73]" />
            </div>
            <h2 className="mb-2 text-3xl font-light text-[#e5e4e2]">Ustaw nowe hasło</h2>
            <p className="font-light text-[#e5e4e2]/60">Wprowadź nowe hasło dla swojego konta</p>
          </div>

          {error && !validToken ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-4">
                <p className="text-center text-sm text-red-400">{error}</p>
              </div>

              <button
                onClick={() => router.push('/crm/login')}
                className="w-full rounded-lg bg-[#d3bb73] py-3 font-medium text-[#1c1f33] transition-all duration-300 hover:bg-[#d3bb73]/90"
              >
                Powrót do logowania
              </button>
            </div>
          ) : (
            <>
              <div className="mb-6 rounded-lg border border-blue-500/20 bg-blue-500/10 p-4">
                <p className="mb-2 text-sm text-blue-200">
                  Twoje hasło musi spełniać następujące wymagania:
                </p>
                <ul className="space-y-1 text-xs text-blue-200/80">
                  <li>• Minimum 8 znaków</li>
                  <li>• Co najmniej jedna wielka litera</li>
                  <li>• Co najmniej jedna mała litera</li>
                  <li>• Co najmniej jedna cyfra</li>
                </ul>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-6">
                <div>
                  <label
                    htmlFor="newPassword"
                    className="mb-2 block text-sm font-light text-[#e5e4e2]"
                  >
                    Nowe hasło
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                    <input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Wprowadź nowe hasło"
                      required
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-12 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
                    >
                      {showNewPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="mb-2 block text-sm font-light text-[#e5e4e2]"
                  >
                    Potwierdź nowe hasło
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Potwierdź nowe hasło"
                      required
                      className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-12 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#e5e4e2]/40 transition-colors hover:text-[#e5e4e2]"
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-5 w-5" />
                      ) : (
                        <Eye className="h-5 w-5" />
                      )}
                    </button>
                  </div>
                </div>

                {error && (
                  <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                    <p className="text-center text-sm text-red-400">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full rounded-lg bg-[#d3bb73] py-3 font-medium text-[#1c1f33] transition-all duration-300 hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? 'Zmieniam hasło...' : 'Zmień hasło'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
