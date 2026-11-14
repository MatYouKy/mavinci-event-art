import 'server-only';
import type { NativeContext } from './auth';
import { fail } from './offers';
import { brochureAccess } from './brochures';
import { DEMO_PRODUCTS } from '@/lib/seller/demo';

/*
 * Broszury na Macu, część G4 — „Demo strefy sprzedawcy · statystyki i PDF-y” (`BrochureDemoReport`): liczniki, wersje
 * broszury z przypisanymi linkami demo, próbne oferty wygenerowane przez odwiedzających (także anonimowe) i dobrowolnie
 * podane dane. Wyniki liczy `get_seller_demo_report_scoped` z uprawnieniami pracownika (tokenem), jak w CRM; tu tylko
 * porządkujemy odpowiedź dla aplikacji. Usuwanie próbnej oferty — `/bridge/brochures/[id]/demo-documents/[documentId]`.
 */

type Row = Record<string, any>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) => (value == null ? '' : String(value));
const record = (value: unknown): Row => (value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {});
const list = (value: unknown): Row[] => (Array.isArray(value) ? value.map(record) : []);
const optionalId = (value: unknown) => (UUID.test(text(value)) ? text(value) : null);
const count = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
};
const color = (value: unknown) => (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '');

/** Link demo tylko z adresu Mavinci przypisanego do tej broszury i wersji (jak `demoUrl` w CRM). */
function demoLink(value: unknown, brochureId: string): string | null {
  try {
    const url = new URL(text(value));
    return url.protocol === 'https:' && url.hostname === 'mavinci.pl' && url.pathname === `/demo-sprzedawcy/${brochureId}` && url.searchParams.has('source')
      ? url.toString() : null;
  } catch {
    return null;
  }
}

function attribution(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Row;
  return {
    recipientEmail: text(value.recipientEmail),
    employeeId: optionalId(value.employeeId),
    version: Number.isInteger(value.version) ? value.version as number : null,
    campaignId: optionalId(value.campaignId),
    campaignName: text(value.campaignName),
  };
}

/** Cena wpisana w demonstracji jak w szczegółach próbnej oferty w CRM: kwota w złotych netto albo „Nie podano”. */
function money(value: unknown) {
  if (value == null || value === '') return 'Nie podano';
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? `${number.toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' })} netto` : 'Nie podano';
}

/**
 * Wyniki demo broszury: „Moje” albo — z prawem do wyników wszystkich — „Wszystkie” z filtrem pracownika. Po 50 pozycji
 * na stronę w każdej liście; liczniki obejmują całą historię.
 */
export async function brochureDemoReport(ctx: NativeContext, params: URLSearchParams) {
  const access = await brochureAccess(ctx);
  if (!access.canViewResults) fail('Nie masz dostępu do statystyk broszur.');
  const id = text(params.get('id'));
  if (!UUID.test(id)) fail('Nie znaleziono broszury.');
  const offset = Math.max(0, Math.min(100_000, Number.parseInt(params.get('offset') || '0', 10) || 0));
  const all = params.get('all') === 'true';
  const employee = all ? optionalId(params.get('employee')) : null;
  const { data, error } = await ctx.supabase.rpc('get_seller_demo_report_scoped', {
    p_brochure: id, p_offset: offset, p_all: all, p_employee: employee,
  });
  if (error || !data) fail('Nie udało się odczytać wyników. Sprawdź uprawnienia do statystyk broszur.');
  const report = record(data);
  return {
    canViewAll: report.canViewAll === true,
    canManage: access.canManage,
    employees: list(report.employees).filter((row) => optionalId(row.id)).map((row) => ({ id: text(row.id), name: text(row.name) || 'Pracownik' })),
    sent: count(report.sent),
    visits: count(report.visits),
    sessions: count(report.sessions),
    leads: count(report.leads),
    pdfs: count(report.pdfs),
    downloads: count(report.downloads),
    sources: list(report.sources).map((row) => {
      const source = attribution(row.attribution);
      return {
        id: text(row.id),
        version: count(row.version),
        pdfPath: text(row.pdf_path),
        employeeName: text(row.employee_name) || 'Pracownik',
        createdAt: text(row.created_at),
        demoUrl: demoLink(row.demo_url, id),
        recipientEmail: source?.recipientEmail || '',
        campaignId: source?.campaignId || null,
      };
    }),
    documents: list(report.documents).map((row) => {
      const snapshot = record(row.snapshot);
      const prices = Array.isArray(snapshot.prices) ? snapshot.prices : [];
      return {
        id: text(row.id),
        status: ['generating', 'ready', 'failed'].includes(row.status) ? row.status : 'failed',
        pdfPath: text(row.pdf_path) || null,
        createdAt: text(row.created_at),
        downloadStartedAt: text(row.download_started_at) || null,
        employeeName: text(row.employee_name) || 'Pracownik',
        title: text(snapshot.title),
        website: text(snapshot.website),
        fullName: text(snapshot.fullName),
        organization: text(snapshot.organization),
        email: text(snapshot.email),
        phone: text(snapshot.phone),
        primary: color(snapshot.primary),
        accent: color(snapshot.accent),
        surface: color(snapshot.surface),
        prices: DEMO_PRODUCTS.map((product, index) => ({ name: product.name, price: money(prices[index]) })),
        logoAdded: snapshot.logoAdded === true,
        coverAdded: snapshot.coverAdded === true,
        portraitAdded: snapshot.portraitAdded === true,
        attribution: attribution(snapshot.attribution),
      };
    }),
    people: list(report.people).map((row) => {
      const brand = record(row.brand_config);
      return {
        id: text(row.id),
        fullName: text(row.full_name),
        organization: text(row.organization),
        email: text(row.email),
        phone: text(row.phone),
        logoAdded: row.logo_added === true,
        colors: [brand.primary, brand.accent, brand.surface].map(color).filter(Boolean),
        updatedAt: text(row.updated_at),
        employeeName: text(row.employee_name) || 'Pracownik',
        visits: count(row.visits),
        pdfs: count(row.pdfs),
      };
    }),
  };
}
