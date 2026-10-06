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

export default function SellerSetPasswordPage() {
  const router = useRouter();
  const [checkingLink, setCheckingLink] = useState(true);
  const [linkReady, setLinkReady] = useState(false);
  const [accessMode, setAccessMode] = useState<'invite' | 'recovery'>('invite');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    const verifyAccessLink = async () => {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      const type = params.get('type');

      if (tokenHash && (type === 'invite' || type === 'recovery')) {
        if (window.location.origin !== PASSWORD_ACCESS_ORIGIN) {
          // Starszy e-mail mógł zawierać localhost. Nie zużywaj tam tokenu.
          window.location.replace(passwordAccessUrl('seller', tokenHash, type));
          return;
        }
        setAccessMode(type);
        const { error: verificationError } = await verifyPasswordAccessToken(tokenHash, type);

        if (!active) return;
        if (verificationError) {
          setError('Link jest nieprawidłowy, został już wykorzystany albo wygasł. Poproś opiekuna w MAVINCI o ponowne wysłanie dostępu.');
          setCheckingLink(false);
          return;
        }

        window.history.replaceState({}, '', '/seller/set-password');
        setLinkReady(true);
        setCheckingLink(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!active) return;
      if (session) {
        setLinkReady(true);
      } else {
        setError('W tym adresie brakuje prawidłowego linku dostępowego. Poproś opiekuna w MAVINCI o ponowne wysłanie wiadomości.');
      }
      setCheckingLink(false);
    };

    void verifyAccessLink().catch(() => {
      if (!active) return;
      setError('Nie udało się sprawdzić linku. Sprawdź połączenie i otwórz wiadomość ponownie.');
      setCheckingLink(false);
    });
    return () => { active = false; };
  }, []);

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    const validationError = validatePassword(password);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (password !== confirmation) {
      setError('Podane hasła nie są identyczne.');
      return;
    }

    setSaving(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setSaving(false);
    if (updateError) {
      setError(updateError.message || 'Nie udało się zapisać hasła.');
      return;
    }

    setSuccess(true);
    setPassword('');
    setConfirmation('');
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#100a0e] px-4 py-10 text-[#f2eee9]">
      <div className="pointer-events-none absolute -left-32 top-12 h-80 w-80 rounded-full bg-[#7a1738]/20 blur-3xl" />
      <div className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-full bg-[#d3bb73]/10 blur-3xl" />

      <section className="relative w-full max-w-md overflow-hidden rounded-3xl bg-[#1c1720] shadow-[0_28px_90px_rgba(0,0,0,0.45)]">
        <div className="bg-[#290812] px-8 py-8 text-center">
          <div className="relative mx-auto h-28 w-56 max-w-full">
            <Image
              src={`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/brandbook/d4474f90-5e61-4ba4-928e-c25c0f0659b5/1779367661905.png`}
              alt="MAVINCI — primary-white"
              fill
              sizes="224px"
              priority
              className="object-contain"
            />
          </div>
          <p className="mt-4 text-[10px] uppercase tracking-[0.28em] text-[#d3bb73]">Portal sprzedawcy</p>
        </div>

        <div className="p-7 sm:p-9">
          {checkingLink ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-[#d3bb73]" />
              <p className="mt-4 text-sm text-white/55">Sprawdzamy link dostępowy…</p>
            </div>
          ) : success ? (
            <div className="py-7 text-center">
              <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-400/10 text-emerald-300">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <h1 className="mt-6 text-2xl font-light">Hasło zostało ustawione</h1>
              <p className="mt-3 text-sm leading-6 text-white/55">Konto jest gotowe. Możesz przejść bezpośrednio do portalu sprzedawcy.</p>
              <button
                type="button"
                onClick={() => router.replace('/seller')}
                className="mt-7 w-full rounded-xl bg-[#d3bb73] px-5 py-3.5 text-sm font-semibold text-[#20130f] shadow-[0_10px_30px_rgba(211,187,115,0.16)] transition hover:bg-[#dfca8b]"
              >
                Przejdź do portalu
              </button>
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
                className="mt-7 w-full rounded-xl bg-white/7 px-5 py-3.5 text-sm text-white/75 transition hover:bg-white/10 hover:text-white"
              >
                Przejdź do logowania
              </button>
            </div>
          ) : (
            <>
              <div className="mb-7">
                <p className="text-xs uppercase tracking-[0.18em] text-[#d3bb73]">
                  {accessMode === 'invite' ? 'Pierwsze logowanie' : 'Reset hasła'}
                </p>
                <h1 className="mt-2 text-3xl font-light">Ustaw swoje hasło</h1>
                <p className="mt-3 text-sm leading-6 text-white/50">Minimum 8 znaków, w tym wielka i mała litera oraz cyfra.</p>
              </div>

              <form onSubmit={savePassword} className="space-y-4">
                <label className="block text-sm text-white/65">
                  Nowe hasło
                  <span className="relative mt-2 block">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/55" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl bg-[#100d13] py-3.5 pl-11 pr-12 text-white outline-none ring-1 ring-white/5 transition placeholder:text-white/20 focus:bg-[#131018] focus:ring-[#d3bb73]/35"
                      placeholder="Wpisz nowe hasło"
                    />
                    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70" aria-label={showPassword ? 'Ukryj hasło' : 'Pokaż hasło'}>
                      {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                </label>

                <label className="block text-sm text-white/65">
                  Powtórz hasło
                  <span className="relative mt-2 block">
                    <LockKeyhole className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#d3bb73]/55" />
                    <input
                      type={showConfirmation ? 'text' : 'password'}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      autoComplete="new-password"
                      required
                      className="w-full rounded-xl bg-[#100d13] py-3.5 pl-11 pr-12 text-white outline-none ring-1 ring-white/5 transition placeholder:text-white/20 focus:bg-[#131018] focus:ring-[#d3bb73]/35"
                      placeholder="Wpisz hasło ponownie"
                    />
                    <button type="button" onClick={() => setShowConfirmation((value) => !value)} className="absolute right-3.5 top-1/2 -translate-y-1/2 text-white/35 hover:text-white/70" aria-label={showConfirmation ? 'Ukryj hasło' : 'Pokaż hasło'}>
                      {showConfirmation ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                    </button>
                  </span>
                </label>

                {error && <p className="rounded-xl bg-red-400/10 px-4 py-3 text-sm leading-5 text-red-200">{error}</p>}

                <button
                  type="submit"
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#d3bb73] px-5 py-3.5 text-sm font-semibold text-[#20130f] shadow-[0_10px_30px_rgba(211,187,115,0.16)] transition hover:bg-[#dfca8b] disabled:cursor-not-allowed disabled:opacity-55"
                >
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  Zapisz hasło
                </button>
              </form>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
