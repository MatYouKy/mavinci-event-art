import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin.server';
import { documentPrintJob, escapeHtml, resolveCachedPrintLogo } from '@/lib/print/pdfRenderer.server';
import type { PrintJob } from '@/lib/print/printJob.server';
import { getRental, rentalDateTime, type RentalDetail, type RentalProtocol } from '@/lib/CRM/rental/rental';

/*
 * Protokół wydania (WZ) i odbioru (PZ) wypożyczenia — PDF do wydruku i podpisu (decyzja właściciela: podpis na papierze, skan
 * dołączany do wypożyczenia). Dane z `rental_get` sesją pracownika (dostęp sprzedaż / magazyn liczy baza), bez cen. Logo
 * i dane firmy — „Logo do druku” z brandbooka firmy wypożyczenia (jak faktury). Mac drukuje lokalnie (`?render=local`).
 */

export class RentalPrintError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

type Company = {
  id: string;
  name: string;
  legal_name: string | null;
  nip: string | null;
  street: string | null;
  building_number: string | null;
  postal_code: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
};

export type RentalProtocolPrint = { job: PrintJob; fileName: string; rental: RentalDetail; protocol: RentalProtocol };

const fileNameOf = (protocol: RentalProtocol) =>
  `${protocol.kind === 'issue' ? 'protokol-wydania' : 'protokol-odbioru'}-${protocol.number.replace(/[^A-Za-z0-9]+/g, '-').replace(/-+$/, '')}.pdf`;

async function companyOf(client: SupabaseClient, companyId: string | null): Promise<Company | null> {
  const fields = 'id, name, legal_name, nip, street, building_number, postal_code, city, phone, email, website, is_default';
  const query = companyId
    ? client.from('my_companies').select(fields).eq('id', companyId).maybeSingle()
    : client.from('my_companies').select(fields).eq('is_default', true).limit(1).maybeSingle();
  const { data } = await query;
  return (data as Company | null) || null;
}

async function logoOf(companyId: string | null) {
  if (!companyId) return null;
  try {
    return await resolveCachedPrintLogo(createSupabaseAdminClient(), companyId);
  } catch {
    return null;
  }
}

