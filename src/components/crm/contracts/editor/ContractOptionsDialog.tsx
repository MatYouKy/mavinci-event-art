'use client';

import { useEffect, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { contractOptionKeyFromLabel, type ContractOption } from '@/lib/CRM/contracts/contractConditions';

export interface ContractOptionsDialogProps {
  options: ContractOption[];
  /** Ile razy opcja jest użyta w warunkach treści — użytej nie da się usunąć. */
  usage: Record<string, number>;
  onSave: (options: ContractOption[]) => void;
  onClose: () => void;
}

/**
 * Opcje umowy szablonu (np. „Nocleg dla wykonawcy”, „Posiłek dla artystów”). Przy każdej umowie wydarzenia opcję
 * można włączyć lub wyłączyć; „domyślnie włączona” — stan dla nowej umowy.
 */
export default function ContractOptionsDialog({ options, usage, onSave, onClose }: ContractOptionsDialogProps) {
  const [list, setList] = useState<ContractOption[]>(options);
  const [label, setLabel] = useState('');
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [onClose]);

  const add = () => {
    const name = label.trim();
    if (!name) return;
    setList((current) => [...current, { key: contractOptionKeyFromLabel(name, current.map((option) => option.key)), label: name, defaultOn: true }]);
    setLabel('');
  };
  const update = (key: string, patch: Partial<ContractOption>) =>
    setList((current) => current.map((option) => (option.key === key ? { ...option, ...patch } : option)));

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="contract-options-title"
        className="w-full max-w-lg rounded-xl border border-white/10 bg-[#1c1f33] shadow-2xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
          <div>
            <h2 id="contract-options-title" className="text-base font-medium text-[#e5e4e2]">Opcje umowy</h2>
            <p className="text-xs text-[#e5e4e2]/50">Włączane przy każdej umowie wydarzenia. Akapity z warunkiem „Opcja” pojawiają się tylko przy włączonej opcji.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="rounded p-1 text-[#e5e4e2]/60 hover:bg-white/10 hover:text-[#e5e4e2]">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-2 px-5 py-4">
          {list.length === 0 && <p className="text-sm text-[#e5e4e2]/60">Brak opcji. Dodaj np. „Nocleg dla wykonawcy”.</p>}
          {list.map((option) => (
            <div key={option.key} className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
              <input
                value={option.label}
                onChange={(event) => update(option.key, { label: event.target.value })}
                className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-sm text-[#e5e4e2] hover:border-white/15 focus:border-[#d3bb73] focus:outline-none"
              />
              <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[#e5e4e2]/70">
                <input type="checkbox" checked={option.defaultOn} onChange={(event) => update(option.key, { defaultOn: event.target.checked })} className="accent-[#d3bb73]" />
                domyślnie włączona
              </label>
              <button
                type="button"
                disabled={Boolean(usage[option.key])}
                onClick={() => setList((current) => current.filter((item) => item.key !== option.key))}
                title={usage[option.key] ? `Użyta w ${usage[option.key]} warunkach — najpierw usuń warunki` : 'Usuń opcję'}
                className="rounded p-1 text-[#e5e4e2]/50 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30 disabled:hover:bg-transparent"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add(); } }}
              placeholder="Nowa opcja"
              className="flex-1 rounded border border-white/15 bg-[#0f1119] px-2 py-1.5 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30"
            />
            <button type="button" onClick={add} className="rounded-lg bg-white/10 px-3 text-sm text-[#e5e4e2] hover:bg-white/15">Dodaj</button>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-white/10 px-5 py-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-[#e5e4e2]/80 hover:bg-white/10">Anuluj</button>
          <button
            type="button"
            onClick={() => onSave(list.map((option) => ({ ...option, label: option.label.trim() || option.key })))}
            className="rounded-lg bg-[#d3bb73] px-4 py-2 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90"
          >
            Zapisz opcje
          </button>
        </div>
      </div>
    </div>
  );
}
