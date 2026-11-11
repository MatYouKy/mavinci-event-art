import 'server-only';
import { can, type NativeContext, type NativeEmployee } from './auth';
import type { DocSectionMeta } from './protocol';
import { offerRecords, offersMeta } from './offers-native';

/*
 * Zbiory kart natywnych (nazwa zbioru = zakładka listy w aplikacji). Każdy zbiór: kto go widzi, opis podstrony (`sections`)
 * i karty. Dostęp do rekordów i tak wyznacza RLS Supabase — `allowed` decyduje tylko, czy pokazać pozycję menu.
 */
export type NativeSet = {
  name: string;
  allowed: (employee: NativeEmployee) => boolean;
  meta?: (ctx: NativeContext) => DocSectionMeta;
  load: (ctx: NativeContext) => Promise<{ id: string; item: Record<string, unknown> }[]>;
};

const cards = <T extends { id: string }>(records: T[]) => records.map((r) => ({ id: r.id, item: r as unknown as Record<string, unknown> }));

export const nativeSets: NativeSet[] = [
  {
    name: 'offers',
    allowed: (e) => can(e, 'offers_view') || can(e, 'offers_manage'),
    meta: offersMeta,
    load: async (ctx) => cards(await offerRecords(ctx)),
  },
];

/** Opisy podstron dostępnych dla pracownika (zbiór `sections`). */
export const nativeSectionMetas = (ctx: NativeContext): DocSectionMeta[] =>
  nativeSets.filter((s) => s.allowed(ctx.employee) && s.meta).map((s) => s.meta!(ctx));
