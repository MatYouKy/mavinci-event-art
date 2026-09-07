'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  HeartHandshake,
  Edit3,
  FileText,
  Gamepad2,
  Loader2,
  MapPin,
  Music2,
  Printer,
  Save,
  Sparkles,
  X,
} from 'lucide-react';
import { supabase } from '@/lib/supabase/browser';
import { useSnackbar } from '@/contexts/SnackbarContext';
import WeddingPeopleSchedulePanel from './WeddingPeopleSchedulePanel';
import FullScreenLoader from '@/components/UI/Loader/CustomModalLoader';
import { isWeddingReceptionGame } from '@/lib/weddingAttractions';
import WeddingThanksEditor from '@/components/wedding/WeddingThanksEditor';
import WeddingThanksSummary from '@/components/wedding/WeddingThanksSummary';
import { readThanksEntries, WELCOME_GLASS_OPTIONS, type ThanksCardPerson } from '@/lib/weddingCardDetails';

type WeddingCard = {
  id: string;
  status: 'not_started' | 'in_progress' | 'submitted' | 'approved' | 'changes_requested';
  progress: number;
  submitted_at: string | null;
  updated_at: string;
};

type Answer = {
  id: string;
  section: string;
  field_key: string;
  value: unknown;
};

type Track = {
  id: string;
  list_type: 'play' | 'do_not_play' | 'special';
  title: string;
  artist: string | null;
  url: string | null;
  notes: string | null;
};

type Attraction = {
  id: string;
  attraction_key: string;
  attraction_name: string;
  choice: 'undecided' | 'interested' | 'selected' | 'rejected';
  notes: string | null;
};

type FamiliadaMaterial = {
  gameId: string;
  gameName: string;
  pdfPath: string | null;
  pdfFileName: string | null;
  generatedAt: string | null;
};

type WeddingCardPdfMaterial = {
  filePath: string;
  fileName: string;
  generatedAt: string | null;
};

const SECTIONS = [
  {
    id: 'ceremony',
    title: 'Ceremonia',
    icon: HeartHandshake,
    fields: [
      ['ceremony_type', 'Rodzaj ceremonii'],
      ['ceremony_time', 'Godzina ślubu'],
      ['church_address', 'Adres kościoła'],
      ['civil_ceremony_setting', 'Miejsce ceremonii cywilnej'],
      ['ceremony_address', 'Adres ceremonii'],
      ['church_wishes_enabled', 'Życzenia pod kościołem'],
    ],
  },
  {
    id: 'technical',
    title: 'Przebieg i logistyka',
    icon: Clock3,
    fields: [
      ['guest_count', 'Liczba gości'],
      ['ceremony', 'Dodatkowe informacje o ceremonii'],
      ['venue_arrival_time', 'Przyjazd na salę'],
      ['venue_access', 'Dostęp i schody'],
      ['hot_vodka', 'Gorzka wódka'],
      ['first_dance', 'Pierwszy taniec'],
      ['first_dance_title', 'Pierwszy taniec — tytuł utworu'],
      ['first_dance_artist', 'Pierwszy taniec — wykonawca / wersja'],
      ['first_dance_url', 'Pierwszy taniec — link do utworu'],
      ['first_dance_duration', 'Pierwszy taniec — czas trwania'],
      ['first_dance_special_moments', 'Pierwszy taniec — punkty specjalne'],
      ['first_dance_file_url', 'Pierwszy taniec — własny plik audio'],
      ['special_toasts', 'Specjalne toasty'],
    ],
  },
  {
    id: 'welcome',
    title: 'Przyjazd i powitanie',
    icon: MapPin,
    fields: [
      ['couple_wait_before_welcome', 'Para czeka przed wjazdem na główne powitanie'],
      ['bread_and_salt_enabled', 'Powitanie chlebem i solą'],
      ['welcome_glass_throwing', 'Czy i kiedy rzucacie kieliszkami?'],
      ['welcome_sequence', 'Kolejność powitania'],
    ],
  },
  {
    id: 'cake',
    title: 'Tort weselny',
    icon: Sparkles,
    fields: [
      ['cake_time', 'Godzina podania'],
      ['cake_presentation', 'Aranżacja podania'],
      ['cake_proposal_url', 'Wybrana propozycja tortu'],
      ['cake_location', 'Miejsce podania'],
    ],
  },
  {
    id: 'parents_thanks',
    title: 'Podziękowania dla bliskich',
    icon: HeartHandshake,
    fields: [
      ['parents_thanks_enabled', 'Czy planowane'],
      ['parents_thanks_recipients', 'Komu dziękujemy'],
      ['parents_thanks_entries', 'Kolejność wyjść'],
      ['parents_thanks_plan', 'Forma podziękowań'],
      ['parents_thanks_proposal_url', 'Wybrana propozycja podziękowań'],
    ],
  },
  {
    id: 'oczepiny',
    title: 'Oczepiny',
    icon: CheckCircle2,
    fields: [
      ['oczepiny_enabled', 'Czy planowane'],
      ['oczepiny_notes', 'Uwagi'],
    ],
  },
  {
    id: 'music',
    title: 'Playlisty',
    icon: Music2,
    fields: [
      ['spotify_playlist_url', 'Playlista Spotify'],
      ['youtube_playlist_url', 'Playlista YouTube'],
    ],
  },
  {
    id: 'notes',
    title: 'Dodatkowe informacje',
    icon: Edit3,
    fields: [['general_notes', 'Uwagi dla zespołu']],
  },
] as const;

