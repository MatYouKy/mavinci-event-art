'use client';

import { useEffect, useRef, useState } from 'react';
import {
  CheckCircle,
  XCircle,
  Loader,
  Shield,
  FileText,
  Lock,
  Send,
  Radio,
  Database,
  X,
} from 'lucide-react';

interface KSeFSendModalProps {
  invoiceId: string;
  invoiceNumber: string;
  onSuccess: (result: { ksef_reference_number: string; ksef_timestamp: string }) => void;
  onError: (error: string) => void;
  onClose: () => void;
}

type KsefProgressEvent = {
  step: string;
  status: 'active' | 'completed' | 'error';
  message?: string;
  attempt?: number;
  maxAttempts?: number;
};

type StepStatus = 'pending' | 'active' | 'completed' | 'error';

interface Step {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  status: StepStatus;
}

const MAX_POLL_ATTEMPTS = 15;

const STEPS_CONFIG: Omit<Step, 'status'>[] = [
  {
    id: 'validate',
    label: 'Walidacja faktury',
    description: 'Sprawdzanie danych faktury i organizacji',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    id: 'xml',
    label: 'Generowanie dokumentu XML',
    description: 'Przygotowanie struktury FA(3) dla KSeF',
    icon: <FileText className="h-5 w-5" />,
  },
  {
    id: 'auth',
    label: 'Autoryzacja sesji KSeF',
    description: 'Weryfikacja uprawnień i pobieranie certyfikatów',
    icon: <Shield className="h-5 w-5" />,
  },
  {
    id: 'session',
    label: 'Otwieranie sesji szyfrowanej',
    description: 'Nawiązywanie bezpiecznego połączenia z KSeF',
    icon: <Lock className="h-5 w-5" />,
  },
  {
    id: 'encrypt',
    label: 'Szyfrowanie i wysyłka faktury',
    description: 'Szyfrowanie dokumentu kluczem symetrycznym',
    icon: <Send className="h-5 w-5" />,
  },
  {
    id: 'poll',
    label: 'Oczekiwanie na potwierdzenie',
    description: 'KSeF przetwarza fakturę i nadaje numer referencyjny',
    icon: <Radio className="h-5 w-5" />,
  },
  {
    id: 'save',
    label: 'Zapisywanie wyniku',
    description: 'Aktualizacja statusu faktury w systemie',
    icon: <Database className="h-5 w-5" />,
  },
];

