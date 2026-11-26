'use client';

import type { LucideIcon } from 'lucide-react';

/*
 * Drzewo sekcji Finansów po lewej (`/crm/invoices`) — jak lista części Finansów na Macu (`FinanceView`): grupy (Przegląd,
 * Bank, Podatki i terminy, Dokumenty, Koszty i rozliczenia, Ustawienia), w każdej pozycje z ikoną i krótkim opisem.
 * Zastępuje dawne zakładki strony i drugi rząd zakładek „Dokumentów i rozliczeń” (zakładki w zakładkach). Pozycja to
 * zakładka strony (`?tab=`) i — dla sekcji „Dokumentów i rozliczeń” — sekcja (`&section=`), więc stare adresy działają.
 * Poniżej szerokości `xl` (laptop z paskiem bocznym CRM) — lista wyboru z grupami, żeby tabele miały całą szerokość.
 */

export type FinanceNavItem = {
  key: string;
  label: string;
  detail: string;
  icon: LucideIcon;
  tab: string;
  section?: string;
};

export type FinanceNavGroup = { label: string; items: FinanceNavItem[] };

export default function FinanceNavTree({
  groups,
  active,
  onSelect,
}: {
  groups: FinanceNavGroup[];
  active: string;
  onSelect: (item: FinanceNavItem) => void;
}) {
  const items = groups.flatMap((group) => group.items);
  return (
    <>
      <div className="mb-4 xl:hidden">
        <label htmlFor="finance-section" className="mb-1 block text-[11px] uppercase tracking-wider text-[#e5e4e2]/45">
          Sekcja finansów
        </label>
        <select
          id="finance-section"
          value={active}
          onChange={(event) => {
            const item = items.find((candidate) => candidate.key === event.target.value);
            if (item) onSelect(item);
          }}
          className="w-full rounded-lg border border-[#d3bb73]/25 bg-[#1c1f33] px-3 py-2.5 text-sm text-[#e5e4e2] outline-none focus:border-[#d3bb73]/55"
        >
          {groups.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <nav aria-label="Sekcje finansów" className="hidden w-60 shrink-0 xl:sticky xl:top-4 xl:block">
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/70 p-2">
          {groups.map((group) => (
            <div key={group.label} className="mb-1.5 last:mb-0">
              <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-[0.14em] text-[#e5e4e2]/40">
                {group.label}
              </div>
              <ul>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const selected = item.key === active;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        data-crm-tab-active={selected}
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => onSelect(item)}
                        title={item.detail}
                        className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2 text-left transition-colors ${
                          selected
                            ? 'bg-[#d3bb73]/10 text-[#d3bb73]'
                            : 'text-[#e5e4e2]/75 hover:bg-white/[0.04] hover:text-[#e5e4e2]'
                        }`}
                      >
                        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/45'}`} />
                        <span className="min-w-0">
                          <span className="block text-sm leading-5">{item.label}</span>
                          <span className={`block truncate text-[11px] leading-4 ${selected ? 'text-[#d3bb73]/70' : 'text-[#e5e4e2]/40'}`}>
                            {item.detail}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>
    </>
  );
}