const ALL_FIELDS = SECTIONS.flatMap((section) =>
  section.fields.map(([key, label]) => ({ key, label, section: section.id })),
);

const CARD_NAV_ITEMS = [
  { id: 'bride_side', label: 'Strona Panny Młodej' },
  { id: 'groom_side', label: 'Strona Pana Młodego' },
  { id: 'ceremony', label: 'Ceremonia' },
  { id: 'technical', label: 'Informacje ogólne' },
  { id: 'welcome', label: 'Przyjazd i powitanie' },
  { id: 'schedule', label: 'Harmonogram i posiłki' },
  { id: 'cake', label: 'Tort weselny' },
  { id: 'parents_thanks', label: 'Podziękowania' },
  { id: 'oczepiny', label: 'Oczepiny i zabawy' },
  { id: 'familiada', label: 'Familiada' },
  { id: 'attractions', label: 'Atrakcje i dodatki' },
  { id: 'music', label: 'Muzyka i playlisty' },
  { id: 'notes', label: 'Dodatkowe informacje' },
  { id: 'shared_people', label: 'Pozostałe osoby organizacyjne' },
] as const;

type CardCategoryId = (typeof CARD_NAV_ITEMS)[number]['id'];
const BOOLEAN_FIELDS = new Set([
  'church_wishes_enabled',
  'couple_wait_before_welcome',
  'bread_and_salt_enabled',
  'hot_vodka',
  'parents_thanks_enabled',
  'oczepiny_enabled',
]);
const SHORT_FIELDS = new Set([
  'guest_count',
  'ceremony_time',
  'church_address',
  'ceremony_address',
  'venue_arrival_time',
  'cake_time',
  'first_dance_title',
  'first_dance_artist',
  'first_dance_url',
  'first_dance_duration',
  'first_dance_file_url',
]);
const LINK_FIELDS = new Set([
  'cake_proposal_url',
  'parents_thanks_proposal_url',
  'first_dance_url',
  'first_dance_file_url',
  'spotify_playlist_url',
  'youtube_playlist_url',
]);

const SELECT_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  welcome_glass_throwing: [...WELCOME_GLASS_OPTIONS],
  ceremony_type: [
    { value: 'church', label: 'Kościelna' },
    { value: 'civil', label: 'Cywilna' },
    { value: 'humanist', label: 'Humanistyczna' },
  ],
  civil_ceremony_setting: [
    { value: 'registry_office', label: 'W urzędzie' },
    { value: 'outdoor', label: 'W plenerze' },
  ],
  welcome_throwing: [
    { value: 'none', label: 'Bez rzucania' },
    { value: 'rice', label: 'Ryż' },
    { value: 'petals', label: 'Płatki kwiatów' },
    { value: 'confetti', label: 'Konfetti' },
    { value: 'coins', label: 'Monety' },
    { value: 'other', label: 'Inne — opisane w kolejności powitania' },
  ],
  welcome_glasses: [
    { value: 'vodka', label: 'Kieliszki z wódką' },
    { value: 'champagne', label: 'Kieliszki do szampana' },
    { value: 'none', label: 'Bez kieliszków' },
  ],
};

const isWeddingFieldVisible = (key: string, values: Record<string, string | boolean>) => {
  const ceremonyType = values.ceremony_type;
  if (['church_address', 'church_wishes_enabled'].includes(key)) return ceremonyType === 'church';
  if (key === 'civil_ceremony_setting') return ceremonyType === 'civil';
  if (key === 'ceremony_address') return ceremonyType === 'civil' || ceremonyType === 'humanist';
  if (key === 'parents_thanks_recipients' && readThanksEntries(values.parents_thanks_entries).length) return false;
  if (['parents_thanks_recipients', 'parents_thanks_plan', 'parents_thanks_entries', 'parents_thanks_proposal_url'].includes(key)) {
    return values.parents_thanks_enabled === true;
  }
  return true;
};

