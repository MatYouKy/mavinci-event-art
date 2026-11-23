import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isShowcaseUuid, showcaseDefaultTitle, showcaseMediaKey, showcaseVisibleBlocks, type ShowcaseBlock, type ShowcaseMedia,
  type ShowcaseRealizationView, type ShowcaseUrls,
} from './showcaseShared';
import { cleanShowcaseContent, showcaseMediaUrls, showcaseRealizationViews } from './showcase.server';

/*
 * Materiał z Prezentacji (Strefa sprzedawcy → Prezentacje) na stronie produktu dla klienta `/produkty/[id]` — jedna praca,
 * dwa miejsca: karta prezentacji powiązana z produktem (`sales_showcase_items.product_ids`) pokazuje się też pod opisem produktu.
 *
 * Co trafia na stronę: aktywne karty (nie szkice) z aktywnych działów z włączonym „Pokazuj na stronie produktu dla klienta”
 * (`show_on_product_page`, migracja 20261128100000; bez niej — wszystkie aktywne), w kolejności działów i kart; z każdej — hasło, wstęp,
 * zdjęcie główne i bloki widoczne na spotkaniu (bez ukrytych i pustych): zdjęcia, punkty (korzyści, kroki, „co obejmuje”),
 * specyfikacja, pytania klientów, tekst i realizacje ze strony. Bloki „Z katalogu produktów” tego produktu pomijamy (strona
 * produktu pokazuje warianty, pakiety i wymagania sama), a innego produktu — jako odnośnik do jego strony. Bez cen i danych
 * pracowników. Zdjęcie produktu, które strona pokazuje u góry, nie powtarza się. Zdjęcia — podpisane adresy na godzinę.
 *
 * Kontrola: przełącznik w karcie — karta tylko na spotkaniach; ukryty blok albo szkic — znika i ze spotkań, i ze strony produktu.
 * Klient serwisowy (strona publiczna) — wyłącznie do odczytu powyższych pól; błąd Prezentacji nie psuje strony produktu.
 */

const LIMIT_CARDS = 6;
const LIMIT_PHOTOS_PER_BLOCK = 24;

export type PublicShowcasePhoto = {
  key: string;
  /** Pełne zdjęcie (powiększenie). */
  url: string;
  /** Miniatura (siatka); gdy brak — pełne. */
  thumb: string;
  caption: string;
  width: number | null;
  height: number | null;
};

export type PublicShowcaseRealization = {
  id: string;
  title: string;
  location: string;
  date: string | null;
  photo: PublicShowcasePhoto | null;
  href: string | null;
};

export type PublicShowcaseProductLink = { id: string; name: string; description: string; image: string | null; href: string };

export type PublicShowcaseBlock = {
  id: string;
  kind: 'photos' | 'points' | 'specs' | 'faq' | 'text' | 'realizations' | 'product';
  /** Wariant bloku: zdjęcia `large` | `grid`, punkty `benefits` | `steps` | `checklist`. */
  style: string;
  title: string;
  text: string;
  photos: PublicShowcasePhoto[];
  rows: { title: string; text: string }[];
  realizations: PublicShowcaseRealization[];
  product: PublicShowcaseProductLink | null;
};

export type PublicShowcaseCard = {
  id: string;
  title: string;
  tagline: string;
  lead: string;
  hero: PublicShowcasePhoto | null;
  blocks: PublicShowcaseBlock[];
};

type Row = Record<string, any>;

const plain = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

function photoOf(media: ShowcaseMedia | null | undefined, urls: ShowcaseUrls, fallbackCaption: string): PublicShowcasePhoto | null {
  if (!media) return null;
  const key = showcaseMediaKey(media);
  const signed = urls[key];
  const url = signed?.url || signed?.thumb || '';
  if (!url) return null;
  return { key, url, thumb: signed?.thumb || url, caption: media.caption || fallbackCaption, width: media.width, height: media.height };
}

/**
 * Karty prezentacji powiązane z produktem — gotowe do pokazania na `/produkty/[id]`. `exclude` — ścieżki zdjęć, które strona już
 * pokazuje (zdjęcie produktu). Przy błędzie (np. baza bez Prezentacji) — pusta lista.
 */
