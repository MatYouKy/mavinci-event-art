'use client';

import { useMemo, useState } from 'react';
import { AlertTriangle, Info, RefreshCw, Search, Tags } from 'lucide-react';
import { Modal } from '@/components/UI/Modal';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { CrmCartesianChart } from '@/components/crm/charts/CrmCharts';
import {
  SOCIAL_BRAND_CHANNELS, SOCIAL_BRAND_COLORS, SOCIAL_BRAND_HINTS, SOCIAL_BRAND_INSTAGRAM_POSTS_HINT, SOCIAL_BRAND_LABELS,
  SOCIAL_BRAND_SHORT_LABELS, SOCIAL_BRAND_STATUS_LABELS, SOCIAL_BRAND_TERMS_LIMITS, formatSocialNumber, socialBrandDayLabel,
  socialBrandTermsFromText, type SocialBrandChannel, type SocialBrandInterest,
} from '@/lib/social/socialShared';
import { socialPost, type SocialStats } from './socialApi';
import { ChangeBadge, cardClass, dateTimeLabel, errorMessage, inputClass, primaryButton, secondaryButton } from './socialUi';

/*
 * Social media → Statystyki → „Zainteresowanie marką”: wyszukiwania nazwy marki w Google (Search Console), wejścia na stronę
 * Facebook i na profil Instagram — suma okresu wobec poprzedniego, dzień po dniu, frazy, którymi szukano marki w Google,
 * i stan pobrania kanałów. Wyłącznie liczby — Google i Meta nie podają, kto szukał ani kto odwiedził profil.
 * „Frazy marki” — zarządzający marketingiem albo akceptujący social media marki; „Odśwież” — każdy z dostępem do statystyk.
 * Te same dane i akcje na Macu i w telefonie (`op=stats` → `brand`, `brandRefresh`, `brandTerms`).
 */

const STATUS_CLASSES: Record<string, string> = {
  pending: 'text-[#e5e4e2]/55',
  unavailable: 'text-amber-200/80',
  error: 'text-red-200/90',
  not_connected: 'text-[#e5e4e2]/55',
};

