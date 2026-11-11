import 'server-only';
import { randomUUID } from 'node:crypto';
import type { NativeContext } from './auth';
import { registerEventActions, registerEventQueries, registerEventTab } from './eventTabs';
import { isWeddingReceptionGame } from '@/lib/weddingAttractions';
import { readThanksEntries } from '@/lib/weddingCardDetails';

/*
 * Zakładka „Karta weselna” (agenda wesela) dla Maca — te same zapytania i zapisy co `EventWeddingCardTab`
 * i `WeddingPeopleSchedulePanel` (osoby, harmonogram, odpowiedzi, muzyka, atrakcje, Familiada, PDF), tokenem pracownika (RLS).
 */

const uuid = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;
function fail(message: string): never {
  throw new Error(message);
}

/** Pola karty i ich sekcje (`SECTIONS` w zakładce) — do zapisu odpowiedzi i liczenia postępu. */
const FIELDS: Array<[string, string]> = [
  ['ceremony_type', 'ceremony'], ['ceremony_time', 'ceremony'], ['church_address', 'ceremony'], ['civil_ceremony_setting', 'ceremony'],
  ['ceremony_address', 'ceremony'], ['church_wishes_enabled', 'ceremony'],
  ['guest_count', 'technical'], ['ceremony', 'technical'], ['venue_arrival_time', 'technical'], ['venue_access', 'technical'], ['hot_vodka', 'technical'],
  ['first_dance', 'technical'], ['first_dance_title', 'technical'], ['first_dance_artist', 'technical'], ['first_dance_url', 'technical'],
  ['first_dance_duration', 'technical'], ['first_dance_special_moments', 'technical'], ['first_dance_file_url', 'technical'], ['special_toasts', 'technical'],
  ['couple_wait_before_welcome', 'welcome'], ['bread_and_salt_enabled', 'welcome'], ['welcome_glass_throwing', 'welcome'], ['welcome_sequence', 'welcome'],
  ['cake_time', 'cake'], ['cake_presentation', 'cake'], ['cake_proposal_url', 'cake'], ['cake_location', 'cake'],
  ['parents_thanks_enabled', 'parents_thanks'], ['parents_thanks_recipients', 'parents_thanks'], ['parents_thanks_entries', 'parents_thanks'],
  ['parents_thanks_plan', 'parents_thanks'], ['parents_thanks_proposal_url', 'parents_thanks'],
  ['oczepiny_enabled', 'oczepiny'], ['oczepiny_notes', 'oczepiny'],
  ['spotify_playlist_url', 'music'], ['youtube_playlist_url', 'music'],
  ['general_notes', 'notes'],
];

/** `isWeddingFieldVisible`. */
function visible(key: string, values: Record<string, unknown>) {
  const ceremony = values.ceremony_type;
  if (['church_address', 'church_wishes_enabled'].includes(key)) return ceremony === 'church';
  if (key === 'civil_ceremony_setting') return ceremony === 'civil';
  if (key === 'ceremony_address') return ceremony === 'civil' || ceremony === 'humanist';
  if (key === 'parents_thanks_recipients' && readThanksEntries(values.parents_thanks_entries).length) return false;
  if (['parents_thanks_recipients', 'parents_thanks_plan', 'parents_thanks_entries', 'parents_thanks_proposal_url'].includes(key)) {
    return values.parents_thanks_enabled === true;
  }
  return true;
}

const ROLES = ['bride', 'groom', 'witness', 'mother', 'father', 'godparent', 'guardian', 'subcontractor', 'venue_contact', 'other'];

