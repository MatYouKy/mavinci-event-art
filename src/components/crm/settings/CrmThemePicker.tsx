'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { CRM_THEMES, CRM_THEME_PALETTES, isCrmTheme, type CrmTheme } from '@/lib/CRM/theme/crmTheme';

/*
 * Wybór motywu CRM dla zalogowanego pracownika (employees.crm_theme). Zmiana działa od razu
 * (atrybut data-crm-theme na <html>) i zapisuje się w profilu — obowiązuje na każdym komputerze.
 * Kolory: styles/crm-themes.css.
 */

/** Podgląd motywu — kolory ze wspólnej palety (CRM, Mac, telefon). */
const preview = (theme: CrmTheme) => {
  const palette = CRM_THEME_PALETTES[theme];
  return { page: palette.page, card: palette.surface, text: palette.text, muted: `${palette.text}73`, accent: palette.accent };
};

const readCurrent = (): CrmTheme => {
  const value = typeof document === 'undefined' ? null : document.documentElement.dataset.crmTheme;
  return isCrmTheme(value) ? value : 'burgundy';
};

export default function CrmThemePicker({ employeeId }: { employeeId: string | null | undefined }) {
  const { showSnackbar } = useSnackbar();
  const [theme, setTheme] = useState<CrmTheme>('burgundy');
  const [saving, setSaving] = useState<CrmTheme | null>(null);

  useEffect(() => { setTheme(readCurrent()); }, []);

  const choose = async (next: CrmTheme) => {
    if (!employeeId || next === theme || saving) return;
    const previous = theme;
    setTheme(next);
    document.documentElement.dataset.crmTheme = next;
    setSaving(next);
    const { error } = await (supabase.from as any)('employees').update({ crm_theme: next }).eq('id', employeeId);
    setSaving(null);
    if (error) {
      setTheme(previous);
      document.documentElement.dataset.crmTheme = previous;
      showSnackbar(
        error.code === '42703' || error.code === 'PGRST204'
          ? 'Motywy wymagają aktualizacji bazy danych (migracja crm_theme).'
          : 'Nie udało się zapisać motywu. Spróbuj ponownie.',
        'error',
      );
      return;
    }
    showSnackbar(`Motyw: ${CRM_THEMES.find((item) => item.id === next)?.label}`, 'success');
  };

  return (
    <div className="rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] p-6">
      <h3 className="mb-1 text-lg font-light text-[#e5e4e2]">Wygląd</h3>
      <p className="mb-5 text-sm text-[#e5e4e2]/60">
        Motyw kolorystyczny CRM. Ustawienie dotyczy tylko Ciebie i obowiązuje na każdym komputerze.
      </p>
      <div role="radiogroup" aria-label="Motyw CRM" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CRM_THEMES.map((option) => {
          const colors = preview(option.id);
          const active = theme === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={Boolean(saving) || !employeeId}
              onClick={() => void choose(option.id)}
              className={`rounded-xl p-2 text-left transition-colors disabled:cursor-wait ${active ? 'bg-[#d3bb73]/15' : 'bg-[#0f1119] hover:bg-white/5'}`}
            >
              <div data-theme-preserve className="overflow-hidden rounded-lg p-2.5" style={{ background: colors.page }}>
                <div className="flex gap-2">
                  <div className="w-1/4 space-y-1.5 rounded-md p-1.5" style={{ background: colors.card }}>
                    {[0, 1, 2].map((line) => <div key={line} className="h-1.5 rounded-full" style={{ background: line === 0 ? colors.accent : colors.muted }} />)}
                  </div>
                  <div className="flex-1 space-y-1.5 rounded-md p-2" style={{ background: colors.card }}>
                    <div className="h-2 w-2/3 rounded-full" style={{ background: colors.text }} />
                    <div className="h-1.5 w-full rounded-full" style={{ background: colors.muted }} />
                    <div className="h-1.5 w-4/5 rounded-full" style={{ background: colors.muted }} />
                    <div className="mt-2 h-3 w-1/3 rounded" style={{ background: colors.accent }} />
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between gap-2 px-1">
                <span>
                  <span className={`block text-sm ${active ? 'text-[#d3bb73]' : 'text-[#e5e4e2]'}`}>{option.label}</span>
                  <span className="block text-xs text-[#e5e4e2]/50">{option.description}</span>
                </span>
                {saving === option.id
                  ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#d3bb73]" />
                  : active && <Check className="h-4 w-4 shrink-0 text-[#d3bb73]" />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