export async function productShowcaseCards(client: SupabaseClient, productId: string, exclude: string[] = []): Promise<PublicShowcaseCard[]> {
  if (!isShowcaseUuid(productId)) return [];
  try {
    // Wszystkie kolumny — przełącznik strony produktu odczytany, gdy baza go ma (filtr w kodzie, bez błędu przed migracją).
    const { data: items, error } = await client.from('sales_showcase_items')
      .select('*')
      .eq('is_active', true)
      .contains('product_ids', [productId])
      .limit(40);
    if (error) throw error;
    const rows = ((items || []) as Row[]).filter((row) => row.show_on_product_page !== false);
    if (!rows.length) return [];
    const sectionIds = Array.from(new Set(rows.map((row) => String(row.section_id))));
    const { data: sections, error: sectionError } = await client.from('sales_showcase_sections')
      .select('id, sort_order, title').in('id', sectionIds).eq('is_active', true);
    if (sectionError) throw sectionError;
    const sectionOrder = new Map(((sections || []) as Row[]).map((section) => [String(section.id), Number(section.sort_order) || 0]));
    const cards = rows
      .filter((row) => sectionOrder.has(String(row.section_id)))
      .sort((a, b) => (sectionOrder.get(String(a.section_id))! - sectionOrder.get(String(b.section_id))!)
        || (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0))
      .slice(0, LIMIT_CARDS)
      .map((row) => ({ row, content: cleanShowcaseContent(row.content) }));
    if (!cards.length) return [];

    // Zdjęcia bez powtórzeń: pokazane już na stronie (zdjęcie produktu) i wcześniej na tej stronie (inna karta, inny blok).
    const excluded = new Set(exclude.filter(Boolean));
    const seen = new Set<string>();
    const fresh = (media: ShowcaseMedia | null | undefined) => {
      if (!media || (media.source === 'product' && excluded.has(media.path))) return false;
      const key = showcaseMediaKey(media);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    };
    const plan = cards.map(({ row, content }) => {
      const hero = fresh(content.hero) ? content.hero : null;
      const blocks = showcaseVisibleBlocks(content).flatMap((block): ShowcaseBlock[] => {
        if (block.kind === 'catalog') return block.productId && block.productId !== productId ? [block] : [];
        if (block.kind === 'photos') {
          const photos = block.photos.filter(fresh).slice(0, LIMIT_PHOTOS_PER_BLOCK);
          return photos.length ? [{ ...block, photos }] : [];
        }
        return [block];
      });
      return { row, content, hero, blocks };
    });

    // Realizacje ze strony i inne produkty z bloków katalogu — jednym zapytaniem.
    const realizationIds = Array.from(new Set(plan.flatMap((card) => card.blocks.flatMap((block) => (block.kind === 'realizations' ? block.refs : [])))));
    const productIds = Array.from(new Set(plan.flatMap((card) => card.blocks.flatMap((block) => (block.kind === 'catalog' && block.productId ? [block.productId] : []))))).filter(isShowcaseUuid);
    const [realizations, products] = await Promise.all([
      realizationIds.length ? showcaseRealizationViews(client, realizationIds) : Promise.resolve([] as ShowcaseRealizationView[]),
      productIds.length
        ? client.from('offer_products').select('id, name, is_active, offer_short_description, offer_image_path').in('id', productIds)
          .then(({ data, error: productError }) => { if (productError) throw productError; return ((data || []) as Row[]).filter((product) => product.is_active !== false); })
        : Promise.resolve([] as Row[]),
    ]);
    const productMedia = (path: unknown): ShowcaseMedia | null => {
      const value = plain(path);
      return value && !/^(?:[a-z]+:|\/\/)/i.test(value)
        ? { id: `product:${value}`, source: 'product', path: value, thumb: null, width: null, height: null, caption: '' }
        : null;
    };
    const urls = await showcaseMediaUrls(client, [
      ...plan.flatMap((card) => [card.hero, ...card.blocks.flatMap((block) => block.photos)]),
      ...realizations.map((realization) => realization.photos[0]),
      ...products.map((product) => productMedia(product.offer_image_path)),
    ]);

    return plan.map(({ row, content, hero, blocks }) => {
      const title = plain(row.title) || 'Prezentacja';
      return {
        id: String(row.id),
        title,
        tagline: plain(row.tagline),
        lead: content.lead,
        hero: photoOf(hero, urls, title),
        blocks: blocks.flatMap((block): PublicShowcaseBlock[] => {
          const base = {
            id: block.id,
            style: block.style,
            title: block.title || showcaseDefaultTitle(block.kind, block.style),
            text: block.text,
            photos: [] as PublicShowcasePhoto[],
            rows: [] as { title: string; text: string }[],
            realizations: [] as PublicShowcaseRealization[],
            product: null as PublicShowcaseProductLink | null,
          };
          switch (block.kind) {
            case 'photos': {
              const photos = block.photos.map((media) => photoOf(media, urls, title)).filter((photo): photo is PublicShowcasePhoto => Boolean(photo));
              return photos.length ? [{ ...base, kind: 'photos', photos }] : [];
            }
            case 'points':
            case 'specs':
            case 'faq':
              return [{ ...base, kind: block.kind, rows: block.rows.map((entry) => ({ title: entry.title, text: entry.text })) }];
            case 'text':
              return [{ ...base, kind: 'text' }];
            case 'realizations': {
              const list = block.refs.flatMap((id) => {
                const realization = realizations.find((entry) => entry.id === id);
                if (!realization) return [];
                return [{
                  id: realization.id,
                  title: realization.title,
                  location: realization.location,
                  date: realization.date,
                  photo: photoOf(realization.photos[0], urls, realization.title),
                  href: realization.siteUrl,
                }];
              });
              return list.length ? [{ ...base, kind: 'realizations', realizations: list }] : [];
            }
            case 'catalog': {
              const product = products.find((entry) => String(entry.id) === block.productId);
              if (!product) return [];
              const media = productMedia(product.offer_image_path);
              const signed = media ? urls[showcaseMediaKey(media)] : null;
              return [{
                ...base,
                kind: 'product',
                product: {
                  id: String(product.id),
                  name: plain(product.name) || 'Produkt',
                  description: plain(product.offer_short_description).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim(),
                  image: signed?.thumb || signed?.url || null,
                  href: `/produkty/${String(product.id)}`,
                },
              }];
            }
            default:
              return [];
          }
        }),
      };
    }).filter((card) => card.hero || card.lead || card.tagline || card.blocks.length);
  } catch (error) {
    console.error('[produkty] materiał z Prezentacji', (error as { message?: string })?.message || error);
    return [];
  }
}
