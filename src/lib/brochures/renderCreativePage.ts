import { pageDesign, requiresPageImage, type BrochureDecorativePage, type PageRect } from './decorativePages';
import { renderBrochureIcon } from './brochureIcons';
const escape = (v: unknown) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
const url = (v: string = '') => /^(https?:|data:image\/)/i.test(v) ? escape(v) : '';
export const rectStyle = (r: PageRect) => `left:${r.x}%;top:${r.y}%;width:${r.width}%;height:${r.height}%;`;
export function renderCreativePage(page: BrochureDecorativePage & { imageUrl?: string | null }, company: { name: string; logoUrl?: string | null }, targetName: string, number: string) {
  const d = pageDesign(page), photo = url(page.imageUrl || '');
  const personal = (text: string) => text.replace(/\{\{klient\}\}/g, targetName || 'Państwa organizacji');
  const points = (page.points || []).map((point, index) => ({ point, icon: page.pointIcons?.[index] })).filter(({ point }) => point.trim());
  const cards = ['features', 'features-photo', 'process', 'timeline', 'showcase', 'signature'].includes(page.layout);
  return `<section class="page creative-page creative-${page.layout} creative-${d.theme}" style="--creative-font:${d.fontSize}px;text-align:${d.align}">
    ${d.ornament && d.ornament !== 'none' ? `<div class="creative-ornament creative-ornament-${d.ornament}"></div>` : ''}
    ${photo && requiresPageImage(page.layout) ? `<div class="creative-image" style="${rectStyle(d.image)}--creative-tint:${(d.imageTint || 0) / 100};--creative-desaturation:${(d.imageTint || 0) / 125};--creative-fade:${(d.imageFade || 0) / 100}"><img src="${photo}" alt="" style="object-fit:${d.imageFit};object-position:${d.imageX}% ${page.imagePosition}%"/><div style="position:absolute;inset:0;background:linear-gradient(180deg,transparent,var(--brochure-secondary));opacity:${d.overlay / 100}"></div></div>` : ''}
    ${d.showBrand ? `<div class="decorative-brand">${company.logoUrl ? `<img class="logo" src="${url(company.logoUrl)}" alt="${escape(company.name)}"/>` : `<span class="wordmark">${escape(company.name)}</span>`}</div>` : ''}
    ${page.layout !== 'artwork' ? `<div class="creative-text" data-fit-box style="${rectStyle(d.text)}">${page.icon || page.eyebrow ? `<div class="creative-kicker">${renderBrochureIcon(page.icon)}<span>${escape(personal(page.eyebrow || ''))}</span></div>` : '<div class="creative-rule"></div>'}<h2>${page.layout === 'signature' ? personal(page.slogan).toLocaleUpperCase('pl-PL').split('\n').map((line) => `<span>${escape(line)}</span>`).join('') : escape(personal(page.slogan).toLocaleUpperCase('pl-PL'))}</h2>${page.caption ? `<p>${escape(personal(page.caption)).replace(/\n/g, '<br>')}</p>` : ''}</div>` : ''}
    ${cards ? `<div class="creative-details" data-fit-box style="${rectStyle(d.details)}"><div class="creative-cards ${points.length === 3 || points.length > 4 ? 'creative-cards-many' : ''} ${page.layout === 'process' ? 'creative-steps' : page.layout === 'timeline' ? 'creative-timeline-track' : page.layout === 'showcase' ? 'creative-showcase-cards' : page.layout === 'signature' ? 'creative-signature-cards' : ''}">${points.map(({ point, icon }, index) => {
      const [title, ...body] = personal(point).split('|');
      return `<article><span class="creative-marker">${renderBrochureIcon(icon) || String(index + 1).padStart(2, '0')}</span><div class="creative-card-copy"><strong>${page.layout === 'timeline' ? `<span class="creative-step-number">${String(index + 1).padStart(2, '0')} / </span>` : ''}${escape(title.trim())}</strong>${body.length ? `<p>${escape(body.join('|').trim())}</p>` : ''}</div></article>`;
    }).join('')}</div>${page.linkUrl && url(page.linkUrl) ? `<a class="creative-link" href="${url(page.linkUrl)}"><span>${escape(page.linkLabel || 'Dowiedz się więcej')}</span><span class="creative-link-arrow" aria-hidden="true">↗</span></a>${page.linkHint ? `<p class="creative-link-hint">${escape(page.linkHint)}</p>` : ''}` : ''}</div>` : ''}
    ${page.layout !== 'artwork' ? `<footer class="${d.theme === 'dark' ? 'cover-footer' : 'page-footer'}"><span>${escape(company.name)}</span><span>${number}</span></footer>` : ''}
  </section>`;
}
export const creativePageCss = `
.creative-page { padding:0; }
.creative-signature { isolation:isolate; }
.creative-signature.creative-dark { background:radial-gradient(ellipse at 100% 5%,rgba(211,187,115,.11),transparent 50%),var(--brochure-secondary); }
.creative-signature:before,.creative-signature:after { content:'';position:absolute;width:55%;height:65%;right:-30%;top:-31%;border:1px solid var(--brochure-primary);border-radius:50%;transform:rotate(-32deg);opacity:.3;pointer-events:none; }
.creative-signature:after { right:-25%;top:-30%;opacity:.16; }
.creative-signature .decorative-brand { left:8%;top:6%; }
.creative-signature .logo { width:38mm;height:27mm; }
.creative-signature .creative-kicker { font-size:10px;letter-spacing:2.4px;gap:12px; }
.creative-signature .creative-kicker:before { content:'';width:28px;height:1px;background:currentColor; }
.creative-signature .creative-text h2 { line-height:1.06;letter-spacing:-1.8px;margin:6mm 0 5mm; }
.creative-signature .creative-text h2 span { display:block; }
.creative-signature.creative-dark .creative-text h2 span:last-child { color:var(--brochure-primary); }
.creative-signature .creative-text p { max-width:88%;font-size:14px;line-height:1.6; }
.creative-signature .creative-image { border-radius:26mm 0 26mm 0;isolation:isolate;box-shadow:0 16px 32px rgba(35,0,13,.18); }
.creative-signature .creative-image img { filter:grayscale(var(--creative-desaturation,0)); }
.creative-signature .creative-image:before { content:'';position:absolute;inset:0;z-index:1;background:var(--brochure-secondary);mix-blend-mode:color;opacity:var(--creative-tint,0);pointer-events:none; }
.creative-signature .creative-image:after { content:'';position:absolute;inset:0;z-index:2;border-radius:inherit;background:linear-gradient(180deg,var(--brochure-secondary) 0%,transparent 24%,transparent 48%,var(--brochure-secondary) 100%),linear-gradient(90deg,var(--brochure-secondary) 0%,transparent 20%,transparent 85%,var(--brochure-secondary) 100%);opacity:var(--creative-fade,0);pointer-events:none; }
.creative-signature-cards { grid-template-columns:repeat(3,1fr);gap:4mm; }
.creative-signature-cards article { display:flex;align-items:center;gap:3mm;padding:0;background:none;border-radius:0; }
.creative-signature-cards .creative-marker { width:30px;height:30px;margin:0;background:none;border-radius:0;flex-shrink:0; }
.creative-signature-cards .brochure-icon { width:24px;height:24px; }
.creative-signature-cards strong { font-size:11px;letter-spacing:.8px;font-weight:500;text-transform:uppercase; }
.creative-signature-cards p { font-size:10px;margin-top:2mm; }
.creative-signature footer { left:8%;right:8%;bottom:3%;opacity:.65; }

.creative-light { background:#f8f6f1;color:var(--brochure-secondary); }
.creative-dark { background:var(--brochure-secondary);color:#fff; }
.creative-image { position:absolute;overflow:hidden; }
.creative-image img { display:block;width:100%;height:100%; }
.creative-text,.creative-details { position:absolute;z-index:3; }
.creative-text h2 { margin:4mm 0;font-size:var(--creative-font);line-height:1.15;overflow-wrap:anywhere; }
.creative-text p { font-size:15px;line-height:1.65;margin:0;overflow-wrap:anywhere; }
.creative-rule { width:16mm;height:2px;background:var(--brochure-primary); }
.brochure-icon { width:28px;height:28px;display:block;flex-shrink:0; }
.creative-kicker { display:flex;align-items:center;gap:10px;font-size:10px;font-weight:600;letter-spacing:1.7px;text-transform:uppercase;color:var(--brochure-secondary); }
.creative-dark .creative-kicker { color:var(--brochure-primary); }
.creative-kicker .brochure-icon { width:25px;height:25px; }
.creative-cards { display:grid;grid-template-columns:1fr 1fr;gap:6mm; }
.creative-cards article { text-align:left;padding:6mm;background:rgba(150,140,120,.09);border-radius:3mm;overflow-wrap:anywhere;position:relative; }
.creative-marker { color:var(--brochure-secondary);font-size:16px;display:flex;align-items:center;justify-content:center;width:42px;height:42px;background:rgba(211,187,115,.15);border-radius:11px;margin-bottom:3mm; }
.creative-dark .creative-marker { color:var(--brochure-primary);background:rgba(255,255,255,.07); }
.creative-cards strong { display:block;font-size:16px;line-height:1.3; }
.creative-cards p { font-size:14px;line-height:1.55;margin:3mm 0 0; }
.creative-link { display:flex;align-items:center;justify-content:space-between;gap:5mm;width:100%;min-height:17mm;margin-top:6mm;padding:5mm 6mm;border-radius:3mm;background:var(--brochure-secondary);color:#fff;font-size:16px;font-weight:700;line-height:1.35;text-decoration:none;box-shadow:0 5px 16px rgba(35,0,13,.12); }
.creative-link > span:first-child { min-width:0; }
.creative-link-arrow { display:flex;align-items:center;justify-content:center;flex-shrink:0;width:32px;height:32px;border-radius:50%;background:var(--brochure-primary);color:#24000e;font-size:23px; }
.creative-dark .creative-link { background:var(--brochure-primary);color:#24000e; }
.creative-dark .creative-link-arrow { background:rgba(0,0,0,.08); }
.creative-link-hint { margin:2.5mm 0 0;text-align:center;font-size:10px;line-height:1.5; }
.creative-cards-many { grid-template-columns:repeat(3,1fr);gap:4mm; }
.creative-cards-many article { padding:4mm; }
.creative-cards-many p { font-size:13px; }
.creative-cards-many strong { font-size:15px; }
.creative-steps { grid-template-columns:1fr;gap:3mm; }
.creative-steps article { padding:4mm 6mm;display:flex;gap:5mm; }
.creative-steps .creative-marker { flex-shrink:0;margin:0; }
.creative-timeline-track { grid-template-columns:1fr;gap:6mm;position:relative; }
.creative-timeline-track:before { content:'';position:absolute;top:20px;bottom:30px;left:20px;width:1px;background:var(--brochure-primary); }
.creative-timeline-track article { display:flex;align-items:flex-start;gap:7mm;padding:0;background:none;min-height:22mm; }
.creative-timeline-track .creative-marker { background:#f8f6f1;border:1px solid rgba(211,187,115,.5);border-radius:50%;flex-shrink:0;position:relative; }
.creative-dark .creative-timeline-track .creative-marker { background:var(--brochure-secondary); }
.creative-timeline-track .creative-card-copy { padding-top:2mm; }
.creative-step-number { font-size:11px;letter-spacing:1px;color:inherit;opacity:.6; }
.creative-timeline-track p { margin-top:2mm; }
.creative-showcase-cards { grid-template-columns:repeat(3,1fr);gap:4mm; }
.creative-showcase-cards article { padding:4mm; }
.creative-showcase-cards p { font-size:13px; }
.creative-showcase .creative-image { border-radius:3mm; }
.creative-features-photo .creative-image { border-radius:3mm; }
.creative-features-photo .creative-cards { gap:4mm; }
.creative-features-photo .creative-cards article { display:flex;align-items:flex-start;gap:3mm;padding:4mm; }
.creative-features-photo .creative-marker { width:30px;height:30px;flex-shrink:0;margin:0; }
.creative-features-photo .creative-marker .brochure-icon { width:24px;height:24px; }
.creative-features-photo .creative-card-copy { min-width:0; }
.creative-features-photo .creative-cards strong { font-size:15px; }
.creative-features-photo .creative-cards p { font-size:13px;line-height:1.5;margin-top:2mm; }
.creative-ornament { position:absolute;pointer-events:none;z-index:0; }
.creative-ornament-arc { width:340px;height:340px;border:1px solid var(--brochure-primary);border-radius:50%;top:-175px;right:-110px;opacity:.38; }
.creative-ornament-arc:after { content:'';position:absolute;inset:28px;border:1px solid var(--brochure-primary);border-radius:50%; }
.creative-ornament-grid { width:35%;height:28%;right:0;top:0;opacity:.13;background-image:radial-gradient(var(--brochure-primary) 1px,transparent 1px);background-size:16px 16px; }
`;
