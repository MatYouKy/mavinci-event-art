'use client';

import { useEffect, useState } from 'react';
import { Mail, Loader2 } from 'lucide-react';

interface MessagesLoadingScreenProps {
  onLoadComplete?: () => void;
  progress?: number;
}

export default function MessagesLoadingScreen({
  onLoadComplete,
  progress: externalProgress
}: MessagesLoadingScreenProps) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Inicjalizacja...');

  useEffect(() => {
    if (externalProgress !== undefined) {
      setProgress(externalProgress);

      if (externalProgress < 30) {
        setStatus('Ładowanie kont email...');
      } else if (externalProgress < 60) {
        setStatus('Pobieranie wiadomości...');
      } else if (externalProgress < 90) {
        setStatus('Przetwarzanie danych...');
      } else {
        setStatus('Prawie gotowe...');
      }

      if (externalProgress >= 100 && onLoadComplete) {
        setTimeout(onLoadComplete, 300);
      }
      return;
    }

    // Automatyczny progress jeśli nie ma zewnętrznego
    const steps = [
      { delay: 100, progress: 10, status: 'Ładowanie kont email...' },
      { delay: 300, progress: 30, status: 'Pobieranie wiadomości...' },
      { delay: 800, progress: 50, status: 'Przetwarzanie danych...' },
      { delay: 1200, progress: 70, status: 'Synchronizacja...' },
      { delay: 1500, progress: 90, status: 'Prawie gotowe...' },
      { delay: 1800, progress: 100, status: 'Gotowe!' },
    ];

    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < steps.length) {
        const step = steps[currentStep];
        setProgress(step.progress);
        setStatus(step.status);
        currentStep++;
      } else {
        clearInterval(interval);
        if (onLoadComplete) {
          setTimeout(onLoadComplete, 300);
        }
      }
    }, 200);

    return () => clearInterval(interval);
  }, [externalProgress, onLoadComplete]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1119]">
      <div className="w-full max-w-md px-6">
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-6 h-20 w-20">
            <Mail className="h-20 w-20 text-[#d3bb73]" />
            <Loader2 className="absolute inset-0 h-20 w-20 animate-spin text-[#d3bb73]/30" />
          </div>
          <h2 className="mb-2 text-2xl font-bold text-white">Wiadomości</h2>
          <p className="text-[#e5e4e2]/60">{status}</p>
        </div>

        {/* Progress bar */}
        <div className="mb-4 overflow-hidden rounded-full bg-[#1c1f33]">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-[#d3bb73] to-[#c5ad65] transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Progress percentage */}
        <div className="text-center">
          <span className="text-sm font-medium text-[#d3bb73]">{Math.round(progress)}%</span>
        </div>

        {/* Hint */}
        {progress < 50 && (
          <div className="mt-8 text-center text-xs text-[#e5e4e2]/40">
            Ładowanie może potrwać chwilę przy pierwszym uruchomieniu
          </div>
        )}
      </div>
    </div>
  );
}
