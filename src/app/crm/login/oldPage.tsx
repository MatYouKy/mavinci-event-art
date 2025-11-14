'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Mail } from 'lucide-react';
import { supabase } from '@/lib/supabase';

export default function CRMLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);
  const [resetLoading, setResetLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      if (data.session) {
        router.push('/crm');
      }
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas logowania');
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResetLoading(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/crm/reset-password`,
      });

      if (resetError) {
        setError(resetError.message);
        setResetLoading(false);
        return;
      }

      setResetSuccess(true);
      setResetLoading(false);
    } catch (err: any) {
      setError(err.message || 'Wystąpił błąd podczas resetowania hasła');
      setResetLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#0f1119] px-4">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-[#d3bb73]/10">
              <Lock className="h-8 w-8 text-[#d3bb73]" />
            </div>
            <h2 className="mb-2 text-3xl font-light text-[#e5e4e2]">
              {showResetPassword ? 'Resetuj hasło' : 'Panel CRM Mavinci'}
            </h2>
            <p className="font-light text-[#e5e4e2]/60">
              {showResetPassword
                ? 'Podaj adres email aby otrzymać link do zmiany hasła'
                : 'Zaloguj się aby zarządzać systemem'}
            </p>
          </div>

          {!showResetPassword ? (
            <form onSubmit={handleLogin} className="space-y-6">
              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="twoj@email.pl"
                    required
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-light text-[#e5e4e2]">
                  Hasło
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none"
                  />
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
                {loading ? 'Logowanie...' : 'Zaloguj się'}
              </button>

              <div className="text-center">
                <button
                  type="button"
                  onClick={() => {
                    setShowResetPassword(true);
                    setResetEmail(email);
                    setError('');
                  }}
                  className="text-sm text-[#d3bb73] transition-colors hover:text-[#d3bb73]/80"
                >
                  Nie pamiętasz hasła?
                </button>
              </div>
            </form>
          ) : resetSuccess ? (
            <div className="space-y-6">
              <div className="rounded-lg border border-green-500/20 bg-green-500/10 p-4">
                <p className="text-center text-sm text-green-400">
                  Link do resetowania hasła został wysłany na adres <strong>{resetEmail}</strong>
                </p>
                <p className="mt-2 text-center text-xs text-green-400/80">
                  Sprawdź swoją skrzynkę odbiorczą (w tym folder spam)
                </p>
              </div>

              <button
                onClick={() => {
                  setShowResetPassword(false);
                  setResetSuccess(false);
                  setResetEmail('');
                }}
                className="w-full rounded-lg bg-[#d3bb73] py-3 font-medium text-[#1c1f33] transition-all duration-300 hover:bg-[#d3bb73]/90"
              >
                Powrót do logowania
              </button>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-6">
              <div>
                <label
                  htmlFor="resetEmail"
                  className="mb-2 block text-sm font-light text-[#e5e4e2]"
                >
                  Email
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/60" />
                  <input
                    id="resetEmail"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    placeholder="twoj@email.pl"
                    required
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 pl-10 pr-4 text-[#e5e4e2] placeholder-[#e5e4e2]/40 transition-colors focus:border-[#d3bb73] focus:outline-none"
                  />
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                  <p className="text-center text-sm text-red-400">{error}</p>
                </div>
              )}

              <div className="space-y-3">
                <button
                  type="submit"
                  disabled={resetLoading}
                  className="w-full rounded-lg bg-[#d3bb73] py-3 font-medium text-[#1c1f33] transition-all duration-300 hover:bg-[#d3bb73]/90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {resetLoading ? 'Wysyłanie...' : 'Wyślij link resetujący'}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowResetPassword(false);
                    setResetEmail('');
                    setError('');
                  }}
                  className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0f1119] py-3 font-medium text-[#e5e4e2] transition-all duration-300 hover:bg-[#1c1f33]"
                >
                  Powrót do logowania
                </button>
              </div>
            </form>
          )}

          {!showResetPassword && (
            <div className="mt-6 text-center text-sm text-[#e5e4e2]/60">
              <p>Skontaktuj się z administratorem aby uzyskać dostęp</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