export default function KSeFSendModal({
  invoiceId,
  invoiceNumber,
  onSuccess,
  onError,
  onClose,
}: KSeFSendModalProps) {
  const [steps, setSteps] = useState<Step[]>(
    STEPS_CONFIG.map((step) => ({ ...step, status: 'pending' as StepStatus })),
  );

  const [currentStepIndex, setCurrentStepIndex] = useState(-1);
  const [finished, setFinished] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ksefRef, setKsefRef] = useState<string | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [pollAttempt, setPollAttempt] = useState(0);
  const [pollMaxAttempts, setPollMaxAttempts] = useState(MAX_POLL_ATTEMPTS);

  const hasStarted = useRef(false);
  const startTimeRef = useRef(Date.now());
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    const controller = new AbortController();
    const jobId = crypto.randomUUID();

    startTimeRef.current = Date.now();

    timerRef.current = setInterval(() => {
      setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
    }, 500);

    const eventSource = new EventSource(
      `/bridge/ksef/invoices/send/progress?jobId=${encodeURIComponent(jobId)}`,
    );

    const markProgress = (progress: KsefProgressEvent) => {
      const progressIndex = STEPS_CONFIG.findIndex((step) => step.id === progress.step);

      if (progressIndex === -1) return;

      setCurrentStepIndex(progressIndex);

      setSteps((old) =>
        old.map((step, index) => {
          if (index < progressIndex) {
            return { ...step, status: 'completed' as StepStatus };
          }

          if (index === progressIndex) {
            return { ...step, status: progress.status };
          }

          return step;
        }),
      );

      if (progress.step === 'poll') {
        if (progress.attempt) setPollAttempt(progress.attempt);
        if (progress.maxAttempts) setPollMaxAttempts(progress.maxAttempts);
      }

      if (progress.status === 'error') {
        const message = progress.message || 'Błąd wysyłki do KSeF';
        setErrorMessage(message);
        setFinished(true);
        onError(message);
        eventSource.close();
      }
    };

    eventSource.onmessage = (event) => {
      try {
        const progress = JSON.parse(event.data) as KsefProgressEvent;
        markProgress(progress);
      } catch (err) {
        console.warn('[KSEF_PROGRESS] Invalid SSE message:', err);
      }
    };

    eventSource.onerror = () => {
      console.warn('[KSEF_PROGRESS] SSE connection error');
    };

    fetch('/bridge/ksef/invoices/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invoiceId, jobId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        const result = await res.json();

        if (!res.ok) {
          const details = Array.isArray(result.details)
            ? result.details.join(', ')
            : result.details;

          const msg = result.error || details || 'Nieznany błąd KSeF';

          setErrorMessage(msg);
          setFinished(true);

          setSteps((old) =>
            old.map((step, index) => {
              if (index < Math.max(currentStepIndex, 0)) {
                return { ...step, status: 'completed' as StepStatus };
              }

              if (index === Math.max(currentStepIndex, 0)) {
                return { ...step, status: 'error' as StepStatus };
              }

              return step;
            }),
          );

          onError(msg);
          eventSource.close();
          return;
        }

        setKsefRef(result.ksef_reference_number ?? null);

        setSteps((old) => old.map((step) => ({ ...step, status: 'completed' as StepStatus })));
        setCurrentStepIndex(STEPS_CONFIG.length - 1);
        setFinished(true);

        onSuccess({
          ksef_reference_number: result.ksef_reference_number,
          ksef_timestamp: result.ksef_timestamp,
        });

        eventSource.close();
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;

        const msg = err.message || 'Nieznany błąd';

        setErrorMessage(msg);
        setFinished(true);
        onError(msg);

        eventSource.close();
      });

    return () => {
      controller.abort();
      eventSource.close();

      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [invoiceId, onError, onSuccess]);

  const formatTime = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;

    return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
  };

  const completedCount = steps.filter((step) => step.status === 'completed').length;
  const progressPercent = (completedCount / steps.length) * 100;

  const isError = Boolean(errorMessage);
  const isSuccess = finished && !isError;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-lg overflow-hidden rounded-2xl border border-[#d3bb73]/30 bg-[#1c1f33] shadow-2xl">
        <div className="border-b border-[#d3bb73]/20 px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                  isError
                    ? 'bg-red-500/20'
                    : isSuccess
                      ? 'bg-green-500/20'
                      : 'bg-[#d3bb73]/20'
                }`}
              >
                {isError ? (
                  <XCircle className="h-5 w-5 text-red-400" />
                ) : isSuccess ? (
                  <CheckCircle className="h-5 w-5 text-green-400" />
                ) : (
                  <Send className="h-5 w-5 text-[#d3bb73]" />
                )}
              </div>

              <div>
                <h2 className="text-lg font-semibold text-[#e5e4e2]">
                  {isError
                    ? 'Wysyłka nieudana'
                    : isSuccess
                      ? 'Wysłano do KSeF'
                      : 'Wysyłanie do KSeF'}
                </h2>
                <p className="text-sm text-[#e5e4e2]/50">Faktura {invoiceNumber}</p>
              </div>
            </div>

            {finished && (
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-[#e5e4e2]/50 transition-colors hover:bg-[#d3bb73]/10 hover:text-[#e5e4e2]"
              >
                <X className="h-5 w-5" />
              </button>
            )}
          </div>

          {!finished && (
            <div className="mt-4">
              <div className="mb-1 flex items-center justify-between text-xs text-[#e5e4e2]/40">
                <span>
                  Krok {Math.max(Math.min(currentStepIndex + 1, steps.length), 1)} z{' '}
                  {steps.length}
                </span>
                <span>{formatTime(elapsedTime)}</span>
              </div>

              <div className="h-1.5 overflow-hidden rounded-full bg-[#0a0d1a]">
                <div
                  className="h-full rounded-full bg-[#d3bb73] transition-all duration-700 ease-out"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="max-h-[420px] overflow-y-auto px-6 py-4">
          <div className="space-y-1">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-start gap-3 rounded-lg px-3 py-2.5 transition-all duration-300 ${
                  step.status === 'active'
                    ? 'bg-[#d3bb73]/10'
                    : step.status === 'error'
                      ? 'bg-red-500/10'
                      : ''
                }`}
              >
                <div className="mt-0.5 flex-shrink-0">
                  {step.status === 'completed' ? (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-500/20">
                      <CheckCircle className="h-4 w-4 text-green-400" />
                    </div>
                  ) : step.status === 'active' ? (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#d3bb73]/20">
                      <Loader className="h-4 w-4 animate-spin text-[#d3bb73]" />
                    </div>
                  ) : step.status === 'error' ? (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-red-500/20">
                      <XCircle className="h-4 w-4 text-red-400" />
                    </div>
                  ) : (
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-[#e5e4e2]/5">
                      <div className="h-2 w-2 rounded-full bg-[#e5e4e2]/20" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div
                    className={`text-sm font-medium transition-colors duration-300 ${
                      step.status === 'completed'
                        ? 'text-green-400/80'
                        : step.status === 'active'
                          ? 'text-[#e5e4e2]'
                          : step.status === 'error'
                            ? 'text-red-400'
                            : 'text-[#e5e4e2]/30'
                    }`}
                  >
                    {step.label}

                    {step.id === 'poll' && step.status === 'active' && pollAttempt > 0 && (
                      <span className="ml-2 text-xs font-normal text-[#d3bb73]">
                        ({pollAttempt}/{pollMaxAttempts})
                      </span>
                    )}

                    {step.id === 'save' && step.status === 'active' && (
                      <span className="ml-2 text-xs font-normal text-[#d3bb73]">
                        (3 operacje)
                      </span>
                    )}
                  </div>

                  {(step.status === 'active' || step.status === 'error') && (
                    <div
                      className={`mt-0.5 text-xs ${
                        step.status === 'error' ? 'text-red-400/70' : 'text-[#e5e4e2]/40'
                      }`}
                    >
                      {step.id === 'poll' && step.status === 'active' && pollAttempt > 0
                        ? `Sprawdzanie statusu - próba ${pollAttempt} z ${pollMaxAttempts}`
                        : step.id === 'save' && step.status === 'active'
                          ? 'Zapis do KSeF, aktualizacja faktury, historia zmian'
                          : step.description}
                    </div>
                  )}

                  {step.id === 'poll' && step.status === 'active' && pollAttempt > 0 && (
                    <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#0a0d1a]">
                      <div
                        className="h-full rounded-full bg-[#d3bb73]/60 transition-all duration-500 ease-out"
                        style={{
                          width: `${(pollAttempt / pollMaxAttempts) * 100}%`,
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {finished && (
          <div className="border-t border-[#d3bb73]/20 px-6 py-4">
            {isSuccess && ksefRef && (
              <div className="mb-4 rounded-lg border border-green-500/20 bg-green-500/10 p-3">
                <div className="text-sm font-medium text-green-400">
                  Numer referencyjny KSeF
                </div>
                <div className="mt-1 font-mono text-sm text-[#e5e4e2]">{ksefRef}</div>
              </div>
            )}

            {isError && errorMessage && (
              <div className="mb-4 rounded-lg border border-red-500/20 bg-red-500/10 p-3">
                <div className="text-sm font-medium text-red-400">Szczegóły błędu</div>
                <div className="mt-1 text-sm text-[#e5e4e2]/70">{errorMessage}</div>
              </div>
            )}

            <button
              onClick={onClose}
              className={`w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
                isSuccess
                  ? 'bg-green-600 text-white hover:bg-green-700'
                  : 'bg-[#d3bb73] text-[#1c1f33] hover:bg-[#d3bb73]/90'
              }`}
            >
              {isSuccess ? 'Zamknij' : 'Rozumiem'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}