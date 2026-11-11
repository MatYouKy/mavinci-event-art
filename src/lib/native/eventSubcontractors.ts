import 'server-only';
import * as yup from 'yup';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { subcontractorTaskSchema } from '@/components/crm/subcontractors/taskValidation';
import { getFunctionErrorMessage } from '@/lib/supabase/functionError';

/**
 * Zakładka „Podwykonawcy” (`EventSubcontractorsPanel` + `AddTaskModal`): zlecenia i umowy wydarzenia pogrupowane
 * według podwykonawców, wynajem bez podwykonawcy, zapis zlecenia (z bazy albo nowy / jednorazowy podwykonawca, usługi
 * z katalogu, ta sama walidacja `subcontractorTaskSchema`), umowa od podwykonawcy (plik prosto do magazynu przez
 * podpisany adres), wysyłka wytycznych e-mailem i generator wytycznych AI — te same funkcje Supabase co w CRM.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTLEMENTS = ['invoice_vat', 'invoice_no_vat', 'cash', 'civil_contract', 'other'];
const PAYMENT_METHODS = ['transfer', 'cash', 'card', 'other'];
const PAYMENT_TYPES = ['hourly', 'fixed', 'mixed'];
const STATUSES = ['planned', 'in_progress', 'completed', 'cancelled'];
const PAYMENT_STATUSES = ['pending', 'paid', 'overdue'];

function fail(message: string): never {
  throw new Error(message);
}

const one = <T,>(value: T | T[] | null | undefined): T | null => (Array.isArray(value) ? value[0] ?? null : value ?? null);
const num = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

function subcontractorRow(s: any) {
  if (!s) return null;
  return {
    id: s.id, name: s.company_name || '', contactPerson: s.contact_person ?? null, email: s.email ?? null, phone: s.phone ?? null,
    rating: s.rating ?? null, hourlyRate: num(s.hourly_rate),
  };
}

async function subcontractorsTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const person = 'id,company_name,contact_person,email,phone,hourly_rate,rating,specialization';
  const [tasks, contracts] = await Promise.all([
    s.from('subcontractor_tasks').select(`*, subcontractors (${person}), event_equipment (id,quantity,equipment_id,kit_id,cable_id,equipment_items (name, thumbnail_url),equipment_kits (name, thumbnail_url),cables (name))`)
      .eq('event_id', eventId).order('start_date', { ascending: false }),
    s.from('subcontractor_contracts').select(`*, subcontractors (${person})`).eq('event_id', eventId).order('created_at', { ascending: false }),
  ]);
  if (tasks.error) throw tasks.error;
  if (contracts.error) throw contracts.error;
  return {
    tasks: (tasks.data || []).map((t: any) => {
      const equipment = one(t.event_equipment) as any;
      const item = one(equipment?.equipment_items) as any;
      const kit = one(equipment?.equipment_kits) as any;
      const cable = one(equipment?.cables) as any;
      return {
        id: t.id, subcontractorId: t.subcontractor_id ?? null, subcontractor: subcontractorRow(one(t.subcontractors)),
        taskName: t.task_name || '', description: t.description ?? null, taskType: t.task_type || 'service',
        startDate: t.start_date ?? null, endDate: t.end_date ?? null, scheduledStart: t.scheduled_start ?? null, scheduledEnd: t.scheduled_end ?? null,
        estimatedHours: num(t.estimated_hours), actualHours: num(t.actual_hours), hourlyRate: num(t.hourly_rate), fixedPrice: num(t.fixed_price),
        paymentType: t.payment_type || 'hourly', totalCost: num(t.total_cost), agreedCost: num(t.agreed_cost), currency: t.currency || 'PLN',
        status: t.status || 'planned', paymentStatus: t.payment_status || 'pending', settlementType: t.settlement_type || 'invoice_vat',
        paymentMethod: t.payment_method || 'transfer', serviceCatalogId: t.service_catalog_id ?? null,
        scopeOfWork: t.scope_of_work ?? null, deliverables: t.deliverables ?? null, guidelines: t.guidelines ?? null, operationalNotes: t.operational_notes ?? null,
        contactEmail: t.contact_email_snapshot ?? null, guidelinesStatus: t.guidelines_status || 'draft', confirmedAt: t.confirmed_at ?? null,
        confirmedByName: t.confirmed_by_name ?? null, responseNote: t.response_note ?? null,
        equipment: equipment
          ? { name: item?.name || kit?.name || cable?.name || null, quantity: num(equipment.quantity), thumbnail: item?.thumbnail_url || kit?.thumbnail_url || null }
          : null,
      };
    }),
    contracts: (contracts.data || []).map((c: any) => ({
      id: c.id, subcontractorId: c.subcontractor_id ?? null, subcontractor: subcontractorRow(one(c.subcontractors)), number: c.contract_number || '',
      title: c.title || '', totalValue: num(c.total_value), status: c.status || 'draft', hasFile: Boolean(c.file_path),
    })),
  };
}

registerEventTab('subcontractors', subcontractorsTab);

/** Lista do wyboru — aktywni podwykonawcy bez duplikatów (NIP, e-mail, nazwa + telefon) jak `uniqueSubcontractors`. */
async function subcontractorOptions(ctx: NativeContext) {
  const { data, error } = await ctx.supabase.from('subcontractors')
    .select('*, organization:organizations!organization_id(name,alias,phone)').eq('status', 'active').order('company_name', { ascending: true });
  if (error) throw error;
  const seen = new Set<string>();
  const unique = (data || []).filter((s: any) => {
    const nip = String(s.nip || '').replace(/\D/g, '');
    const email = String(s.email || '').trim().toLowerCase();
    const phone = String(s.phone || '').replace(/\D/g, '');
    const name = String(s.company_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
    const keys = [nip ? `nip:${nip}` : '', email ? `email:${email}` : '', phone ? `name-phone:${name}:${phone}` : ''].filter(Boolean);
    if (!keys.length) keys.push(`name:${name}`);
    if (keys.some((key) => seen.has(key))) return false;
    keys.forEach((key) => seen.add(key));
    return true;
  });
  return {
    subcontractors: unique.map((s: any) => {
      const organization = one(s.organization) as any;
      return {
        id: s.id, name: s.company_name || '', contactPerson: s.contact_person ?? null, email: s.email ?? null, phone: s.phone ?? null,
        hourlyRate: num(s.hourly_rate), alias: organization?.alias ?? null, organizationName: organization?.name ?? null, organizationPhone: organization?.phone ?? null,
        defaultSettlement: s.default_settlement_type ?? null, preferredPayment: s.preferred_payment_method ?? null,
      };
    }),
  };
}

async function services(ctx: NativeContext, _eventId: string, params: URLSearchParams) {
  const id = params.get('subcontractorId') || '';
  if (!UUID.test(id)) return { services: [] };
  const { data, error } = await ctx.supabase.from('subcontractor_service_catalog').select('id, name, description, category, unit_price, unit')
    .eq('subcontractor_id', id).eq('is_active', true).order('name');
  if (error) return { services: [] };
  return {
    services: (data || []).map((s: any) => ({
      id: s.id, name: s.name || '', description: s.description ?? null, category: s.category ?? null,
      unitPrice: s.unit_price === null || s.unit_price === undefined ? null : Number(s.unit_price), unit: s.unit ?? null,
    })),
  };
}

async function contractUrl(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const id = params.get('id') || '';
  if (!UUID.test(id)) fail('Nieprawidłowa umowa.');
  const { data: contract } = await ctx.supabase.from('subcontractor_contracts').select('file_path,title').eq('id', id).eq('event_id', eventId).maybeSingle();
  if (!contract?.file_path) fail('Umowa nie ma pliku.');
  const { data, error } = await ctx.supabase.storage.from('event-files').createSignedUrl(contract.file_path, 900);
  if (error || !data?.signedUrl) fail('Nie udało się otworzyć podglądu umowy');
  return { url: data.signedUrl, name: String(contract.file_path).split('/').pop() || `${contract.title || 'umowa'}.pdf` };
}

registerEventQueries('subcontractors', { subcontractors: (ctx) => subcontractorOptions(ctx), services, contract: contractUrl });

/** Błędy walidacji jak `collectValidationErrors` — pierwszy komunikat dla każdego pola. */
function validationErrors(values: Record<string, unknown>) {
  try {
    subcontractorTaskSchema.validateSync(values, { abortEarly: false });
    return {};
  } catch (error) {
    if (!(error instanceof yup.ValidationError)) throw error;
    const errors: Record<string, string> = {};
    for (const issue of error.inner.length ? error.inner : [error]) if (issue.path && !errors[issue.path]) errors[issue.path] = issue.message;
    return errors;
  }
}

const text = (value: unknown) => (typeof value === 'string' ? value : '');
const day = (value: unknown) => (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);

/** `AddTaskModal.handleSubmit`: walidacja, ewentualny nowy podwykonawca, zlecenie i (dla nowego) miejsce na plik umowy. */
async function save(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const s = ctx.supabase;
  const d = body.data && typeof body.data === 'object' ? body.data : {};
  const quick = body.quick && typeof body.quick === 'object' ? body.quick : {};
  const contract = body.contract && typeof body.contract === 'object' ? body.contract : null;
  const id = body.id ? String(body.id) : '';
  if (id && !UUID.test(id)) fail('Nieprawidłowe zlecenie.');
  const providerMode = !id && body.providerMode === 'quick' ? 'quick' : 'existing';
  const createContract = !id && Boolean(contract);
  const form = {
    subcontractor_id: text(d.subcontractorId), service_catalog_id: text(d.serviceCatalogId), task_name: text(d.taskName), description: text(d.description),
    scope_of_work: text(d.scopeOfWork), deliverables: text(d.deliverables), guidelines: text(d.guidelines), operational_notes: text(d.operationalNotes),
    scheduled_start: text(d.scheduledStart), scheduled_end: text(d.scheduledEnd),
    estimated_hours: num(d.estimatedHours), actual_hours: num(d.actualHours), payment_type: PAYMENT_TYPES.includes(d.paymentType) ? d.paymentType : 'hourly',
    hourly_rate: num(d.hourlyRate), fixed_price: num(d.fixedPrice), agreed_cost: num(d.agreedCost),
    settlement_type: SETTLEMENTS.includes(d.settlementType) ? d.settlementType : 'invoice_vat',
    payment_method: PAYMENT_METHODS.includes(d.paymentMethod) ? d.paymentMethod : 'transfer',
    status: STATUSES.includes(d.status) ? d.status : 'planned', payment_status: PAYMENT_STATUSES.includes(d.paymentStatus) ? d.paymentStatus : 'pending',
  };
  const errors = validationErrors({
    ...form, providerMode,
    nip: providerMode === 'quick' ? text(quick.nip) : '', company_name: providerMode === 'quick' ? text(quick.companyName) : '',
    email: providerMode === 'quick' ? text(quick.email) : '', phone: providerMode === 'quick' ? text(quick.phone) : '',
    createContract, contractFile: createContract && contract?.fileSize ? { size: num(contract.fileSize) } : null,
    contract_value: createContract ? num(contract?.totalValue) : 0,
  });
  if (Object.keys(errors).length) {
    throw Object.assign(new Error(Object.values(errors)[0]), { fieldErrors: errors });
  }

  let subcontractorId = form.subcontractor_id;
  let contactName: string | null = null;
  let contactEmail: string | null = null;
  let contactPhone: string | null = null;
  if (providerMode === 'quick') {
    const entity = quick.entityType === 'company' ? 'company' : 'individual';
    const { data: created, error } = await s.from('subcontractors').insert({
      company_name: text(quick.companyName).trim(),
      nip: form.settlement_type.startsWith('invoice') ? text(quick.nip).replace(/[\s-]/g, '') : null,
      contact_person: text(quick.contactPerson) || null, email: text(quick.email).trim() || null, phone: text(quick.phone) || null,
      entity_type: entity, is_registered_business: entity === 'company', default_settlement_type: form.settlement_type,
      preferred_payment_method: form.payment_method, hourly_rate: form.payment_type === 'fixed' ? 0 : form.hourly_rate,
      specialization: [form.task_name.trim()], status: 'active',
    }).select('id, contact_person, email, phone').single();
    if (error) fail('Nie udało się dodać podwykonawcy.');
    subcontractorId = (created as any).id;
    contactName = (created as any).contact_person;
    contactEmail = (created as any).email;
    contactPhone = (created as any).phone;
  } else {
    if (!UUID.test(subcontractorId)) fail('Wybierz podwykonawcę');
    const { data: chosen } = await s.from('subcontractors').select('contact_person,email,phone').eq('id', subcontractorId).maybeSingle();
    contactName = (chosen as any)?.contact_person ?? null;
    contactEmail = (chosen as any)?.email ?? null;
    contactPhone = (chosen as any)?.phone ?? null;
  }

  const calculated = form.payment_type === 'fixed' ? form.fixed_price
    : form.payment_type === 'hourly' ? form.estimated_hours * form.hourly_rate
      : form.fixed_price + form.estimated_hours * form.hourly_rate;
  const payload = {
    event_id: eventId, subcontractor_id: subcontractorId, service_catalog_id: UUID.test(form.service_catalog_id) ? form.service_catalog_id : null,
    task_name: form.task_name.trim(), description: form.description || null, scope_of_work: form.scope_of_work || form.description || null,
    deliverables: form.deliverables || null, guidelines: form.guidelines || null, operational_notes: form.operational_notes || null,
    scheduled_start: form.scheduled_start ? new Date(form.scheduled_start).toISOString() : null,
    scheduled_end: form.scheduled_end ? new Date(form.scheduled_end).toISOString() : null,
    start_date: day(d.startDay), end_date: day(d.endDay),
    estimated_hours: form.estimated_hours, actual_hours: form.actual_hours, payment_type: form.payment_type,
    hourly_rate: form.payment_type === 'fixed' ? 0 : form.hourly_rate, fixed_price: form.payment_type === 'hourly' ? 0 : form.fixed_price,
    agreed_cost: form.agreed_cost || calculated, settlement_type: form.settlement_type, payment_method: form.payment_method, currency: 'PLN',
    contact_name_snapshot: contactName, contact_email_snapshot: contactEmail, contact_phone_snapshot: contactPhone,
    status: form.status, payment_status: form.payment_status,
  };
  const mutation = id
    ? s.from('subcontractor_tasks').update(payload).eq('id', id).eq('event_id', eventId)
    : s.from('subcontractor_tasks').insert([payload]);
  const { data: task, error } = await mutation.select('id').single();
  if (error || !task) fail('Błąd podczas dodawania zadania');
  const taskId = String((task as any).id);

  if (createContract && contract) {
    const safe = String(contract.fileName || 'umowa').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9._-]+/g, '-');
    const path = `${eventId}/umowy-podwykonawcow/${taskId}/${Date.now()}-${safe}`;
    const { data: slot, error: slotError } = await s.storage.from('event-files').createSignedUploadUrl(path);
    if (slotError || !slot?.signedUrl) {
      await s.from('subcontractor_tasks').delete().eq('id', taskId);
      fail('Nie udało się przygotować wysyłki pliku umowy.');
    }
    return { ok: true, id: taskId, subcontractorId, upload: { path, url: slot.signedUrl } };
  }
  return { ok: true, id: taskId, subcontractorId };
}

