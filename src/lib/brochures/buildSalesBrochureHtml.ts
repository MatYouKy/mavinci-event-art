export type SalesBrochureSnapshot = {
  brochure: {
    id: string;
    name: string;
    title: string;
    subtitle?: string | null;
    introduction?: string | null;
    closingText?: string | null;
    audienceType: string;
  };
  company: {
    name: string;
    legalName?: string | null;
    logoUrl?: string | null;
    email?: string | null;
    phone?: string | null;
    website?: string | null;
    primaryColor: string;
    secondaryColor: string;
  };
  organization?: {
    name: string;
    email?: string | null;
    website?: string | null;
  } | null;
  contact?: {
    name: string;
    email?: string | null;
    phone?: string | null;
    avatarUrl?: string | null;
  } | null;
  coverImageUrl?: string | null;
  items: Array<{
    id: string;
    title: string;
    shortDescription?: string | null;
    description?: string | null;
    benefits: string[];
    imageUrl?: string | null;
    layout: 'visual' | 'classic' | 'compact';
    category?: string | null;
  }>;
  generatedAt: string;
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const safeUrl = (value?: string | null) => {
  const url = String(value || '').trim();
  return /^(https?:|data:image\/)/i.test(url) ? escapeHtml(url) : '';
};

const textToParagraphs = (value?: string | null) =>
  String(value || '')
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>')}</p>`)
    .join('');

export function buildSalesBrochureHtml(snapshot: SalesBrochureSnapshot) {
  const { brochure, company, organization, contact, items } = snapshot;
  const primary = company.primaryColor || '#d3bb73';
  const secondary = company.secondaryColor || '#73002d';
  const logo = safeUrl(company.logoUrl);
  const cover = safeUrl(snapshot.coverImageUrl || items.find((item) => item.imageUrl)?.imageUrl);
  const targetName = organization?.name || '';
  const pages: string[] = [];

  pages.push(`
    <section class="page cover">
      ${cover ? `<img class="cover-photo" src="${cover}" alt="" />` : ''}
      <div class="cover-overlay"></div>
      <div class="circle circle-a"></div><div class="circle circle-b"></div>
      <header class="cover-header">
        ${logo ? `<img class="logo" src="${logo}" alt="${escapeHtml(company.name)}" />` : `<div class="wordmark">${escapeHtml(company.name)}</div>`}
      </header>
      <div class="cover-copy">
        <div class="eyebrow">BROSZURA USŁUG</div>
        <h1>${escapeHtml(brochure.title)}</h1>
        ${brochure.subtitle ? `<div class="cover-subtitle">${escapeHtml(brochure.subtitle)}</div>` : ''}
        ${targetName ? `<div class="prepared-for"><span>PRZYGOTOWANO DLA</span>${escapeHtml(targetName)}</div>` : ''}
      </div>
      <footer class="cover-footer"><span>KONCEPCJA · PRODUKCJA · REALIZACJA</span><span>01</span></footer>
    </section>`);

  pages.push(`
    <section class="page intro-page">
      <div class="top-rule"></div>
      <div class="section-label">WSPÓŁPRACA</div>
      <h2>${targetName ? `Dla ${escapeHtml(targetName)}` : 'Technika, która wspiera sprzedaż wydarzeń'}</h2>
      <div class="intro-grid">
        <div class="intro-copy">
          ${textToParagraphs(brochure.introduction || 'Zapewniamy kompleksową technikę i realizację wydarzeń — od pierwszej koncepcji, przez przygotowanie, aż po bezpieczną obsługę na miejscu. Współpracujemy z hotelami i obiektami, które chcą oferować klientom przewidywalny standard oraz sprawną komunikację.')}
        </div>
        <div class="promise-card">
          <span>JEDEN PARTNER</span>
          <strong>Spójna realizacja</strong>
          <p>Jedno źródło odpowiedzialności za technikę, zespół, logistykę i przebieg realizacji.</p>
        </div>
      </div>
      <div class="metrics">
        <div><strong>${String(items.length).padStart(2, '0')}</strong><span>wybranych obszarów współpracy</span></div>
        <div><strong>360°</strong><span>obsługi od planu po realizację</span></div>
        <div><strong>1</strong><span>opiekun prowadzący komunikację</span></div>
      </div>
      <footer class="page-footer"><span>${escapeHtml(company.name)}</span><span>02</span></footer>
    </section>`);

  items.forEach((item, index) => {
    const image = safeUrl(item.imageUrl);
    const benefits = item.benefits.slice(0, item.layout === 'compact' ? 4 : 6);
    pages.push(`
      <section class="page service-page layout-${item.layout}">
        <div class="service-index">${String(index + 1).padStart(2, '0')}</div>
        ${image ? `<div class="service-image-wrap"><img class="service-image" src="${image}" alt="${escapeHtml(item.title)}" /></div>` : '<div class="service-image-wrap image-placeholder"></div>'}
        <div class="service-body">
          <div class="section-label">${escapeHtml(item.category || 'USŁUGA')}</div>
          <h2>${escapeHtml(item.title)}</h2>
          ${item.shortDescription ? `<p class="lead">${escapeHtml(item.shortDescription)}</p>` : ''}
          <div class="description">${textToParagraphs(item.description)}</div>
          ${benefits.length ? `<ul class="benefits">${benefits.map((benefit) => `<li>${escapeHtml(benefit)}</li>`).join('')}</ul>` : ''}
        </div>
        <footer class="page-footer"><span>${escapeHtml(company.name)}</span><span>${String(index + 3).padStart(2, '0')}</span></footer>
      </section>`);
  });

  const lastPageNumber = items.length + 3;
  pages.push(`
    <section class="page closing-page">
      <div class="circle circle-a"></div><div class="circle circle-b"></div>
      <div class="closing-content">
        <div class="section-label">POROZMAWIAJMY</div>
        <h2>Stwórzmy standard współpracy, który ułatwia sprzedaż wydarzeń.</h2>
        <div class="closing-copy">${textToParagraphs(brochure.closingText || 'Możemy przygotować stałe warianty techniczne dla najczęstszych formatów wydarzeń, uzgodnić zasady komunikacji oraz zapewnić sprawną wycenę dla Państwa klientów.')}</div>
        <div class="contact-card">
          <strong>${escapeHtml(contact?.name || company.name)}</strong>
          ${contact?.email || company.email ? `<a href="mailto:${escapeHtml(contact?.email || company.email)}">${escapeHtml(contact?.email || company.email)}</a>` : ''}
          ${contact?.phone || company.phone ? `<a href="tel:${escapeHtml(contact?.phone || company.phone)}">${escapeHtml(contact?.phone || company.phone)}</a>` : ''}
          ${company.website ? `<a href="${safeUrl(company.website.startsWith('http') ? company.website : `https://${company.website}`)}">${escapeHtml(company.website)}</a>` : ''}
        </div>
      </div>
      <footer class="cover-footer"><span>${escapeHtml(company.name)}</span><span>${String(lastPageNumber).padStart(2, '0')}</span></footer>
    </section>`);

  return `<!doctype html>
  <html lang="pl"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" />
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html, body { margin: 0; background: #111; font-family: Arial, Helvetica, sans-serif; color: #171924; }
    .page { width: 210mm; height: 297mm; position: relative; overflow: hidden; background: #f8f6f1; page-break-after: always; padding: 22mm 20mm 18mm; }
    .page:last-child { page-break-after: auto; }
    .cover, .closing-page { color: #fff; background: ${secondary}; padding: 18mm; }
    .cover-photo { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .cover-overlay { position: absolute; inset: 0; background: linear-gradient(180deg, rgba(55,0,24,.7), rgba(65,0,28,.94) 62%, ${secondary}); }
    .cover-header, .cover-copy, .cover-footer, .closing-content { position: relative; z-index: 3; }
    .logo { width: 42mm; height: 24mm; object-fit: contain; object-position: left center; }
    .wordmark { color: ${primary}; font-size: 22px; letter-spacing: 8px; font-weight: 700; }
    .cover-copy { position: absolute; left: 20mm; right: 20mm; top: 102mm; }
    .eyebrow, .section-label { color: ${primary}; font-size: 10px; font-weight: 700; letter-spacing: 2.2px; text-transform: uppercase; }
    h1 { margin: 9mm 0 4mm; max-width: 158mm; font-size: 39px; line-height: 1.08; font-weight: 400; letter-spacing: -.8px; }
    .cover-subtitle { max-width: 145mm; font-size: 18px; line-height: 1.5; color: rgba(255,255,255,.82); }
    .prepared-for { margin-top: 22mm; border-top: 1px solid ${primary}; padding-top: 7mm; font-size: 20px; }
    .prepared-for span { display: block; margin-bottom: 3mm; color: ${primary}; font-size: 9px; letter-spacing: 2px; }
    .cover-footer, .page-footer { position: absolute; left: 20mm; right: 20mm; bottom: 12mm; display: flex; justify-content: space-between; align-items: center; font-size: 9px; letter-spacing: 1px; }
    .page-footer { color: #777; border-top: 1px solid rgba(0,0,0,.15); padding-top: 4mm; }
    .circle { position: absolute; border-radius: 50%; z-index: 2; }
    .circle-a { width: 125mm; height: 125mm; right: -43mm; top: -45mm; background: rgba(143,0,53,.52); }
    .circle-b { width: 101mm; height: 101mm; right: -30mm; top: -34mm; border: 1.4px solid ${primary}; }
    .top-rule { height: 1px; background: ${primary}; margin-bottom: 20mm; }
    .intro-page h2, .service-body h2, .closing-page h2 { margin: 5mm 0 8mm; font-size: 34px; line-height: 1.12; font-weight: 400; letter-spacing: -.5px; }
    .intro-grid { display: grid; grid-template-columns: 1.25fr .75fr; gap: 14mm; margin-top: 18mm; }
    .intro-copy, .description, .closing-copy { font-size: 15px; line-height: 1.72; }
    .intro-copy p, .description p, .closing-copy p { margin: 0 0 5mm; }
    .promise-card { border-left: 3px solid ${primary}; padding: 8mm; background: #fff; box-shadow: 0 8px 28px rgba(0,0,0,.06); }
    .promise-card span { color: #777; font-size: 9px; letter-spacing: 1.8px; }
    .promise-card strong { display: block; margin: 5mm 0 3mm; font-size: 21px; }
    .promise-card p { color: #555; font-size: 13px; line-height: 1.6; }
    .metrics { position: absolute; left: 20mm; right: 20mm; bottom: 33mm; display: grid; grid-template-columns: repeat(3,1fr); gap: 5mm; border-top: 1px solid ${primary}; padding-top: 8mm; }
    .metrics strong { display: block; color: ${secondary}; font-size: 27px; font-weight: 400; }
    .metrics span { display: block; margin-top: 2mm; color: #666; font-size: 10px; line-height: 1.4; }
    .service-page { padding-top: 18mm; }
    .service-index { position: absolute; right: 20mm; top: 17mm; color: ${primary}; font-size: 12px; letter-spacing: 2px; }
    .service-image-wrap { height: 112mm; margin-bottom: 13mm; overflow: hidden; background: #dedbd3; }
    .service-image { width: 100%; height: 100%; object-fit: cover; }
    .image-placeholder { background: linear-gradient(135deg, ${secondary}, #1c1f33); }
    .service-body h2 { margin-bottom: 4mm; font-size: 31px; }
    .lead { max-width: 155mm; margin: 0 0 5mm; color: #555; font-size: 16px; line-height: 1.55; }
    .description { max-width: 160mm; font-size: 13px; line-height: 1.6; }
    .benefits { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm 8mm; margin: 7mm 0 0; padding: 0; list-style: none; }
    .benefits li { position: relative; padding-left: 6mm; color: #343640; font-size: 12px; line-height: 1.45; }
    .benefits li::before { content: '—'; position: absolute; left: 0; color: ${primary}; font-weight: 700; }
    .layout-classic .service-image-wrap { height: 78mm; }
    .layout-compact .service-image-wrap { height: 63mm; }
    .closing-content { position: absolute; left: 22mm; right: 25mm; top: 55mm; }
    .closing-page h2 { max-width: 155mm; margin-top: 8mm; font-size: 40px; color: #fff; }
    .closing-copy { max-width: 145mm; margin-top: 10mm; color: rgba(255,255,255,.78); }
    .contact-card { margin-top: 20mm; border-top: 1px solid ${primary}; padding-top: 8mm; display: flex; flex-direction: column; gap: 2.5mm; }
    .contact-card strong { margin-bottom: 2mm; color: ${primary}; font-size: 19px; }
    .contact-card a { width: fit-content; color: #fff; font-size: 14px; text-decoration: none; }
  </style></head><body>${pages.join('')}</body></html>`;
}
