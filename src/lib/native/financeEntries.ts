import 'server-only';
import type { NativeContext } from './auth';
import { canFinanceCompany, loadInvoiceFinanceAccess } from '@/lib/invoices/financeAccess';

/*
 * Koszty i wypłaty dla Maca (jak zakładka CRM „Koszty i wypłaty”, `FinancialEntriesTab`): ręczne zapisy w
 * `financial_entries` — wynagrodzenia, gotówka i koszty spoza KSeF i faktur. Te same zapytania co w przeglądarce (200
 * najnowszych według daty kosztu, kategorie wydatków, pracownicy), klientem z tokenem pracownika; zapis i usunięcie
 * pilnuje RLS (`finance_company_manageable` działalności wiersza). Lista ograniczona do działalności z „Podglądem finansów”
 * i z NIP (marki bez NIP są pominięte jak w pozostałych częściach Finansów) oraz zapisów bez działalności.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class EntryError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}
function fail(message: string, status = 400): never {
  throw new EntryError(message, status);
}
const str = (value: unknown): string => (value === null || value === undefined ? '' : String(value));
const strOrNull = (value: unknown): string | null => (value === null || value === undefined || value === '' ? null : String(value));
const num = (value: unknown): number => {
  const parsed = Number(value);
  return value === null || value === undefined || value === '' || !Number.isFinite(parsed) ? 0 : parsed;
};
const one = (value: unknown): Row | null => (Array.isArray(value) ? (value[0] as Row) || null : value && typeof value === 'object' ? value as Row : null);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const ENTRY_TYPES = new Set(['payroll', 'contractor', 'purchase', 'reimbursement', 'cash', 'other']);
const STATUSES = new Set(['paid', 'incurred', 'planned']);
const METHODS = new Set(['transfer', 'cash', 'card', 'blik', 'compensation', 'other']);

async function financeCompanies(ctx: NativeContext) {
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  const { data, error } = await ctx.supabase.from('my_companies').select('id,name,nip').eq('is_active', true).order('name');
  if (error) fail('Nie udało się wczytać firm.', 500);
  return ((data || []) as Row[])
    .filter((company) => str(company.nip).trim() !== '' && canFinanceCompany(access, String(company.id), 'finance_view'))
    .map((company) => ({ id: String(company.id), name: str(company.name), canManage: canFinanceCompany(access, String(company.id), 'finance_manage') }));
}

export async function financeEntries(ctx: NativeContext) {
  const [companies, entriesRes, categoriesRes, employeesRes] = await Promise.all([
    financeCompanies(ctx),
    ctx.supabase
      .from('financial_entries')
      .select('*, company:my_companies(id,name), employee:employees!financial_entries_employee_id_fkey(id,name,surname), category:finance_categories(id,code,name,color)')
      .order('recognition_date', { ascending: false })
      .limit(200),
    ctx.supabase.from('finance_categories').select('id,code,name,color').eq('is_active', true).in('kind', ['expense', 'both']).order('sort_order'),
    ctx.supabase.from('employees').select('id,name,surname').eq('is_active', true).order('surname'),
  ]);
  if (entriesRes.error) fail('Nie udało się pobrać kosztów i wypłat.', 500);
  const allowed = new Map(companies.map((company) => [company.id, company]));
  return {
    companies,
    categories: ((categoriesRes.data || []) as Row[]).map((c) => ({ id: str(c.id), code: str(c.code), name: str(c.name), color: strOrNull(c.color) })),
    employees: ((employeesRes.data || []) as Row[]).map((e) => ({ id: str(e.id), name: `${str(e.name)} ${str(e.surname)}`.trim() })),
    entries: ((entriesRes.data || []) as Row[])
      .filter((entry) => !entry.my_company_id || allowed.has(String(entry.my_company_id)))
      .map((entry) => {
        const company = one(entry.company);
        const employee = one(entry.employee);
        const category = one(entry.category);
        const companyId = strOrNull(entry.my_company_id);
        return {
          id: str(entry.id),
          title: str(entry.title),
          amount: num(entry.amount_gross),
          recognitionDate: str(entry.recognition_date).slice(0, 10),
          paymentDate: strOrNull(entry.payment_date)?.slice(0, 10) ?? null,
          status: str(entry.status),
          paymentMethod: str(entry.payment_method),
          entryType: str(entry.entry_type),
          companyId,
          companyName: company ? str(company.name) : null,
          employeeName: employee ? `${str(employee.name)} ${str(employee.surname)}`.trim() : null,
          categoryName: category ? str(category.name) : null,
          categoryColor: category ? strOrNull(category.color) : null,
          notes: strOrNull(entry.notes),
          canManage: companyId ? allowed.get(companyId)?.canManage === true : false,
        };
      }),
  };
}

/** Nowy koszt lub wypłata — walidacja i zapis jak `save` w `FinancialEntriesTab`. */
export async function saveFinanceEntry(ctx: NativeContext, body: Row) {
  const companyId = str(body.companyId).trim();
  const categoryId = str(body.categoryId).trim();
  const title = str(body.title).trim();
  const amount = Number(str(body.amount).replace(/\s/g, '').replace(',', '.'));
  const entryType = str(body.entryType);
  const status = str(body.status);
  const method = str(body.paymentMethod);
  if (!title || !UUID.test(companyId) || !UUID.test(categoryId) || !Number.isFinite(amount) || amount <= 0) {
    fail('Uzupełnij działalność, kategorię, opis i poprawną kwotę.');
  }
  if (!ENTRY_TYPES.has(entryType)) fail('Wybierz rodzaj zapisu.');
  if (!STATUSES.has(status)) fail('Wybierz status.');
  if (!METHODS.has(method)) fail('Wybierz formę płatności.');
  const employeeId = str(body.employeeId).trim();
  if (entryType === 'payroll' && !UUID.test(employeeId)) fail('Dla wypłaty wybierz pracownika.');
  const recognitionDate = str(body.recognitionDate).slice(0, 10);
  if (!DAY.test(recognitionDate)) fail('Podaj datę kosztu.');
  const paymentDate = str(body.paymentDate).slice(0, 10);
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (!canFinanceCompany(access, companyId, 'finance_manage')) fail('Zapis wymaga poziomu „Zarządzanie finansami” w tej działalności.', 403);
  const { error } = await ctx.supabase.from('financial_entries').insert({
    direction: 'expense',
    entry_type: entryType,
    title,
    amount_gross: amount,
    recognition_date: recognitionDate,
    payment_date: status === 'paid' ? (DAY.test(paymentDate) ? paymentDate : recognitionDate) : null,
    status,
    payment_method: method,
    my_company_id: companyId,
    category_id: categoryId,
    employee_id: entryType === 'payroll' ? employeeId : null,
    notes: str(body.notes).trim() || null,
  });
  if (error) fail(error.code === '42501' ? 'Brak uprawnień do zapisu w tej działalności.' : 'Nie udało się zapisać kosztu.', error.code === '42501' ? 403 : 400);
  return { ok: true, message: 'Koszt został zapisany i trafi do raportu.' };
}

export async function deleteFinanceEntry(ctx: NativeContext, body: Row) {
  const id = str(body.id).trim();
  if (!UUID.test(id)) fail('Nieprawidłowy zapis.');
  const { data: entry, error: readError } = await ctx.supabase.from('financial_entries').select('id,my_company_id').eq('id', id).maybeSingle();
  if (readError || !entry) fail('Nie znaleziono zapisu.', 404);
  const access = await loadInvoiceFinanceAccess(ctx.supabase);
  if (!entry.my_company_id || !canFinanceCompany(access, String(entry.my_company_id), 'finance_manage')) {
    fail('Usunięcie wymaga poziomu „Zarządzanie finansami” w działalności zapisu.', 403);
  }
  const { data, error } = await ctx.supabase.from('financial_entries').delete().eq('id', id).select('id');
  if (error || !data?.length) fail('Nie udało się usunąć zapisu.');
  return { ok: true, message: 'Zapis usunięty.' };
}
