import 'server-only';
import { compareEquipmentOrder, equipmentRowOrderKey } from '@/lib/events/equipment/equipmentChecklist';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildEquipmentChecklistHtml } from '@/app/(crm)/crm/events/[id]/helpers/buildEquipmentChecklistPdf';
import { parseEventAccess } from '@/lib/events/access/eventAccess';
import type { PrintJob } from '@/lib/print/printJob.server';
import { trustedPrintHosts } from '@/lib/print/printJob.server';

/*
 * Checklista sprzętu (nota załadunkowa) — ten sam HTML co „Generuj checklistę” w zakładce Sprzęt (`handleGenerateChecklist`
 * + `buildEquipmentChecklistHtml`), te same dane i ten sam zapis: plik w `event-files`, wpis w `event_files`, ścieżka
 * w `events.equipment_checklist_pdf_path`, usunięcie poprzedniej wersji. PDF drukuje Mac (Chrome, `?render=local`),
 * a bez Chrome — serwer.
 */

const CHECKLIST_COMPANY_ID = 'd4474f90-5e61-4ba4-928e-c25c0f0659b5';

export class ChecklistPrintError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);

/** `checklistFileName` z zakładki Sprzęt. */
export function checklistFileName(eventName: string | null | undefined, suffix = '') {
  const name = String(eventName || 'wydarzenie').normalize('NFC')
    .replace(/[^\p{L}\p{N}._ -]/gu, '-')
    .replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^[. -]+|[. -]+$/g, '')
    .slice(0, 100) || 'wydarzenie';
  return `checklista-sprzętu-${name}${suffix ? `-${suffix}` : ''}.pdf`;
}

/** Logo `logo-horizontal-black` z brandbooka Mavinci jako data URI (jak `resolveChecklistCompanyLogo`). */
async function checklistLogo(client: SupabaseClient) {
  const { data: company, error: companyError } = await client.from('my_companies').select('id, name').eq('id', CHECKLIST_COMPANY_ID).maybeSingle();
  if (companyError) throw new ChecklistPrintError('Nie udało się odczytać brandbooka Mavinci. Odśwież stronę i spróbuj ponownie.');
  if (!company) throw new ChecklistPrintError('Brak dostępu do firmowych ustawień Mavinci wymaganych do wydruku checklisty.');
  const { data: logos, error: logosError } = await client.from('company_brandbook_logos')
    .select('url, label, variant, is_default, order_index').eq('company_id', (company as any).id)
    .order('is_default', { ascending: false }).order('order_index', { ascending: true });
  if (logosError) throw new ChecklistPrintError('Nie udało się pobrać logotypów Mavinci. Sprawdź dostęp do brandbooka i ponów wydruk.');
  const normalize = (value: string | null | undefined) =>
    (value || '').trim().toLowerCase().replace(/\.(svg|png|webp|jpe?g)$/i, '').replace(/[\s_]+/g, '-');
  const logo = (logos || []).find((item: any) => normalize(item.label) === 'logo-horizontal-black')
    || (logos || []).find((item: any) => normalize(item.variant) === 'logo-horizontal-black');
  const raw = (logo as any)?.url as string | undefined;
  if (!raw) {
    throw new ChecklistPrintError('W brandbooku Mavinci dodaj logo o nazwie logo-horizontal-black. Checklista zawsze używa marki Mavinci, niezależnie od marki wydarzenia.');
  }
  const publicUrl = /^https?:\/\//i.test(raw) || raw.startsWith('data:')
    ? raw
    : `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/company-logos/${raw.replace(/^\/+/, '')}`;
  if (publicUrl.startsWith('data:')) return publicUrl;
  try {
    const response = await fetch(publicUrl);
    if (!response.ok) return publicUrl;
    const buffer = Buffer.from(await response.arrayBuffer());
    return `data:${response.headers.get('content-type') || 'image/png'};base64,${buffer.toString('base64')}`;
  } catch {
    return publicUrl;
  }
}

/** Składniki zestawu (`extractKitItemsFromRow`, wariant `row.kit.items`). */
function kitItems(kit: any) {
  return (Array.isArray(kit?.items) ? kit.items : []).map((it: any) => {
    const eq = one(it?.equipment_items) || one(it?.equipment) || it;
    return { name: eq?.name || 'Nieznany', brand: eq?.brand || '', model: eq?.model || '', quantity: Number(it?.quantity || eq?.quantity) };
  });
}

