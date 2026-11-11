import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from '@/lib/native/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { buildCalculationHtml } from '@/components/crm/events/pdf/buildCalculationHtml';
import { DEFAULT_VAT, round2, rowGross, rowNet } from '@/components/crm/events/helpers/calculations/calculations.helper';
import { getCalculationNumber } from '@/lib/CRM/calculations/calculationNumber';
import { buildCalculationHeadingFontCss, type PublicBrandTheme } from '@/lib/events/print/calculationHeadingFont';
import { resolveCachedPrintLogo } from '@/lib/print/pdfRenderer.server';
import type { PrintJob } from '@/lib/print/printJob.server';

/**
 * PDF kalkulacji wydarzenia dla Maca — ten sam dokument co „Generuj PDF” w `CalculationEditor`: zapisane pozycje
 * (rewizja treści), firma z logo z brandbooka, kontakt, przygotowujący, moc, krój nagłówków z motywu marki.
 * Zapis jak `/bridge/events/calculations-pdf`: folder „Kalkulacje”, wpis w Plikach, `publish_calculation_pdf`.
 */

export class CalculationPrintError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Category = 'equipment' | 'staff' | 'transport' | 'other';
type Row = Record<string, any>;

export type CalculationPrint = { html: string; revision: number; fileName: string; eventName: string; calculationName: string };

export async function loadCalculationPrint(ctx: NativeContext, eventId: string, calculationId: string, expectedRevision: number | null): Promise<CalculationPrint> {
  const s = ctx.supabase;
  const { data: calc } = await s.from('event_calculations').select('id,event_id,name,notes,created_at,content_revision').eq('id', calculationId).maybeSingle();
  if (!calc || (calc as Row).event_id !== eventId) throw new CalculationPrintError('Brak dostępu do kalkulacji', 403);
  const { data: canManage, error: permissionError } = await s.rpc('sales_can_manage_calculation', { p_calculation: calculationId });
  if (permissionError || !canManage) throw new CalculationPrintError('Brak uprawnień do zmiany kalkulacji', 403);
  const revision = Number((calc as Row).content_revision ?? 0);
  if (expectedRevision !== null && expectedRevision !== revision) throw new CalculationPrintError('Kalkulacja zmieniła się. Zapisz i wygeneruj dokument ponownie.', 409);

  const [rowsRes, eventRes, employeeRes, themeRes] = await Promise.all([
    s.from('event_calculation_items').select('*').eq('calculation_id', calculationId).order('position').order('id'),
    s.from('events').select('name, event_date, my_company_id, contact_person_id').eq('id', eventId).maybeSingle(),
    s.from('employees').select('name, surname, email, phone_number').eq('id', ctx.employee.id).maybeSingle(),
    s.rpc('get_public_brand_theme'),
  ]);
  if (rowsRes.error) throw rowsRes.error;
  const rows = (rowsRes.data || []) as Row[];
  if (!rows.length) throw new CalculationPrintError('Kalkulacja nie zawiera pozycji');
  const event = eventRes.data as Row | null;

  const companyFields = 'id, name, legal_name, nip, logo_url, street, building_number, apartment_number, postal_code, city, email, phone, website';
  const companyQuery = s.from('my_companies').select(companyFields);
  const { data: company } = event?.my_company_id
    ? await companyQuery.eq('id', event.my_company_id).maybeSingle()
    : await companyQuery.eq('is_default', true).eq('is_active', true).maybeSingle();
  let printCompany: Row | null = null;
  if (company) {
    const logo = await resolveCachedPrintLogo(createSupabaseAdminClient(), (company as Row).id);
    printCompany = { ...(company as Row), logo_url: logo };
  }
  let contactPerson: { name: string; email: string; phone: string } | null = null;
  if (event?.contact_person_id) {
    const { data: contact } = await s.from('contacts').select('first_name, last_name, full_name, email, phone').eq('id', event.contact_person_id).maybeSingle();
    if (contact) {
      const c = contact as Row;
      contactPerson = { name: c.full_name || `${c.first_name ?? ''} ${c.last_name ?? ''}`.trim() || 'Kontakt bez nazwy', email: c.email ?? '', phone: c.phone ?? '' };
    }
  }
  const employee = employeeRes.data as Row | null;
  const preparedBy = employee
    ? { name: `${employee.name ?? ''} ${employee.surname ?? ''}`.trim(), email: employee.email ?? null, phone: employee.phone_number ?? null }
    : { name: 'Nieznany użytkownik', email: null, phone: null };

  const grouped: Record<Category, any[]> = { equipment: [], staff: [], transport: [], other: [] };
  const totals: Record<Category, number> = { equipment: 0, staff: 0, transport: 0, other: 0 };
  const gross: Record<Category, number> = { equipment: 0, staff: 0, transport: 0, other: 0 };
  for (const raw of rows) {
    const item = {
      ...raw, quantity: Number(raw.quantity), unit_price: Number(raw.unit_price), days: Number(raw.days),
      vat_rate: raw.vat_rate != null ? Number(raw.vat_rate) : DEFAULT_VAT, description: raw.description ?? '',
    };
    const category = (['equipment', 'staff', 'transport', 'other'].includes(item.category) ? item.category : 'other') as Category;
    grouped[category].push(item);
    totals[category] += rowNet(item as any);
    gross[category] += rowGross(item as any);
  }
  const html = buildCalculationHtml({
    calculationNumber: getCalculationNumber(calculationId, (calc as Row).created_at),
    name: (calc as Row).name, notes: (calc as Row).notes || '', eventName: event?.name ?? '', eventDate: event?.event_date ?? null,
    grouped: grouped as any, categoryTotals: totals, categoryTotalsGross: gross,
    grandTotal: round2(Object.values(totals).reduce((sum, value) => sum + value, 0)),
    grandTotalGross: round2(Object.values(gross).reduce((sum, value) => sum + value, 0)),
    company: printCompany, totalPowerWatts: rows.reduce((sum, item) => sum + Number(item.power_watts || 0) * Number(item.quantity || 0), 0),
    contactPerson, preparedBy: preparedBy as any,
  });
  const fontCss = buildCalculationHeadingFontCss(themeRes.data && typeof themeRes.data === 'object' ? (themeRes.data as unknown as PublicBrandTheme) : null);
  const renderHtml = html.includes('</head>') ? html.replace('</head>', `<style>${fontCss}</style></head>`) : `<style>${fontCss}</style>${html}`;
  const slug = String((calc as Row).name || event?.name || 'kalkulacja').replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
  return { html: renderHtml, revision, fileName: `kalkulacja-${slug || 'event'}.pdf`, eventName: event?.name ?? '', calculationName: (calc as Row).name ?? '' };
}

