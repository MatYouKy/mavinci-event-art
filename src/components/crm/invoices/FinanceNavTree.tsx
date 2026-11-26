'use client';

import type { LucideIcon } from 'lucide-react';

/*
 * Drzewo sekcji Finansów po lewej (`/crm/invoices`) — jak lista części Finansów na Macu (`FinanceView`): grupy (Przegląd,
 * Bank, Podatki i terminy, Dokumenty, Koszty i rozliczenia, Ustawienia), w każdej pozycje z ikoną i krótkim opisem.
 * Zastępuje dawne zakładki strony i drugi rząd zakładek „Dokumentów i rozliczeń” (zakładki w zakładkach). Pozycja to
 * zakładka strony (`?tab=`) i — dla sekcji „Dokumentów i rozliczeń” — sekcja (`&section=`), więc stare adresy działają.
 * Poniżej szerokości `xl` (laptop z paskiem bocznym CRM) — lista wyboru z grupami, żeby tabele miały całą szerokość.
 *
 * Wygląd: pozycje o jednej wysokości (nazwa i opis — każde w jednej, przyciętej linii), rozdzielone cienkimi liniami; wybrana pozycja to
 * „karta w pionie” — wysunięta w stronę treści, a wysunięta część jest złota i zaokrąglona z prawej (zamiast zakładki
 * z poziomym podkreśleniem).
 * Bez `data-crm-tab-active` — globalny styl zakładek CRM (zaokrąglenie u góry, pasek u dołu) tu nie pasuje; stan niesie
 * `aria-current`. Opis pod nazwą — zwykłym krojem (nawigacja CRM ma wersaliki kroju nagłówków tylko dla nazwy).
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
        <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33]/60 py-1">
          {groups.map((group) => (
            <div key={group.label} className="border-t border-[#e5e4e2]/[0.06] pb-1 first:border-t-0">
              <div className="px-4 pb-1 pt-2.5 text-[9.5px] font-medium uppercase tracking-[0.16em] text-[#e5e4e2]/35">
                {group.label}
              </div>
              <ul className="divide-y divide-[#e5e4e2]/[0.045]">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const selected = item.key === active;
                  return (
                    <li key={item.key}>
                      <button
                        type="button"
                        aria-current={selected ? 'page' : undefined}
                        onClick={() => onSelect(item)}
                        title={`${item.label} — ${item.detail}`}
                        className={`relative flex h-11 items-center gap-2.5 pl-4 text-left outline-none transition-[width,background-color,color,box-shadow] duration-150 focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#d3bb73]/50 ${
                          selected
                            ? 'z-10 w-[calc(100%+0.75rem)] rounded-r-lg pr-6 text-[#e2cd8d] [background:var(--crm-tab-active-bg)] shadow-[6px_0_14px_-8px_rgba(0,0,0,0.55)]'
                            : 'w-full pr-3 text-[#e5e4e2]/70 hover:bg-white/[0.035] hover:text-[#e5e4e2]'
                        }`}
                      >
                        {/* Wysunięta w stronę treści część wybranej pozycji — złota, zaokrąglona z prawej. */}
                        {selected && <span aria-hidden className="absolute inset-y-0 right-0 w-3 rounded-r-lg bg-[#d3bb73]" />}
                        <Icon className={`h-3.5 w-3.5 shrink-0 ${selected ? 'text-[#d3bb73]' : 'text-[#e5e4e2]/40'}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-[10.5px] leading-4">{item.label}</span>
                          <span
                            className={`block truncate font-sans text-[10.5px] font-normal normal-case leading-[14px] tracking-normal ${
                              selected ? 'text-[#d3bb73]/60' : 'text-[#e5e4e2]/35'
                            }`}
                          >
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
