'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarClock, CheckCircle2, ExternalLink, Facebook, Instagram, XCircle } from 'lucide-react';
import { SOCIAL_CHANNELS, SOCIAL_CHANNEL_LABELS, SOCIAL_PUBLICATION_STATUS_LABELS, type SocialAccess } from '@/lib/social/socialShared';
import type { SocialMetaStatus, SocialPostDetail } from './socialApi';
import { cardClass, dateTimeLabel } from './socialUi';

/*
 * Publikacja w Meta: stan konta marki (strona, Instagram, uprawnienia) w nagłówku Social media oraz wyniki kanałów
 * posta (link do opublikowanego posta albo błąd) w kreatorze. Konto i uprawnienia ustawia się w ustawieniach
 * marketingu marki („Połącz” / „Odśwież dostęp” przy Meta).
 */

const settingsHref = (companyId: string) => `/crm/settings/my-companies/${companyId}/marketing`;

export function MetaStatusBanner({ meta, companyId, access }: { meta: SocialMetaStatus | null; companyId: string; access: SocialAccess }) {
  if (!meta || !(access.publish || access.create)) return null;
  const ready = SOCIAL_CHANNELS.filter((channel) => meta.channels[channel].ready);
  const problems = Array.from(new Set(SOCIAL_CHANNELS.map((channel) => meta.channels[channel].problem).filter((item): item is string => Boolean(item))));
  const allReady = ready.length === SOCIAL_CHANNELS.length;
  return (
    <div className={`${cardClass} flex flex-col gap-2 p-3 text-sm lg:flex-row lg:items-center ${allReady ? '' : 'border-amber-400/30'}`}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-[#e5e4e2]/60">Publikacja w Meta:</span>
        <span className="inline-flex items-center gap-1.5"><Facebook className="h-4 w-4 text-[#d3bb73]" />{meta.pageName || 'brak strony'}</span>
        <span className="inline-flex items-center gap-1.5"><Instagram className="h-4 w-4 text-[#d3bb73]" />{meta.instagramUsername ? `@${meta.instagramUsername}` : 'brak konta Instagram'}</span>
        {SOCIAL_CHANNELS.map((channel) => (
          <span key={channel} className={`inline-flex items-center gap-1 text-xs ${meta.channels[channel].ready ? 'text-emerald-200' : 'text-amber-200'}`}
            title={meta.channels[channel].problem || 'Gotowe do publikacji'}>
            {meta.channels[channel].ready ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}{SOCIAL_CHANNEL_LABELS[channel]}
          </span>
        ))}
      </div>
      <span className="flex-1" />
      {!allReady && (
        <div className="space-y-1 text-xs text-amber-100 lg:max-w-xl">
          {problems.slice(0, 2).map((problem) => <p key={problem}>{problem}</p>)}
          {meta.missingScopes.length > 0 && <p className="text-amber-100/70">Brakujące uprawnienia Meta: {meta.missingScopes.join(', ')}.</p>}
        </div>
      )}
      <Link href={settingsHref(companyId)} className="inline-flex shrink-0 items-center gap-1 text-xs text-[#d3bb73] hover:underline">
        Ustawienia Meta<ExternalLink className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function MetaPublishPanel({ detail }: { detail: SocialPostDetail }) {
  const { post, meta, publications } = detail;
  const showProblems = ['approved', 'scheduled', 'failed'].includes(post.status) && detail.problems.meta.length > 0;
  if (!meta && !publications.length && !['scheduled', 'publishing', 'failed'].includes(post.status)) return null;
  return (
    <section className={`${cardClass} space-y-3 p-4`}>
      <h3 className="flex items-center gap-2 text-sm font-medium"><CalendarClock className="h-4 w-4 text-[#d3bb73]" />Publikacja w Meta</h3>
      {post.status === 'scheduled' && (
        <p className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-2 text-xs text-sky-100">
          Zaplanowano na {dateTimeLabel(post.scheduledAt)}{post.scheduledByName ? ` — ${post.scheduledByName}` : ''}. Post opublikuje się automatycznie.
        </p>
      )}
      {post.status === 'publishing' && <p className="rounded-lg border border-sky-400/30 bg-sky-400/10 p-2 text-xs text-sky-100">Trwa publikacja w Meta…</p>}
      {post.status === 'failed' && post.publishError && (
        <p className="whitespace-pre-wrap rounded-lg border border-red-400/30 bg-red-500/10 p-2 text-xs text-red-100">{post.publishError}</p>
      )}
      <ul className="space-y-1.5 text-xs">
        {post.channels.map((channel) => {
          const publication = publications.find((item) => item.channel === channel);
          const problem = meta?.channels[channel]?.problem;
          return (
            <li key={channel} className="rounded-lg border border-[#d3bb73]/10 p-2">
              <div className="flex items-center gap-2">
                {publication?.status === 'published' ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-300" />
                  : publication?.status === 'failed' ? <XCircle className="h-3.5 w-3.5 text-red-300" />
                    : problem ? <AlertTriangle className="h-3.5 w-3.5 text-amber-300" /> : <CheckCircle2 className="h-3.5 w-3.5 text-[#e5e4e2]/30" />}
                <span className="font-medium">{SOCIAL_CHANNEL_LABELS[channel]}</span>
                <span className="text-[#e5e4e2]/45">
                  {publication ? SOCIAL_PUBLICATION_STATUS_LABELS[publication.status] || publication.status : problem ? 'niegotowy' : 'gotowy'}
                </span>
                <span className="flex-1" />
                {publication?.permalink && <a href={publication.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[#d3bb73] hover:underline">Otwórz<ExternalLink className="h-3 w-3" /></a>}
              </div>
              {publication?.status === 'published' && publication.publishedAt && <p className="mt-0.5 text-[#e5e4e2]/40">{dateTimeLabel(publication.publishedAt)}</p>}
              {publication?.error && publication.status !== 'published' && <p className="mt-1 text-red-200/80">{publication.error}</p>}
              {!publication && problem && <p className="mt-1 text-amber-100/80">{problem}</p>}
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
      {meta && !meta.connected && (
        <Link href={settingsHref(detail.company.id)} className="inline-flex items-center gap-1 text-xs text-[#d3bb73] hover:underline">Połącz Meta w ustawieniach marketingu<ExternalLink className="h-3 w-3" /></Link>
      )}
    </section>
  );
}
