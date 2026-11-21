import 'server-only';
import type { NativeContext } from '@/lib/native/auth';
import { check, fail, isUuid, requireAccess, text, uuidOrNull, type Row } from './socialCommon.server';
import { graphicSpec, loadTemplates, pickTemplate, templateDTO, type SocialGraphicSpec, type SocialTemplateDTO } from './socialTemplate.server';
import {
  SOCIAL_LAYOUT_LIMITS, SOCIAL_LAYOUT_PRESETS, parseSocialLayout, socialLayoutProblem, socialLayoutSlots, type SocialLayoutDefinition,
} from './socialLayout';
import type { SocialAccess } from './socialShared';

/*
 * Edytor układów grafik (Etap F): układy marki jako dane (`social_layouts`) — lista, zapis (nowy / zmiana), kopia,
 * archiwum i usunięcie. Podgląd: Social media — podgląd; zmiany: akceptujący (jak szablony marki, RLS). Zmiana układu nie
 * zmienia zapisanych postów (post ma migawkę definicji); nowa wersja trafia do postu po ponownym wyborze układu w kreatorze.
 */

const FIELDS = 'id, company_id, name, definition, is_archived, created_at, updated_at, updated_by';

export type SocialLayoutDTO = {
  id: string;
  name: string;
  definition: SocialLayoutDefinition;
  slots: number;
  archived: boolean;
  /** Liczba postów z tym układem (usunąć można tylko nieużywany — inaczej archiwum). */
  usedBy: number;
  updatedAt: string;
};

export type SocialLayoutsReply = {
  companyId: string;
  access: SocialAccess;
  layouts: SocialLayoutDTO[];
  presets: Array<{ key: string; name: string; description: string; definition: SocialLayoutDefinition; slots: number }>;
  /** Szablon marki do podglądu na płótnie (logo, fonty, kolory z księgi znaku). */
  template: SocialTemplateDTO | null;
  spec: SocialGraphicSpec | null;
  limits: typeof SOCIAL_LAYOUT_LIMITS;
};

/** Układy marki (także archiwalne) i gotowe układy z danymi szablonu do podglądu. */
export async function socialLayouts(ctx: NativeContext, companyId: string, templateId: string | null = null): Promise<SocialLayoutsReply> {
  if (!isUuid(companyId)) fail('Wybierz markę.');
  const access = await requireAccess(ctx, companyId, 'view');
  const [{ data, error }, templates] = await Promise.all([
    ctx.supabase.from('social_layouts').select(FIELDS).eq('company_id', companyId).order('is_archived').order('name'),
    loadTemplates(ctx, companyId),
  ]);
  check(error, 'Nie udało się pobrać układów.');
  const ids = ((data || []) as Row[]).map((row) => String(row.id));
  const usage = ids.length
    ? await ctx.supabase.from('social_post_variants').select('layout_id, post_id').in('layout_id', ids).limit(5000)
    : { data: [] as Row[] };
  const posts = new Map<string, Set<string>>();
  for (const row of (usage.data || []) as Row[]) {
    const id = String(row.layout_id);
    const set = posts.get(id) || new Set<string>();
    set.add(String(row.post_id));
    posts.set(id, set);
  }
  const template = pickTemplate(templates, templateId);
  const layouts = ((data || []) as Row[]).map((row): SocialLayoutDTO | null => {
    const definition = parseSocialLayout(row.definition);
    if (!definition) return null;
    return {
      id: String(row.id), name: text(row.name), definition, slots: socialLayoutSlots(definition), archived: row.is_archived === true,
      usedBy: posts.get(String(row.id))?.size || 0, updatedAt: text(row.updated_at),
    };
  }).filter((item): item is SocialLayoutDTO => Boolean(item));
  return {
    companyId,
    access,
    layouts,
    presets: SOCIAL_LAYOUT_PRESETS.map((preset) => ({ ...preset, slots: socialLayoutSlots(preset.definition) })),
    template: template ? templateDTO(template) : null,
    spec: template ? await graphicSpec(template) : null,
    limits: SOCIAL_LAYOUT_LIMITS,
  };
}

