'use client';

import { useCallback, useEffect, useState } from 'react';
import { CornerDownRight, ExternalLink, Facebook, Heart, Images, Instagram, Linkedin, MessagesSquare, RefreshCw, Reply } from 'lucide-react';
import { useSnackbar } from '@/contexts/SnackbarContext';
import { useGlobalLoader } from '@/contexts/GlobalLoaderContext';
import { SOCIAL_COMMENT_PLATFORM_LABELS, SOCIAL_LIMITS, SOCIAL_REPLY_AUTHOR, SOCIAL_REPLY_SUCCESS } from '@/lib/social/socialShared';
import { socialGet, socialPost, type SocialComment, type SocialComments as SocialCommentsData, type SocialCommentThread } from './socialApi';
import { cardClass, dateTimeLabel, errorMessage, inputClass, primaryButton, secondaryButton } from './socialUi';

/*
 * Komentarze Facebook, Instagram i LinkedIn opublikowanych postów: skrzynka marki (najnowsze wątki, filtr „bez odpowiedzi”)
 * albo wątki jednego posta. Odpowiedź publikuje serwer jako strona / profil marki (twórca treści, uprawnienia Meta
 * albo LinkedIn do komentarzy). „Odśwież” pobiera komentarze z Meta i LinkedIn; harmonogram robi to co 15 minut.
 */

type Props = { companyId?: string; postId?: string; onOpenPost?: (id: string) => void; onChanged?: () => void };

