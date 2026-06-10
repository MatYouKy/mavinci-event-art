'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';

interface InvoiceNumberInputProps {
  invoiceType: 'vat' | 'proforma' | 'advance' | 'corrective';
  value: string;
  onChange: (value: string) => void;
  myCompanyId: string;
}

export default function InvoiceNumberInput({
  invoiceType,
  value,
  onChange,
  myCompanyId,
}: InvoiceNumberInputProps) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastInvoiceNumber, setLastInvoiceNumber] = useState<string>('');
  const [numberExists, setNumberExists] = useState(false);

  useEffect(() => {
    if (!myCompanyId) return;
    fetchNextInvoiceNumber();
  }, [invoiceType, myCompanyId]);

  useEffect(() => {
    if (!value || !myCompanyId) {
      setNumberExists(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      checkInvoiceNumberExists(value);
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [value, myCompanyId]);

  const fetchNextInvoiceNumber = async () => {
    try {
      setLoading(true);

      if (!myCompanyId) return;

      const { data: nextNumber, error } = await supabase.rpc('peek_next_invoice_number', {
        p_invoice_type: invoiceType,
        p_my_company_id: myCompanyId,
      });

      if (error) throw error;

      if (nextNumber) {
        onChange(nextNumber);
        setLastInvoiceNumber(nextNumber);
      }
    } catch (err) {
      console.error('Error fetching invoice number:', err);
    } finally {
      setLoading(false);
    }
  };

  const checkInvoiceNumberExists = async (invoiceNumber: string) => {
    try {
      setChecking(true);

      const { data, error } = await supabase
        .from('invoices')
        .select('id')
        .eq('my_company_id', myCompanyId)
        .eq('invoice_number', invoiceNumber.trim())
        .maybeSingle();

      if (error) throw error;

      setNumberExists(!!data);
    } catch (err) {
      console.error('Error checking invoice number:', err);
      setNumberExists(false);
    } finally {
      setChecking(false);
    }
  };

  const getInvoiceTypeLabel = () => {
    switch (invoiceType) {
      case 'proforma':
        return 'Proforma';
      case 'advance':
        return 'Zaliczkowa';
      case 'corrective':
        return 'Korygująca';
      default:
        return 'VAT';
    }
  };

  return (
    <div>
      <label className="mb-2 flex items-center justify-between text-sm text-[#e5e4e2]/60">
        <span>Numer faktury *</span>

        {lastInvoiceNumber && !numberExists && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Automatycznie wygenerowany
          </span>
        )}

        {numberExists && (
          <span className="flex items-center gap-1 text-xs text-red-400">
            <AlertTriangle className="h-3 w-3" />
            Numer już istnieje
          </span>
        )}
      </label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              setLastInvoiceNumber('');
            }}
            placeholder="FV/001/2026"
            disabled={!myCompanyId}
            className={`w-full rounded-lg border bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 ${
              numberExists
                ? 'border-red-500 focus:border-red-500'
                : 'border-[#d3bb73]/20 focus:border-[#d3bb73]'
            }`}
          />
        </div>

        <button
          type="button"
          onClick={fetchNextInvoiceNumber}
          disabled={loading || !myCompanyId}
          className="flex items-center gap-2 rounded-lg border border-[#d3bb73]/20 px-4 py-3 text-[#d3bb73] hover:bg-[#d3bb73]/10 disabled:opacity-50"
          title="Wygeneruj następny numer"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <RefreshCw className="h-5 w-5" />
          )}
        </button>
      </div>

      <div className="mt-2 space-y-1 text-xs text-[#e5e4e2]/40">
        <div>Typ: {getInvoiceTypeLabel()}</div>

        {!myCompanyId && (
          <div className="text-orange-400">
            Najpierw wybierz firmę wystawiającą fakturę.
          </div>
        )}

        {checking && <div>Sprawdzam dostępność numeru...</div>}

        {numberExists && (
          <div className="text-red-400">
            Ten numer faktury jest już użyty dla wybranej działalności.
          </div>
        )}

        {!numberExists && (
          <div>
            Numer jest sprawdzany osobno dla wybranej działalności.
          </div>
        )}
      </div>
    </div>
  );
}