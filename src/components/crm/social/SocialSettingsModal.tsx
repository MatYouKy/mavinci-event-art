'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Plus, Sparkles } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { normalizeHashtags } from '@/lib/social/socialShared';
import { socialGet, socialPost, type SocialBrandbook, type SocialSettings, type SocialTemplate } from './socialApi';
import { errorMessage, inputClass, primaryButton, secondaryButton } from './socialUi';

/*
 * Ustawienia social media marki (akceptujący): opisy AI (zgoda na przekazanie treści realizacji bez danych osobowych),
 * stałe hashtagi i styl opisów oraz szablony grafik — wyłącznie logo, fonty i kolory z księgi znaku marki.
 */

type TemplateForm = {
  id: string | null; name: string; isDefault: boolean; logoId: string | null; titleFontId: string | null; captionFontId: string | null;
  overlayColorId: string | null; accentColorId: string | null; textColorId: string | null;
};

const formFrom = (template: SocialTemplate | null): TemplateForm => ({
  id: template?.id || null,
  name: template?.name || 'Nowy szablon',
  isDefault: template?.isDefault || false,
  logoId: template?.logoId || null,
  titleFontId: template?.titleFontId || null,
  captionFontId: template?.captionFontId || null,
  overlayColorId: template?.overlayColorId || null,
  accentColorId: template?.accentColorId || null,
  textColorId: template?.textColorId || null,
});