async function weddingTab(ctx: NativeContext, eventId: string) {
  const s = ctx.supabase;
  const [canManage, cardResult, projectResult, pdfResult] = await Promise.all([
    s.rpc('current_employee_can_manage_event', { p_event_id: eventId }).then((r) => r.data === true),
    s.from('wedding_cards').select('id,status,progress,submitted_at,updated_at').eq('event_id', eventId).maybeSingle(),
    s.from('mavinci_event_projects').select('draft_manifest').eq('event_id', eventId).maybeSingle(),
    s.from('event_files').select('name,file_path,updated_at').eq('event_id', eventId).like('file_path', `${eventId}/documents/wedding-card/%`)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (cardResult.error) throw cardResult.error;
  const familiada = ((projectResult.data as any)?.draft_manifest as any)?.familiada;
  const base = {
    canManage,
    familiada: familiada?.gameId ? {
      gameId: familiada.gameId, gameName: familiada.gameName || 'Familiada', pdfPath: familiada.pdfPath || null,
      pdfFileName: familiada.pdfFileName || null, generatedAt: familiada.generatedAt || null,
    } : null,
    pdf: (pdfResult.data as any)?.file_path ? {
      filePath: (pdfResult.data as any).file_path, fileName: (pdfResult.data as any).name, generatedAt: (pdfResult.data as any).updated_at || null,
    } : null,
  };
  const card = cardResult.data as any;
  if (!card) return { ...base, card: null, answers: {}, tracks: [], attractions: [], people: [], schedule: [] };
  const [answers, tracks, attractions, people, schedule] = await Promise.all([
    s.from('wedding_card_answers').select('id,section,field_key,value').eq('wedding_card_id', card.id),
    s.from('wedding_music_tracks').select('id,list_type,title,artist,url,notes').eq('wedding_card_id', card.id).order('sort_order'),
    s.from('wedding_attraction_choices').select('id,attraction_key,attraction_name,choice,notes').eq('wedding_card_id', card.id).order('attraction_name'),
    s.from('wedding_card_people').select('id,side,role,first_name,last_name,phone,email,instagram_handle,instagram_tag_consent,notes')
      .eq('wedding_card_id', card.id).order('side').order('sort_order'),
    s.from('wedding_schedule_items').select('id,title,scheduled_at,category,location,responsible_person,notes,is_confirmed')
      .eq('wedding_card_id', card.id).order('scheduled_at', { ascending: true, nullsFirst: false }).order('sort_order'),
  ]);
  for (const result of [answers, tracks, attractions, people, schedule]) if (result.error) throw result.error;
  const values: Record<string, unknown> = {};
  for (const answer of answers.data || []) values[(answer as any).field_key] = (answer as any).value;
  return {
    ...base,
    card: { id: card.id, status: card.status, progress: Number(card.progress || 0), submittedAt: card.submitted_at ?? null, updatedAt: card.updated_at ?? null },
    answers: values,
    thanksEntries: readThanksEntries(values.parents_thanks_entries),
    tracks: (tracks.data || []).map((t: any) => ({ id: t.id, listType: t.list_type, title: t.title || '', artist: t.artist ?? null, url: t.url ?? null, notes: t.notes ?? null })),
    attractions: (attractions.data || []).map((a: any) => ({
      id: a.id, key: a.attraction_key || '', name: a.attraction_name || '', choice: a.choice || 'undecided', notes: a.notes ?? null, game: isWeddingReceptionGame(a),
    })),
    people: (people.data || []).map((p: any) => ({
      id: p.id, side: p.side, role: ROLES.includes(p.role) ? p.role : 'other', firstName: p.first_name || '', lastName: p.last_name || '', phone: p.phone || '',
      email: p.email || '', instagram: p.instagram_handle || '', instagramConsent: p.instagram_tag_consent === true, notes: p.notes || '',
    })),
    schedule: (schedule.data || []).map((i: any) => ({
      id: i.id, title: i.title || '', scheduledAt: i.scheduled_at ? String(i.scheduled_at) : '', category: i.category || 'other',
      location: i.location || '', responsible: i.responsible_person || '', notes: i.notes || '', confirmed: i.is_confirmed === true,
    })),
  };
}

registerEventTab('wedding', weddingTab);

async function createCard(ctx: NativeContext, eventId: string) {
  const { error } = await ctx.supabase.from('wedding_cards').upsert({ event_id: eventId, status: 'not_started', progress: 0 }, { onConflict: 'event_id' });
  if (error) fail('Nie udało się utworzyć karty weselnej');
  return { ok: true };
}

/** `saveCard`: wszystkie pola karty (źródło „crm”) i postęp — z sekcji oznaczonych przez Parę albo z wypełnionych pól. */
async function saveCard(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const s = ctx.supabase;
  const { data: card, error: cardError } = await s.from('wedding_cards').select('id,status').eq('event_id', eventId).maybeSingle();
  if (cardError || !card) fail('Nie znaleziono karty weselnej.');
  const draft: Record<string, unknown> = body.draft && typeof body.draft === 'object' ? body.draft : {};
  const rows = FIELDS.map(([key, section]) => ({
    wedding_card_id: (card as any).id, section, field_key: key,
    value: key === 'parents_thanks_entries' ? readThanksEntries(draft[key]) : draft[key] ?? '',
    source: 'crm', updated_by: ctx.employee.authUserId || null,
  }));
  const { error: answersError } = await s.from('wedding_card_answers').upsert(rows, { onConflict: 'wedding_card_id,field_key' });
  if (answersError) fail('Nie udało się zapisać Karty Weselnej');
  const applicable = FIELDS.filter(([key]) => visible(key, draft));
  const filled = applicable.filter(([key]) => draft[key] !== '' && draft[key] !== null && draft[key] !== undefined).length;
  const { data: statuses } = await s.from('wedding_card_answers').select('field_key,value').eq('wedding_card_id', (card as any).id).like('field_key', 'section_status_%');
  const completed = new Set((statuses || []).filter((a: any) => ['complete', 'skipped'].includes(String(a.value || ''))).map((a: any) => String(a.field_key).slice('section_status_'.length))).size;
  const progress = completed > 0 ? Math.round((completed / 12) * 100) : Math.round((filled / applicable.length) * 100);
  const { error } = await s.from('wedding_cards').update({ progress, status: (card as any).status === 'not_started' ? 'in_progress' : (card as any).status }).eq('id', (card as any).id);
  if (error) fail('Odpowiedzi zapisano, ale nie udało się zaktualizować postępu');
  return { ok: true };
}

/** `WeddingPeopleSchedulePanel.save`: osoby (z imieniem) i punkty dnia (z tytułem) zastępowane przez `replace_wedding_people_and_schedule`. */
async function saveTeam(ctx: NativeContext, eventId: string, body: Record<string, any>) {
  const { data: card } = await ctx.supabase.from('wedding_cards').select('id').eq('event_id', eventId).maybeSingle();
  if (!card) fail('Nie znaleziono karty weselnej.');
  const people = (Array.isArray(body.people) ? body.people : []).filter((p: any) => String(p?.firstName || '').trim()).map((p: any) => ({
    id: uuid.test(String(p.id || '')) ? p.id : randomUUID(), side: ['bride', 'groom', 'shared'].includes(p.side) ? p.side : 'shared',
    role: ROLES.includes(p.role) ? p.role : 'other', first_name: String(p.firstName || ''), last_name: String(p.lastName || ''), phone: String(p.phone || ''),
    email: String(p.email || ''), instagram_handle: String(p.instagram || ''), instagram_tag_consent: p.instagramConsent === true, notes: String(p.notes || ''),
  }));
  const schedule = (Array.isArray(body.schedule) ? body.schedule : []).filter((i: any) => String(i?.title || '').trim()).map((i: any) => ({
    id: uuid.test(String(i.id || '')) ? i.id : randomUUID(), title: String(i.title || ''),
    scheduled_at: i.scheduledAt && Number.isFinite(Date.parse(i.scheduledAt)) ? new Date(i.scheduledAt).toISOString() : null,
    category: String(i.category || 'other'), location: String(i.location || ''), responsible_person: String(i.responsible || ''),
    notes: String(i.notes || ''), is_confirmed: i.confirmed === true,
  }));
  const { error } = await ctx.supabase.rpc('replace_wedding_people_and_schedule', { p_wedding_card_id: (card as any).id, p_people: people, p_schedule: schedule });
  if (error) fail('Nie udało się zapisać osób lub harmonogramu');
  return { ok: true };
}

registerEventActions('wedding', { create: (ctx, eventId) => createCard(ctx, eventId), save: saveCard, saveTeam });

/** Podpisany link do PDF karty albo arkusza Familiady (tylko pliki tego wydarzenia). */
async function fileQuery(ctx: NativeContext, eventId: string, params: URLSearchParams) {
  const path = params.get('path') || '';
  if (!path.startsWith(`${eventId}/`)) fail('Nieprawidłowy plik.');
  const { data, error } = await ctx.supabase.storage.from('event-files').createSignedUrl(path, 3600);
  if (error || !data?.signedUrl) fail(error?.message || 'Nie udało się otworzyć pliku.');
  return { url: data.signedUrl, name: path.split('/').pop() || 'dokument.pdf' };
}

registerEventQueries('wedding', { file: fileQuery });
