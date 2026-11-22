'use client';

import { useState } from 'react';
import { Check, Hash, PenLine, Sparkles, Wand2 } from 'lucide-react';
import { useDialog } from '@/contexts/DialogContext';
import { useSnackbar } from '@/contexts/SnackbarContext';
import {
  SOCIAL_AI_GOALS, SOCIAL_AI_LENGTHS, SOCIAL_AI_REWRITES, SOCIAL_AI_TONES, SOCIAL_HASHTAGS_RECOMMENDED, SOCIAL_LIMITS, normalizeHashtags,
  toggleHashtag, type SocialAiGoal, type SocialAiHashtagGroup, type SocialAiLength, type SocialAiMode, type SocialAiRewrite,
  type SocialAiTone, type SocialChannel,
} from '@/lib/social/socialShared';
import { socialPost, type SocialAiSuggestion, type SocialPostDetail, type SocialSettings } from './socialApi';
import { inputClass, secondaryButton } from './socialUi';

/*
 * Asystent AI w kreatorze posta (CRM; to samo na Macu i w telefonie): „Napisz” — 3 wersje opisu z hashtagami, tytułem
 * i podpisem grafiki (temat, cel, ton, długość, opcjonalnie zdjęcie), „Popraw” — szybkie poprawki bieżącego opisu albo
 * własne polecenie, „Hashtagi” — podpowiedzi w grupach do zaznaczania. Bierze niezapisane wartości z kreatora; wynik
 * nie zmienia posta, dopóki nie wybierzesz propozycji. Wyłączonego asystenta włącza osoba akceptująca (zgoda z datą).
 */

export type AssistantDraft = {
  caption: string;
  hashtags: string;
  headline: string;
  subline: string;
  eventId: string | null;
  assetId: string | null;
  channels: SocialChannel[];
};

type AssistReply = {
  mode: SocialAiMode;
  suggestions: SocialAiSuggestion[];
  hashtagGroups: SocialAiHashtagGroup[];
  usedPhoto: boolean;
  photoNote: string | null;
};

type Tab = 'write' | 'rewrite' | 'hashtags';
type Run = <T>(title: string, action: () => Promise<T>, success?: string, description?: string) => Promise<T | null>;

const chip = (active: boolean) =>
  `rounded-full border px-2.5 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${active
    ? 'border-[#d3bb73]/70 bg-[#d3bb73]/20 text-[#d3bb73]'
    : 'border-[#d3bb73]/15 text-[#e5e4e2]/70 hover:border-[#d3bb73]/40 hover:text-[#e5e4e2]'}`;

function Chips<K extends string>({ options, value, onChange, allowEmpty = true }: {
  options: Record<K, string>; value: K | null; onChange: (value: K | null) => void; allowEmpty?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {(Object.keys(options) as K[]).map((key) => (
        <button key={key} type="button" className={chip(value === key)} onClick={() => onChange(value === key && allowEmpty ? null : key)}>
          {options[key]}
        </button>
      ))}
    </div>
  );
}