export type ChecklistPrint = { html: string; eventName: string; fileName: string };

/** Dane i HTML checklisty — `resolved`: indeksy pozycji kalkulacji spoza magazynu rozwiązanych w zakładce (nie trafiają do uwag). */
export async function loadChecklistPrint(client: SupabaseClient, eventId: string, employeeId: string, resolved: Set<number>): Promise<ChecklistPrint> {
  const { data: event, error: eventError } = await client.from('events')
    .select('id, name, event_date, location, location_id, contact_person_id, equipment_checklist_notes, equipment_checklist_note_items')
    .eq('id', eventId).maybeSingle();
  if (eventError) throw new ChecklistPrintError('Nie udało się pobrać notatek do checklisty.');
  if (!event) throw new ChecklistPrintError('Nie znaleziono wydarzenia albo nie masz do niego dostępu.', 404);
  const e = event as any;
  const [rows, access, location, me, calculation] = await Promise.all([
    client.from('event_equipment').select(`
      id, is_loaded, quantity, removed_from_offer, expand_kit_in_checklist, kit_id, cable_id,
      equipment:equipment_items(name, brand, model, category:warehouse_categories(name)),
      kit:equipment_kits(name, category:warehouse_categories(name), items:equipment_kit_items(quantity, equipment:equipment_items(name, brand, model))),
      cable:cables(name, length_meters, category:warehouse_categories(name))`)
      .eq('event_id', eventId).or('removed_from_offer.is.null,removed_from_offer.eq.false').order('created_at', { ascending: true }),
    client.rpc('get_event_access', { p_event_id: eventId }),
    e.location_id ? client.from('locations').select('name, address, postal_code, city').eq('id', e.location_id).maybeSingle() : Promise.resolve({ data: null }),
    client.from('employees').select('name, surname, phone_number').eq('id', employeeId).maybeSingle(),
    client.rpc('get_event_calculation_equipment', { p_event_id: eventId }),
  ]);
  if (rows.error) throw new ChecklistPrintError('Nie udało się pobrać aktualnego stanu załadunku.');
  const equipment = (rows.data || []) as any[];
  if (!equipment.length) throw new ChecklistPrintError('Brak sprzętu do wygenerowania checklisty');
  const canViewClient = !access.error && parseEventAccess(access.data)?.areas?.client === true;
  const contact = canViewClient && e.contact_person_id
    ? (await client.from('contacts').select('*').eq('id', e.contact_person_id).maybeSingle()).data as any
    : null;
  const companyLogoUrl = await checklistLogo(client);
  const items = equipment.map((row) => {
    const equipmentItem = one(row.equipment) as any, kit = one(row.kit) as any, cable = one(row.cable) as any;
    const isKit = Boolean(row.kit_id || kit);
    const expand = row.expand_kit_in_checklist === true;
    return {
      order: equipmentRowOrderKey(row),
      data: {
        is_loaded: row.is_loaded === true,
        name: equipmentItem?.name || kit?.name || cable?.name || 'Nieznany',
        brand: equipmentItem?.brand || '',
        model: equipmentItem?.model || kit?.description || '',
        quantity: Number(row.quantity),
        category: (one(equipmentItem?.category) as any)?.name || '',
        cable_length: cable?.length_meters ?? null,
        is_kit: isKit,
        expand_kit_in_checklist: expand,
        kit_items: expand ? kitItems(kit) : [],
      },
    };
  }).sort((a, b) => compareEquipmentOrder(a.order, b.order)).map((item) => item.data);
  const l = (location as any).data;
  const locationText = l ? `${l.name ?? ''}, ${l.address ?? ''}, ${l.postal_code ?? ''} ${l.city ?? ''}  ` : (e.location || '-');
  const calc = calculation.error ? null : (calculation.data as any);
  const external = (Array.isArray(calc?.items) && calc?.calculation_id ? calc.items : [])
    .filter((item: any) => item.source !== 'warehouse' && !item.source_ref)
    .map((item: any) => ({ name: item.name, quantity: Number(item.quantity ?? 0), unit: item.unit || 'szt.' }))
    .filter((_: unknown, index: number) => !resolved.has(index));
  const employee = (me as any).data;
  const html = buildEquipmentChecklistHtml({
    checklistNotes: e.equipment_checklist_notes,
    checklistNoteItems: e.equipment_checklist_note_items,
    eventName: e.name || 'Wydarzenie',
    eventDate: e.event_date ? new Date(e.event_date).toLocaleDateString('pl-PL', { timeZone: 'Europe/Warsaw' }) : '',
    location: locationText,
    equipmentItems: items,
    authorName: employee ? `${employee.name} ${employee.surname}` : '-',
    authorNumber: employee?.phone_number || '-',
    contactName: contact?.full_name || '-',
    contactPhone: contact?.phone || '-',
    companyLogoUrl,
    externalItems: external.length > 0 ? external : undefined,
  });
  return { html, eventName: e.name || 'wydarzenie', fileName: checklistFileName(e.name) };
}

