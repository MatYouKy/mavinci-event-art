import type { SellerArrangements } from './arrangements';

export type ClientAcceptance = { id: string; document_id: string; source_key: string; seller_name: string; confirmed_at: string };
export type DeliveryProgress = {
  my_company_id: string; commission_enabled: boolean;
  acceptances: ClientAcceptance[];
  items: { id: string; name: string; quantity: number; unit: string; requirements?: string | null; accommodation?: string | null; logistics?: string | null }[];
  submissions: { id: string; task_key: string; arrangement_revision: number; submitted_at: string }[];
};
export type SellerDocument = { id: string; filename: string; created_at: string; source_key: string; current: boolean };
export type SellerDeliveryState = {
  title: string; offer_number: string; source_key: string; documents: SellerDocument[];
  review?: { document_id: string; status: string; source_key: string; reviewed_at?: string; response_note?: string };
  realization?: { offer_status: string; event_status: string | null; stage: string; event_id: string | null };
  seller_arrangements?: SellerArrangements; seller_arrangements_error?: string;
  seller_progress?: DeliveryProgress; seller_progress_error?: string;
  chat?: { sales_partner_id: string; my_company_id: string; can_start: boolean }; chat_error?: string;
};

export const deliverySteps = ['Potwierdzenie MAVINCI', 'Potwierdzona', 'W przygotowaniu', 'Gotowa', 'W realizacji', 'Zrealizowana'];
// Dates never advance a stage. Only the existing CRM decision/status does.
export function deliveryStage(status?: string | null) {
  if (status === 'cancelled') return { index: -1, label: 'Anulowana', closed: true, cancelled: true };
  if (['on_hold', 'paused'].includes(status || '')) return { index: -1, label: 'Wstrzymana', closed: false, cancelled: false };
  const index = status === 'offer_accepted' ? 1 : status === 'in_preparation' ? 2 : status === 'ready_for_live' ? 3
    : status === 'in_progress' ? 4 : ['completed', 'invoiced', 'settled'].includes(status || '') ? 5 : 0;
  return { index, label: index === 0 ? 'Oczekuje na potwierdzenie MAVINCI' : deliverySteps[index], closed: index === 5, cancelled: false };
}

export type PreparationTask = { key: string; title: string; detail: string; due?: string | null; recorded?: boolean; optional?: boolean };
export function preparationTasks(arrangements: SellerArrangements, progress?: DeliveryProgress): PreparationTask[] {
  const values = arrangements.values;
  if (deliveryStage(arrangements.event?.status).closed) return arrangements.event?.status === 'cancelled' ? []
    : [{ key: 'feedback', title: 'Podsumowanie po realizacji', detail: 'Przekaż opiekunowi uwagi klienta lub informację, że wszystko przebiegło zgodnie z ustaleniami.', optional: true }];
  const tasks: PreparationTask[] = [{ key: 'contact', title: 'Kontakt do osoby na miejscu',
    detail: 'Imię i nazwisko, rola oraz telefon osoby dostępnej podczas wydarzenia.',
    recorded: Boolean(values.contacts?.some((contact) => contact.name.trim() && contact.phone.trim())) }];
  if (values.technical_requirements?.trim()) tasks.push({ key: 'technical', title: 'Wymagania techniczne', detail: values.technical_requirements });
  if (values.logistics_requirements?.trim()) tasks.push({ key: 'logistics', title: 'Logistyka i organizacja', detail: values.logistics_requirements });
  if (values.materials_due_date) tasks.push({ key: 'materials', title: 'Przekazanie materiałów',
    detail: 'Przekaż link do materiałów oraz opis dla zespołu. Dostępność plików potwierdzi opiekun.', due: values.materials_due_date });
  for (const item of progress?.items || []) {
    const detail = [item.requirements, item.accommodation, item.logistics].filter(Boolean).join('\n');
    if (detail) tasks.push({ key: `product:${item.id}`, title: item.name, detail });
  }
  return tasks;
}

export const deliveryTimestamp = (value?: string | null) => value
  ? new Date(value).toLocaleString('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'short', timeStyle: 'short' }) : 'Nie ustalono';
