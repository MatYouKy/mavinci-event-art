'use client';

import { useEffect, useState } from 'react';
import { RefreshCw, Loader2, CheckCircle2 } from 'lucide-react';
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
  const [lastInvoiceNumber, setLastInvoiceNumber] = useState<string>('');

  useEffect(() => {
    fetchNextInvoiceNumber();
  }, [invoiceType]);

  const fetchNextInvoiceNumber = async () => {
    try {
      setLoading(true);

      const { data: nextNumber, error } = await supabase.rpc('generate_invoice_number', {
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

  console.log('[GUS_DEBUG-lastInvoiceNumber]', lastInvoiceNumber);

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
        {lastInvoiceNumber && (
          <span className="flex items-center gap-1 text-xs text-green-400">
            <CheckCircle2 className="h-3 w-3" />
            Automatycznie wygenerowany
          </span>
        )}
      </label>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="FV/001/2026"
            className="w-full rounded-lg border border-[#d3bb73]/20 bg-[#0a0d1a] px-4 py-3 text-[#e5e4e2] placeholder:text-[#e5e4e2]/40 focus:border-[#d3bb73] focus:outline-none"
          />
        </div>

        <button
          onClick={fetchNextInvoiceNumber}
          disabled={loading}
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
        <div>
          Numer został automatycznie wygenerowany na podstawie ostatniej faktury tego typu w
          systemie
        </div>
      </div>
    </div>
  );
}
