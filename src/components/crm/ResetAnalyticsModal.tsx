'use client';

import { useState } from 'react';
import { X, AlertTriangle, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ResetAnalyticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ResetAnalyticsModal({ isOpen, onClose, onSuccess }: ResetAnalyticsModalProps) {
  const [password, setPassword] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState<'confirm' | 'password'>('confirm');

  if (!isOpen) return null;

  const handleReset = async () => {
    if (!password) {
      setError('Wpisz hasło aby kontynuować');
      return;
    }

    setIsResetting(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError('Nie jesteś zalogowany');
        setIsResetting(false);
        return;
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: password,
      });

      if (signInError) {
        setError('Nieprawidłowe hasło. Spróbuj ponownie.');
        setIsResetting(false);
        return;
      }

      const { data: result, error: resetError } = await supabase
        .rpc('reset_analytics_data');

      if (resetError) {
        console.error('Error resetting analytics:', resetError);
        setError(resetError.message || 'Błąd podczas resetowania statystyk');
        setIsResetting(false);
        return;
      }

      console.log('Analytics reset result:', result);

      setPassword('');
      setStep('confirm');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Wystąpił nieoczekiwany błąd');
      setIsResetting(false);
    }
  };

  const handleClose = () => {
    if (!isResetting) {
      setPassword('');
      setError('');
      setStep('confirm');
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="bg-[#1c1f33] border-2 border-[#d3bb73]/30 rounded-2xl max-w-md w-full p-8 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <h2 className="text-2xl font-light text-[#e5e4e2]">
              {step === 'confirm' ? 'Resetuj statystyki' : 'Potwierdź hasłem'}
            </h2>
          </div>
          {!isResetting && (
            <button
              onClick={handleClose}
              className="text-[#e5e4e2]/60 hover:text-[#e5e4e2] transition-colors"
            >
              <X className="w-6 h-6" />
            </button>
          )}
        </div>

        {step === 'confirm' ? (
          <>
            <div className="mb-6 space-y-3">
              <p className="text-[#e5e4e2]/80">
                Ta operacja usunie <strong className="text-red-400">wszystkie dane analityczne</strong>:
              </p>
              <ul className="space-y-2 text-sm text-[#e5e4e2]/70 pl-5">
                <li className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  Historię wizyt (<span className="text-[#d3bb73]">page_analytics</span>)
                </li>
                <li className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  Interakcje użytkowników (<span className="text-[#d3bb73]">user_interactions</span>)
                </li>
                <li className="flex items-center gap-2">
                  <Trash2 className="w-4 h-4 text-red-400" />
                  Aktywne sesje (<span className="text-[#d3bb73]">active_sessions</span>)
                </li>
              </ul>
              <div className="mt-4 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-sm text-red-300 font-medium">
                  ⚠️ Tej operacji NIE MOŻNA cofnąć!
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleClose}
                disabled={isResetting}
                className="flex-1 px-6 py-3 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] hover:bg-[#0f1119]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Anuluj
              </button>
              <button
                onClick={() => setStep('password')}
                disabled={isResetting}
                className="flex-1 px-6 py-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-300 hover:bg-red-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                Kontynuuj
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mb-6 space-y-4">
              <p className="text-[#e5e4e2]/80">
                Aby potwierdzić reset statystyk, wpisz swoje hasło administratora:
              </p>

              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setError('');
                }}
                placeholder="Wpisz hasło"
                disabled={isResetting}
                className="w-full px-4 py-3 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:outline-none focus:border-[#d3bb73] disabled:opacity-50 disabled:cursor-not-allowed"
                onKeyPress={(e) => e.key === 'Enter' && handleReset()}
              />

              {error && (
                <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <p className="text-sm text-red-300">{error}</p>
                </div>
              )}

              <div className="p-3 bg-[#d3bb73]/10 border border-[#d3bb73]/30 rounded-lg">
                <p className="text-xs text-[#e5e4e2]/60">
                  💡 <strong>Wskazówka:</strong> Używamy Twojego hasła aby upewnić się, że to naprawdę Ty podejmujesz tę decyzję.
                </p>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep('confirm')}
                disabled={isResetting}
                className="flex-1 px-6 py-3 bg-[#0f1119] border border-[#d3bb73]/30 rounded-lg text-[#e5e4e2] hover:bg-[#0f1119]/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Wróć
              </button>
              <button
                onClick={handleReset}
                disabled={isResetting || !password}
                className="flex-1 px-6 py-3 bg-red-500 rounded-lg text-white hover:bg-red-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center justify-center gap-2"
              >
                {isResetting ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Resetowanie...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-5 h-5" />
                    Resetuj statystyki
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
