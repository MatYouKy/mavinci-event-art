'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, CircleDashed, ExternalLink, Facebook, Instagram, Linkedin, RefreshCw, XCircle } from 'lucide-react';
import {
  SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_METRICS, SOCIAL_METRIC_HINTS, SOCIAL_METRIC_LABELS, SOCIAL_PUBLICATION_STATUS_LABELS,
  formatSocialNumber, formatSocialPercent, isMetaChannel, type SocialAccess, type SocialChannel,
} from '@/lib/social/socialShared';
import type { SocialMetaStatus, SocialPostDetail } from './socialApi';
import { cardClass, dateTimeLabel } from './socialUi';

/*
 * Publikacja: stan kont marki (strona Facebook, Instagram, uprawnienia Meta; strona firmowa LinkedIn) w nagłówku Social media
 * oraz wyniki kanałów posta (link do opublikowanego posta albo błąd i — po publikacji — wyniki z Meta) w kreatorze. Konta
 * i uprawnienia ustawia się w ustawieniach marketingu marki („Połącz” / „Odśwież dostęp” przy Meta i LinkedIn). LinkedIn
 * bez połączenia nie jest błędem — post na LinkedIn publikuje się wtedy ręcznie („Pobierz paczkę” + „Oznacz jako opublikowany”).
 */

const settingsHref = (companyId: string) => `/crm/settings/my-companies/${companyId}/marketing`;

/** Kanał bez automatycznej publikacji, który nie jest błędem: LinkedIn bez połączonej strony (publikacja ręczna). */
export const manualChannel = (meta: SocialMetaStatus | null, channel: SocialChannel) =>
  channel === 'linkedin_page' && !meta?.linkedin?.connected;