export default function SocialAssistant({ detail, draft, run, onUse, onHashtags, onSettings }: {
  detail: SocialPostDetail;
  draft: AssistantDraft;
  run: Run;
  /** Wybrana propozycja: opis i hashtagi, a przy `withGraphic` — także tytuł i podpis grafiki (gdy są). */
  onUse: (suggestion: SocialAiSuggestion, withGraphic: boolean) => void;
  onHashtags: (hashtags: string[]) => void;
  onSettings: (settings: SocialSettings) => void;
}) {
  const { showConfirm } = useDialog();
  const { showSnackbar } = useSnackbar();
  const [tab, setTab] = useState<Tab>('write');
  const [topic, setTopic] = useState('');
  const [goal, setGoal] = useState<SocialAiGoal | null>(detail.event ? 'realization' : null);
  const [tone, setTone] = useState<SocialAiTone | null>('elegant');
  const [length, setLength] = useState<SocialAiLength | null>('medium');
  const [usePhoto, setUsePhoto] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [reply, setReply] = useState<AssistReply | null>(null);

  if (!detail.settings.aiCaptionsEnabled) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-[#d3bb73]/15 p-3 text-xs text-[#e5e4e2]/60">
        <Sparkles className="h-4 w-4 text-[#d3bb73]" />
        <span className="flex-1">Asystent AI pisze opisy, poprawia je i dobiera hashtagi. {detail.access.approve ? 'Jest wyłączony dla tej marki.' : 'Włącza go osoba akceptująca posty („Szablony i AI”).'}</span>
        {detail.access.approve && (
          <button type="button" className={secondaryButton} onClick={async () => {
            const ok = await showConfirm({
              title: 'Włączyć asystenta AI?',
              message: 'Do OpenAI trafią: temat i opis wpisane w kreatorze, rodzaj eventu, miejsce, miesiąc i opis realizacji; nazwa eventu i klient — tylko przy zgodzie klienta na publikację; zdjęcie — tylko gdy zaznaczysz „Uwzględnij zdjęcie” i ma ono zgodę klienta. Zgoda zostanie zapisana z Twoim nazwiskiem i datą; wyłączysz ją w „Szablony i AI”.',
              confirmText: 'Włącz asystenta',
            });
            if (!ok) return;
            const result = await run('Włączam asystenta AI', () => socialPost<{ settings: SocialSettings }>('settings', {
              companyId: detail.post.companyId, aiCaptionsEnabled: true,
            }), 'Asystent AI włączony');
            if (result) onSettings(result.settings);
          }}><Sparkles className="h-4 w-4" />Włącz asystenta AI</button>
        )}
      </div>
    );
  }

  const current = normalizeHashtags(draft.hashtags);
  const base = {
    id: detail.post.id, caption: draft.caption, hashtags: current, headline: draft.headline, subline: draft.subline,
    eventId: draft.eventId, assetId: draft.assetId, channels: draft.channels, usePhoto,
  };

  const ask = async (title: string, body: Record<string, unknown>, description: string) => {
    const result = await run(title, () => socialPost<AssistReply>('assist', { ...base, ...body }), undefined, description);
    if (!result) return;
    setReply(result);
    if (result.photoNote) {
      setUsePhoto(false);
      showSnackbar(result.photoNote, 'warning');
    }
  };

  const tabs: Array<[Tab, string, typeof PenLine]> = [['write', 'Napisz', PenLine], ['rewrite', 'Popraw opis', Wand2], ['hashtags', 'Hashtagi', Hash]];
  const hashtagHint = current.length < SOCIAL_HASHTAGS_RECOMMENDED.min
    ? `Dodaj kilka trafnych (zalecane ${SOCIAL_HASHTAGS_RECOMMENDED.min}–${SOCIAL_HASHTAGS_RECOMMENDED.max}).`
    : current.length > SOCIAL_HASHTAGS_RECOMMENDED.max ? `Najlepiej działa ${SOCIAL_HASHTAGS_RECOMMENDED.min}–${SOCIAL_HASHTAGS_RECOMMENDED.max} trafnych hashtagów.` : 'Liczba hashtagów w sam raz.';

  return (
    <div className="space-y-3 rounded-lg border border-[#d3bb73]/15 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mr-auto text-sm"><Sparkles className="mr-1 inline h-4 w-4 text-[#d3bb73]" />Asystent AI</span>
        {tabs.map(([key, label, Icon]) => (
          <button key={key} type="button" onClick={() => { setTab(key); setReply(null); }}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs ${tab === key ? 'bg-[#d3bb73]/15 text-[#d3bb73]' : 'text-[#e5e4e2]/60 hover:text-[#e5e4e2]'}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === 'write' && (
        <div className="space-y-2">
          <textarea value={topic} onChange={(event) => setTopic(event.target.value)} rows={2} maxLength={500} className={inputClass}
            placeholder="O czym jest post? Np. jubileusz 30 lat marki, scena z ekranem LED, teleturniej dla gości (opcjonalnie)" />
          <div className="space-y-1.5 text-xs text-[#e5e4e2]/50">
            <div>Cel</div><Chips options={SOCIAL_AI_GOALS} value={goal} onChange={setGoal} />
            <div className="pt-1">Ton</div><Chips options={SOCIAL_AI_TONES} value={tone} onChange={setTone} />
            <div className="pt-1">Długość</div><Chips options={SOCIAL_AI_LENGTHS} value={length} onChange={setLength} allowEmpty={false} />
          </div>
          <PhotoToggle value={usePhoto} onChange={setUsePhoto} disabled={!draft.assetId} />
          <button type="button" className={secondaryButton} onClick={() => void ask('Asystent AI pisze', { mode: 'write', topic, goal, tone, length },
            'Trzy wersje opisu z hashtagami, tytułem i podpisem grafiki…')}>
            <Sparkles className="h-4 w-4" />Napisz 3 wersje
          </button>
        </div>
      )}

      {tab === 'rewrite' && (
        <div className="space-y-2">
          {!draft.caption.trim() && <p className="text-xs text-amber-200/80">Najpierw wpisz opis (albo skorzystaj z „Napisz”) — asystent go poprawi.</p>}
          <div className="flex flex-wrap gap-1.5">
            {(Object.keys(SOCIAL_AI_REWRITES) as SocialAiRewrite[]).map((key) => (
              <button key={key} type="button" className={chip(false)} disabled={!draft.caption.trim()}
                onClick={() => void ask('Asystent AI poprawia opis', { mode: 'rewrite', rewrite: key }, `${SOCIAL_AI_REWRITES[key]}…`)}>
                {SOCIAL_AI_REWRITES[key]}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <input value={instruction} onChange={(event) => setInstruction(event.target.value)} maxLength={300} className={inputClass}
              placeholder="Własne polecenie, np. „podkreśl, że cała technika była nasza”" />
            <button type="button" className={secondaryButton} disabled={!draft.caption.trim() || !instruction.trim()}
              onClick={() => void ask('Asystent AI poprawia opis', { mode: 'rewrite', instruction }, 'Poprawiam opis według polecenia…')}>
              <Wand2 className="h-4 w-4" />Popraw
            </button>
          </div>
        </div>
      )}

      {tab === 'hashtags' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={secondaryButton}
              onClick={() => void ask('Asystent AI dobiera hashtagi', { mode: 'hashtags', topic }, 'Marka, branża, lokalne i temat posta…')}>
              <Hash className="h-4 w-4" />{reply?.mode === 'hashtags' ? 'Inne propozycje' : 'Dobierz hashtagi'}
            </button>
            <PhotoToggle value={usePhoto} onChange={setUsePhoto} disabled={!draft.assetId} />
          </div>
          <p className={`text-xs ${current.length > SOCIAL_LIMITS.hashtags ? 'text-red-300' : 'text-[#e5e4e2]/45'}`}>
            W poście: {current.length}/{SOCIAL_LIMITS.hashtags}. {hashtagHint} Kliknij hashtag, żeby go dodać albo usunąć.
          </p>
          {reply?.mode === 'hashtags' && reply.hashtagGroups.map((group) => (
            <div key={group.key} className="space-y-1">
              <div className="text-xs text-[#e5e4e2]/50">{group.label}</div>
              <div className="flex flex-wrap gap-1.5">
                {group.tags.map((tag) => {
                  const selected = current.some((item) => item.toLocaleLowerCase('pl') === tag.toLocaleLowerCase('pl'));
                  return (
                    <button key={tag} type="button" className={chip(selected)} onClick={() => onHashtags(toggleHashtag(current, tag))}>
                      {selected && <Check className="mr-0.5 inline h-3 w-3" />}{tag}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {reply && reply.mode !== 'hashtags' && reply.suggestions.map((suggestion, index) => (
        <div key={index} className="rounded-lg bg-[#0f1119]/70 p-2 text-xs">
          {(suggestion.headline || suggestion.subline) && (
            <div className="mb-1 text-[#d3bb73]">Na grafice: {suggestion.headline}{suggestion.subline ? ` · ${suggestion.subline}` : ''}</div>
          )}
          <p className="whitespace-pre-wrap text-[#e5e4e2]/85">{suggestion.caption}</p>
          {suggestion.hashtags.length > 0 && <p className="mt-1 text-[#e5e4e2]/45">{suggestion.hashtags.join(' ')}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={secondaryButton} onClick={() => onUse(suggestion, false)}>Użyj opisu i hashtagów</button>
            {(suggestion.headline || suggestion.subline) && (
              <button type="button" className={secondaryButton} onClick={() => onUse(suggestion, true)}>Użyj z tytułem na grafice</button>
            )}
          </div>
        </div>
      ))}

      <p className="text-[11px] text-[#e5e4e2]/40">
        Do AI trafia temat i opis z kreatora, rodzaj eventu, miejsce, miesiąc i opis realizacji; nazwa eventu i klient — tylko przy
        zgodzie klienta; zdjęcie — tylko gdy zaznaczysz i ma zgodę klienta na publikację. Propozycje nie zmieniają posta, dopóki ich nie użyjesz.
        {reply?.usedPhoto ? ' Ta odpowiedź uwzględnia zdjęcie.' : ''}
      </p>
    </div>
  );
}

function PhotoToggle({ value, onChange, disabled }: { value: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className={`flex items-center gap-2 text-xs ${disabled ? 'text-[#e5e4e2]/30' : 'text-[#e5e4e2]/70'}`}
      title={disabled ? 'Wybierz zdjęcie posta' : 'AI opisze to, co widać na zdjęciu (miniatura; tylko zdjęcie ze zgodą klienta)'}>
      <input type="checkbox" checked={value && !disabled} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      Uwzględnij zdjęcie
    </label>
  );
}