/** Ustawienia druku odpowiadające `html2pdf` z zakładki: A4, marginesy z `@page`, „Strona X / Y” w prawym dolnym rogu. */
export function checklistPrintJob(print: ChecklistPrint): PrintJob {
  return {
    version: 1,
    html: print.html,
    fontsMarker: null,
    javascript: true,
    network: 'trusted',
    allowedHosts: trustedPrintHosts(),
    waitUntil: 'load',
    waitForAssets: true,
    emulatePrintMedia: false,
    pdf: {
      format: 'A4',
      preferCSSPageSize: true,
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: '<div style="width:100%;padding:0 10mm;box-sizing:border-box;text-align:right;font-family:Helvetica,Arial,sans-serif;font-size:8pt;color:rgb(70,70,70);-webkit-print-color-adjust:exact;">Strona <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      margin: { top: '10mm', right: '10mm', bottom: '18mm', left: '10mm' },
    },
    fileName: print.fileName,
    finalize: true,
  };
}

/** Zapis PDF w CRM dokładnie jak w zakładce: plik, wpis w Plikach, ścieżka w wydarzeniu, usunięcie poprzedniej wersji. */
export async function storeChecklistPdf(client: SupabaseClient, eventId: string, employeeId: string, eventName: string, pdf: Buffer) {
  const { data: current } = await client.from('events').select('equipment_checklist_pdf_path').eq('id', eventId).maybeSingle();
  const previous = (current as any)?.equipment_checklist_pdf_path || null;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const fileName = checklistFileName(eventName, timestamp);
  const storagePath = `${eventId}/checklista-${timestamp}-${randomUUID()}.pdf`;
  const { error: uploadError } = await client.storage.from('event-files').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false });
  if (uploadError) throw new ChecklistPrintError('Błąd podczas zapisywania pliku');
  const { data: folderId } = await client.rpc('get_or_create_documents_subfolder', {
    p_event_id: eventId, p_required_permission: null, p_created_by: employeeId ?? null,
  });
  const { error: recordError } = await client.from('event_files').insert([{
    event_id: eventId, folder_id: folderId ?? null, name: fileName, original_name: fileName, file_path: storagePath, file_size: pdf.byteLength,
    mime_type: 'application/pdf', document_type: 'equipment_checklist', thumbnail_url: null, uploaded_by: employeeId ?? null,
  }]);
  if (recordError) throw new ChecklistPrintError(recordError.message || 'Błąd podczas generowania checklisty');
  const { error: eventError } = await client.from('events').update({
    equipment_checklist_pdf_path: storagePath, equipment_checklist_pdf_at: new Date().toISOString(), equipment_checklist_modified: false,
  }).eq('id', eventId);
  if (eventError) throw new ChecklistPrintError(eventError.message || 'Błąd podczas generowania checklisty');
  if (previous && previous !== storagePath) {
    try {
      const { error: removeError } = await client.storage.from('event-files').remove([previous]);
      if (removeError) throw removeError;
      const { error } = await client.from('event_files').delete().eq('event_id', eventId).eq('file_path', previous);
      if (error) throw error;
    } catch (error) {
      console.warn('Nie udało się usunąć poprzedniej wersji checklisty:', error);
    }
  }
  return { fileName, path: storagePath };
}
