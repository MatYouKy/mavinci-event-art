import 'server-only';
import type { NativeContext } from './auth';
import { settlementLabels, subcontractorProfileSchema } from '@/components/crm/subcontractors/profileValidation';
import { emptyAddress, matchesProfileAddress, normalizeProfileAddress } from '@/components/crm/subcontractors/profileAddress';
import { systemLabel } from '@/lib/ui/systemLabels';

/*
 * Podwykonawcy dla Maca — jak strony `/crm/subcontractors` (lista), `/crm/subcontractors/new` i karta
 * `/crm/subcontractors/[id]` (szczegóły, zadania, umowy ramowe i projektowe, edycja `SubcontractorProfileForm`). Tokenem
 * pracownika — RLS jak w przeglądarce; dane do umowy zlecenia (`personnel_people`) tylko z uprawnieniem do umów
 * i wynagrodzeń (`personnel_can_access`), zapis umowy zlecenia funkcją bazy `save_subcontractor_personnel_profile`.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class SubcontractorError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new SubcontractorError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const rows = (value: unknown): Row[] => (Array.isArray(value) ? value.filter((item) => item && typeof item === 'object') as Row[] : []);
const day = (value: unknown) => str(value).slice(0, 10) || null;

/** Lista jak strona `/crm/subcontractors`: wszystkie rekordy po 500, alfabetycznie. */
export async function subcontractorsList(ctx: NativeContext) {
  const all: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await ctx.supabase.from('subcontractors')
      .select('id,company_name,contact_person,phone,email,subcontractor_service_catalog(name),default_settlement_type,status')
      .order('company_name').order('id').range(from, from + 499);
    if (error) fail(error.message || 'Nie udało się pobrać podwykonawców.', 500);
    all.push(...rows(data));
    if (rows(data).length < 500) break;
  }
  return {
    subcontractors: all.map((row) => ({
      id: str(row.id),
      name: str(row.company_name),
      contactPerson: str(row.contact_person),
      phone: str(row.phone),
      email: str(row.email),
      services: rows(row.subcontractor_service_catalog).map((service) => str(service.name)),
      settlementType: str(row.default_settlement_type),
      settlementLabel: settlementLabels[str(row.default_settlement_type)] || '',
      status: str(row.status),
    })),
  };
}

/** Uprawnienia do umów i wynagrodzeń (`usePersonnelAccess`). */
async function personnelAccess(ctx: NativeContext) {
  const [view, manage] = await Promise.all([
    ctx.supabase.rpc('personnel_can_access'),
    ctx.supabase.rpc('personnel_can_access', { p_manage: true }),
  ]);
  return {
    view: view.data === true,
    manage: manage.data === true,
    error: view.error || manage.error ? 'Moduł zespołu jest niedostępny. Sprawdź, czy aktualizacja bazy została wdrożona.' : '',
  };
}

function subcontractorOut(row: Row) {
  return {
    id: str(row.id),
    name: str(row.company_name),
    contactPerson: str(row.contact_person),
    email: str(row.email),
    phone: str(row.phone),
    nip: str(row.nip),
    address: str(row.address),
    hourlyRate: num(row.hourly_rate),
    paymentTerms: str(row.payment_terms),
    bankAccount: str(row.bank_account),
    status: str(row.status),
    statusLabel: systemLabel(row.status),
    rating: row.rating === null || row.rating === undefined ? null : num(row.rating),
    notes: str(row.notes),
    settlementType: str(row.default_settlement_type),
    settlementLabel: settlementLabels[str(row.default_settlement_type)] || '',
    organizationId: str(row.organization_id),
  };
}

