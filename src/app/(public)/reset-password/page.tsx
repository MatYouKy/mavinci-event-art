'use client';

import { FormEvent, useEffect, useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Eye, EyeOff, Loader2, LockKeyhole } from 'lucide-react';

import { supabase } from '@/lib/supabase/browser';
import { PASSWORD_ACCESS_ORIGIN, passwordAccessUrl } from '@/lib/passwordAccess';
import { verifyPasswordAccessToken } from '@/lib/passwordAccess.browser';

const validatePassword = (password: string) => {
  if (password.length < 8) return 'Hasło musi mieć minimum 8 znaków.';
  if (!/[A-Z]/.test(password)) return 'Hasło musi zawierać co najmniej jedną wielką literę.';
  if (!/[a-z]/.test(password)) return 'Hasło musi zawierać co najmniej jedną małą literę.';
  if (!/[0-9]/.test(password)) return 'Hasło musi zawierać co najmniej jedną cyfrę.';
  return null;
};

export default function ResetPasswordPage() {
  const router = useRouter();
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkReady, setLinkReady] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let active = true;

    const markReady = () => {
      if (!active) return;
      setLinkReady(true);
      setCheckingLink(false);
      setError('');
    };

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) markReady();
    });

    const verifyResetLink = async () => {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      const type = params.get('type');

      if (tokenHash && type === 'recovery') {
        if (window.location.origin !== PASSWORD_ACCESS_ORIGIN) {
          window.location.replace(passwordAccessUrl('crm', tokenHash, 'recovery'));
          return;
        }
        const { error: verificationError } = await verifyPasswordAccessToken(tokenHash, 'recovery');

        if (!active) return;
        if (verificationError) {
          setError('Link jest nieprawidłowy, został już wykorzystany albo wygasł. Wyślij nową prośbę o zmianę hasła.');
          setCheckingLink(false);
          return;
        }

        window.history.replaceState({}, '', '/reset-password');
        markReady();
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (session) {
        markReady();
      } else {
        setError('W tym adresie brakuje prawidłowego linku do zmiany hasła. Wyślij nową prośbę z ekranu logowania.');
        setCheckingLink(false);
      }
    };

    void verifyResetLink().catch(() => {
      if (!active) return;
      setError('Nie udało się sprawdzić linku. Sprawdź połączenie i otwórz wiadomość ponownie.');
      setCheckingLink(false);
    });
    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleResetPassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      setError(passwordError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Podane hasła nie są identyczne.');
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
    if (updateError) {
      setError(updateError.message || 'Nie udało się zapisać nowego hasła.');
      setLoading(false);
      return;
    }

    setSuccess(true);
    setLoading(false);

    const [{ data: sellerContext }, { data: userData }] = await Promise.all([
      supabase.rpc('get_seller_portal_context'),
      supabase.auth.getUser(),
    ]);
    const isSellerAccount = userData.user?.user_metadata?.portal === 'seller';
    const destination = sellerContext || isSellerAccount ? '/seller' : '/crm';

    window.setTimeout(() => router.replace(destination), 2200);
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#100a0e] px-4 py-10 text-[#f2eee9]">
      <div className="pointer-events-none absolute -left-32 top-12 h-80 w-80 rounded-full bg-[#7a1738]/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#d3bb73]/10 blur-3xl" />

      <section className="relative w-full max-w-md overflow-hidden rounded-3xl bg-[#1c1720] shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="bg-[#290812] px-8 py-8 text-center">
          <Image
            src="/logo.png"
            alt="MAVINCI Event & Art"
            width={276}
            height={64}
            priority
            className="mx-auto h-auto w-56"
          />
          <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-[#d3bb73]">Bezpieczeństwo konta</p>
        </div>

        <div className="p-7 sm:p-9">
          {checkingLink ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#d3bb73]" />
              <p className="mt-4 text-sm text-white/55">Sprawdzamy link do zmiany hasła…</p>
            </div>
          ) : success ? (
            <div className="py-7 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h1 className="mt-6 text-2xl font-light">Hasło zostało zmienione</h1>
              <p className="mt-3 text-sm leading-6 text-white/55">Za chwilę przejdziesz bezpośrednio do swojego panelu.</p>
            </div>
          ) : !linkReady ? (
            <div className="py-7 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-400/10 text-red-200">
                <LockKeyhole className="h-8 w-8" />
              </span>
              <h1 className="mt-6 text-2xl font-light">Nie można otworzyć linku</h1>
              <p className="mt-3 text-sm leading-6 text-red-100/70">{error}</p>
              <button
                type="button"
                onClick={() => router.replace('/login')}
                className="mt-7 w-full rounded-xl bg-[#d3bb73] px-5 py-3.5 text-sm font-semibold text-[#20130f] shadow-[0_10px_30px_rgba(211,187,115,0.16)] transition hover:bg-[#dfca8b]"
              >
                Wyślij nowy link
              </button>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">Reset hasła</p>
                <h1 className="mt-2 text-3xl font-light">Ustaw nowe hasło</h1>
                <p className="mt-3 text-sm leading-6 text-white/50">Minimum 8 znaków, w tym wielka i mała litera oraz cyfra.</p>
              </div>

              <form onSubmit={handleResetPassword} className="space-y-4">
                <label className="block text-sm text-white/65">
                  Nowe hasło
                  <span className="relative mt-2 block">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/55" />
                    <input
                      type={showNewPassword ? 'text' : 'password'}
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl bg-[#100d13] py-3.5 pl-11 pr-12 text-white outline-none ring-1 ring-white/5 transition placeholder:text-white/20 focus:bg-[#131018] focus:ring-[#d3bb73]/35"
                      placeholder="Wpisz nowe hasło"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNewPassword((value) => !value)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 transition hover:text-white/70"
                      aria-label={showNewPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
                    >
                      {showNewPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                </label>

                <label className="block text-sm text-white/65">
                  Powtórz hasło
                  <span className="relative mt-2 block">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/55" />
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl bg-[#100d13] py-3.5 pl-11 pr-12 text-white outline-none ring-1 ring-white/5 transition placeholder:text-white/20 focus:bg-[#131018] focus:ring-[#d3bb73]/35"
                      placeholder="Wpisz hasło ponownie"
                    />
                    <button
                      type="button"
                      onClick={() => setShowConfirmPassword((value) => !value)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 transition hover:text-white/70"
                      aria-label={showConfirmPassword ? 'Ukryj hasło' : 'Pokaż hasło'}
                    >
                      {showConfirmPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                </label>

                {error && <p className="rounded-xl bg-red-400/10 px-4 py-3 text-sm leading-5 text-red-200">{error}</p>}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#d3bb73] px-5 py-3.5 text-sm font-semibold text-[#20130f] shadow-[0_10px_30px_rgba(211,187,115,0.16)] transition hover:bg-[#dfca8b] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Zapisz nowe hasło
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
