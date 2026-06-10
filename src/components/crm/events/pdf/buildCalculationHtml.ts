import { CalcItem, Category } from '@/components/crm/events/calculations/EventCalculationsTab';
import { DEFAULT_VAT, fmt, round2, rowGross, rowNet } from '../helpers/calculations/calculations.helper';

export function buildCalculationHtml(params: {
  name: string;
  notes: string;
  eventName: string;
  eventDate: string | null;
  grouped: Record<Category, CalcItem[]>;
  categoryTotals: Record<Category, number>;
  categoryTotalsGross: Record<Category, number>;
  grandTotal: number;
  grandTotalGross: number;
  company?: any;
}): string {
  const {
    name,
    notes,
    eventName,
    eventDate,
    grouped,
    categoryTotals,
    categoryTotalsGross,
    grandTotal,
    grandTotalGross,
    company,
  } = params;

  const formattedDate = eventDate
    ? new Date(eventDate).toLocaleDateString('pl-PL', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      })
    : '';

  const esc = (s: string) =>
    (s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const categoryLabel: Record<Category, string> = {
    equipment: 'Sprzęt',
    staff: 'Ludzie',
    transport: 'Transport',
    other: 'Pozostałe',
  };

  const footerContent = company
    ? `${esc(company.legal_name || company.name || '')}${company.nip ? ` &middot; NIP: ${esc(company.nip)}` : ''}${company.email ? ` &middot; ${esc(company.email)}` : ''}${company.phone ? ` &middot; ${esc(company.phone)}` : ''}${company.website ? ` &middot; ${esc(company.website)}` : ''}`
    : 'Kalkulacja wydarzenia';

  const sections = (Object.keys(categoryLabel) as Category[])
    .filter((cat) => grouped[cat].length > 0)
    .map((cat) => {
      const rows = grouped[cat]
        .map(
          (it) => `
        <tr>
          <td>${esc(it.name)}${it.description ? `<div class="desc">${esc(it.description)}</div>` : ''}</td>
          <td class="num">${it.quantity}</td>
          <td class="num">${esc(it.unit)}</td>
          <td class="num">${it.days}</td>
          <td class="num">${fmt(it.unit_price)}</td>
          <td class="num">${it.vat_rate ?? DEFAULT_VAT}%</td>
          <td class="num strong">${fmt(rowNet(it))}</td>
          <td class="num strong accent">${fmt(rowGross(it))}</td>
        </tr>
      `,
        )
        .join('');

      return `
        <section>
          <h2>${categoryLabel[cat]}</h2>
          <table class="items">
            <thead>
              <tr>
                <th>Nazwa</th>
                <th class="num">Ilość</th>
                <th class="num">Jedn.</th>
                <th class="num">Dni</th>
                <th class="num">Cena jedn.</th>
                <th class="num">VAT</th>
                <th class="num">Netto</th>
                <th class="num">Brutto</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
            <tfoot>
              <tr>
                <td colspan="6" class="right">Podsuma ${categoryLabel[cat]}:</td>
                <td class="num strong">${fmt(categoryTotals[cat])} PLN</td>
                <td class="num strong accent">${fmt(categoryTotalsGross[cat])} PLN</td>
              </tr>
            </tfoot>
          </table>
        </section>
      `;
    })
    .join('');

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<title>${esc(name)}</title>
<style>
  @page {
    size: A4;
    margin: 12mm 12mm 12mm 12mm;
  }

  * {
    box-sizing: border-box;
  }

  html,
  body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #1c1f33;
    font-family: 'Helvetica Neue', Arial, sans-serif;
    font-size: 10.5px;
    line-height: 1.35;
  }

  body {
    padding: 24px 32px 72px;
  }

  header {
    border-bottom: 1.5px solid #d3bb73;
    padding-bottom: 12px;
    margin-bottom: 16px;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: start;
    gap: 18px;
  }

  header h1 {
    margin: 0;
    font-size: 18px;
    font-weight: 300;
    letter-spacing: 0.4px;
  }

  header .event-meta {
    font-size: 10.5px;
    color: #555;
    margin-top: 4px;
  }

  header .logo-wrap {
    display: flex;
    justify-content: center;
    align-items: center;
    min-width: 120px;
  }

  header img.logo {
    display: block;
    max-height: 46px;
    max-width: 130px;
    object-fit: contain;
  }

  header .meta {
    font-size: 9.5px;
    color: #555;
    text-align: right;
    line-height: 1.4;
  }

  header .meta strong {
    color: #1c1f33;
  }

  header .meta .company-name {
    font-size: 11px;
    color: #1c1f33;
    font-weight: 600;
  }

  section {
    margin-bottom: 16px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  section h2 {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #b1963f;
    border-bottom: 1px solid #d3bb73;
    padding-bottom: 3px;
    margin: 0 0 6px 0;
  }

  table.items {
    width: 100%;
    border-collapse: collapse;
    font-size: 9.8px;
    page-break-inside: auto;
  }

  table.items thead {
    display: table-header-group;
  }

  table.items tfoot {
    display: table-row-group;
  }

  table.items tr {
    page-break-inside: avoid;
    break-inside: avoid;
  }

  table.items th,
  table.items td {
    padding: 5px 7px;
    border-bottom: 1px solid #eee;
    text-align: left;
    vertical-align: top;
  }

  table.items th {
    background: #f6f3ea;
    font-weight: 600;
    font-size: 8.8px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: #4a4331;
  }

  table.items td.num,
  table.items th.num {
    text-align: right;
    white-space: nowrap;
  }

  table.items td.strong {
    font-weight: 600;
  }

  table.items td.accent {
    color: #b1963f;
  }

  table.items td.right {
    text-align: right;
    font-weight: 500;
    color: #555;
  }

  table.items .desc {
    font-size: 9px;
    color: #777;
    margin-top: 1px;
  }

  table.items tfoot td {
    border-top: 1px solid #d3bb73;
    border-bottom: none;
    background: #fafaf3;
  }

  .grand {
    margin-top: 14px;
    padding: 12px 16px;
    background: #1c1f33;
    color: #f5f5f5;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-radius: 4px;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  .grand .label {
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #bcbcbc;
  }

  .grand .amount {
    font-size: 14px;
    color: #f5f5f5;
  }

  .grand .value {
    color: #d3bb73;
    font-size: 19px;
    font-weight: 300;
  }

  .notes {
    margin-top: 16px;
    padding: 10px 12px;
    background: #faf8f2;
    border-left: 3px solid #d3bb73;
    font-size: 10px;
    color: #4a4331;
    white-space: pre-wrap;
    page-break-inside: avoid;
    break-inside: avoid;
  }

  footer {
    position: fixed;
    left: 12mm;
    right: 12mm;
    bottom: 3mm;
    min-height: 5mm;
    padding-top: 4px;
    border-top: 1px solid #eee;
    font-size: 8px;
    line-height: 1.2;
    color: #999;
    text-align: center;
    background: #fff;
  }

  @media print {
    body {
      padding: 0 0 10mm 0;
    }

    footer {
      position: fixed;
      bottom: 3mm;
    }
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${esc(name) || 'Kalkulacja'}</h1>
      <div class="event-meta">
        ${eventName ? `Wydarzenie: <strong>${esc(eventName)}</strong>` : ''}
        ${formattedDate ? ` &middot; ${esc(formattedDate)}` : ''}
      </div>
    </div>

    <div class="logo-wrap">
      ${company?.logo_url ? `<img class="logo" src="${esc(company.logo_url)}" alt="${esc(company?.name || '')}" />` : ''}
    </div>

    <div class="meta">
      ${
        company
          ? `<div class="company-name">${esc(company.legal_name || company.name || '')}</div>
             ${company.nip ? `<div>NIP: ${esc(company.nip)}</div>` : ''}
             ${company.street ? `<div>${esc(company.street)}${company.building_number ? ` ${esc(company.building_number)}` : ''}${company.apartment_number ? `/${esc(company.apartment_number)}` : ''}</div>` : ''}
             ${company.postal_code || company.city ? `<div>${esc(company.postal_code || '')} ${esc(company.city || '')}</div>` : ''}
             <div style="margin-top:5px;color:#888;">Wygenerowano: <strong>${new Date().toLocaleDateString('pl-PL')}</strong></div>`
          : `<div>Wygenerowano</div><strong>${new Date().toLocaleDateString('pl-PL')}</strong>`
      }
    </div>
  </header>

  <main>
    ${sections || '<p style="color:#888;text-align:center;padding:32px 0;">Brak pozycji</p>'}

    <div class="grand">
      <div>
        <div class="label">Netto</div>
        <div class="amount">${fmt(grandTotal)} PLN</div>
      </div>
      <div>
        <div class="label">VAT</div>
        <div class="amount">${fmt(round2(grandTotalGross - grandTotal))} PLN</div>
      </div>
      <div>
        <div class="label" style="color:#d3bb73;">Brutto</div>
        <div class="value">${fmt(grandTotalGross)} PLN</div>
      </div>
    </div>

    ${notes ? `<div class="notes">${esc(notes)}</div>` : ''}
  </main>

  <footer>
    ${footerContent}
  </footer>
</body>
</html>`;
}