/** Po wysłaniu pliku: rekord umowy podwykonawcy (jak w CRM); błąd usuwa plik i nowe zlecenie. */
async function attachContract(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const s = ctx.supabase;
  const taskId = String(body.taskId || '');
  const path = String(body.path || '');
  if (!UUID.test(taskId) || !path.startsWith(`${eventId}/umowy-podwykonawcow/${taskId}/`)) fail('Nieprawidłowy plik umowy.');
  const { data: task } = await s.from('subcontractor_tasks').select('id,subcontractor_id').eq('id', taskId).eq('event_id', eventId).maybeSingle();
  if (!task) fail('Nie znaleziono zlecenia.');
  if (body.failed) {
    await s.storage.from('event-files').remove([path]);
    await s.from('subcontractor_tasks').delete().eq('id', taskId);
    return { ok: true };
  }
  const c = body.contract && typeof body.contract === 'object' ? body.contract : {};
  const generated = `PODW/${new Date().getFullYear()}/${taskId.slice(0, 8).toUpperCase()}`;
  const { error } = await s.from('subcontractor_contracts').insert([{
    subcontractor_id: (task as any).subcontractor_id, subcontractor_task_id: taskId, event_id: eventId,
    contract_number: text(c.number).trim() || generated, contract_type: c.type === 'frame' ? 'frame' : 'project',
    title: text(c.title).trim() || text(c.fileName) || 'Umowa', description: text(c.description) || null, total_value: num(c.totalValue),
    file_path: path, status: 'draft', created_by: ctx.employee.authUserId || ctx.employee.id,
  }]);
  if (error) {
    await s.storage.from('event-files').remove([path]);
    await s.from('subcontractor_tasks').delete().eq('id', taskId);
    fail('Błąd podczas dodawania zadania');
  }
  return { ok: true };
}

