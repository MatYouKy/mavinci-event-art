'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, FilePlus2 } from 'lucide-react';

export interface InvoiceDocumentAction {
  label: string;
  description: string;
  icon?: ReactNode;
  onClick: () => void;
}

export default function InvoiceDocumentActionsMenu({ actions, label = 'Wystaw dokument' }: { actions: InvoiceDocumentAction[]; label?: string }) {
  const disclosure = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (disclosure.current && !disclosure.current.contains(event.target as Node)) {
        disclosure.current.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && disclosure.current?.open) {
        disclosure.current.open = false;
        disclosure.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  if (!actions.length) return null;

  return (
    <details ref={disclosure} className="group relative shrink-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#d3bb73]/90 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[#d3bb73]/40 [&::-webkit-details-marker]:hidden">
        <FilePlus2 className="h-4 w-4" />
        {label}
        <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute right-0 top-full z-40 mt-2 w-72 max-w-[calc(100vw-3rem)] rounded-xl border border-white/5 bg-[#1c1f33] p-1.5 shadow-xl">
        {actions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => {
              if (disclosure.current) disclosure.current.open = false;
              action.onClick();
            }}
            className="flex w-full items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors hover:bg-[#d3bb73]/10 focus-visible:bg-[#d3bb73]/10 focus-visible:outline-none"
          >
            <span className="mt-0.5 text-[#d3bb73]">{action.icon || <FilePlus2 className="h-4 w-4" />}</span>
            <span>
              <span className="block text-sm font-medium text-[#e5e4e2]">{action.label}</span>
              <span className="mt-1 block text-xs leading-relaxed text-[#e5e4e2]/55">{action.description}</span>
            </span>
          </button>
        ))}
      </div>
    </details>
  );
}