export default function SocialSettingsModal({ companyId, settings, templates: initial, onClose, onSaved }: {
  companyId: string; settings: SocialSettings; templates: SocialTemplate[]; onClose: () => void; onSaved: () => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [ai, setAi] = useState(settings.aiCaptionsEnabled);
  const [hashtags, setHashtags] = useState(settings.defaultHashtags.join(' '));
  const [style, setStyle] = useState(settings.captionStyle);
  const [templates, setTemplates] = useState(initial);
  const [form, setForm] = useState<TemplateForm>(formFrom(initial.find((item) => item.isDefault) || initial[0] || null));
  const [brandbook, setBrandbook] = useState<SocialBrandbook | null>(null);

  useEffect(() => {
    socialGet<SocialBrandbook>('brandbook', { company: companyId }).then(setBrandbook)
      .catch((cause) => showSnackbar(errorMessage(cause, 'Nie udało się pobrać księgi znaku.'), 'error'));
  }, [companyId, showSnackbar]);

  const run = async (title: string, action: () => Promise<void>, success: string) => {
    showLoader(title);
    try {
      await action();
      showSnackbar(success, 'success');
      onSaved();
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Nie udało się zapisać.'), 'error');
    } finally {
      hideLoader();
    }
  };

  const current = templates.find((item) => item.id === form.id) || null;
  const colorSelect = (label: string, key: 'overlayColorId' | 'accentColorId' | 'textColorId', hint: string) => (
    <div className="text-sm">
      <div className="mb-1">{label} <span className="text-xs text-[#e5e4e2]/40">{hint}</span></div>
      <div className="flex flex-wrap gap-1.5">
        {(brandbook?.colors || []).map((color) => (
          <button key={color.id} type="button" title={`${color.label} ${color.hex}`} onClick={() => setForm({ ...form, [key]: color.id })}
            className={`flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs ${form[key] === color.id ? 'border-[#d3bb73] bg-[#d3bb73]/15' : 'border-[#d3bb73]/10'}`}>
            <span className="h-4 w-4 rounded border border-white/20" style={{ background: color.hex.slice(0, 7) }} />{color.label || color.hex}
            {form[key] === color.id && <Check className="h-3 w-3 text-[#d3bb73]" />}
          </button>
        ))}
      </div>
    </div>
  );
  const fontSelect = (label: string, key: 'titleFontId' | 'captionFontId') => (
    <label className="block text-sm">{label}
      <select value={form[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value || null })} className={`${inputClass} mt-1`}>
        <option value="">— wybierz —</option>
        {(brandbook?.fonts || []).map((font) => <option key={font.id} value={font.id}>{font.label || font.family}{font.hasFile ? '' : ' (bez pliku — nie do grafik)'}</option>)}
      </select>
    </label>
  );

  return (
    <Modal open onClose={onClose} title="Social media — szablony i AI" scrollBody>
      <div className="space-y-6">
        <section className="space-y-3">
          <h3 className="flex items-center gap-2 text-lg font-light"><Sparkles className="h-4 w-4 text-[#d3bb73]" />Opisy AI i hashtagi</h3>
          <label className="flex items-start gap-3 rounded-lg bg-[#0f1119] p-3 text-sm">
            <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="mt-1" />
            <span>Opisy AI z danych realizacji
              <span className="mt-1 block text-xs text-[#e5e4e2]/55">Do usługi AI (OpenAI, konfiguracja marketingu) trafia rodzaj wydarzenia, miejsce, miesiąc, opis realizacji ze strony i robocza treść posta. Nazwa wydarzenia i klient — tylko przy zgodzie klienta. Bez danych osobowych i kontaktowych.</span>
              {settings.aiConsentAt && <span className="mt-1 block text-xs text-[#e5e4e2]/40">Włączone: {new Date(settings.aiConsentAt).toLocaleString('pl-PL')}</span>}
            </span>
          </label>
          <label className="block text-sm">Stałe hashtagi marki<input value={hashtags} onChange={(e) => setHashtags(e.target.value)} className={`${inputClass} mt-1`} placeholder="#mavinci #eventy" /></label>
          <label className="block text-sm">Styl opisów (wskazówki dla AI)<textarea value={style} maxLength={600} rows={2} onChange={(e) => setStyle(e.target.value)} className={`${inputClass} mt-1`} placeholder="np. bez emoji, zawsze zaproszenie do kontaktu na końcu" /></label>
          <button type="button" className={primaryButton} onClick={() => void run('Zapisuję ustawienia', async () => {
            await socialPost('settings', { companyId, aiCaptionsEnabled: ai, defaultHashtags: normalizeHashtags(hashtags), captionStyle: style });
          }, 'Zapisano ustawienia social media')}>Zapisz ustawienia</button>
        </section>

        <section className="space-y-3 border-t border-[#d3bb73]/10 pt-5">
          <h3 className="text-lg font-light">Szablony grafik</h3>
          <p className="text-xs text-[#e5e4e2]/55">Szablon wskazuje logo, fonty i kolory z <Link className="text-[#d3bb73] underline" href={`/crm/settings/my-companies/${companyId}/brandbook`}>księgi znaku marki</Link> — zmiana w księdze znaku zmienia też nowe grafiki. Fonty muszą mieć plik, żeby grafika była identyczna w CRM, na Macu i w telefonie.</p>
          <div className="flex flex-wrap gap-2">
            {templates.map((template) => (
              <button key={template.id} type="button" onClick={() => setForm(formFrom(template))}
                className={`rounded-lg border px-3 py-1.5 text-sm ${form.id === template.id ? 'border-[#d3bb73]/60 bg-[#d3bb73]/15 text-[#d3bb73]' : 'border-[#d3bb73]/15'}`}>
                {template.name}{template.isDefault ? ' ★' : ''}{template.ready ? '' : ' (niegotowy)'}
              </button>
            ))}
            <button type="button" className={secondaryButton} onClick={() => setForm(formFrom(null))}><Plus className="h-4 w-4" />Nowy szablon</button>
          </div>
          {current && !current.ready && <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-100">{current.problems.join(' ')}</p>}
          <label className="block text-sm">Nazwa<input value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`${inputClass} mt-1`} /></label>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />Domyślny szablon marki</label>
          <div className="text-sm">
            <div className="mb-1">Logo <span className="text-xs text-[#e5e4e2]/40">(na zdjęciach — wersja w negatywie)</span></div>
            <div className="flex flex-wrap gap-2">
              {(brandbook?.logos || []).map((logo) => (
                <button key={logo.id} type="button" onClick={() => setForm({ ...form, logoId: logo.id })}
                  className={`flex h-20 w-28 flex-col items-center justify-center gap-1 rounded-lg border bg-[#4a4a4a] p-1 ${form.logoId === logo.id ? 'border-[#d3bb73] ring-2 ring-[#d3bb73]/40' : 'border-transparent'}`}>
                  {logo.url && <img src={logo.url} alt={logo.label} className="max-h-12 max-w-full object-contain" />}
                  <span className="max-w-full truncate text-[10px] text-white/80">{logo.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">{fontSelect('Font tytułu', 'titleFontId')}{fontSelect('Font podpisu', 'captionFontId')}</div>
          {colorSelect('Przyciemnienie', 'overlayColorId', '(dół zdjęcia)')}
          {colorSelect('Akcent', 'accentColorId', '(kreska i podpis)')}
          {colorSelect('Tytuł', 'textColorId', '(tekst na zdjęciu)')}
          <button type="button" className={primaryButton} onClick={() => void run('Zapisuję szablon', async () => {
            const result = await socialPost<{ templates: SocialTemplate[] }>('template', { companyId, ...form });
            setTemplates(result.templates);
            const saved = result.templates.find((item) => item.id === form.id) || result.templates.find((item) => item.name === form.name) || null;
            setForm(formFrom(saved));
          }, 'Zapisano szablon grafik')}>Zapisz szablon</button>
        </section>
      </div>
    </Modal>
  );
}