export function MetaStatusBanner({ meta, companyId, access }: { meta: SocialMetaStatus | null; companyId: string; access: SocialAccess }) {
  if (!meta || !(access.publish || access.create)) return null;
  const state = (channel: SocialChannel) => meta.channels[channel] || { ready: false, problem: null };
  // Ostrzeżenie tylko dla kanałów z automatyczną publikacją (Meta zawsze, LinkedIn — po połączeniu strony).
  const watched = SOCIAL_CHANNELS.filter((channel) => !manualChannel(meta, channel));
  const problems = Array.from(new Set(watched.map((channel) => state(channel).problem).filter((item): item is string => Boolean(item))));
  const allReady = watched.every((channel) => state(channel).ready);
  return (
    <div className={`${cardClass} flex flex-col gap-2 p-3 text-sm lg:flex-row lg:items-center ${allReady ? '' : 'border-amber-400/30'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[#e5e4e2]/60">Publikacja:</span>
        <span className="inline-flex items-center gap-1.5"><Facebook className="h-4 w-4 text-[#d3bb73]" />{meta.pageName || 'brak strony'}</span>
        <span className="inline-flex items-center gap-1.5"><Instagram className="h-4 w-4 text-[#d3bb73]" />{meta.instagramUsername ? `@${meta.instagramUsername}` : 'brak konta Instagram'}</span>
        <span className="inline-flex items-center gap-1.5"><Linkedin className="h-4 w-4 text-[#d3bb73]" />{meta.linkedin?.organizationName || (meta.linkedin?.connected ? 'brak strony' : 'ręcznie')}</span>
        {SOCIAL_CHANNELS.map((channel) => {
          const manual = manualChannel(meta, channel);
          const ready = state(channel).ready;
          return (
            <span key={channel} className={`inline-flex items-center gap-1 text-xs ${manual ? 'text-[#e5e4e2]/50' : ready ? 'text-emerald-200' : 'text-amber-200'}`}
              title={state(channel).problem || 'Gotowe do publikacji'}>
              {manual ? <CircleDashed className="h-3.5 w-3.5" /> : ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
              {SOCIAL_CHANNEL_LABELS[channel]}{manual ? ' (ręcznie)' : ''}
            </span>
          );
        })}
      </div>
      <span className="flex-1" />
      {!allReady && (
        <div className="space-y-1 text-xs text-amber-100 lg:max-w-xl">
          {problems.slice(0, 2).map((problem) => <p key={problem}>{problem}</p>)}
          {meta.missingScopes.length > 0 && <p className="text-amber-100/70">Brakujące uprawnienia Meta: {meta.missingScopes.join(', ')}.</p>}
        </div>
      )}
      <Link href={settingsHref(companyId)} className="inline-flex shrink-0 items-center gap-1 text-xs text-[#d3bb73] hover:underline">
        Ustawienia kont<ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function MetaPublishPanel({ detail, onRefreshMetrics }: { detail: SocialPostDetail; onRefreshMetrics?: () => void }) {
  const { post, meta, publications } = detail;
  const showProblems = ['approved', 'scheduled', 'failed'].includes(post.status) && detail.problems.meta.length > 0;
  const published = publications.filter((item) => item.status === 'published');
  if (!meta && !publications.length && !['scheduled', 'publishing', 'failed'].includes(post.status)) return null;
  return (
    <section className={`${cardClass} space-y-3 p-4`}>
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <CalendarClock className="h-4 w-4 text-[#d3bb73]" />Publikacja
        <span className="flex-1" />
        {published.length > 0 && onRefreshMetrics && (
          <button type="button" onClick={onRefreshMetrics} className="inline-flex items-center gap-1 text-xs font-normal text-[#d3bb73] hover:underline" title="Pobierz aktualne wyniki z Meta">
            <RefreshCw className="h-3 w-3" />Wyniki
          </button>
        )}
      </h3>
      {post.status === 'scheduled' && (
        <p className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-2 text-xs text-sky-100">
          Zaplanowano na {dateTimeLabel(post.scheduledAt)}{post.scheduledByName ? ` — ${post.scheduledByName}` : ''}. Post opublikuje się automatycznie.
        </p>
      )}
      {post.status === 'publishing' && <p className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-2 text-xs text-sky-100">Trwa publikacja…</p>}
      {post.status === 'failed' && post.publishError && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs text-red-100">{post.publishError}</p>
      )}
      <ul className="space-y-1.5 text-xs">
        {post.channels.map((channel) => {
          const publication = publications.find((item) => item.channel === channel);
          const problem = meta?.channels[channel]?.problem;
          const manual = manualChannel(meta, channel);
          return (
            <li key={channel} className="rounded-lg border border-[#d3bb73]/10 p-2">
              <div className="flex items-center gap-2">
                {publication?.status === 'published' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                  : publication?.status === 'failed' ? <XCircle className="h-3.5 w-3.5 text-red-300" />
                    : manual ? <CircleDashed className="h-3.5 w-3.5 text-[#e5e4e2]/45" />
                      : problem ? <AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-[#e5e4e2]/30" />}
                <span className="font-medium">{SOCIAL_CHANNEL_LABELS[channel]}</span>
                <span className="text-[#e5e4e2]/45">
                  {publication ? SOCIAL_PUBLICATION_STATUS_LABELS[publication.status] || publication.status : manual ? 'publikacja ręczna' : problem ? 'niegotowy' : 'gotowy'}
                </span>
                <span className="flex-1" />
                {publication?.permalink && <a href={publication.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#d3bb73] hover:underline">Otwórz<ExternalLink className="h-3 w-3" /></a>}
              </div>
              {publication?.status === 'published' && publication.publishedAt && <p className="mt-0.5 text-[#e5e4e2]/40">{dateTimeLabel(publication.publishedAt)}</p>}
              {publication?.status === 'published' && (channel === 'linkedin_page'
                ? <p className="mt-1 text-[#e5e4e2]/40">Wyniki postów LinkedIn nie są jeszcze pobierane do CRM.</p>
                : <PublicationMetrics publication={publication} />)}
              {publication?.error && publication.status !== 'published' && <p className="mt-1 text-red-200/80">{publication.error}</p>}
              {!publication && problem && <p className={`mt-1 ${manual ? 'text-[#e5e4e2]/55' : 'text-amber-100/80'}`}>{problem}</p>}
            </li>
          );
        })}
      </ul>
      {showProblems && (
        <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-amber-100/80">
          {detail.problems.meta.filter((item) => !post.channels.some((channel) => item === `${SOCIAL_CHANNEL_LABELS[channel]}: ${meta?.channels[channel]?.problem}`))
            .map((item) => <li key={item}>{item}</li>)}
        </ul>
      )}
      {meta && !meta.connected && post.channels.some(isMetaChannel) && (
        <Link href={settingsHref(detail.company.id)} className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">Połącz Meta w ustawieniach marketingu<ExternalLink className="h-3 w-3" /></Link>
      )}
      {meta && !meta.linkedin?.connected && post.channels.includes('linkedin_page') && (
        <Link href={settingsHref(detail.company.id)} className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">LinkedIn w ustawieniach marketingu<ExternalLink className="h-3 w-3" /></Link>
      )}
    </section>
  );
}

/** Wyniki kanału z Meta (stan narastająco od publikacji). */
function PublicationMetrics({ publication }: { publication: SocialPostDetail['publications'][number] }) {
  const metrics = publication.metrics || {};
  const keys = SOCIAL_METRICS.filter((key) => metrics[key] != null);
  if (!keys.length) {
    return (
      <p className="mt-1 text-[#e5e4e2]/40">
        {publication.metricsError || (publication.metricsSyncedAt ? 'Meta nie podała jeszcze wyników.' : 'Wyniki pojawią się w ciągu godziny od publikacji.')}
      </p>
    );
  }
  return (
    <div className="mt-1.5 space-y-1">
      <div className="grid grid-cols-3 gap-1">
        {keys.map((key) => (
          <div key={key} className="rounded bg-[#0f1119]/70 px-1.5 py-1" title={SOCIAL_METRIC_HINTS[key]}>
            <div className="truncate text-[10px] text-[#e5e4e2]/45">{SOCIAL_METRIC_LABELS[key]}</div>
            <div className="tabular-nums">{formatSocialNumber(metrics[key])}</div>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-[#e5e4e2]/40">
        {publication.rate != null ? `Zaangażowanie ${formatSocialPercent(publication.rate)} · ` : ''}
        {publication.metricsSyncedAt ? `pobrano ${dateTimeLabel(publication.metricsSyncedAt)}` : ''}
        {publication.metricsError ? ` · ${publication.metricsError}` : ''}
      </p>
    </div>
  );
}