export default function SocialComments({ companyId, postId, onOpenPost, onChanged }: Props) {
  const { showSnackbar } = useSnackbar();
  const { showLoader, hideLoader } = useGlobalLoader();
  const [data, setData] = useState<SocialCommentsData | null>(null);
  const [filter, setFilter] = useState<'unanswered' | 'all'>(postId ? 'all' : 'unanswered');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await socialGet<SocialCommentsData>('comments', postId ? { post: postId } : { company: companyId, filter }));
      setError('');
    } catch (cause) {
      setError(errorMessage(cause, 'Nie udało się pobrać komentarzy.'));
    }
  }, [companyId, postId, filter]);

  useEffect(() => { void load(); }, [load]);

  const run = async (title: string, action: () => Promise<SocialCommentsData>, success?: string) => {
    showLoader(title, 'Proszę chwilę poczekać...');
    try {
      const result = await action();
      setData(result);
      if (success) showSnackbar(success, 'success');
      onChanged?.();
      return true;
    } catch (cause) {
      showSnackbar(errorMessage(cause, 'Operacja nie powiodła się.'), 'error');
      return false;
    } finally {
      hideLoader();
    }
  };

  const refresh = () => run('Pobieram komentarze', () => socialPost<SocialCommentsData>('commentsRefresh',
    postId ? { postId } : { companyId: data?.companyId || companyId, filter }), 'Komentarze są aktualne');

  const reply = async (thread: SocialCommentThread) => {
    const message = (drafts[thread.id] || '').trim();
    if (!message) return;
    const ok = await run('Publikuję odpowiedź', () => socialPost<SocialCommentsData>('reply', {
      commentId: thread.id, message, scope: postId ? 'post' : 'company', filter,
    }), SOCIAL_REPLY_SUCCESS[thread.platform] || SOCIAL_REPLY_SUCCESS.instagram);
    if (ok) {
      setDrafts((current) => ({ ...current, [thread.id]: '' }));
      setOpen(null);
    }
  };

  const threads = data?.threads || [];

  return (
    <section className={postId ? 'space-y-3' : `${cardClass} space-y-4 p-4`}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium"><MessagesSquare className="h-4 w-4 text-[#d3bb73]" />Komentarze</h3>
        {data && data.unanswered > 0 && <span className="rounded-full bg-[#d3bb73] px-1.5 text-[11px] font-semibold text-[#1c1f33]">{data.unanswered} bez odpowiedzi</span>}
        <span className="flex-1" />
        {!postId && (
          <div className="flex rounded-lg border border-[#d3bb73]/15 p-0.5 text-xs">
            {([['unanswered', 'Bez odpowiedzi'], ['all', 'Wszystkie']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setFilter(key)}
                className={`rounded-md px-2.5 py-1 ${filter === key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60'}`}>{label}</button>
            ))}
          </div>
        )}
        <button type="button" className={secondaryButton} onClick={() => void refresh()}><RefreshCw className="h-4 w-4" />Odśwież</button>
      </div>
      {error && <p className="text-sm text-red-200">{error}</p>}
      {data && !threads.length && (
        <p className="p-4 text-center text-sm text-[#e5e4e2]/45">
          {postId ? 'Brak komentarzy pod tym postem.' : filter === 'unanswered' ? 'Wszystkie komentarze mają odpowiedź.' : 'Brak komentarzy pod opublikowanymi postami.'}
        </p>
      )}
      <div className={postId ? 'space-y-3' : 'grid gap-3 xl:grid-cols-2'}>
        {threads.map((thread) => {
          const canReply = data?.canReply && Boolean(data.replyChannels[thread.platform]);
          return (
            <article key={thread.id} className="space-y-2 rounded-lg border border-[#d3bb73]/10 bg-[#0f1119]/60 p-3">
              {!postId && thread.post && (
                <button type="button" onClick={() => onOpenPost?.(thread.post!.id)} className="flex w-full items-center gap-2 text-left text-xs text-[#e5e4e2]/60 hover:text-[#e5e4e2]">
                  {thread.post.thumbnailUrl ? <img src={thread.post.thumbnailUrl} alt="" className="h-8 w-7 rounded object-cover" /> : <Images className="h-4 w-4" />}
                  <span className="truncate">{thread.post.title}</span>
                </button>
              )}
              <CommentLine comment={thread} />
              {thread.replies.map((item) => (
                <div key={item.id} className="flex gap-1.5 pl-3"><CornerDownRight className="mt-1 h-3.5 w-3.5 shrink-0 text-[#e5e4e2]/30" /><CommentLine comment={item} /></div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {!thread.isOwn && !thread.answeredAt && <span className="rounded-full border border-amber-400/30 bg-amber-400/10 px-2 py-0.5 text-[11px] text-amber-200">Bez odpowiedzi</span>}
                {thread.permalink && <a href={thread.permalink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-[#d3bb73] hover:underline"><ExternalLink className="h-3 w-3" />{SOCIAL_COMMENT_PLATFORM_LABELS[thread.platform] || 'Post'}</a>}
                <span className="flex-1" />
                {canReply && open !== thread.id && <button type="button" className={secondaryButton} onClick={() => setOpen(thread.id)}><Reply className="h-4 w-4" />Odpowiedz</button>}
                {!canReply && data?.canReply && <span className="text-[11px] text-[#e5e4e2]/40">Odpowiedzi wymagają uprawnień {thread.platform === 'linkedin' ? 'LinkedIn' : 'Meta'} do komentarzy (ustawienia marketingu marki).</span>}
              </div>
              {open === thread.id && (
                <div className="space-y-2">
                  <textarea autoFocus rows={3} maxLength={SOCIAL_LIMITS.reply} value={drafts[thread.id] || ''} className={inputClass}
                    placeholder={`Odpowiedź jako ${SOCIAL_REPLY_AUTHOR[thread.platform] || 'marka'}…`}
                    onChange={(event) => setDrafts((current) => ({ ...current, [thread.id]: event.target.value }))} />
                  <div className="flex justify-end gap-2">
                    <button type="button" className={secondaryButton} onClick={() => setOpen(null)}>Anuluj</button>
                    <button type="button" className={primaryButton} disabled={!(drafts[thread.id] || '').trim()} onClick={() => void reply(thread)}><Reply className="h-4 w-4" />Opublikuj odpowiedź</button>
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function CommentLine({ comment }: { comment: SocialComment }) {
  const Icon = comment.platform === 'facebook' ? Facebook : comment.platform === 'linkedin' ? Linkedin : Instagram;
  return (
    <div className="min-w-0 flex-1 text-sm">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Icon className="h-3.5 w-3.5 text-[#d3bb73]/70" />
        <span className={comment.isOwn ? 'font-medium text-[#d3bb73]' : 'font-medium'}>{comment.isOwn ? `${comment.authorName} (marka)` : comment.authorName}</span>
        <span className="text-[#e5e4e2]/40">{dateTimeLabel(comment.commentedAt)}</span>
        {comment.likeCount > 0 && <span className="inline-flex items-center gap-0.5 text-[#e5e4e2]/40"><Heart className="h-3 w-3" />{comment.likeCount}</span>}
        {comment.repliedByName && <span className="text-[#e5e4e2]/40">· z CRM: {comment.repliedByName}</span>}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[#e5e4e2]/85">{comment.message || '—'}</p>
    </div>
  );
}
