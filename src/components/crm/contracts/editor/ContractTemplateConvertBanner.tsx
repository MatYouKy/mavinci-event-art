'use client';

import { useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useDialog } from '@/contexts/DialogContext';
import { renderContractDocument } from '@/lib/CRM/contracts/contractPagination';
import { convertLegacyContractTemplate } from '@/lib/CRM/contracts/contractTemplateConverter';
import { CONTRACT_STYLE_IDS, CONTRACT_STYLE_LABELS } from '@/lib/CRM/contracts/contractDocumentStyles';
import { getContractDocumentCss } from '@/components/crm/events/calculations/helpers/getContractCssForPrint';

export interface ContractTemplateConvertBannerProps {
  template: any;
  /** Treść z edytora (może mieć niezapisane zmiany — wtedy najpierw trzeba zapisać). */
  hasUnsavedChanges: boolean;
  onConverted: () => Promise<void> | void;
}

const pages = (count: number) => `${count} ${count === 1 ? 'strona' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 10 || count % 100 >= 20) ? 'strony' : 'stron'}`;

/**
 * Pasek nad starym edytorem: przekształcenie szablonu do stylów dokumentu (nowy edytor jak Word). Najpierw pokazuje
 * wynik (liczba stron przed i po, rozpoznane style), zapisuje dopiero po potwierdzeniu i zostawia kopię starej treści.
 */
export default function ContractTemplateConvertBanner({ template, hasUnsavedChanges, onConverted }: ContractTemplateConvertBannerProps) {
  const { showSnackbar } = useSnackbar();
  const { showConfirm } = useDialog();
  const [busy, setBusy] = useState(false);

  const convert = async () => {
    if (hasUnsavedChanges) {
      showSnackbar('Najpierw zapisz zmiany w szablonie.', 'warning');
      return;
    }
    try {
      setBusy(true);
      const settings = { ...(template?.page_settings || {}) };
      delete settings.pages;
      delete settings.flowContent;
      const flow = template?.page_settings?.flowContent || template?.content_html || '';
      const before = await renderContractDocument(flow, settings);
      const conversion = await convertLegacyContractTemplate(flow, {
        selectedFont: settings.selectedFont,
        lineHeight: settings.lineHeight,
        baseCss: getContractDocumentCss(),
      });
      const v2Settings = {
        ...settings,
        documentStyles: conversion.documentStyles,
        selectedFont: conversion.documentStyles.styles.body.fontFamily,
        lineHeight: conversion.documentStyles.styles.body.lineHeight,
      };
      const after = await renderContractDocument(conversion.html, v2Settings);
      const counts = CONTRACT_STYLE_IDS.filter((id) => conversion.report.styleCounts[id])
        .map((id) => `${CONTRACT_STYLE_LABELS[id]}: ${conversion.report.styleCounts[id]}`);
      setBusy(false);

      const confirmed = await showConfirm({
        title: 'Przekształcić szablon do nowego edytora?',
        message: (
          <div className="space-y-2 text-sm">
            <p>
              Wygląd umowy zostanie zapisany jako style (jak w Wordzie): zmiana stylu zmienia wszystkie akapity tego rodzaju.
              Treść i warunki zostają bez zmian.
            </p>
            <p>
              Strony w PDF: <strong>{pages(before.pages.length)}</strong> → <strong>{pages(after.pages.length)}</strong>
            </p>
            {counts.length > 0 && <p className="text-xs opacity-70">Rozpoznane style — {counts.join(' · ')}</p>}
            {conversion.report.warnings.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-amber-300">
                {conversion.report.warnings.map((warning) => <li key={warning}>{warning}</li>)}
              </ul>
            )}
            <p className="text-xs opacity-70">Poprzednia wersja zostaje zapisana w szablonie — można do niej wrócić.</p>
          </div>
        ),
        confirmText: 'Przekształć',
        cancelText: 'Anuluj',
      });
      if (!confirmed) return;

      setBusy(true);
      if (!template?.updated_at) throw new Error('Odśwież szablon przed przekształceniem.');
      const { data, error } = await supabase
        .from('contract_templates')
        .update({
          content_html: after.flowContent,
          page_settings: {
            ...v2Settings,
            flowContent: after.flowContent,
            pages: after.pages,
            legacyFormatBackup: {
              flowContent: flow,
              selectedFont: settings.selectedFont ?? null,
              lineHeight: settings.lineHeight ?? null,
              clauseTypography: settings.clauseTypography ?? null,
              convertedAt: new Date().toISOString(),
            },
          },
          updated_at: new Date().toISOString(),
        })
        .eq('id', template.id)
        .eq('updated_at', template.updated_at)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Szablon został zmieniony w innej karcie. Odśwież stronę i spróbuj ponownie.');
      showSnackbar('Szablon przekształcony — otwieram nowy edytor', 'success');
      await onConverted();
    } catch (error: any) {
      showSnackbar(error?.message || 'Nie udało się przekształcić szablonu', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-3 flex items-center gap-3 rounded-lg border border-[#d3bb73]/30 bg-[#d3bb73]/10 px-4 py-2.5 text-sm text-[#e5e4e2]">
      <Sparkles className="h-4 w-4 shrink-0 text-[#d3bb73]" />
      <div className="flex-1">
        <span className="font-medium text-[#d3bb73]">Nowy edytor umów (jak Word).</span>{' '}
        Style akapitów, czyste wklejanie z Worda, wstążka. Ten szablon jest jeszcze w starym formacie.
      </div>
      <button
        type="button"
        onClick={() => void convert()}
        disabled={busy}
        className="flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-1.5 text-sm font-medium text-[#1c1f33] hover:bg-[#d3bb73]/90 disabled:opacity-60"
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        Przekształć szablon
      </button>
    </div>
  );
}
