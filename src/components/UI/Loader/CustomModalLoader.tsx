'use client';

import { Loader2 } from 'lucide-react';

interface FullScreenLoaderProps {
  show: boolean;
  title?: string;
  description?: string;
}

export default function FullScreenLoader({
  show,
  title = 'Ładowanie',
  description = 'Proszę chwilę poczekać...',
}: FullScreenLoaderProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
      <div className="flex min-w-[280px] flex-col items-center gap-4 rounded-2xl border border-[#d3bb73]/30 bg-[#1c1f33] px-8 py-7 shadow-2xl">
        <Loader2 className="h-9 w-9 animate-spin text-[#d3bb73]" />

        <div className="text-center">
          <div className="text-base font-medium text-[#e5e4e2]">{title}</div>
          <div className="mt-1 text-sm text-[#e5e4e2]/50">{description}</div>
        </div>
      </div>
    </div>
  );
}