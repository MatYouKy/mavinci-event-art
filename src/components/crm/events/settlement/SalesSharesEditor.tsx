'use client';
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { Loader2, Plus, Trash2, UserCog } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { formatPercent, type SettlementInternalCommission } from '@/lib/events/settlement/eventSettlement';
import type { SettlementMutate } from './useEventSettlement';
import {
  accentButtonClass,
  parsePercentInput,
  primaryButtonClass,
  secondaryButtonClass,
  settlementInputClass,
  smallButtonClass,
} from './settlementUi';

type EmployeeOption = { id: string; name: string };
/** keep = bez zmian (zapisana ocena „klient własny”; nowa osoba — ocena wg opiekuna klienta). */
type ClientOwnedChoice = 'keep' | 'yes' | 'no';
type ShareRow = { rowId: string; employeeId: string; percent: string; clientOwned: ClientOwnedChoice; current: boolean | null };

let rowCounter = 0;
const nextRowId = () => `share-${++rowCounter}`;

function rowsFrom(internal: SettlementInternalCommission[]): ShareRow[] {
  return internal.map(item => ({
    rowId: nextRowId(),
    employeeId: item.employee_id,
    percent: String(item.share_percent).replace('.', ','),
    clientOwned: 'keep',
    current: item.client_owned,
  }));
}

/**
 * „Sprzedawca wydarzenia” (administrator): osoby i udziały (razem 100%), klient własny, powód → set_event_sales_shares.
 * Suma udziałów jest pokazywana na żywo tylko jako podpowiedź — sprawdza ją baza.
 */