/** Jak `page.pdf` w trasie kalkulacji: A4, tła, marginesy 10/10/20/10 mm, czekanie na fonty i obrazy. */
export function calculationPrintJob(print: CalculationPrint): PrintJob {
  return {
    version: 1, html: print.html, fontsMarker: null, javascript: true, network: 'open', allowedHosts: [], waitUntil: 'networkidle',
    waitForAssets: true, emulatePrintMedia: false,
    pdf: { format: 'A4', printBackground: true, margin: { top: '10mm', right: '10mm', bottom: '20mm', left: '10mm' } },
    fileName: print.fileName, finalize: true,
  };
}

/** Zapis jak w `/bridge/events/calculations-pdf`: folder „Kalkulacje”, plik, wpis w Plikach i publikacja dla rewizji. */
export async function storeCalculationPdf(ctx: NativeContext, eventId: string, calculationId: string, revision: number, print: { eventName: string; calculationName: string }, pdf: Buffer) {
  const admin = createSupabaseAdminClient();
  const createdBy = ctx.employee.authUserId || null;
  const rpc = await admin.rpc('get_or_create_documents_subfolder', {
    p_event_id: eventId, p_subfolder_name: 'Kalkulacje', p_required_permission: 'events_manage', p_created_by: createdBy,
  });
  let folderId: string | null = !rpc.error && rpc.data ? (rpc.data as string) : null;
  if (!folderId && rpc.error?.code === '23505') {
    const q = await admin.from('event_folders').select('id').eq('event_id', eventId).eq('name', 'Kalkulacje').order('created_at', { ascending: true }).limit(1).maybeSingle();
    folderId = (q.data as Row | null)?.id ?? null;
  }
  if (!folderId) throw new CalculationPrintError('Nie udało się uzyskać folderu Kalkulacje', 500);
  const slug = (print.calculationName || print.eventName || 'kalkulacja').replace(/[^a-z0-9]/gi, '-').toLowerCase().replace(/-+/g, '-').replace(/^-|-$/g, '');
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const fileName = `kalkulacja-${slug || 'event'}-${timestamp}-${randomUUID()}.pdf`;
  const storagePath = `${eventId}/documents/calculations/${fileName}`;
  const upload = await admin.storage.from('event-files').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
  if (upload.error) throw new CalculationPrintError(upload.error.message, 500);
  const inserted = await admin.from('event_files').insert([{
    event_id: eventId, folder_id: folderId, name: fileName, original_name: fileName, file_path: storagePath, file_size: pdf.byteLength,
    mime_type: 'application/pdf', document_type: 'calculation', thumbnail_url: null, uploaded_by: createdBy,
  }]);
  if (inserted.error) console.error('event_files insert error:', inserted.error);
  const published = await admin.rpc('publish_calculation_pdf', { p_calculation: calculationId, p_revision: revision, p_path: storagePath });
  if (published.error) {
    await admin.storage.from('event-files').remove([storagePath]);
    await admin.from('event_files').delete().eq('file_path', storagePath);
    throw new CalculationPrintError('Kalkulacja zmieniła się podczas generowania. Wygeneruj PDF ponownie.', 409);
  }
  return { storagePath, fileName };
}
