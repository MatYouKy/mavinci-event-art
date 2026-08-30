export const DASHBOARD_WIDGETS = [
  {
    id: 'kpi-overview',
    label: 'Pozostałe wskaźniki',
    description: 'Kompaktowe, rozwijane liczniki pomocnicze na końcu dashboardu.',
  },
  {
    id: 'sales-trends',
    label: 'Trend sprzedażowy',
    description: 'Zapytania, oferty i nowe wydarzenia w kolejnych miesiącach.',
  },
  {
    id: 'sales-funnel',
    label: 'Lejek sprzedaży',
    description: 'Przejście od zapytania przez ofertę do zaakceptowanej realizacji.',
  },
  {
    id: 'financial-trends',
    label: 'Wpływy, wydatki i wynik kasowy',
    description: 'Miesięczne, rzeczywiste przepływy pieniężne.',
  },
  {
    id: 'operational-attention',
    label: 'Wymaga działania',
    description: 'Zaległe zadania, faktury i nadchodzące wydarzenia.',
  },
  {
    id: 'recent-activity',
    label: 'Ostatnia aktywność',
    description: 'Najnowsze zmiany w CRM dostępne dla użytkownika.',
  },
  {
    id: 'quick-actions',
    label: 'Szybkie akcje',
    description: 'Skróty do najczęściej wykonywanych operacji.',
  },
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGETS)[number]['id'];
export type DashboardRange = '6m' | '12m';

export interface DashboardPreferences {
  range?: DashboardRange;
  widgets?: Partial<Record<DashboardWidgetId, boolean>>;
}

export const DEFAULT_DASHBOARD_RANGE: DashboardRange = '6m';

export function isDashboardWidgetEnabled(
  preferences: DashboardPreferences | undefined,
  widgetId: DashboardWidgetId,
) {
  return preferences?.widgets?.[widgetId] !== false;
}
