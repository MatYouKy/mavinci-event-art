'use client';

import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronDown, Download, Pencil, Trash2, X } from 'lucide-react';
import ResponsiveActionBar from '../../ResponsiveActionBar';

type AccountType = 'regular' | 'vat' | 'mt940';
type AccountFilter = 'all' | AccountType;
type CompanyTab = 'all' | string;

export interface BankStatementRecord {
  id: string;
  file_name: string;
  account_type: AccountType;
  statement_month: number;
  statement_year: number;
  my_company_id: string;
  file_storage_path: string | null;
  transactions_count: number;
  processed: boolean;
  validation_status?: 'pending' | 'valid' | 'rejected';
  validation_message?: string | null;
  parser_version?: number | null;
  created_at: string;
  my_companies?: { name: string } | null;
}

interface Props {
  open: boolean;
  loading: boolean;
  statements: BankStatementRecord[];
  renamingStatement: { id: string; name: string } | null;
  setRenamingStatement: (value: { id: string; name: string } | null) => void;
  onClose: () => void;
  onRename: () => void;
  onDownload: (
    statementId: string,
    accountType: AccountType,
    month: number,
    year: number,
  ) => void;
  onDelete: (statementId: string) => void;
}

const MONTHS = [
  'Styczeń',
  'Luty',
  'Marzec',
  'Kwiecień',
  'Maj',
  'Czerwiec',
  'Lipiec',
  'Sierpień',
  'Wrzesień',
  'Październik',
  'Listopad',
  'Grudzień',
];

function getTypeLabel(type: AccountType) {
  if (type === 'vat') return 'VAT';
  if (type === 'mt940') return 'MT940';
  return 'Bieżące';
}

function getStatementsCountLabel(count: number) {
  if (count === 1) return '1 wyciąg';
  if (count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14)) {
    return `${count} wyciągi`;
  }
  return `${count} wyciągów`;
}