export default function SocialBrandInterestCard({ brand, companyId, days, reportId, onStats }: {
  brand: SocialBrandInterest; companyId: string; days: number; reportId: string | null; onStats: (stats: SocialStats) => void;
}) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [editing, setEditing] = useState(false);

  const visible = useMemo(
    () => SOCIAL_BRAND_CHANNELS.filter((channel) => brand.days.some((day) => day[channel] != null)),
    [brand.days],
  );
  const chartData = useMemo(() => brand.days.map((day) => ({
    day: socialBrandDayLabel(day.date), google: day.google, facebook: day.facebook, instagram: day.instagram,
  })), [brand.days]);

  const run = async (title: string, subtitle: string, action: () => Promise<SocialStats>, success: string) => {
    showLoader(title, subtitle);
    try {
      onStats(await action());
      showSnackbar(success, 'success');
      return true;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Operacja nie powiodła się.'), 'error');
      return false;
    } finally {
      hideLoader();
    }
  };

  const refresh = () => void run('Odświeżam zainteresowanie marką', 'Pobieram liczby z Google i Meta — to może potrwać do minuty.',
    () => socialPost<SocialStats>('brandRefresh', { companyId, days, report: reportId }), 'Odświeżono zainteresowanie marką');

  const saveTerms = async (terms: string[]) => {
    const ok = await run('Zapisuję frazy marki', 'Pobieram od nowa wyszukiwania z Google.',
      () => socialPost<SocialStats>('brandTerms', { companyId, terms, days, report: reportId }),
      terms.length ? 'Zapisano frazy marki' : 'Przywrócono frazy domyślne');
    if (ok) setEditing(false);
  };

  const problems = SOCIAL_BRAND_CHANNELS
    .map((channel) => ({ channel, state: brand.channels[channel] }))
    .filter((item) => item.state.status !== 'ok' && item.state.message);

  return (
    <div className={`${cardClass} space-y-4 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><Search className="h-4 w-4 text-[#d3bb73]" />Zainteresowanie marką</h3>
        <span className="text-xs text-[#e5e4e2]/45">Ostatnie {days} dni wobec {days} dni wcześniej</span>
        <span className="flex-1" />
        {brand.canEditTerms && (
          <button type="button" className={secondaryButton} onClick={() => setEditing(true)}><Tags className="h-4 w-4" />Frazy marki</button>
        )}
        {brand.canRefresh && (
          <button type="button" className={secondaryButton} onClick={refresh}><RefreshCw className="h-4 w-4" />Odśwież</button>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {SOCIAL_BRAND_CHANNELS.map((channel) => (
          <BrandTile key={channel} channel={channel} brand={brand} />
        ))}
      </div>

      {problems.length > 0 && (
        <div className="space-y-1 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs">
          {problems.map(({ channel, state }) => (
            <p key={channel} className={`flex gap-2 ${STATUS_CLASSES[state.status] || ''}`}>
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span><span className="font-medium">{SOCIAL_BRAND_SHORT_LABELS[channel]} — {SOCIAL_BRAND_STATUS_LABELS[state.status]}:</span> {state.message}</span>
            </p>
          ))}
        </div>
      )}

      <CrmCartesianChart data={chartData} categoryKey="day" kind="line" height={240} showLegend={visible.length > 1}
        series={visible.map((channel) => ({ key: channel, label: SOCIAL_BRAND_SHORT_LABELS[channel], color: SOCIAL_BRAND_COLORS[channel] }))}
        valueFormatter={(value) => formatSocialNumber(value)} ariaLabel="Zainteresowanie marką dzień po dniu"
        emptyMessage="Brak danych w tym okresie — pojawią się po pobraniu z Google i Meta." />

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-xs uppercase tracking-wide text-[#e5e4e2]/45">Jak nas szukają w Google</h4>
          {brand.queries.length ? (
            <ol className="space-y-1">
              {brand.queries.map((item, index) => (
                <li key={item.query} className="flex items-center gap-2 rounded-lg bg-[#0f1119]/60 px-3 py-1.5 text-sm">
                  <span className="w-5 text-[#d3bb73]">{index + 1}.</span>
                  <span className="min-w-0 flex-1 truncate" title={item.query}>{item.query}</span>
                  <span className="tabular-nums" title="Wyszukiwania (wyświetlenia strony w wynikach)">{formatSocialNumber(item.searches)}</span>
                  <span className="w-24 text-right text-xs text-[#e5e4e2]/45" title="Kliknięcia w wynikach">{formatSocialNumber(item.clicks)} klik.</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="rounded-lg bg-[#0f1119]/60 p-3 text-xs text-[#e5e4e2]/55">
              {brand.channels.google.status === 'not_connected' ? brand.channels.google.message : 'Brak fraz z nazwą marki w tym okresie.'}
            </p>
          )}
        </div>
        <div className="space-y-2 text-xs text-[#e5e4e2]/55">
          <h4 className="text-xs uppercase tracking-wide text-[#e5e4e2]/45">Liczone frazy</h4>
          <div className="flex flex-wrap gap-1.5">
            {brand.terms.length ? brand.terms.map((term) => (
              <span key={term} className="rounded-full border border-[#d3bb73]/20 bg-[#d3bb73]/5 px-2 py-0.5 text-[#d3bb73]">{term}</span>
            )) : <span>Brak fraz.</span>}
          </div>
          <p>
            {brand.defaultTerms ? 'Frazy domyślne — z nazwy i adresu strony marki. ' : ''}
            Google liczy każdą frazę zawierającą jedną z nich (np. „{brand.terms[0] || 'nazwa'} opinie”).
            {brand.canEditTerms ? ' Zmienisz je przyciskiem „Frazy marki”.' : ' Frazy zmienia osoba zarządzająca marketingiem albo akceptująca social media.'}
          </p>
          <p className="flex gap-2">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#d3bb73]/70" />
            <span>Google i Meta nie podają, kto szukał marki ani kto odwiedził profil — tylko liczby. Nazwiska widać wyłącznie przy osobach, które same zareagowały: komentarze, wiadomości, obserwacje.</span>
          </p>
          <ul className="space-y-0.5">
            {SOCIAL_BRAND_CHANNELS.map((channel) => {
              const state = brand.channels[channel];
              return (
                <li key={channel}>
                  {SOCIAL_BRAND_SHORT_LABELS[channel]}: {SOCIAL_BRAND_STATUS_LABELS[state.status]}
                  {state.syncedAt ? ` · pobrano ${dateTimeLabel(state.syncedAt)}` : ''}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {editing && <BrandTermsModal brand={brand} onClose={() => setEditing(false)} onSave={saveTerms} />}
    </div>
  );
}

function BrandTile({ channel, brand }: { channel: SocialBrandChannel; brand: SocialBrandInterest }) {
  const state = brand.channels[channel];
  const value = brand.totals[channel];
  const note = channel === 'google' && brand.totals.googleClicks != null
    ? `Kliknięcia w wynikach: ${formatSocialNumber(brand.totals.googleClicks)}`
    : channel === 'instagram' && brand.instagramSource === 'posts' ? SOCIAL_BRAND_INSTAGRAM_POSTS_HINT
      : value == null ? SOCIAL_BRAND_STATUS_LABELS[state.status] : '';
  return (
    <div className="rounded-lg bg-[#0f1119]/60 p-3" title={SOCIAL_BRAND_HINTS[channel]}>
      <div className="flex items-center gap-2 text-xs text-[#e5e4e2]/50">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: SOCIAL_BRAND_COLORS[channel] }} />
        {SOCIAL_BRAND_LABELS[channel]}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-2xl font-light">{formatSocialNumber(value)}</span>
        <ChangeBadge current={value} previous={brand.previous[channel]} />
      </div>
      {note && <div className="mt-0.5 text-[11px] text-[#e5e4e2]/45">{note}</div>}
    </div>
  );
}

function BrandTermsModal({ brand, onClose, onSave }: {
  brand: SocialBrandInterest; onClose: () => void; onSave: (terms: string[]) => void | Promise<void>;
}) {
  const [value, setValue] = useState(brand.defaultTerms ? '' : brand.terms.join('\n'));
  const parsed = socialBrandTermsFromText(value);
  return (
    <Modal open onClose={onClose} title="Frazy marki">
      <div className="space-y-4 text-sm">
        <p className="text-[#e5e4e2]/70">
          Wyszukiwania w Google liczymy dla fraz zawierających jedną z poniższych — każda w osobnym wierszu, od {SOCIAL_BRAND_TERMS_LIMITS.min} do
          {' '}{SOCIAL_BRAND_TERMS_LIMITS.max} znaków, najwyżej {SOCIAL_BRAND_TERMS_LIMITS.count}. Wielkość liter nie ma znaczenia, a spacja i łącznik
          między słowami są opcjonalne („event rulers” obejmuje też „eventrulers”).
        </p>
        <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={6} className={inputClass}
          placeholder={brand.defaultTerms ? brand.terms.join('\n') : 'np. mavinci'} aria-label="Frazy marki" />
        {brand.defaultTerms && (
          <p className="text-xs text-[#e5e4e2]/50">Teraz liczone są frazy domyślne: {brand.terms.join(', ') || 'brak'} (z nazwy i adresu strony marki).</p>
        )}
        {parsed.error && <p className="text-xs text-red-300">{parsed.error}</p>}
        <p className="text-xs text-[#e5e4e2]/45">Po zapisaniu wyniki Google z 90 dni pobiorą się od nowa dla nowych fraz.</p>
        <div className="flex flex-wrap justify-end gap-2">
          {!brand.defaultTerms && (
            <button type="button" className={secondaryButton} onClick={() => void onSave([])}>Przywróć domyślne</button>
          )}
          <span className="flex-1" />
          <button type="button" className={secondaryButton} onClick={onClose}>Anuluj</button>
          <button type="button" className={primaryButton} disabled={Boolean(parsed.error) || parsed.terms.length === 0}
            onClick={() => void onSave(parsed.terms)}>Zapisz frazy</button>
        </div>
      </div>
    </Modal>
  );
}