export default function SalesSharesEditor({
  eventId,
  internal,
  busy,
  mutate,
}: {
  eventId: string;
  internal: SettlementInternalCommission[];
  busy: string | null;
  mutate: SettlementMutate;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [employees, setEmployees] = useState<EmployeeOption[]>([]);
  const [employeesError, setEmployeesError] = useState('');
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const saving = busy === 'shares';

  useEffect(() => {
    if (!open) return;
    let active = true;
    supabase
      .from('employees')
      .select('id,name,surname')
      .eq('is_active', true)
      .order('surname')
      .limit(500)
      .then(({ data, error: loadError }) => {
        if (!active) return;
        if (loadError) {
          setEmployeesError('Nie udało się wczytać listy pracowników.');
          return;
        }
        setEmployeesError('');
        setEmployees(
          (data ?? []).map(row => ({
            id: String(row.id),
            name: [row.name, row.surname].filter(Boolean).join(' ') || 'Pracownik',
          })),
        );
      });
    return () => {
      active = false;
    };
  }, [open]);

  const begin = () => {
    setRows(rowsFrom(internal));
    setReason('');
    setError('');
    setOpen(true);
  };

  // Podpowiedź na żywo (w groszach procentu, bez błędów zaokrągleń). Ostatecznie sprawdza baza.
  const sumHundredths = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const value = parsePercentInput(row.percent);
        return sum + (value === null ? 0 : Math.round(value * 100));
      }, 0),
    [rows],
  );
  const invalidPercent = rows.some(row => parsePercentInput(row.percent) === null || parsePercentInput(row.percent) === 0);
  // Pusta lista = świadomie bez sprzedawcy (baza zapamiętuje to i nie przywraca sprzedawcy automatycznie).
  const noSeller = rows.length === 0;
  const sumOk = noSeller || (sumHundredths === 10000 && !invalidPercent);

  const employeeName = (employeeId: string) =>
    employees.find(item => item.id === employeeId)?.name ?? internal.find(item => item.employee_id === employeeId)?.name ?? 'Pracownik';

  const update = (rowId: string, patch: Partial<ShareRow>) =>
    setRows(current => current.map(row => (row.rowId === rowId ? { ...row, ...patch } : row)));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (rows.some(row => !row.employeeId)) {
      setError('Wybierz pracownika w każdym wierszu.');
      return;
    }
    if (new Set(rows.map(row => row.employeeId)).size !== rows.length) {
      setError('Każdy pracownik może wystąpić raz.');
      return;
    }
    if (!sumOk) {
      setError('Udziały muszą być większe od zera i dawać razem 100%.');
      return;
    }
    if (reason.trim().length < 3) {
      setError('Podaj powód zmiany (widoczny w historii).');
      return;
    }
    setError('');
    const shares = rows.map(row => ({
      employee_id: row.employeeId,
      share_percent: parsePercentInput(row.percent),
      ...(row.clientOwned === 'keep' ? {} : { client_owned: row.clientOwned === 'yes' }),
    }));
    const ok = await mutate(
      'shares',
      'set_event_sales_shares',
      { p_event_id: eventId, p_shares: shares, p_reason: reason.trim() },
      noSeller ? 'Zapisano: wydarzenie bez sprzedawcy.' : 'Sprzedawca wydarzenia zapisany — prowizje przeliczone.',
    );
    if (ok) setOpen(false);
  };

  return (
    <section aria-labelledby={`${id}-heading`} className="rounded-xl bg-white/5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`${id}-heading`} className="flex items-center gap-2 font-medium text-[#e5e4e2]">
            <UserCog className="h-4 w-4 text-[#d3bb73]" aria-hidden />
            Sprzedawca wydarzenia
          </h3>
          <p className="mt-0.5 text-xs text-[#e5e4e2]/55">
            Zapisuje się przy akceptacji oferty. Możesz zmienić osobę albo podzielić udziały (razem 100%) — zmiana trafia do historii.
          </p>
        </div>
        {!open && (
          <button type="button" disabled={Boolean(busy)} onClick={begin} className={accentButtonClass}>
            Zmień
          </button>
        )}
      </div>

      {!open && (
        <ul className="mt-3 space-y-1 text-sm">
          {internal.length === 0 ? (
            <li className="text-[#e5e4e2]/50">Brak zapisanego sprzedawcy.</li>
          ) : (
            internal.map(item => (
              <li key={item.employee_id} className="flex justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="text-[#e5e4e2]">
                  {item.name}
                  {item.client_owned && <span className="ml-2 text-xs text-[#d3bb73]">klient własny</span>}
                </span>
                <span className="tabular-nums text-[#e5e4e2]/70">{formatPercent(item.share_percent)}</span>
              </li>
            ))
          )}
        </ul>
      )}

      {open && (
        <form onSubmit={submit} noValidate className="mt-3 space-y-3" aria-busy={saving}>
          {employeesError && <p className="text-xs text-amber-200">{employeesError}</p>}
          <ul className="space-y-2">
            {rows.map(row => {
              const taken = new Set(rows.filter(other => other.rowId !== row.rowId).map(other => other.employeeId));
              const options = employees.filter(item => !taken.has(item.id));
              const listed = options.some(item => item.id === row.employeeId);
              return (
                <li key={row.rowId} className="grid gap-2 rounded-lg bg-white/[0.03] p-2.5 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(0,11rem)_auto] sm:items-end">
                  <label className="block text-xs text-[#e5e4e2]/60">
                    Pracownik
                    <select
                      value={row.employeeId}
                      disabled={saving}
                      onChange={event => update(row.rowId, { employeeId: event.target.value, clientOwned: 'keep', current: null })}
                      className={`${settlementInputClass} mt-1`}
                    >
                      <option value="">Wybierz…</option>
                      {row.employeeId && !listed && <option value={row.employeeId}>{employeeName(row.employeeId)}</option>}
                      {options.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-xs text-[#e5e4e2]/60">
                    Udział (%)
                    <input
                      inputMode="decimal"
                      value={row.percent}
                      disabled={saving}
                      onChange={event => update(row.rowId, { percent: event.target.value })}
                      className={`${settlementInputClass} mt-1`}
                    />
                  </label>
                  <label className="block text-xs text-[#e5e4e2]/60">
                    Klient własny
                    <select
                      value={row.clientOwned}
                      disabled={saving}
                      onChange={event => update(row.rowId, { clientOwned: event.target.value as ClientOwnedChoice })}
                      className={`${settlementInputClass} mt-1`}
                    >
                      <option value="keep">
                        {row.current === null ? 'Wg opiekuna klienta' : `Bez zmian (${row.current ? 'tak' : 'nie'})`}
                      </option>
                      <option value="yes">Tak — 10%</option>
                      <option value="no">Nie — 5%</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => setRows(current => current.filter(item => item.rowId !== row.rowId))}
                    aria-label={`Usuń ${row.employeeId ? employeeName(row.employeeId) : 'wiersz'}`}
                    className="inline-flex h-9 items-center justify-center rounded-lg bg-red-500/10 px-2.5 text-red-200 hover:bg-red-500/20 disabled:opacity-45"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => setRows(current => [...current, { rowId: nextRowId(), employeeId: '', percent: '', clientOwned: 'keep', current: null }])}
              className={smallButtonClass}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Dodaj osobę
            </button>
            {noSeller ? (
              <p role="status" className="text-sm text-amber-200">Bez sprzedawcy</p>
            ) : (
              <p role="status" className={`text-sm tabular-nums ${sumOk ? 'text-emerald-300' : 'text-amber-200'}`}>
                Razem: {formatPercent(sumHundredths / 100)}
                {!sumOk && ' — musi być 100%'}
              </p>
            )}
          </div>
          {noSeller && (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs text-amber-100/90">
              Zapisanie pustej listy oznacza świadomie wydarzenie bez sprzedawcy — prowizja pracownika nie zostanie naliczona, a system nie
              przywróci sprzedawcy automatycznie.
            </p>
          )}
          <label className="block text-xs text-[#e5e4e2]/60">
            Powód zmiany <span className="text-[#d3bb73]">*</span>
            <textarea
              rows={2}
              maxLength={2000}
              value={reason}
              disabled={saving}
              onChange={event => setReason(event.target.value)}
              placeholder="Np. sprzedaż prowadzona wspólnie z…"
              className={`${settlementInputClass} mt-1`}
            />
          </label>
          {error && (
            <p role="alert" className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {error}
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => setOpen(false)} className={secondaryButtonClass}>
              Anuluj
            </button>
            <button type="submit" disabled={Boolean(busy)} className={primaryButtonClass}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Zapisz sprzedawcę
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