export default function BankStatementsListModal({
  open,
  loading,
  statements,
  renamingStatement,
  setRenamingStatement,
  onClose,
  onRename,
  onDownload,
  onDelete,
}: Props) {
  const [selectedCompanyTab, setSelectedCompanyTab] = useState<CompanyTab>('all');
  const [selectedType, setSelectedType] = useState<AccountFilter>('all');
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());
  const [expandedMonths, setExpandedMonths] = useState<Set<string>>(new Set());

  const companyTabs = useMemo(() => {
    const map = new Map<string, string>();

    statements.forEach((statement) => {
      if (!statement.my_company_id) return;

      map.set(statement.my_company_id, statement.my_companies?.name || 'Bez nazwy');
    });

    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [statements]);

  const filteredStatements = useMemo(() => {
    return statements.filter((statement) => {
      const companyMatches =
        selectedCompanyTab === 'all' || statement.my_company_id === selectedCompanyTab;

      const typeMatches = selectedType === 'all' || statement.account_type === selectedType;

      return companyMatches && typeMatches;
    });
  }, [statements, selectedCompanyTab, selectedType]);

  const groupedStatements = useMemo(() => {
    const years = new Map<number, Map<number, BankStatementRecord[]>>();

    filteredStatements.forEach((statement) => {
      if (!years.has(statement.statement_year)) years.set(statement.statement_year, new Map());
      const months = years.get(statement.statement_year)!;
      if (!months.has(statement.statement_month)) months.set(statement.statement_month, []);
      months.get(statement.statement_month)!.push(statement);
    });

    return Array.from(years.entries())
      .sort(([leftYear], [rightYear]) => rightYear - leftYear)
      .map(([year, months]) => ({
        year,
        statementsCount: Array.from(months.values()).reduce((sum, rows) => sum + rows.length, 0),
        months: Array.from(months.entries())
          .sort(([leftMonth], [rightMonth]) => rightMonth - leftMonth)
          .map(([month, monthStatements]) => ({ month, statements: monthStatements })),
      }));
  }, [filteredStatements]);

  useEffect(() => {
    if (!open || groupedStatements.length === 0) return;
    const firstYear = groupedStatements[0];
    const firstMonth = firstYear.months[0];

    setExpandedYears((current) => {
      if (current.has(firstYear.year)) return current;
      return new Set(current).add(firstYear.year);
    });
    if (firstMonth) {
      const monthKey = `${firstYear.year}-${firstMonth.month}`;
      setExpandedMonths((current) => {
        if (current.has(monthKey)) return current;
        return new Set(current).add(monthKey);
      });
    }
  }, [groupedStatements, open]);

  const toggleYear = (year: number) => {
    setExpandedYears((current) => {
      const next = new Set(current);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };

  const toggleMonth = (year: number, month: number) => {
    const key = `${year}-${month}`;
    setExpandedMonths((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[90vh] w-full max-w-6xl overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#1c1f33] shadow-xl">
        <div className="flex items-center justify-between border-b border-[#d3bb73]/10 p-6">
          <div>
            <h3 className="text-xl font-medium text-[#e5e4e2]">Wszystkie wyciągi bankowe</h3>
            <p className="mt-1 text-sm text-[#e5e4e2]/50">
              Wyciągi pogrupowane według roku rozliczeniowego i miesiąca
            </p>
          </div>

          <button onClick={onClose} className="text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 border-b border-[#d3bb73]/10 p-4">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedCompanyTab('all')}
              className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                selectedCompanyTab === 'all'
                  ? 'bg-[#d3bb73] text-[#1c1f33]'
                  : 'bg-[#252945] text-[#e5e4e2]/70 hover:bg-[#2d3254]'
              }`}
            >
              Wszystkie działalności
            </button>

            {companyTabs.map((company) => (
              <button
                key={company.id}
                type="button"
                onClick={() => setSelectedCompanyTab(company.id)}
                className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                  selectedCompanyTab === company.id
                    ? 'bg-[#d3bb73] text-[#1c1f33]'
                    : 'bg-[#252945] text-[#e5e4e2]/70 hover:bg-[#2d3254]'
                }`}
              >
                {company.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {[
              { value: 'all', label: 'Wszystkie' },
              { value: 'regular', label: 'Wyciąg' },
              { value: 'vat', label: 'VAT' },
              { value: 'mt940', label: 'MT940' },
            ].map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setSelectedType(item.value as AccountFilter)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
                  selectedType === item.value
                    ? 'border border-[#d3bb73] bg-[#d3bb73]/15 text-[#d3bb73]'
                    : 'border border-[#d3bb73]/10 bg-transparent text-[#e5e4e2]/60 hover:bg-[#d3bb73]/5'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="max-h-[62vh] overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-[#e5e4e2]/60">Ładowanie...</div>
            </div>
          ) : filteredStatements.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-[#e5e4e2]/60">Brak wyciągów dla wybranych filtrów</div>
            </div>
          ) : (
            <div className="space-y-4">
              {groupedStatements.map((yearGroup) => {
                const yearExpanded = expandedYears.has(yearGroup.year);
                return (
                  <section
                    key={yearGroup.year}
                    className="overflow-hidden rounded-xl border border-[#d3bb73]/20 bg-[#141827]"
                  >
                    <button
                      type="button"
                      aria-expanded={yearExpanded}
                      onClick={() => toggleYear(yearGroup.year)}
                      className="flex w-full items-center justify-between gap-4 bg-[#d3bb73]/10 px-4 py-3 text-left hover:bg-[#d3bb73]/15"
                    >
                      <span className="flex items-center gap-3">
                        <CalendarDays className="h-5 w-5 text-[#d3bb73]" />
                        <span>
                          <strong className="block text-sm text-[#e5e4e2]">Rok rozliczeniowy {yearGroup.year}</strong>
                          <span className="text-xs text-[#e5e4e2]/45">
                            {yearGroup.months.length}{' '}
                            {yearGroup.months.length === 1 ? 'miesiąc' : 'miesięcy'} •{' '}
                            {getStatementsCountLabel(yearGroup.statementsCount)}
                          </span>
                        </span>
                      </span>
                      <ChevronDown
                        className={`h-5 w-5 text-[#d3bb73] transition-transform ${yearExpanded ? 'rotate-180' : ''}`}
                      />
                    </button>

                    {yearExpanded && (
                      <div className="space-y-3 border-t border-[#d3bb73]/10 p-3">
                        {yearGroup.months.map((monthGroup) => {
                          const monthKey = `${yearGroup.year}-${monthGroup.month}`;
                          const monthExpanded = expandedMonths.has(monthKey);
                          const transactionCount = monthGroup.statements.reduce(
                            (sum, statement) => sum + Number(statement.transactions_count || 0),
                            0,
                          );
                          return (
                            <div
                              key={monthKey}
                              className="overflow-hidden rounded-lg border border-[#d3bb73]/15 bg-[#1c1f33]"
                            >
                              <button
                                type="button"
                                aria-expanded={monthExpanded}
                                onClick={() =>
                                  toggleMonth(yearGroup.year, monthGroup.month)
                                }
                                className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-[#252945]"
                              >
                                <span>
                                  <strong className="text-sm text-[#e5e4e2]">
                                    {MONTHS[monthGroup.month - 1]} {yearGroup.year}
                                  </strong>
                                  <span className="ml-3 text-xs text-[#e5e4e2]/45">
                                    {getStatementsCountLabel(monthGroup.statements.length)} •{' '}
                                    {transactionCount} transakcji
                                  </span>
                                </span>
                                <ChevronDown
                                  className={`h-4 w-4 text-[#d3bb73]/75 transition-transform ${monthExpanded ? 'rotate-180' : ''}`}
                                />
                              </button>

                              {monthExpanded && (
                                <div className="overflow-x-auto border-t border-[#d3bb73]/10">
                                  <table className="w-full min-w-[860px]">
              <thead>
                <tr className="border-b border-[#d3bb73]/10">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Plik
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Firma
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Typ
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Transakcje
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Status danych
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-[#e5e4e2]/60">
                    Akcje
                  </th>
                </tr>
              </thead>

              <tbody>
                {monthGroup.statements.map((stmt) => (
                  <tr
                    key={stmt.id}
                    className="border-b border-[#d3bb73]/10 transition-colors hover:bg-[#252945]/50"
                  >
                    <td className="px-4 py-3">
                      {renamingStatement?.id === stmt.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={renamingStatement.name}
                            onChange={(e) =>
                              setRenamingStatement({
                                ...renamingStatement,
                                name: e.target.value,
                              })
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') onRename();
                              if (e.key === 'Escape') setRenamingStatement(null);
                            }}
                            autoFocus
                            className="w-full rounded border border-[#d3bb73]/30 bg-[#0f1119] px-2 py-1 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                          />

                          <button
                            onClick={onRename}
                            className="rounded px-2 py-1 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                          >
                            OK
                          </button>

                          <button
                            onClick={() => setRenamingStatement(null)}
                            className="rounded px-2 py-1 text-xs text-[#e5e4e2]/60 hover:bg-white/5"
                          >
                            x
                          </button>
                        </div>
                      ) : (
                        <span className="text-sm text-[#e5e4e2]">{stmt.file_name}</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <span className="text-sm text-[#e5e4e2]/70">
                        {stmt.my_companies?.name || '-'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          stmt.account_type === 'vat'
                            ? 'bg-blue-500/20 text-blue-400'
                            : stmt.account_type === 'mt940'
                              ? 'bg-purple-500/20 text-purple-400'
                              : 'bg-[#d3bb73]/20 text-[#d3bb73]'
                        }`}
                      >
                        {getTypeLabel(stmt.account_type)}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span className="text-sm text-[#e5e4e2]/70">
                        {stmt.transactions_count}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-center">
                      <span
                        title={stmt.validation_message || undefined}
                        className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${
                          stmt.validation_status === 'valid'
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : stmt.validation_status === 'rejected'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-sky-500/15 text-sky-300'
                        }`}
                      >
                        {stmt.validation_status === 'valid'
                          ? 'Zweryfikowany'
                          : stmt.validation_status === 'rejected'
                            ? 'Importuj ponownie'
                            : 'Oczekuje'}
                      </span>
                    </td>

                    <td className="px-4 py-3 text-right">
                      <ResponsiveActionBar
                        disabledBackground
                        mobileBreakpoint={4000}
                        actions={[
                          {
                            label: 'Pobierz',
                            icon: <Download className="h-4 w-4" />,
                            show: Boolean(stmt.file_storage_path),
                            onClick: () =>
                              onDownload(
                                stmt.id,
                                stmt.account_type,
                                stmt.statement_month,
                                stmt.statement_year,
                              ),
                          },
                          {
                            label: 'Zmień nazwę',
                            icon: <Pencil className="h-4 w-4" />,
                            onClick: () =>
                              setRenamingStatement({ id: stmt.id, name: stmt.file_name }),
                          },
                          {
                            label: 'Usuń',
                            icon: <Trash2 className="h-4 w-4" />,
                            variant: 'danger',
                            onClick: () => onDelete(stmt.id),
                          },
                        ]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
                                  </table>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end border-t border-[#d3bb73]/10 p-6">
          <button
            onClick={onClose}
            className="rounded-lg border border-[#d3bb73]/20 px-4 py-2 text-sm text-[#e5e4e2] hover:bg-[#252945]"
          >
            Zamknij
          </button>
        </div>
      </div>
    </div>
  );
}
