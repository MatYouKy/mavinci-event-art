import { CalcItem, Category } from '@/components/crm/events/calculations/EventCalculationsTab';
import { DEFAULT_VAT, fmt, round2, rowGross, rowNet } from '../helpers/calculations/calculations.helper';

export function buildCalculationHtml(params: {
  calculationNumber?: string;
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
  totalPowerWatts: number;
  contactPerson: {
    name: string;
    email: string;
    phone: string;
  } | null;
  preparedBy: {
    name: string;
    email: string;
    phone: string;
  } | null;
}): string {
  const {
    calculationNumber,
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
    totalPowerWatts,
    contactPerson,
    preparedBy,
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

  const categories = (Object.keys(categoryLabel) as Category[]).filter(cat => grouped[cat].length > 0);
  const sections = categories.map((cat, categoryIndex) => {
      const categoryNet = categoryTotals[cat] ?? grouped[cat].reduce((sum, item) => sum + rowNet(item), 0);
      const categoryGross = categoryTotalsGross[cat] ?? grouped[cat].reduce((sum, item) => sum + rowGross(item), 0);

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
        );

      return `
        <section>
          <table class="items">
            <thead>
              <tr><th colspan="8" class="category-heading">Kalkulacja · ${categoryLabel[cat]}</th></tr>
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
            <tbody>${rows.slice(0, -1).join('')}</tbody>
            <tbody class="table-ending">
              ${rows[rows.length - 1]}
              <tr>
                <td colspan="6" class="right subtotal">Suma częściowa ${categoryLabel[cat]}:</td>
                <td class="num strong">${fmt(categoryNet)} PLN</td>
                <td class="num strong accent">${fmt(categoryGross)} PLN</td>
              </tr>
              ${categoryIndex === categories.length - 1 ? `
              <tr class="grand-total">
                <td colspan="6"><strong>RAZEM CAŁA KALKULACJA</strong><div>VAT razem: ${fmt(round2(grandTotalGross - grandTotal))} PLN</div></td>
                <td class="num"><div>Netto razem</div><strong>${fmt(grandTotal)} PLN</strong></td>
                <td class="num"><div>Brutto razem</div><strong>${fmt(grandTotalGross)} PLN</strong></td>
              </tr>` : ''}
            </tbody>
          </table>
        </section>
      `;
    })
    .join('');

    const formatPower = (watts: number) => {
      if (!watts || watts <= 0) return '-';
      return watts >= 1000 ? `${fmt(round2(watts / 1000))} kW` : `${Math.round(watts)} W`;
    };
    
    const getPowerSuggestion = (watts: number) => {
      if (!watts || watts <= 0) return null;
    
      const amps3f = watts / (400 * 1.732);
    
      if (amps3f <= 16) return '3F 16A';
      if (amps3f <= 32) return '3F 32A';
      if (amps3f <= 63) return '3F 63A';
      
      return 'powyżej 3F 63A — wymagana analiza techniczna';
    };
    
    const powerSuggestion = getPowerSuggestion(totalPowerWatts);
    

  return `<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8" />
<title>${esc(name)}</title>
<style>
  @page {
    size: A4;
    margin: 12mm 12mm 22mm 12mm;
    @bottom-center {
      content: "${footerContent.replace(/&middot;/g, '·').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, ' ').replace(/</g, '\\3c ')}";
      font-family: Arial, sans-serif;
      font-size: 8px;
      line-height: 1.2;
      color: #999;
      vertical-align: middle;
      width: 80%;
    }
    @bottom-right {
      content: "Strona " counter(page) " / " counter(pages);
      font-family: Arial, sans-serif;
      font-size: 8px;
      color: #777;
    }
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
    font-family: 'Atom', 'Montserrat', Arial, sans-serif;
    font-size: 16px;
    font-weight: 400;
    letter-spacing: 0.8px;
    text-transform: uppercase;
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
    font-family: 'Atom', 'Montserrat', Arial, sans-serif;
    font-size: 11px;
    color: #1c1f33;
    font-weight: 400;
    letter-spacing: 0.5px;
    text-transform: uppercase;
  }

  section {
    margin-bottom: 16px;
    page-break-inside: auto;
    break-inside: auto;
  }

  section h2 {
    page-break-after: avoid;
    break-after: avoid;
    font-family: 'Atom', 'Montserrat', Arial, sans-serif;
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

  table.items .table-ending {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  table.items td:first-child {
    overflow-wrap: anywhere;
    word-break: normal;
  }

  table.items .category-heading {
    background: #fff;
    color: #680025;
    padding: 8px 7px;
  }

  table.items .grand-total td {
    background: #680025;
    color: #fff;
    padding: 10px 7px;
  }

  table.items .grand-total div {
    font-size: 8px;
    margin-bottom: 4px;
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
    font-family: 'Atom', 'Montserrat', Arial, sans-serif;
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

  table.items .table-ending tr:not(:first-child):not(.grand-total) td {
    border-top: 1px solid #d3bb73;
    border-bottom: none;
    background: #fafaf3;
  }

.technical-section {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 2px solid #d3bb73;
  page-break-inside: avoid;
  break-inside: avoid;
}

.technical-title {
  font-family: 'Atom', 'Montserrat', Arial, sans-serif;
  margin-bottom: 8px;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #b1963f;
}

.technical-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
  max-width: 520px;
}

.technical-label {
  font-size: 9px;
  color: #555;
}

.technical-value {
  margin-top: 2px;
  font-size: 14px;
  color: #1c1f33;
  font-weight: 600;
}

.technical-value.accent {
  color: #b1963f;
  font-size: 16px;
  font-weight: 300;
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

  .power-box {
    min-width: 190px;
    padding: 12px 16px;
    border: 1px solid #d3bb73;
    border-radius: 4px;
    background: #faf8f2;
    text-align: right;
  }

  .power-box .label {
    font-family: 'Atom', 'Montserrat', Arial, sans-serif;
    font-size: 8.5px;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #7a6a38;
  }

  .power-box .value {
    margin-top: 3px;
    font-size: 18px;
    font-weight: 300;
    color: #b1963f;
  }

  .power-box .hint {
    margin-top: 5px;
    font-size: 8.5px;
    color: #555;
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

  .power-section {
  margin-top: 12px;
  padding: 12px 16px;
  border: 1px solid #d3bb73;
  border-radius: 4px;
  background: #faf8f2;
  page-break-inside: avoid;
  break-inside: avoid;
}

.power-section-title {
  font-family: 'Atom', 'Montserrat', Arial, sans-serif;
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: #7a6a38;
  margin-bottom: 8px;
}

.power-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.power-value {
  font-size: 17px;
  font-weight: 300;
  color: #b1963f;
}

.power-hint {
  font-size: 10px;
  color: #1c1f33;
  font-weight: 600;
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

    .company-claim {
    font-size: 8px;
    text-decoration: italic;
    letter-spacing: 0.8px;
    color: #555;
    margin-top: 2px;
  }

  @media print {
    body {
      padding: 0;
    }

    footer {
      display: none;
    }
  }
</style>
</head>
<body>
  <header>
    <div>
      <h1>${esc(name) || 'Kalkulacja'}</h1>
      <div class="event-meta">
        ${calculationNumber ? `<div>Numer kalkulacji: <strong>${esc(calculationNumber)}</strong></div>` : ''}
        ${eventName ? `<div>Wydarzenie: <strong>${esc(eventName)}</strong></div>` : ''}
        ${formattedDate ? `<div>Data: <strong>${esc(formattedDate)}</strong></div>` : ''}
        ${contactPerson?.name ? `<div>Kalkulacja dla: <strong>${esc(contactPerson.name)}</strong></div>` : ''}
        ${contactPerson?.phone ? `<div>Telefon: ${esc(contactPerson.phone)}</div>` : ''}
        ${contactPerson?.email ? `<div>E-mail: ${esc(contactPerson.email)}</div>` : ''}
      </div>
    </div>

    <div class="logo-wrap">
      ${company?.logo_url ? `<img class="logo" src="${esc(company.logo_url)}" alt="${esc(company?.name || '')}" />` : ''}
    </div>

<div class="meta">
  ${
    company
      ? `<div class="company-name">${esc(company.legal_name || company.name || '')}</div>`
      : ''
  }

  <div class="prepared-by">
    ${preparedBy?.name ? `<div>Przygotowane przez: <strong>${esc(preparedBy.name)}</strong></div>` : ''}
    ${preparedBy?.phone ? `<div>Telefon: ${esc(preparedBy.phone)}</div>` : ''}
    ${preparedBy?.email ? `<div>E-mail: ${esc(preparedBy.email)}</div>` : ''}
  </div>

  <div style="margin-top:5px;color:#888;">
    Wygenerowano: <strong>${new Date().toLocaleDateString('pl-PL')}</strong>
  </div>
</div>
  </header>

  <main>
    ${sections || '<p style="color:#888;text-align:center;padding:32px 0;">Brak pozycji</p>'}



${
  totalPowerWatts > 0
    ? `<section class="technical-section">
        <div class="technical-title">Wymagania techniczne</div>
        <div class="technical-grid">
          <div>
            <div class="technical-label">Szacowany pobór mocy</div>
            <div class="technical-value accent">${formatPower(totalPowerWatts)}</div>
          </div>
          <div>
            <div class="technical-label">Minimalne przyłącze</div>
            <div class="technical-value">${esc(powerSuggestion ?? '-')}</div>
          </div>
        </div>
      </section>`
    : ''
}


    ${notes ? `<div class="notes">${esc(notes)}</div>` : ''}
  </main>

  <footer>
    ${footerContent}
  </footer>
</body>
</html>`;
}
