import { resolveCalculationPrintCompany } from './calculationLogo';
import { supabase } from '@/lib/supabase/browser';
import { buildCalculationHtml } from '@/components/crm/events/pdf/buildCalculationHtml';
import {
  rowNet,
  rowGross,
  round2,
} from '@/components/crm/events/helpers/calculations/calculations.helper';
import type { CalcItem, Category } from '@/components/crm/events/calculations/EventCalculationsTab';
import { getCalculationNumber } from './calculationNumber';

export async function duplicateCalculation(
  id: string,
  scope: { inquiryId?: string; eventId?: string },
) {
  let query = supabase.from('event_calculations').select('*').eq('id', id);
  if (scope.inquiryId) query = query.eq('inquiry_id', scope.inquiryId);
  if (scope.eventId) query = query.eq('event_id', scope.eventId);
  const { data: original, error } = await query.single();
  if (error) throw error;
  const { data: copy, error: copyError } = await supabase.rpc('duplicate_sales_calculation', { p_calculation: id, p_request_id: crypto.randomUUID() });
  if (copyError) throw copyError;
  return copy as { calculation: any; items: CalcItem[] };
}

export async function requestCalculationPdf(payload: {
  expectedRevision: number;
  calculationId: string;
  eventId: string | null;
  inquiryId: string | null;
  eventName: string;
  calculationName: string;
  html: string;
  createdBy: string | null;
  previousPdfPath: string | null;
}) {
  const response = await fetch('/bridge/events/calculations-pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok || !data.storagePath)
    throw new Error(data.error || 'Nie udało się wygenerować PDF.');
  return data as { storagePath: string; fileName: string };
}

export type InquiryCalculationContext = {
  inquiryId: string;
  name: string;
  date: string | null;
  contactPerson: { id: string; name: string; email: string | null; phone: string | null } | null;
};

export async function generateSavedInquiryCalculationPdf(
  id: string,
  context: InquiryCalculationContext,
) {
  const { data: calculation, error } = await supabase
    .from('event_calculations')
    .select('*')
    .eq('id', id)
    .eq('inquiry_id', context.inquiryId)
    .single();
  if (error) throw error;
  const { data: items, error: itemsError } = await supabase
    .from('event_calculation_items')
    .select('*')
    .eq('calculation_id', id)
    .order('position')
    .order('id');
  if (itemsError) throw itemsError;
  if (!items?.length)
    throw new Error('Kalkulacja nie zawiera pozycji. Dodaj je przed wygenerowaniem PDF.');
  let eventName = context.name;
  let eventDate = context.date;
  let companyId: string | null = null;
  let contactPerson = context.contactPerson;
  if (calculation.event_id) {
    const { data: event, error: eventError } = await supabase
      .from('events')
      .select('name,event_date,my_company_id,contact_person_id')
      .eq('id', calculation.event_id)
      .single();
    if (eventError) throw eventError;
    eventName = event.name;
    eventDate = event.event_date;
    companyId = event.my_company_id;
    if (event.contact_person_id) {
      const { data: contact, error: contactError } = await supabase
        .from('contacts')
        .select('id,full_name,first_name,last_name,email,phone')
        .eq('id', event.contact_person_id)
        .single();
      if (contactError) throw contactError;
      contactPerson = {
        id: contact.id,
        name:
          contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' '),
        email: contact.email,
        phone: contact.phone,
      };
    }
  }
  let companyQuery = supabase
    .from('my_companies')
    .select(
      'id,name,legal_name,nip,logo_url,street,building_number,apartment_number,postal_code,city,email,phone,website',
    );
  companyQuery = companyId
    ? companyQuery.eq('id', companyId)
    : companyQuery.eq('is_default', true).eq('is_active', true);
  const { data: company, error: companyError } = await companyQuery.maybeSingle();
  if (companyError) throw companyError;
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Zaloguj się ponownie.');
  const { data: employee } = await supabase
    .from('employees')
    .select('name,surname,email,phone_number')
    .eq('auth_user_id', auth.user.id)
    .maybeSingle();
  const grouped: Record<Category, CalcItem[]> = {
    equipment: [],
    staff: [],
    transport: [],
    other: [],
  };
  const categoryTotals = { equipment: 0, staff: 0, transport: 0, other: 0 };
  const categoryTotalsGross = { equipment: 0, staff: 0, transport: 0, other: 0 };
  for (const item of items as CalcItem[]) {
    grouped[item.category].push(item);
    categoryTotals[item.category] += rowNet(item);
    categoryTotalsGross[item.category] += rowGross(item);
  }
  const html = buildCalculationHtml({
    calculationNumber: getCalculationNumber(id, calculation.created_at),
    name: calculation.name,
    notes: calculation.notes || '',
    eventName,
    eventDate,
    grouped,
    categoryTotals,
    categoryTotalsGross,
    grandTotal: round2(Object.values(categoryTotals).reduce((sum, value) => sum + value, 0)),
    grandTotalGross: round2(
      Object.values(categoryTotalsGross).reduce((sum, value) => sum + value, 0),
    ),
    company: await resolveCalculationPrintCompany(company),
    totalPowerWatts: items.reduce(
      (sum, item) => sum + Number(item.power_watts || 0) * Number(item.quantity || 0),
      0,
    ),
    contactPerson: contactPerson
      ? {
          name: contactPerson.name,
          email: contactPerson.email || '',
          phone: contactPerson.phone || '',
        }
      : null,
    preparedBy: {
      name: employee
        ? [employee.name, employee.surname].filter(Boolean).join(' ')
        : auth.user.email || '',
      email: employee?.email || auth.user.email || '',
      phone: employee?.phone_number || '',
    },
  });
  return requestCalculationPdf({
    expectedRevision: calculation.content_revision,
    calculationId: id,
    eventId: calculation.event_id || null,
    inquiryId: context.inquiryId,
    eventName,
    calculationName: calculation.name,
    html,
    createdBy: auth.user.id,
    previousPdfPath: calculation.generated_pdf_path || null,
  });
}
