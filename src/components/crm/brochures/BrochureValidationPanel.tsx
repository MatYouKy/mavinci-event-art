'use client';

import { AlertTriangle, CheckCircle, ExternalLink } from 'lucide-react';
import { brochureIssueEditorUrl, brochureIssueLabel, type BrochureValidationIssue } from '@/lib/brochures/validation';

export default function BrochureValidationPanel({ brochureId, issues, stale = false, disabled = false, onEdit }: {
  brochureId: string;
  issues: BrochureValidationIssue[];
  stale?: boolean;
  disabled?: boolean;
  onEdit?: (issue: BrochureValidationIssue) => void;
}) {
  return <section id="brochure-validation" tabIndex={-1} aria-label="Wynik sprawdzania broszury" className="scroll-mt-5 space-y-3 rounded-xl bg-white/5 p-4 outline-none">
    <h2 className="flex items-center gap-2 text-sm font-medium text-[#d3bb73]">
      {issues.length || stale ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
      {issues.length ? `Broszura wymaga uwagi (${issues.length})` : stale ? 'Sprawdź broszurę po zmianach' : 'Broszura sprawdzona'}
    </h2>
    {stale && <p className="text-xs text-amber-200">Dane zmieniły się od ostatniego sprawdzenia. Poniższy wynik może być nieaktualny — użyj „Sprawdź broszurę” ponownie.</p>}
    {!issues.length && !stale && <p className="text-sm text-white/65">Zdjęcia, logo, treść i układ zostały sprawdzone. Przy generowaniu PDF sprawdzimy je ponownie, ponieważ dostępność plików może się zmienić.</p>}
    {issues.length > 0 && <ul className="space-y-3">
      {issues.map((issue) => <li key={issue.id} className="space-y-2 rounded-lg bg-black/15 p-3">
        <p className="text-sm font-medium">{brochureIssueLabel(issue)}</p>
        {issue.fileName && <p className="break-all text-xs text-white/50">Plik: {issue.fileName}</p>}
        <p className="text-sm text-amber-200">{issue.message}</p>
        <p className="text-xs leading-5 text-white/65">{issue.remedy}</p>
        {onEdit && !['logo', 'font'].includes(issue.field)
          ? <button type="button" disabled={disabled} onClick={() => onEdit(issue)} className="rounded-lg bg-white/10 px-3 py-2 text-xs text-[#d3bb73] disabled:opacity-40">Przejdź do poprawy</button>
          : <a href={brochureIssueEditorUrl(brochureId, issue)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs text-[#d3bb73]"><ExternalLink className="h-3 w-3" />{['logo', 'font'].includes(issue.field) ? 'Otwórz brandbook marki' : 'Popraw w edytorze broszury'}</a>}
      </li>)}
    </ul>}
  </section>;
}
