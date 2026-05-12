import { useSnackbar } from '@/contexts/SnackbarContext';
import { Building, Save } from 'lucide-react';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/browser';


export interface CompanyNumbering {
  id: string;
  name: string;
  nip: string;
  invoice_prefix: string | null;
  last_invoice_number: number;
  last_proforma_number: number;
  last_advance_number: number;
  last_corrective_number: number;
  last_final_number: number;
  invoice_numbering_year: number;
  is_default: boolean;
  invoice_count: number;
}

export function CompanyNumberingCard({
  company,
  existingNumbers,
  onSaved,
}: {
  company: CompanyNumbering;
  existingNumbers: string[];
  onSaved: () => void;  
}) {
  const { showSnackbar } = useSnackbar();
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editValues, setEditValues] = useState({
    last_invoice_number: company.last_invoice_number,
    last_proforma_number: company.last_proforma_number,
    last_advance_number: company.last_advance_number,
    last_corrective_number: company.last_corrective_number,
    last_final_number: company.last_final_number ?? 0,
    invoice_prefix: company.invoice_prefix || '',
  });

  useEffect(() => {
    setEditValues({
      last_invoice_number: company.last_invoice_number,
      last_proforma_number: company.last_proforma_number,
      last_advance_number: company.last_advance_number,
      last_corrective_number: company.last_corrective_number,
      last_final_number: company.last_final_number ?? 0,
      invoice_prefix: company.invoice_prefix || '',
    });
  }, [company]);

  const buildPreview = (prefix: string, typePrefix: string, nextNum: number, year: number) => {
    const parts: string[] = [];
    if (typePrefix) parts.push(typePrefix);
    if (prefix) parts.push(prefix);
    parts.push(String(nextNum));
    parts.push(String(year));
    return parts.join('/');
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const { error } = await supabase
        .from('my_companies')
        .update({
          last_invoice_number: editValues.last_invoice_number,
          last_proforma_number: editValues.last_proforma_number,
          last_advance_number: editValues.last_advance_number,
          last_corrective_number: editValues.last_corrective_number,
          last_final_number: editValues.last_final_number,
          invoice_prefix: editValues.invoice_prefix || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', company.id);

      if (error) throw error;
      showSnackbar(`Numeracja dla ${company.name} zaktualizowana`, 'success');
      onSaved();
    } catch (err) {
      console.error('Error saving company numbering:', err);
      showSnackbar('Blad podczas zapisywania', 'error');
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    editValues.last_invoice_number !== company.last_invoice_number ||
    editValues.last_proforma_number !== company.last_proforma_number ||
    editValues.last_advance_number !== company.last_advance_number ||
    editValues.last_corrective_number !== company.last_corrective_number ||
    editValues.last_final_number !== (company.last_final_number ?? 0) ||
    (editValues.invoice_prefix || '') !== (company.invoice_prefix || '');

  const prefix = editValues.invoice_prefix || '';
  const year = company.invoice_numbering_year;

  const counters = [
    { key: 'last_invoice_number' as const, label: 'Faktura VAT', typePrefix: '', color: 'text-[#d3bb73]' },
    { key: 'last_proforma_number' as const, label: 'Proforma', typePrefix: 'PRO', color: 'text-blue-400' },
    { key: 'last_advance_number' as const, label: 'Zaliczkowa', typePrefix: 'ZAL', color: 'text-amber-400' },
    { key: 'last_final_number' as const, label: 'Koncowa', typePrefix: 'FIN', color: 'text-green-400' },
    { key: 'last_corrective_number' as const, label: 'Korygujaca', typePrefix: 'KOR', color: 'text-red-400' },
  ];

  return (
    <div className="overflow-hidden rounded-xl border border-[#d3bb73]/10 bg-[#1c1f33] transition-all">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-6 py-5 text-left transition-colors hover:bg-[#d3bb73]/5"
      >
        <div className="flex items-center gap-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#d3bb73]/10">
            <Building className="h-5 w-5 text-[#d3bb73]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-[#e5e4e2]">{company.name}</span>
              {company.is_default && (
                <span className="rounded bg-[#d3bb73]/20 px-1.5 py-0.5 text-[10px] font-medium text-[#d3bb73]">
                  DOMYSLNA
                </span>
              )}
            </div>
            <div className="mt-0.5 text-xs text-[#e5e4e2]/40">
              NIP: {company.nip} &middot; {company.invoice_count} faktur
            </div>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="hidden items-center gap-4 sm:flex">
            {counters.map((c) => (
              <div key={c.key} className="text-center">
                <div className={`text-sm font-medium ${c.color}`}>
                  {(editValues[c.key] || 0) + 1}
                </div>
                <div className="text-[10px] text-[#e5e4e2]/30">{c.typePrefix || 'VAT'}</div>
              </div>
            ))}
          </div>
          <svg
            className={`h-5 w-5 text-[#e5e4e2]/40 transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-[#d3bb73]/10 px-6 py-5">
          <div className="mb-5">
            <label className="mb-2 block text-sm text-[#e5e4e2]/60">Prefix firmy (opcjonalnie)</label>
            <input
              type="text"
              value={editValues.invoice_prefix}
              onChange={(e) => setEditValues((v) => ({ ...v, invoice_prefix: e.target.value.toUpperCase() }))}
              placeholder="np. MAV, NAST"
              className="w-full max-w-xs rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-2.5 text-sm text-[#e5e4e2] placeholder:text-[#e5e4e2]/30 focus:border-[#d3bb73] focus:outline-none"
            />
            <div className="mt-1 text-xs text-[#e5e4e2]/30">
              Prefix bedzie dodany do numeru faktury, np. {prefix ? `${prefix}/1/${year}` : `1/${year}`}
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {counters.map((c) => {
              const currentVal = editValues[c.key];
              const nextNum = currentVal + 1;
              const preview = buildPreview(prefix, c.typePrefix, nextNum, year);

              return (
                <div key={c.key} className="rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-xs text-[#e5e4e2]/50">{c.label}</span>
                    <span className={`font-mono text-xs ${c.color}`}>{preview}</span>
                  </div>
                  <div className="mb-1 text-[10px] text-[#e5e4e2]/30">Ostatni uzyty numer</div>
                  <input
                    type="number"
                    min="0"
                    value={currentVal}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      if (!isNaN(val) && val >= 0) {
                        setEditValues((v) => ({ ...v, [c.key]: val }));
                      }
                    }}
                    className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#1c1f33] px-3 py-2 text-sm text-[#e5e4e2] focus:border-[#d3bb73] focus:outline-none"
                  />
                  <div className="mt-1 text-[10px] text-[#e5e4e2]/30">
                    Nastepna: {nextNum}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mb-4 rounded-lg border border-[#d3bb73]/10 bg-[#0a0d1a] p-4">
            <div className="mb-2 text-xs text-[#e5e4e2]/50">Podglad nastepnych numerow</div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {counters.map((c) => {
                const nextNum = editValues[c.key] + 1;
                const preview = buildPreview(prefix, c.typePrefix, nextNum, year);
                return (
                  <div key={c.key} className="rounded bg-[#1c1f33] px-3 py-2 text-center">
                    <div className={`font-mono text-sm ${c.color}`}>{preview}</div>
                    <div className="mt-0.5 text-[10px] text-[#e5e4e2]/30">{c.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          {hasChanges && (
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() =>
                  setEditValues({
                    last_invoice_number: company.last_invoice_number,
                    last_proforma_number: company.last_proforma_number,
                    last_advance_number: company.last_advance_number,
                    last_corrective_number: company.last_corrective_number,
                    last_final_number: company.last_final_number ?? 0,
                    invoice_prefix: company.invoice_prefix || '',
                  })
                }
                className="rounded-lg border border-[#d3bb73]/20 px-4 py-2.5 text-sm text-[#e5e4e2]/60 transition-colors hover:text-[#e5e4e2]"
              >
                Anuluj
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-5 py-2.5 text-sm font-medium text-[#1c1f33] transition-colors hover:bg-[#c4ac64] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                {saving ? 'Zapisywanie...' : 'Zapisz zmiany'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}