/** Karta podwykonawcy: dane, zadania i umowy ramowe / projektowe (jak `fetchData` na karcie CRM). */
export async function subcontractorCard(ctx: NativeContext, idParam: unknown) {
  const id = str(idParam);
  if (!UUID.test(id)) fail('Nieprawidłowy podwykonawca.');
  const { data: sub, error } = await ctx.supabase.from('subcontractors').select('*').eq('id', id).maybeSingle();
  if (error) fail('Błąd podczas ładowania danych', 500);
  if (!sub) fail('Nie znaleziono podwykonawcy', 404);
  const [tasks, contracts, access] = await Promise.all([
    ctx.supabase.from('subcontractor_tasks').select('*, events(name)').eq('subcontractor_id', id).order('start_date', { ascending: false }),
    ctx.supabase.from('subcontractor_contracts').select('*, events(name)').eq('subcontractor_id', id).order('created_at', { ascending: false }),
    personnelAccess(ctx),
  ]);
  const eventName = (row: Row) => {
    const event = Array.isArray(row.events) ? row.events[0] : row.events;
    return event && typeof event === 'object' ? str((event as Row).name) : '';
  };
  return {
    subcontractor: subcontractorOut(sub as Row),
    tasks: rows(tasks.data).map((task) => ({
      id: str(task.id),
      eventId: str(task.event_id),
      eventName: eventName(task),
      name: str(task.task_name),
      description: str(task.description),
      startDate: day(task.start_date),
      endDate: day(task.end_date),
      estimatedHours: num(task.estimated_hours),
      actualHours: num(task.actual_hours),
      hourlyRate: num(task.hourly_rate),
      fixedPrice: num(task.fixed_price),
      paymentType: str(task.payment_type),
      totalCost: num(task.total_cost),
      status: str(task.status),
      statusLabel: systemLabel(task.status),
      invoiceNumber: str(task.invoice_number),
      paymentStatus: str(task.payment_status),
      paymentStatusLabel: systemLabel(task.payment_status),
      paymentDate: str(task.payment_date) || null,
    })),
    contracts: rows(contracts.data).map((contract) => ({
      id: str(contract.id),
      number: str(contract.contract_number),
      type: str(contract.contract_type),
      title: str(contract.title),
      description: str(contract.description),
      startDate: str(contract.start_date) || null,
      endDate: str(contract.end_date) || null,
      totalValue: num(contract.total_value),
      hasFile: Boolean(contract.file_path),
      status: str(contract.status),
      statusLabel: systemLabel(contract.status),
      eventId: str(contract.event_id),
      eventName: eventName(contract),
    })),
    personnel: access,
  };
}

/** Dane do umowy zlecenia do formularza edycji (jak efekt w `SubcontractorProfileForm`) — z uprawnieniem do umów. */
export async function subcontractorPersonnel(ctx: NativeContext, idParam: unknown) {
  const id = str(idParam);
  if (id && !UUID.test(id)) fail('Nieprawidłowy podwykonawca.');
  const access = await personnelAccess(ctx);
  // Nowy podwykonawca — tylko uprawnienia (przycisk zapisu umowy zlecenia czeka na nie jak w CRM).
  if (!id || !access.view) return { access, personnel: null, error: null };
  const { data, error } = await ctx.supabase.from('personnel_people').select('identifier,address,bank_account,address_parts')
    .eq('subcontractor_id', id).maybeSingle();
  if (error) return { access, personnel: null, error: 'Nie udało się pobrać danych do umowy. Odśwież formularz przed zapisem.' };
  const row = (data as Row | null) || {};
  const loaded = normalizeProfileAddress({ ...emptyAddress, ...(row.address_parts && typeof row.address_parts === 'object' ? row.address_parts : {}) });
  const parts = row.address_parts && matchesProfileAddress(loaded, row.address) ? loaded : { ...emptyAddress };
  return {
    access,
    personnel: {
      identifier: str(row.identifier),
      address: str(row.address),
      bankAccount: str(row.bank_account),
      addressParts: parts,
    },
    error: null,
  };
}

type Form = {
  company_name: string; email: string; phone: string; nip: string; address: string; default_settlement_type: string; notes: string;
  personnel_identifier: string; personnel_address: string; personnel_bank_account: string; personnel_address_parts: typeof emptyAddress;
};

function formOf(value: unknown): Form {
  const input = value && typeof value === 'object' ? value as Row : {};
  const parts = normalizeProfileAddress(input.personnelAddressParts && typeof input.personnelAddressParts === 'object' ? input.personnelAddressParts : {});
  return {
    company_name: str(input.name),
    email: str(input.email),
    phone: str(input.phone),
    nip: str(input.nip),
    address: str(input.address),
    default_settlement_type: str(input.settlementType),
    notes: str(input.notes),
    personnel_identifier: str(input.personnelIdentifier),
    personnel_address: str(input.personnelAddress),
    personnel_bank_account: str(input.personnelBankAccount),
    personnel_address_parts: parts,
  };
}