/** „Wyślij wytyczne” — funkcja `send-subcontractor-assignment`. */
async function sendGuidelines(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const taskId = String(body.taskId || '');
  if (!UUID.test(taskId)) fail('Nieprawidłowe zlecenie.');
  const { data: task } = await ctx.supabase.from('subcontractor_tasks').select('id,contact_email_snapshot,subcontractors(email)').eq('id', taskId).eq('event_id', eventId).maybeSingle();
  if (!task) fail('Nie znaleziono zlecenia.');
  const recipient = (task as any).contact_email_snapshot || (one((task as any).subcontractors) as any)?.email;
  if (!recipient) fail('Uzupełnij adres e-mail podwykonawcy przed wysłaniem wytycznych');
  const { data, error } = await ctx.supabase.functions.invoke('send-subcontractor-assignment', { body: { taskId } });
  if (error) fail(await getFunctionErrorMessage(error, 'Nie udało się wysłać wytycznych'));
  if ((data as any)?.error) fail(String((data as any).error));
  return { ok: true };
}

/** „Wygeneruj wytyczne” — funkcja `generate-subcontractor-guidelines`; zwraca szkic trzech pól i źródło. */
async function generate(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  if (!text(body.taskName).trim()) fail('Najpierw podaj nazwę zlecenia, aby AI określiło obowiązki tego podwykonawcy.');
  const { data, error } = await ctx.supabase.functions.invoke('generate-subcontractor-guidelines', {
    body: {
      eventId, prompt: text(body.prompt).slice(0, 2000), taskName: text(body.taskName), scopeOfWork: text(body.scopeOfWork),
      deliverables: text(body.deliverables), guidelines: text(body.guidelines), startsAt: text(body.startsAt), endsAt: text(body.endsAt),
    },
  });
  if (error) fail(await getFunctionErrorMessage(error, 'Nie udało się wygenerować wytycznych. Spróbuj ponownie.'));
  if ((data as any)?.error) fail(String((data as any).error));
  const draft = (data as any)?.draft;
  for (const [field, max] of Object.entries({ scope_of_work: 6000, deliverables: 4000, guidelines: 6000 })) {
    if (typeof draft?.[field] !== 'string' || !draft[field].trim() || draft[field].length > max) fail('Generator zwrócił nieprawidłową treść. Spróbuj ponownie.');
  }
  return {
    scopeOfWork: draft.scope_of_work, deliverables: draft.deliverables, guidelines: draft.guidelines,
    source: ((data as any).sourceOffers || []).map((offer: { name: string }) => offer.name).join(', ') || 'Dane wydarzenia, zlecenie i dodatkowe wskazówki',
  };
}

registerEventActions('subcontractors', { save, attachContract, sendGuidelines, generate });
