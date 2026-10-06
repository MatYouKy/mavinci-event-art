'use client';
import { BROCHURE_ICONS, type BrochureIcon } from '@/lib/brochures/brochureIcons';
import { Copy, Plus, Trash2 } from 'lucide-react';
import { BROCHURE_LAYOUTS, BROCHURE_PRESETS, BROCHURE_SLOGANS, pageDefaults, pageDesign, requiresPageImage, type BrochureDecorativePage, type BrochureImageAsset, type BrochureLayout } from '@/lib/brochures/decorativePages';
import type { SalesBrochureSnapshot } from '@/lib/brochures/buildSalesBrochureHtml';
import BrochureImagePicker from './BrochureImagePicker';
import BrochurePageCanvas from './BrochurePageCanvas';

type Props = {
  brochureId: string; pages: BrochureDecorativePage[]; selectedId: string | null;
  assets: BrochureImageAsset[]; imageUrls: Record<string, string>; company: SalesBrochureSnapshot['company']; organizationName: string;
  disabled: boolean; inputClass: string; onChange: (pages: BrochureDecorativePage[]) => void;
  onSelect: (id: string) => void; onUploadBusy: (busy: boolean) => void;
  onSave: () => void; hasChanges: boolean;
};
const button = 'rounded-lg bg-white/5 px-3 py-2 text-xs text-white/65 hover:bg-white/10 disabled:opacity-40';
export default function BrochureDecorativePagesEditor({ brochureId, pages, selectedId, assets, imageUrls, company, organizationName, disabled, inputClass, onChange, onSelect, onUploadBusy, onSave, hasChanges }: Props) {
  const selected = pages.find((p) => p.id === selectedId);
  const update = (patch: Partial<BrochureDecorativePage>) => selected && onChange(pages.map((p) => p.id === selected.id ? { ...p, ...patch } : p));
  const add = (preset?: keyof typeof BROCHURE_PRESETS) => {
    if (disabled || pages.length >= 40) return;
    const template = preset ? BROCHURE_PRESETS[preset] : null;
    const layout: BrochureLayout = template?.layout || 'statement';
    const next: BrochureDecorativePage = { id: crypto.randomUUID(), layout, slogan: template?.slogan || BROCHURE_SLOGANS[0], caption: template?.caption || '', imagePath: '', imageBucket: 'offer-product-pages', imagePosition: 50, afterItemId: null, isVisible: true, points: template?.points || [], design: pageDefaults(layout),
      linkLabel: preset === 'seller' ? BROCHURE_PRESETS.seller.linkLabel : '', linkUrl: preset === 'seller' ? `https://mavinci.pl/demo-sprzedawcy/${brochureId}` : '', linkHint: preset === 'seller' ? BROCHURE_PRESETS.seller.linkHint : '' };
    if (preset === 'seller') next.design = { ...pageDefaults(layout), showBrand: false, fontSize: 33, ornament: 'arc', text: { x: 10, y: 9, width: 80, height: 25 }, details: { x: 10, y: 37, width: 80, height: 54 } };
    onChange([...pages, next]); onSelect(next.id);
  };
  const d = selected ? pageDesign(selected) : null;
  const adjust = (patch: Partial<ReturnType<typeof pageDesign>>) => d && update({ design: { ...d, ...patch } });
  return <section id="brochure-page-studio" className="scroll-mt-6 space-y-5 rounded-xl bg-[#1c1f33] p-4 md:p-5">
    <div><h2 className="text-lg font-light">Studio stron</h2><p className="mt-1 text-xs leading-5 text-white/45">Dodawaj nowości, prezentuj hotel i układaj własną opowieść. Każdą stronę możesz zmienić, powielić lub ukryć.</p></div>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={disabled || pages.length >= 40} onClick={() => add()} className={button}><Plus className="mr-1 inline h-3 w-3" />Własna strona</button>{(Object.keys(BROCHURE_PRESETS) as Array<keyof typeof BROCHURE_PRESETS>).map((key) => <button type="button" key={key} disabled={disabled || pages.length >= 40} onClick={() => add(key)} className={button}>+ {BROCHURE_PRESETS[key].label}</button>)}</div>
    {!selected && <p className="text-sm text-white/40">Wybierz stronę w spisie powyżej lub dodaj nową z szablonu.</p>}
    {selected && d && <fieldset disabled={disabled} className="min-w-0 space-y-5 disabled:opacity-60">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm text-[#d3bb73]">{selected.slogan || 'Gotowa grafika'}</span><div className="flex gap-2"><button type="button" disabled={disabled || pages.length >= 40} onClick={() => { const copy = { ...selected, id: crypto.randomUUID() }; onChange([...pages, copy]); onSelect(copy.id); }} className={button}><Copy className="mr-1 inline h-3 w-3" />Powiel</button><button type="button" onClick={() => onChange(pages.filter((p) => p.id !== selected.id))} className={button}><Trash2 className="mr-1 inline h-3 w-3" />Usuń</button></div></div>
      <label className="block text-xs text-white/55">Układ strony<select value={selected.layout} className={`${inputClass} mt-1.5`} onChange={(e) => { const layout = e.target.value as BrochureLayout; update({ layout, design: pageDefaults(layout) }); }}>{Object.entries(BROCHURE_LAYOUTS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {selected.layout !== 'artwork' && <>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-white/55">Nazwa działu<input maxLength={80} value={selected.eyebrow || ''} className={`${inputClass} mt-1.5`} onChange={(e) => update({ eyebrow: e.target.value })} /></label><label className="text-xs text-white/55">Ikona nagłówka<select value={selected.icon || ''} className={`${inputClass} mt-1.5`} onChange={(e) => update({ icon: e.target.value ? e.target.value as BrochureIcon : undefined })}><option value="">Bez ikony</option>{Object.entries(BROCHURE_ICONS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
        <label className="block text-xs text-white/55">Hasło / tytuł<textarea rows={selected.layout === 'signature' ? 2 : 1} maxLength={120} value={selected.slogan} className={`${inputClass} mt-1.5`} onChange={(e) => update({ slogan: e.target.value })} /></label>
        <label className="block text-xs text-white/55">Treść<textarea rows={4} maxLength={600} value={selected.caption} className={`${inputClass} mt-1.5`} onChange={(e) => update({ caption: e.target.value })} /></label>
        <p className="text-[11px] text-white/40">{selected.layout === 'signature' && 'W haśle Enter rozpoczyna nowy wiersz. Ostatni wiersz otrzymuje złoty akcent na tle marki. '}Wpisz {'{{klient}}'}, aby wstawić nazwę wybranej organizacji. Zmiana odbiorcy podmieni ją w podglądzie i PDF.</p>
      </>}
      {['features', 'features-photo', 'process', 'timeline', 'showcase', 'signature'].includes(selected.layout) && <>
        <label className="block text-xs text-white/55">Punkty — do 6 wierszy, format: nagłówek | opis<textarea rows={6} value={(selected.points || []).join('\n')} className={`${inputClass} mt-1.5`} onChange={(e) => update({ points: e.target.value.split('\n').slice(0, 6) })} /></label>
        <div className="grid gap-3 sm:grid-cols-2">{(selected.points || []).map((_, index) => <label key={index} className="text-xs text-white/55">Ikona punktu {index + 1}<select className={`${inputClass} mt-1.5`} value={selected.pointIcons?.[index] || ''} onChange={(e) => { const icons = [...(selected.pointIcons || [])]; icons[index] = e.target.value as BrochureIcon | ''; update({ pointIcons: icons }); }}><option value="">Numer</option>{Object.entries(BROCHURE_ICONS).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>)}</div>
        <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs text-white/55">Tekst przycisku<input maxLength={80} value={selected.linkLabel || ''} className={`${inputClass} mt-1.5`} onChange={(e) => update({ linkLabel: e.target.value })} /></label><label className="text-xs text-white/55">Adres przycisku<input type="url" value={selected.linkUrl || ''} placeholder="https://…" className={`${inputClass} mt-1.5`} onChange={(e) => update({ linkUrl: e.target.value })} /></label></div>
        <label className="block text-xs text-white/55">Zachęta pod przyciskiem (opcjonalnie)<input maxLength={160} value={selected.linkHint || ''} className={`${inputClass} mt-1.5`} onChange={(e) => update({ linkHint: e.target.value })} /></label>
        <p className="text-[11px] text-white/40">Treść szablonu jest propozycją. Dopasuj ją do zakresu udostępnionego temu klientowi.</p>
      </>}
      {(selected.layout === 'features' || requiresPageImage(selected.layout)) && <>
        {['features', 'features-photo'].includes(selected.layout) && <p className="text-xs leading-5 text-white/55">Opcjonalne zdjęcie między nagłówkiem a kafelkami. Wybierz materiał z biblioteki lub wgraj własny plik. Po dodaniu zdjęcia kafelki przesuną się niżej; przy wymianie zdjęcia zachowamy Twój układ i kadr.</p>}
        <BrochureImagePicker key={selected.id} brochureId={brochureId} path={selected.imagePath} bucket={selected.imageBucket} assets={assets} imageUrls={imageUrls} disabled={disabled} inputClass={inputClass} onBusy={onUploadBusy} onSave={onSave} hasChanges={hasChanges} onChange={(imagePath, imageBucket) => {
          const layout = selected.layout === 'features' && imagePath ? 'features-photo' : selected.layout === 'features-photo' && !imagePath ? 'features' : selected.layout;
          if (layout !== selected.layout) {
            const defaults = pageDefaults(layout);
            update({ imagePath, imageBucket, layout, design: { ...d, text: defaults.text, image: defaults.image, details: defaults.details, fontSize: defaults.fontSize, showBrand: false, overlay: 0 } });
          } else update({ imagePath, imageBucket });
        }} />
      </>}
      {selected.layout === 'signature' && <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/55">Tonacja koloru marki: {d.imageTint || 0}%<input type="range" min={0} max={100} value={d.imageTint || 0} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => adjust({ imageTint: Number(e.target.value) })} /></label>
        <label className="text-xs text-white/55">Cień gradientowy: {d.imageFade || 0}%<input type="range" min={0} max={100} value={d.imageFade || 0} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => adjust({ imageFade: Number(e.target.value) })} /></label>
        <p className="text-[11px] leading-5 text-white/40 sm:col-span-2">Tonacja nadaje zdjęciu odcień marki. Gradient miękko przyciemnia brzegi, najmocniej u dołu. Ustaw 0%, aby wyłączyć dany efekt.</p>
      </div>}
      {!selected.design && <div className="rounded-lg bg-black/15 p-3 text-xs leading-5 text-white/55">Ta strona zachowuje dotychczasowy układ widoczny w podglądzie broszury. Aby ją swobodnie rozmieścić, włącz nowy układ.<button type="button" className={`${button} mt-2 block`} onClick={() => update({ design: pageDefaults(selected.layout) })}>Włącz edycję rozmieszczenia</button></div>}
      {selected.design && <><BrochurePageCanvas key={selected.id} page={selected} company={company} organizationName={organizationName} imageUrl={imageUrls[`${selected.imageBucket}:${selected.imagePath}`]} disabled={disabled} onChange={(design) => update({ design })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/55">Motyw graficzny<select value={d.ornament || 'none'} className={`${inputClass} mt-1.5`} onChange={(e) => adjust({ ornament: e.target.value as 'none' | 'arc' | 'grid' })}><option value="none">Bez motywu</option><option value="arc">Łuki</option><option value="grid">Siatka punktów</option></select></label>
        <label className="text-xs text-white/55">Tło<select value={d.theme} className={`${inputClass} mt-1.5`} onChange={(e) => adjust({ theme: e.target.value as 'light' | 'dark' })}><option value="light">Jasne</option><option value="dark">Kolor marki</option></select></label>
        <label className="text-xs text-white/55">Wyrównanie tekstu<select value={d.align} className={`${inputClass} mt-1.5`} onChange={(e) => adjust({ align: e.target.value as 'left' | 'center' | 'right' })}><option value="left">Do lewej</option><option value="center">Na środku</option><option value="right">Do prawej</option></select></label>
        <label className="text-xs text-white/55">Wielkość hasła: {d.fontSize}<input type="range" min={20} max={64} value={d.fontSize} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => adjust({ fontSize: Number(e.target.value) })} /></label>
        <label className="flex items-center gap-2 text-xs text-white/55"><input type="checkbox" checked={d.showBrand} onChange={(e) => adjust({ showBrand: e.target.checked })} />Pokaż logo {company.name}</label>
      </div>
      {requiresPageImage(selected.layout) && <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-xs text-white/55">Dopasowanie zdjęcia<select value={d.imageFit} className={`${inputClass} mt-1.5`} onChange={(e) => adjust({ imageFit: e.target.value as 'cover' | 'contain' })}><option value="cover">Wypełnij pole</option><option value="contain">Pokaż całą grafikę</option></select></label>
        <label className="text-xs text-white/55">Przyciemnienie: {d.overlay}%<input type="range" min={0} max={90} value={d.overlay} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => adjust({ overlay: Number(e.target.value) })} /></label>
        <label className="text-xs text-white/55">Kadr — lewo / prawo<input type="range" min={0} max={100} value={d.imageX} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => adjust({ imageX: Number(e.target.value) })} /></label>
        <label className="text-xs text-white/55">Kadr — góra / dół<input type="range" min={0} max={100} value={selected.imagePosition} className="mt-2 block w-full accent-[#d3bb73]" onChange={(e) => update({ imagePosition: Number(e.target.value) })} /></label>
      </div>}
      <button type="button" onClick={() => update({ design: pageDefaults(selected.layout) })} className={button}>Przywróć rozmieszczenie szablonu</button></>}
    </fieldset>}
  </section>;
}