/** Pola z błędami jak w formularzu CRM (`subcontractorProfileSchema`, pierwszy komunikat dla pola). */
async function validationErrors(form: Form) {
  try {
    await subcontractorProfileSchema.validate(form, { abortEarly: false });
    return null;
  } catch (error) {
    const result: Record<string, string> = {};
    for (const issue of ((error as { inner?: Array<{ path?: string; message: string }> }).inner || [])) {
      if (issue.path && !result[issue.path]) result[issue.path] = issue.message;
    }
    // Pusty wybór kończy się w CRM angielskim komunikatem `oneOf` — tu właściwy komunikat pola.
    if (result.default_settlement_type) result.default_settlement_type = 'Wybierz formę rozliczenia.';
    return Object.keys(result).length ? result : { form: (error as Error).message || 'Sprawdź dane podwykonawcy.' };
  }
}

/**
 * „Zapisz podwykonawcę” / „Zapisz i przejdź do umowy zlecenia” (`SubcontractorProfileForm`): te same reguły, ten sam zapis —
 * umowa zlecenia funkcją bazy razem z danymi do umowy, pozostałe formy rozliczenia bezpośrednio w `subcontractors`.
 * Błędy pól wracają jako `errors` (ścieżka pola → komunikat).
 */
export async function saveSubcontractor(ctx: NativeContext, body: Row) {
  const id = str(body.id);
  if (id && !UUID.test(id)) fail('Nieprawidłowy podwykonawca.');
  // Adres jak w formularzu CRM: tekst z części po każdej ich zmianie (`changeAddress`), inaczej dotychczasowy tekst.
  const form = formOf(body.form);
  const errors = await validationErrors(form);
  if (errors) return { ok: false, errors };
  const invoice = form.default_settlement_type.startsWith('invoice');
  const mandate = form.default_settlement_type === 'civil_contract';
  if (mandate) {
    const access = await personnelAccess(ctx);
    if (!access.manage) {
      return { ok: false, errors: { form: 'Do przygotowania umowy zlecenia potrzebujesz uprawnień do umów i wynagrodzeń.' } };
    }
  }
  const payload: Row = {
    company_name: form.company_name.trim(),
    email: form.email.trim() || null,
    phone: form.phone.trim() || null,
    nip: invoice ? form.nip.replace(/[\s-]/g, '') : null,
    ...(!mandate ? { address: form.address.trim() || null } : {}),
    default_settlement_type: form.default_settlement_type,
    entity_type: invoice ? 'company' : 'individual',
    is_registered_business: invoice,
    preferred_payment_method: form.default_settlement_type === 'cash' ? 'cash' : 'transfer',
    requires_contract: mandate,
    notes: form.notes.trim() || null,
    ...(!id ? { status: mandate ? 'inactive' : 'active' } : {}),
  };
  let saved: Row | null = null;
  if (mandate) {
    const { data, error } = await ctx.supabase.rpc('save_subcontractor_personnel_profile', {
      p_id: id || null,
      p_profile: {
        ...payload,
        personnel_address_parts: matchesProfileAddress(form.personnel_address_parts, form.personnel_address) ? form.personnel_address_parts : null,
      },
      p_identifier: form.personnel_identifier.replace(/\s/g, ''),
      p_address: form.personnel_address.trim(),
      p_bank_account: form.personnel_bank_account.replace(/\s/g, '').toUpperCase(),
    });
    if (error) return { ok: false, errors: { form: error.message || 'Nie udało się zapisać podwykonawcy.' } };
    saved = data as Row | null;
  } else {
    const result = id
      ? await ctx.supabase.from('subcontractors').update(payload).eq('id', id).select('*').single()
      : await ctx.supabase.from('subcontractors').insert(payload).select('*').single();
    if (result.error) return { ok: false, errors: { form: result.error.message || 'Nie udało się zapisać podwykonawcy.' } };
    saved = result.data as Row | null;
  }
  if (!saved?.id) return { ok: false, errors: { form: 'Nie udało się zapisać podwykonawcy.' } };
  return { ok: true, subcontractor: subcontractorOut(saved) };
}