async function layoutRow(ctx: NativeContext, id: unknown): Promise<Row> {
  if (!isUuid(id)) fail('Nie znaleziono układu.', 404);
  const { data, error } = await ctx.supabase.from('social_layouts').select(FIELDS).eq('id', String(id)).maybeSingle();
  check(error, 'Nie udało się pobrać układu.');
  if (!data) fail('Nie znaleziono układu.', 404);
  return data as Row;
}

/**
 * Zapis układu (akceptujący): nowy (`id` brak) albo zmiana. `updatedAt` chroni przed nadpisaniem zmian z innego okna.
 * Definicja zapisywana po walidacji (w bezpiecznych zakresach, bez nieznanych pól). Zapis, archiwum i usunięcie zwracają
 * listę z podglądem w szablonie `templateId` (ten sam, w którym edytor był otwarty).
 */
export async function saveLayout(ctx: NativeContext, body: Row) {
  const name = text(body.name).trim().replace(/\s+/g, ' ').slice(0, SOCIAL_LAYOUT_LIMITS.name);
  if (!name) fail('Nadaj układowi nazwę.');
  const problem = socialLayoutProblem(body.definition);
  if (problem) fail(problem);
  const definition = parseSocialLayout(body.definition) as SocialLayoutDefinition;
  const id = uuidOrNull(body.id);
  let companyId: string;
  if (id) {
    const row = await layoutRow(ctx, id);
    companyId = String(row.company_id);
    await requireAccess(ctx, companyId, 'approve');
    if (body.updatedAt && text(body.updatedAt) !== text(row.updated_at)) {
      fail('Układ zmieniono w innym oknie. Odśwież listę — Twoje zmiany nie zostały zapisane.', 409);
    }
    const { error } = await ctx.supabase.from('social_layouts').update({ name, definition }).eq('id', id);
    check(error, 'Nie udało się zapisać układu.');
  } else {
    companyId = uuidOrNull(body.companyId) || '';
    if (!companyId) fail('Wybierz markę.');
    await requireAccess(ctx, companyId, 'approve');
    const { data, error } = await ctx.supabase.from('social_layouts').insert({ company_id: companyId, name, definition }).select('id').single();
    check(error, 'Nie udało się utworzyć układu.');
    return { ...(await socialLayouts(ctx, companyId, uuidOrNull(body.templateId))), savedId: String((data as Row).id) };
  }
  return { ...(await socialLayouts(ctx, companyId, uuidOrNull(body.templateId))), savedId: id };
}

/** Archiwum (ukryty w kreatorze posta; posty z tym układem działają dalej) albo przywrócenie. */
export async function archiveLayout(ctx: NativeContext, body: Row) {
  const row = await layoutRow(ctx, body.id);
  const companyId = String(row.company_id);
  await requireAccess(ctx, companyId, 'approve');
  const { error } = await ctx.supabase.from('social_layouts').update({ is_archived: body.archived !== false }).eq('id', row.id);
  check(error, 'Nie udało się zmienić układu.');
  return socialLayouts(ctx, companyId, uuidOrNull(body.templateId));
}

/** Usunięcie nieużywanego układu (używany — tylko archiwum, żeby było wiadomo, skąd wygląd postów). */
export async function deleteLayout(ctx: NativeContext, body: Row) {
  const row = await layoutRow(ctx, body.id);
  const companyId = String(row.company_id);
  await requireAccess(ctx, companyId, 'approve');
  const { count } = await ctx.supabase.from('social_post_variants').select('id', { count: 'exact', head: true }).eq('layout_id', row.id);
  if ((count || 0) > 0) fail('Układ jest użyty w postach — zamiast usuwać, przenieś go do archiwum.', 409);
  const { error } = await ctx.supabase.from('social_layouts').delete().eq('id', row.id);
  check(error, 'Nie udało się usunąć układu.');
  return socialLayouts(ctx, companyId, uuidOrNull(body.templateId));
}