function buildHtml(rental: RentalDetail, protocol: RentalProtocol, company: Company | null, logo: string | null) {
  const issue = protocol.kind === 'issue';
  const title = issue ? 'Protokół wydania sprzętu' : 'Protokół zwrotu sprzętu';
  const address = company ? [[company.street, company.building_number].filter(Boolean).join(' '), [company.postal_code, company.city].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ') : '';
  const companyLines = company ? [company.legal_name || company.name, address, company.nip ? `NIP ${company.nip}` : '', [company.phone, company.email].filter(Boolean).join(' · ')]
    .filter(Boolean) : [];
  const rows = protocol.lines.map((line, index) => issue
    ? `<tr><td class="num">${index + 1}</td><td>${escapeHtml(line.name)}</td><td class="num">${line.qty}</td><td>${escapeHtml(line.unit)}</td><td>${escapeHtml(line.note || '')}</td><td class="check"></td></tr>`
    : `<tr><td class="num">${index + 1}</td><td>${escapeHtml(line.name)}</td><td class="num">${line.qty || ''}</td><td class="num">${line.damaged || ''}</td><td class="num">${line.missing || ''}</td><td>${escapeHtml(line.unit)}</td><td>${escapeHtml(line.note || '')}</td></tr>`).join('');
  const head = issue
    ? '<tr><th class="num">Lp.</th><th>Nazwa</th><th class="num">Ilość</th><th>J.m.</th><th>Uwagi</th><th class="check">Odebrano ✓</th></tr>'
    : '<tr><th class="num">Lp.</th><th>Nazwa</th><th class="num">Sprawne</th><th class="num">Uszkodz.</th><th class="num">Brak</th><th>J.m.</th><th>Uwagi</th></tr>';
  const clause = issue
    ? `Odbierający potwierdza odbiór sprzętu w ilości i stanie opisanym powyżej oraz zobowiązuje się zwrócić go w stanie niepogorszonym do ${escapeHtml(rentalDateTime(rental.ends_at))}. Za uszkodzenia, braki i opóźnienie zwrotu odpowiada Odbierający zgodnie z warunkami wypożyczenia.`
    : 'Strony potwierdzają zwrot sprzętu w ilości i stanie opisanym powyżej. Uszkodzenia i braki zostaną rozliczone zgodnie z warunkami wypożyczenia.';
  const delivery = rental.handover === 'delivery' && rental.delivery_address ? `<div><span>Dostawa</span><strong>${escapeHtml(rental.delivery_address)}</strong></div>` : '';
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${escapeHtml(protocol.number)}</title><style>
/*invoice-print-fonts*/
@page{size:A4;margin:12mm 12mm 16mm}
*{box-sizing:border-box}
body{margin:0;font-family:'Inter',Helvetica,Arial,sans-serif;font-size:10.5px;color:#111827;line-height:1.45}
.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;border-bottom:1px solid #d1d5db;padding-bottom:12px}
.top img{max-height:42px;max-width:200px;object-fit:contain}
.company{text-align:right;color:#4b5563;font-size:9.5px}
h1{font-weight:400;text-transform:uppercase;letter-spacing:.06em;font-size:18px;margin:18px 0 2px}
.number{color:#4b5563;margin:0 0 14px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;margin-bottom:14px}
.grid div{display:flex;flex-direction:column}
.grid span{color:#6b7280;font-size:9px;text-transform:uppercase;letter-spacing:.04em}
table{width:100%;border-collapse:collapse;margin-top:6px}
th{background:#f3f4f6;text-align:left;font-weight:600;font-size:9.5px;padding:6px;border:1px solid #d1d5db}
td{padding:6px;border:1px solid #d1d5db;vertical-align:top}
.num{text-align:right;white-space:nowrap;width:1%}
.check{width:70px}
.note{margin-top:10px;color:#374151}
.clause{margin-top:14px;color:#374151;font-size:9.5px}
.signs{display:flex;gap:48px;margin-top:48px}
.signs div{flex:1;border-top:1px solid #9ca3af;padding-top:6px;text-align:center;color:#4b5563;font-size:9.5px}
.signs strong{display:block;color:#111827;font-weight:500;margin-bottom:2px}
</style></head><body>
<div class="top"><div>${logo ? `<img src="${escapeHtml(logo)}" alt="">` : `<strong>${escapeHtml(company?.name || '')}</strong>`}</div><div class="company">${companyLines.map((line) => escapeHtml(line)).join('<br>')}</div></div>
<h1>${title}</h1>
<p class="number">${escapeHtml(protocol.number)} · ${escapeHtml(rentalDateTime(protocol.created_at))}</p>
<div class="grid">
<div><span>Wypożyczenie</span><strong>${escapeHtml(rental.number)}${rental.title ? ` — ${escapeHtml(rental.title)}` : ''}</strong></div>
<div><span>Klient</span><strong>${escapeHtml(rental.client_name)}</strong></div>
<div><span>Termin</span><strong>${escapeHtml(rentalDateTime(rental.starts_at))} – ${escapeHtml(rentalDateTime(rental.ends_at))}</strong></div>
<div><span>${issue ? 'Odbierający' : 'Zwracający'}</span><strong>${escapeHtml(protocol.person_name)}${rental.recipient_phone ? ` · ${escapeHtml(rental.recipient_phone)}` : ''}</strong></div>
${delivery}
</div>
<table><thead>${head}</thead><tbody>${rows}</tbody></table>
${protocol.note ? `<p class="note"><strong>Uwagi:</strong> ${escapeHtml(protocol.note)}</p>` : ''}
<p class="clause">${clause}</p>
<div class="signs"><div><strong>${escapeHtml(protocol.created_by_name || '')}</strong>${issue ? 'Wydał (podpis)' : 'Przyjął (podpis)'}</div><div><strong>${escapeHtml(protocol.person_name)}</strong>${issue ? 'Odebrał (czytelny podpis)' : 'Zwrócił (czytelny podpis)'}</div></div>
</body></html>`;
}

/** Protokół do druku — `client` z sesją pracownika (RLS i dostęp wypożyczenia). */
export async function loadRentalProtocolPrint(client: SupabaseClient, rentalId: string, protocolId: string): Promise<RentalProtocolPrint> {
  let rental: RentalDetail;
  try {
    rental = await getRental(client, rentalId);
  } catch (error) {
    throw new RentalPrintError(error instanceof Error ? error.message : 'Nie znaleziono wypożyczenia albo nie masz do niego dostępu.', 404);
  }
  const protocol = rental.protocols.find((item) => item.id === protocolId);
  if (!protocol) throw new RentalPrintError('Nie znaleziono protokołu.', 404);
  const company = await companyOf(client, rental.my_company_id);
  const logo = await logoOf(rental.my_company_id || company?.id || null);
  const html = buildHtml(rental, protocol, company, logo);
  const fileName = fileNameOf(protocol);
  const job = documentPrintJob(html, { html, footer: { left: `${protocol.number} · ${rental.client_name}`, right: company?.website || '' } }, fileName);
  return { job, fileName, rental, protocol };
}