const isExplicitlyFalse = (value: unknown) =>
  value === false || value === 'false' || value === 0 || value === '0';

const STATUS_LABELS: Record<WeddingCard['status'], string> = {
  not_started: 'Nie rozpoczęto',
  in_progress: 'W trakcie uzupełniania',
  submitted: 'Przesłana do weryfikacji',
  approved: 'Zatwierdzona',
  changes_requested: 'Wymaga uzupełnienia',
};

const formatValue = (value: unknown) => {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Tak' : 'Nie';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'object') {
    const entries = Object.values(value as Record<string, unknown>).filter(Boolean);
    return entries.length ? entries.join(' · ') : '—';
  }
  return String(value);
};

const safeHttpUrl = (value: unknown) => {
  const candidate = String(value || '').trim();
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
};

export default function EventWeddingCardTab({
  eventId,
  canManage,
}: {
  eventId: string;
  canManage: boolean;
}) {
  const { showSnackbar } = useSnackbar();
  const [card, setCard] = useState<WeddingCard | null>(null);
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [thanksCardPeople, setThanksCardPeople] = useState<ThanksCardPerson[]>([]);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Record<string, string | boolean>>({});
  const [activeCategory, setActiveCategory] = useState<CardCategoryId>('bride_side');
  const [familiadaMaterial, setFamiliadaMaterial] = useState<FamiliadaMaterial | null>(null);
  const [openingFamiliadaPdf, setOpeningFamiliadaPdf] = useState(false);
  const [weddingCardPdf, setWeddingCardPdf] = useState<WeddingCardPdfMaterial | null>(null);
  const [generatingWeddingCardPdf, setGeneratingWeddingCardPdf] = useState(false);
  const [openingWeddingCardPdf, setOpeningWeddingCardPdf] = useState(false);

  const loadCard = useCallback(async () => {
    const [cardResult, projectResult, generatedPdfResult] = await Promise.all([
      supabase
        .from('wedding_cards')
        .select('id,status,progress,submitted_at,updated_at')
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase
        .from('mavinci_event_projects')
        .select('draft_manifest')
        .eq('event_id', eventId)
        .maybeSingle(),
      supabase
        .from('event_files')
        .select('name,file_path,updated_at')
        .eq('event_id', eventId)
        .like('file_path', `${eventId}/documents/wedding-card/%`)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    const { data: cardData, error: cardError } = cardResult;
    const familiada = (projectResult.data?.draft_manifest as { familiada?: Partial<FamiliadaMaterial> } | null)?.familiada;
    setFamiliadaMaterial(familiada?.gameId ? {
      gameId: familiada.gameId,
      gameName: familiada.gameName || 'Familiada',
      pdfPath: familiada.pdfPath || null,
      pdfFileName: familiada.pdfFileName || null,
      generatedAt: familiada.generatedAt || null,
    } : null);
    setWeddingCardPdf(
      generatedPdfResult.data?.file_path
        ? {
            filePath: generatedPdfResult.data.file_path,
            fileName: generatedPdfResult.data.name,
            generatedAt: generatedPdfResult.data.updated_at || null,
          }
        : null,
    );

    if (cardError) throw cardError;
    if (!cardData) {
      setCard(null);
      setAnswers([]);
      setTracks([]);
      setAttractions([]);
      return;
    }

    const [answersResult, tracksResult, attractionsResult, peopleResult] = await Promise.all([
      supabase
        .from('wedding_card_answers')
        .select('id,section,field_key,value')
        .eq('wedding_card_id', cardData.id),
      supabase
        .from('wedding_music_tracks')
        .select('id,list_type,title,artist,url,notes')
        .eq('wedding_card_id', cardData.id)
        .order('sort_order'),
      supabase
        .from('wedding_attraction_choices')
        .select('id,attraction_key,attraction_name,choice,notes')
        .eq('wedding_card_id', cardData.id)
        .order('attraction_name'),
      supabase.from('wedding_card_people').select('first_name,last_name,side,role').eq('wedding_card_id', cardData.id).order('sort_order'),
    ]);

    if (answersResult.error) throw answersResult.error;
    if (tracksResult.error) throw tracksResult.error;
    if (attractionsResult.error) throw attractionsResult.error;
    if (peopleResult.error) throw peopleResult.error;

    setCard(cardData as WeddingCard);
    setAnswers((answersResult.data || []) as Answer[]);
    setTracks((tracksResult.data || []) as Track[]);
    setAttractions((attractionsResult.data || []) as Attraction[]);
    setThanksCardPeople((peopleResult.data || []).map((person) => ({ ...person, last_name: person.last_name || '' })));
  }, [eventId]);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    loadCard()
      .catch((error) => {
        console.error('Error loading wedding card:', error);
        if (mounted) showSnackbar('Nie udało się pobrać karty weselnej', 'error');
      })
      .finally(() => mounted && setLoading(false));

    const channel = supabase
      .channel(`wedding-card-${eventId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'wedding_cards', filter: `event_id=eq.${eventId}` },
        () => void loadCard(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mavinci_event_projects', filter: `event_id=eq.${eventId}` },
        () => void loadCard(),
      )
      .subscribe();

    return () => {
      mounted = false;
      void supabase.removeChannel(channel);
    };
  }, [eventId, loadCard, showSnackbar]);

  useEffect(() => {
    if (!card?.id) return;
    const childTables = [
      'wedding_card_people',
      'wedding_card_answers',
      'wedding_music_tracks',
      'wedding_attraction_choices',
    ];
    const channel = supabase.channel(`wedding-card-content-${card.id}`);
    childTables.forEach((table) => {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table, filter: `wedding_card_id=eq.${card.id}` },
        () => void loadCard(),
      );
    });
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [card?.id, loadCard]);

  const answersByKey = useMemo(
    () => new Map(answers.map((answer) => [answer.field_key, answer.value])),
    [answers],
  );

  const weddingGameChoices = useMemo(
    () => attractions.filter((item) => isWeddingReceptionGame(item) && item.choice === 'selected'),
    [attractions],
  );

  const additionalAttractions = useMemo(
    () => attractions.filter((item) => !isWeddingReceptionGame(item)),
    [attractions],
  );

  const noParentsThanks = isExplicitlyFalse(answersByKey.get('parents_thanks_enabled'));

  const visibleCardNavItems = useMemo(
    () => CARD_NAV_ITEMS.filter((item) => item.id !== 'familiada' || Boolean(familiadaMaterial)),
    [familiadaMaterial],
  );

  useEffect(() => {
    if (activeCategory === 'familiada' && !familiadaMaterial) setActiveCategory('oczepiny');
  }, [activeCategory, familiadaMaterial]);

  const openFamiliadaPdf = async () => {
    if (!familiadaMaterial?.pdfPath || openingFamiliadaPdf) return;
    const popup = window.open('', '_blank');
    setOpeningFamiliadaPdf(true);
    const { data, error } = await supabase.storage
      .from('event-files')
      .createSignedUrl(familiadaMaterial.pdfPath, 60 * 60);
    setOpeningFamiliadaPdf(false);
    if (error || !data?.signedUrl) {
      popup?.close();
      showSnackbar(error?.message || 'Nie udało się otworzyć materiału Familiady.', 'error');
      return;
    }
    if (popup) popup.location.href = data.signedUrl;
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const openWeddingCardPdf = async (material = weddingCardPdf) => {
    if (!material?.filePath || openingWeddingCardPdf) return;
    const popup = window.open('', '_blank');
    setOpeningWeddingCardPdf(true);
    const { data, error } = await supabase.storage
      .from('event-files')
      .createSignedUrl(material.filePath, 60 * 60);
    setOpeningWeddingCardPdf(false);
    if (error || !data?.signedUrl) {
      popup?.close();
      showSnackbar(error?.message || 'Nie udało się otworzyć Karty Weselnej.', 'error');
      return;
    }
    if (popup) popup.location.href = data.signedUrl;
    else window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const generateWeddingCardPdf = async () => {
    if (generatingWeddingCardPdf) return;
    if (editing) {
      showSnackbar('Zapisz zmiany przed wygenerowaniem Karty Weselnej.', 'warning');
      return;
    }

    const popup = window.open('', '_blank');
    setGeneratingWeddingCardPdf(true);
    try {
      const response = await fetch('/bridge/events/wedding-card-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(result?.error || 'Nie udało się wygenerować Karty Weselnej.');
      }

      const material: WeddingCardPdfMaterial = {
        filePath: result.storagePath,
        fileName: result.fileName,
        generatedAt: result.generatedAt,
      };
      setWeddingCardPdf(material);
      showSnackbar('Karta Weselna PDF została wygenerowana.', 'success');

      if (result.signedUrl && popup) popup.location.href = result.signedUrl;
      else {
        popup?.close();
        await openWeddingCardPdf(material);
      }
    } catch (error) {
      popup?.close();
      console.error('Error generating wedding card PDF:', error);
      showSnackbar(
        error instanceof Error ? error.message : 'Nie udało się wygenerować Karty Weselnej.',
        'error',
      );
    } finally {
      setGeneratingWeddingCardPdf(false);
    }
  };

  const beginEditing = () => {
    setDraft(
      Object.fromEntries(
        answers.map((answer) => [
          answer.field_key,
          answer.field_key === 'parents_thanks_entries' ? JSON.stringify(readThanksEntries(answer.value)) : typeof answer.value === 'boolean' ? answer.value : String(answer.value ?? ''),
        ]),
      ),
    );
    if (['bride_side', 'groom_side', 'shared_people', 'schedule', 'attractions', 'familiada'].includes(activeCategory)) {
      setActiveCategory('ceremony');
    }
    setEditing(true);
  };

  const saveCard = async () => {
    if (!card || saving) return;
    setSaving(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const employeeId = sessionData.session?.user.id ?? null;
    const rows = ALL_FIELDS.map((field) => ({
      wedding_card_id: card.id,
      section: field.section,
      field_key: field.key,
      value: field.key === 'parents_thanks_entries' ? readThanksEntries(draft[field.key]) : draft[field.key] ?? '',
      source: 'crm',
      updated_by: employeeId,
    }));

    const { error: answersError } = await supabase
      .from('wedding_card_answers')
      .upsert(rows, { onConflict: 'wedding_card_id,field_key' });

    if (answersError) {
      setSaving(false);
      console.error('Error saving wedding card answers:', answersError);
      showSnackbar('Nie udało się zapisać Karty Weselnej', 'error');
      return;
    }

    const applicableFields = ALL_FIELDS.filter((field) => isWeddingFieldVisible(field.key, draft));
    const filled = applicableFields.filter((field) => {
      const value = draft[field.key];
      return value !== '' && value !== null && value !== undefined;
    }).length;
    const completedSectionCount = new Set(
      answers
        .filter((answer) => answer.field_key.startsWith('section_status_') && ['complete', 'skipped'].includes(String(answer.value || '')))
        .map((answer) => answer.field_key.slice('section_status_'.length)),
    ).size;
    const progress = completedSectionCount > 0
      ? Math.round((completedSectionCount / 12) * 100)
      : Math.round((filled / applicableFields.length) * 100);
    const { error: cardError } = await supabase
      .from('wedding_cards')
      .update({
        progress,
        status: card.status === 'not_started' ? 'in_progress' : card.status,
      })
      .eq('id', card.id);

    setSaving(false);
    if (cardError) {
      console.error('Error updating wedding card:', cardError);
      showSnackbar('Odpowiedzi zapisano, ale nie udało się zaktualizować postępu', 'error');
      return;
    }

    setEditing(false);
    await loadCard();
    showSnackbar('Karta Weselna została zapisana', 'success');
  };

  const createCard = async () => {
    if (creating) return;
    setCreating(true);
    const { error } = await supabase
      .from('wedding_cards')
      .upsert({ event_id: eventId, status: 'not_started', progress: 0 }, { onConflict: 'event_id' });
    setCreating(false);
    if (error) {
      console.error('Error creating wedding card:', error);
      showSnackbar('Nie udało się utworzyć karty weselnej', 'error');
      return;
    }
    await loadCard();
    setDraft({});
    setActiveCategory('ceremony');
    setEditing(true);
    showSnackbar('Karta weselna została utworzona', 'success');
  };

  if (loading) {
    return (
      <div className="flex min-h-64 items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#d3bb73]" />
      </div>
    );
  }

  if (!card) {
    return (
      <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1e2035]/70 p-8 text-center">
        <HeartHandshake className="mx-auto mb-4 h-10 w-10 text-[#d3bb73]" />
        <h2 className="text-xl font-semibold text-white">Karta weselna nie została jeszcze rozpoczęta</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm text-[#e5e4e2]/65">
          To tutaj pojawią się ustalenia uzupełniane przez Parę Młodą w Event Rulers.
          Para nie otrzymuje dostępu ani konta do CRM.
        </p>
        {canManage && (
          <button
            type="button"
            disabled={creating}
            onClick={createCard}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#d3bb73] px-5 py-2.5 font-medium text-[#111320] disabled:opacity-60"
          >
            {creating && <Loader2 className="h-4 w-4 animate-spin" />}
            Utwórz i edytuj kartę
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <FullScreenLoader
        show={generatingWeddingCardPdf}
        title="Generowanie Karty Weselnej"
        description="Zbieramy ustalenia, osoby, harmonogram, atrakcje i muzykę..."
      />
      <div className="rounded-2xl border border-[#d3bb73]/20 bg-[#1e2035]/70 p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <HeartHandshake className="h-5 w-5 text-[#d3bb73]" />
              <h2 className="text-lg font-semibold text-white">Karta weselna</h2>
            </div>
            <p className="mt-1 text-sm text-[#e5e4e2]/60">{STATUS_LABELS[card.status]}</p>
          </div>
          <div className="flex flex-col gap-3 sm:items-end">
            <div className="min-w-48">
              <div className="mb-1.5 flex justify-between text-xs text-[#e5e4e2]/65">
                <span>Uzupełnienie</span>
                <span>{card.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-[#d3bb73] transition-[width]"
                  style={{ width: `${card.progress}%` }}
                />
              </div>
            </div>
            {canManage && (
              <div className="flex flex-wrap justify-end gap-2">
                {editing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-[#e5e4e2]/65 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" /> Anuluj
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveCard()}
                      disabled={saving}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#111320] disabled:opacity-50"
                    >
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                      Zapisz
                    </button>
                  </>
                ) : (
                  <>
                    {weddingCardPdf && (
                      <button
                        type="button"
                        onClick={() => void openWeddingCardPdf()}
                        disabled={openingWeddingCardPdf}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2 text-xs text-[#e5e4e2]/70 hover:bg-white/[0.05] disabled:opacity-50"
                      >
                        {openingWeddingCardPdf ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        Otwórz PDF
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void generateWeddingCardPdf()}
                      disabled={generatingWeddingCardPdf}
                      className="inline-flex items-center gap-2 rounded-lg bg-[#d3bb73] px-3 py-2 text-xs font-medium text-[#111320] hover:bg-[#d3bb73]/90 disabled:opacity-50"
                    >
                      {generatingWeddingCardPdf ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Printer className="h-4 w-4" />
                      )}
                      {weddingCardPdf ? 'Aktualizuj PDF' : 'Generuj PDF'}
                    </button>
                    <button
                      type="button"
                      onClick={beginEditing}
                      className="inline-flex items-center gap-2 rounded-lg border border-[#d3bb73]/30 px-3 py-2 text-xs text-[#d3bb73] hover:bg-[#d3bb73]/10"
                    >
                      <Edit3 className="h-4 w-4" /> Edytuj kartę
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-white/10 bg-[#171927] p-2 lg:block lg:space-y-1 lg:overflow-visible" aria-label="Sekcje Karty Weselnej">
            {visibleCardNavItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveCategory(item.id)}
                className={`shrink-0 whitespace-nowrap rounded-xl px-3 py-2.5 text-left text-sm transition lg:block lg:w-full ${
                  activeCategory === item.id
                    ? 'bg-[#d3bb73] font-medium text-[#111320] shadow-sm'
                    : 'text-[#e5e4e2]/60 hover:bg-white/[0.05] hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
        {(['bride_side', 'groom_side', 'shared_people', 'schedule'] as CardCategoryId[]).includes(activeCategory) && (
          <WeddingPeopleSchedulePanel
            cardId={card.id}
            canManage={canManage}
            view={activeCategory === 'bride_side' ? 'bride' : activeCategory === 'groom_side' ? 'groom' : activeCategory === 'shared_people' ? 'shared' : 'schedule'}
          />
        )}
        {SECTIONS.filter((section) => section.id === activeCategory).map((section) => {
          const Icon = section.icon;
          return (
            <section key={section.id} className="rounded-2xl border border-white/10 bg-[#171927] p-5">
              <h3 className="mb-4 flex items-center gap-2 font-semibold text-white">
                <Icon className="h-4 w-4 text-[#d3bb73]" />
                {section.title}
              </h3>
              {section.id === 'welcome' && (
                <div className="mb-4 rounded-xl border border-[#d3bb73]/20 bg-[#d3bb73]/[0.06] p-3 text-xs leading-5 text-[#e5e4e2]/70">
                  Rekomendacja: po przyjeździe Para Młoda czeka przed głównym wjazdem, aż goście wysiądą,
                  odłożą rzeczy i ustawią się do powitania. Dzięki temu nie wjeżdża na puste wejście.
                </div>
              )}
              {section.id === 'parents_thanks' && !editing && noParentsThanks ? (
                <div className="rounded-xl border-2 border-red-500/50 bg-red-500/10 px-4 py-5">
                  <p className="text-lg font-extrabold text-red-400">Bez podziękowań dla bliskich</p>
                </div>
              ) : <dl className="space-y-3">
                {section.fields.filter(([key]) => isWeddingFieldVisible(key, editing ? draft : Object.fromEntries(answers.map((answer) => [answer.field_key, answer.field_key === 'parents_thanks_entries' ? JSON.stringify(readThanksEntries(answer.value)) : typeof answer.value === 'boolean' ? answer.value : String(answer.value ?? '')])))).map(([key, label]) => (
                  <div key={key} className={`grid gap-1 border-b border-white/5 pb-3 ${key === 'parents_thanks_entries' ? '' : 'sm:grid-cols-[150px_1fr]'}`}>
                    <dt className="text-xs text-[#e5e4e2]/50">{label}</dt>
                    <dd className="whitespace-pre-wrap text-sm text-[#e5e4e2]">
                      {key === 'parents_thanks_entries' ? (
                        editing
                          ? <WeddingThanksEditor entries={readThanksEntries(draft.parents_thanks_entries)} people={thanksCardPeople} onChange={(entries) => setDraft((current) => ({ ...current, parents_thanks_entries: JSON.stringify(entries) }))} />
                          : <WeddingThanksSummary value={answersByKey.get(key)} />
                      ) : editing ? (
                        SELECT_OPTIONS[key] ? (
                          <select
                            value={String(draft[key] ?? '')}
                            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                            className="w-full rounded-lg border border-white/10 bg-[#111320] px-3 py-2 text-sm outline-none focus:border-[#d3bb73]/60"
                          >
                            <option value="">Wybierz…</option>
                            {SELECT_OPTIONS[key].map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        ) : BOOLEAN_FIELDS.has(key) ? (
                          <div className="flex gap-2">
                            {[true, false].map((value) => (
                              <button
                                key={String(value)}
                                type="button"
                                onClick={() => setDraft((current) => ({ ...current, [key]: value }))}
                                className={`rounded-lg border px-3 py-2 text-xs ${
                                  draft[key] === value
                                    ? 'border-[#d3bb73] bg-[#d3bb73]/10 text-[#d3bb73]'
                                    : 'border-white/10 text-[#e5e4e2]/55'
                                }`}
                              >
                                {value ? 'Tak' : 'Nie'}
                              </button>
                            ))}
                          </div>
                        ) : SHORT_FIELDS.has(key) ? (
                          <input
                            type={key === 'guest_count' ? 'number' : key.endsWith('_time') ? 'time' : 'text'}
                            min={key === 'guest_count' ? 0 : undefined}
                            value={String(draft[key] ?? '')}
                            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                            className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-[#d3bb73]/60"
                          />
                        ) : (
                          <textarea
                            rows={3}
                            value={String(draft[key] ?? '')}
                            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
                            className="w-full resize-y rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm outline-none focus:border-[#d3bb73]/60"
                          />
                        )
                      ) : LINK_FIELDS.has(key) && safeHttpUrl(answersByKey.get(key)) ? (
                        <a href={safeHttpUrl(answersByKey.get(key)) || undefined} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 break-all text-[#d3bb73] hover:underline">
                          {key === 'first_dance_file_url' ? 'Otwórz przesłany plik audio' : formatValue(answersByKey.get(key))}
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      ) : (
                        SELECT_OPTIONS[key]?.find((option) => option.value === answersByKey.get(key))?.label
                          || formatValue(answersByKey.get(key))
                      )}
                    </dd>
                  </div>
                ))}
              </dl>}
            </section>
          );
        })}

        {activeCategory === 'oczepiny' && weddingGameChoices.length > 0 && <section className="rounded-2xl border border-white/10 bg-[#171927] p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-white">
            <Gamepad2 className="h-4 w-4 text-[#d3bb73]" />
            Wybrane zabawy oczepinowe
          </h3>
          <div className="space-y-2">
            {weddingGameChoices.map((attraction) => (
              <div key={attraction.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                <span className="text-sm font-semibold text-[#e5e4e2]">{attraction.attraction_name}</span>
                {attraction.notes && <p className="mt-1 text-xs text-[#e5e4e2]/45">{attraction.notes}</p>}
              </div>
            ))}
          </div>
        </section>}

        {activeCategory === 'attractions' && <section className="rounded-2xl border border-white/10 bg-[#171927] p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-white">
            <Sparkles className="h-4 w-4 text-[#d3bb73]" />
            Atrakcje i dodatki
          </h3>
          {additionalAttractions.length ? (
            <div className="space-y-2">
              {additionalAttractions.map((attraction) => (
                <div key={attraction.id} className="flex items-center justify-between gap-3 rounded-lg bg-white/[0.03] px-3 py-2">
                  <span className="text-sm text-[#e5e4e2]">{attraction.attraction_name}</span>
                  <span className="text-xs text-[#d3bb73]">
                    {attraction.choice === 'selected'
                      ? 'Wybrano'
                      : attraction.choice === 'interested'
                        ? 'Rozważane'
                        : attraction.choice === 'rejected'
                          ? 'Odrzucono'
                          : 'Bez decyzji'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-[#e5e4e2]/50">Brak wybranych atrakcji.</p>
          )}
        </section>}

        {activeCategory === 'familiada' && familiadaMaterial && <section className="rounded-2xl border border-white/10 bg-[#171927] p-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="rounded-xl bg-[#d3bb73]/10 p-3 text-[#d3bb73]"><Gamepad2 className="h-5 w-5" /></span>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d3bb73]">Mavinci LIVE · Familiada</p>
                <h3 className="mt-1 text-lg font-semibold text-white">{familiadaMaterial.gameName}</h3>
                <p className="mt-1 max-w-xl text-sm leading-relaxed text-[#e5e4e2]/55">Ta rozgrywka jest przypisana do wydarzenia. Materiał jest osobnym, czytelnym arkuszem zawierającym wyłącznie pytania — bez odpowiedzi i punktacji.</p>
              </div>
            </div>
            {familiadaMaterial.pdfPath ? <button type="button" onClick={() => void openFamiliadaPdf()} disabled={openingFamiliadaPdf} className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#d3bb73] px-4 py-2.5 text-sm font-semibold text-[#111320] disabled:opacity-60">
              {openingFamiliadaPdf ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
              Otwórz i drukuj pytania
            </button> : null}
          </div>
          {familiadaMaterial.pdfPath ? <div className="mt-5 flex flex-wrap items-center gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] p-4">
            <FileText className="h-5 w-5 text-emerald-300" />
            <div><strong className="block text-sm text-emerald-100">Arkusz pytań gotowy do druku</strong><span className="text-xs text-emerald-100/55">{familiadaMaterial.pdfFileName || 'Pytania Familiady'}{familiadaMaterial.generatedAt ? ` · ${new Date(familiadaMaterial.generatedAt).toLocaleString('pl-PL')}` : ''}</span></div>
          </div> : <div className="mt-5 rounded-xl border border-amber-400/20 bg-amber-400/[0.06] p-4 text-sm text-amber-100/75">Gra została wybrana, ale arkusz pytań nie został jeszcze wygenerowany. Użyj przycisku „Generuj arkusz pytań” w zakładce Mavinci LIVE.</div>}
        </section>}

        {activeCategory === 'music' && <section className="rounded-2xl border border-white/10 bg-[#171927] p-5">
          <h3 className="mb-4 flex items-center gap-2 font-semibold text-white">
            <Music2 className="h-4 w-4 text-[#d3bb73]" />
            Muzyka
          </h3>
          {tracks.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {([
                { type: 'play', title: 'Co gramy' },
                { type: 'do_not_play', title: 'Czego nie gramy' },
              ] as const).map((group) => {
                const groupTracks = tracks.filter((track) => group.type === 'play' ? track.list_type !== 'do_not_play' : track.list_type === 'do_not_play');
                return <div key={group.type} className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-[#d3bb73]">{group.title}</p>
                  {groupTracks.length ? <div className="space-y-2">{groupTracks.map((track) => {
                    const trackUrl = safeHttpUrl(track.url);
                    return <div key={track.id} className="rounded-lg bg-white/[0.03] px-3 py-2">
                      <p className="text-sm text-[#e5e4e2]">{track.artist ? `${track.artist} — ` : ''}{track.title}</p>
                      {trackUrl && <a href={trackUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 text-xs text-[#d3bb73] hover:underline">Otwórz utwór<ExternalLink className="h-3 w-3" /></a>}
                      {track.notes && <p className="mt-1 text-xs text-[#e5e4e2]/45">{track.notes}</p>}
                    </div>;
                  })}</div> : <p className="text-sm text-[#e5e4e2]/40">Brak utworów.</p>}
                </div>;
              })}
            </div>
          ) : (
            <p className="text-sm text-[#e5e4e2]/50">Lista utworów nie została jeszcze dodana.</p>
          )}
        </section>}
        </div>
      </div>
    </div>
  );
}
