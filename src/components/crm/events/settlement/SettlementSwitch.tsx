'use client';

/** Przełącznik tak/nie (role=switch) w stylu CRM — bez obramowań, złoty akcent. */
export default function SettlementSwitch({
  checked,
  onChange,
  label,
  disabled = false,
  title,
  className = '',
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
  title?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      title={title}
      onClick={() => onChange(!checked)}
      className={`inline-flex items-center gap-2 rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-[#e5e4e2]/80 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-45 ${className}`}
    >
      <span
        aria-hidden
        className={`relative inline-flex h-4 w-7 shrink-0 rounded-full transition-colors ${checked ? 'bg-[#d3bb73]' : 'bg-white/20'}`}
      >
        <span
          className={`absolute top-0.5 h-3 w-3 rounded-full bg-[#1c1f33] transition-[left] ${checked ? 'left-3.5' : 'left-0.5'}`}
        />
      </span>
      {label}
    </button>
  );
}
