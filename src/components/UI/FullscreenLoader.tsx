'use client';

import { Loader } from 'lucide-react';

type FullscreenLoaderProps = {
  open: boolean;
  title?: string;
  subtitle?: string;
  backdrop?: boolean;
  blur?: boolean;
};

export default function FullscreenLoader({
  open,
  title = 'Ładowanie...',
  subtitle = 'Proszę chwilę poczekać',
  backdrop = true,
  blur = true,
}: FullscreenLoaderProps) {
  if (!open) return null;

  return (
    <div
      className={`fixed inset-0 z-[99999] flex items-center justify-center ${
        backdrop ? 'bg-black/60' : 'bg-transparent'
      } ${blur ? 'backdrop-blur-sm' : ''}`}
    >
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-[#d3bb73]/20 bg-[#1c1f33] px-8 py-7 shadow-2xl">
        <Loader className="h-10 w-10 animate-spin text-[#d3bb73]" />

        <div className="text-center">
          <div className="text-sm font-medium text-[#e5e4e2]">{title}</div>
          {subtitle && <div className="mt-1 text-xs text-[#e5e4e2]/50">{subtitle}</div>}
        </div>
      </div>
    </div>
  );
}