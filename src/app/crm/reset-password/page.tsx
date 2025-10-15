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
      const { data: { session } } = await supabase.auth.getSession();
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
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-4">
        <div className="text-[#d3bb73] text-lg">Sprawdzanie linku...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-4">
        <div className="max-w-md w-full">
          <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-8 shadow-2xl text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-500/10 mb-4">
              <CheckCircle className="w-8 h-8 text-green-400" />
            </div>
            <h2 className="text-2xl font-light text-[#e5e4e2] mb-2">
              Hasło zostało zmienione!
            </h2>
            <p className="text-[#e5e4e2]/60 mb-6">
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
    <div className="min-h-screen bg-[#0f1119] flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="bg-[#1c1f33] border border-[#d3bb73]/20 rounded-2xl p-8 shadow-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#d3bb73]/10 mb-4">
              <Lock className="w-8 h-8 text-[#d3bb73]" />
            </div>
            <h2 className="text-3xl font-light text-[#e5e4e2] mb-2">
              Ustaw nowe hasło
            </h2>
            <p className="text-[#e5e4e2]/60 font-light">
              Wprowadź nowe hasło dla swojego konta
            </p>
          </div>

          {error && !validToken ? (
            <div className="space-y-6">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
                <p className="text-red-400 text-sm text-center">{error}</p>
              </div>

              <button
                onClick={() => router.push('/crm/login')}
                className="w-full py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all duration-300"
              >
                Powrót do logowania
              </button>
            </div>
          ) : (
            <>
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-4 mb-6">
                <p className="text-sm text-blue-200 mb-2">
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
                    className="block text-sm font-light text-[#e5e4e2] mb-2"
                  >
                    Nowe hasło
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#d3bb73]/60" />
                    <input
                      id="newPassword"
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Wprowadź nowe hasło"
                      required
                      className="w-full pl-10 pr-12 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none transition-colors"
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
                </div>

                <div>
                  <label
                    htmlFor="confirmPassword"
                    className="block text-sm font-light text-[#e5e4e2] mb-2"
                  >
                    Potwierdź nowe hasło
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#d3bb73]/60" />
                    <input
                      id="confirmPassword"
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Potwierdź nowe hasło"
                      required
                      className="w-full pl-10 pr-12 py-3 bg-[#0f1119] border border-[#d3bb73]/20 rounded-lg text-[#e5e4e2] placeholder-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none transition-colors"
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
                </div>

                {error && (
                  <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
                    <p className="text-red-400 text-sm text-center">{error}</p>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-3 bg-[#d3bb73] text-[#1c1f33] rounded-lg font-medium hover:bg-[#d3bb73]/90 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed"
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
