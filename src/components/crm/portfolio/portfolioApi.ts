import { supabase } from '@/lib/supabase/browser';
import type { PortfolioContent, PortfolioPhoto, PortfolioStatus } from '@/lib/portfolio/portfolioShared';

/*
 * Klient API „Realizacji” w CRM — to samo API co Mac i telefon (`/bridge/native/v1/portfolio`, token sesji pracownika,
 * `x-mavinci-client: web`). Zdjęcia z dysku idą na serwer (wersje WebP strony powstają na serwerze).
 */

export type PortfolioListItem = {
  id: string; title: string; slug: string; status: PortfolioStatus; category: string; location: string; eventDate: string | null;
  thumbnailUrl: string | null; photos: number; isFeatured: boolean; orderIndex: number; eventId: string | null; eventName: string | null;
  siteUrl: string | null; publishedAt: string | null; updatedAt: string; problems: number;
};
export type PortfolioCity = { locality: string; name: string };
export type PortfolioHome = {
  items: PortfolioListItem[]; categories: string[]; cities: PortfolioCity[];
  counts: { draft: number; published: number; changed: number }; siteUrl: string;
};
export type PortfolioEvent = { id: string; name: string; date: string | null; location: string; category: string | null };
export type PortfolioItem = {
  id: string; version: number; status: PortfolioStatus; content: PortfolioContent; eventId: string | null; companyId: string | null;
  portfolioProjectId: string | null; publishedSlug: string | null; siteUrl: string | null; publishedAt: string | null;
  publishedByName: string | null; createdAt: string; createdByName: string | null; updatedAt: string; updatedByName: string | null;
  problems: string[]; siteContent: PortfolioContent | null;
};
export type PortfolioDetail = { item: PortfolioItem; event: PortfolioEvent | null };
export type PortfolioPhotoSource = 'event' | 'material' | 'social';
export type PortfolioPhotoOption = { id: string; name: string; thumbnailUrl: string | null; width: number | null; height: number | null; bytes: number | null };
export type PortfolioAiResult = {
  title?: string; description?: string; detailedDescription?: string; metaDescription?: string; keywords?: string[];
  features?: Array<{ icon: string; title: string; description: string }>; alts?: Array<{ src: string; alt: string }>;
  model: string; usedPhotos: boolean;
};

const ENDPOINT = '/bridge/native/v1/portfolio';

async function headers(json: boolean) {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw Object.assign(new Error('Sesja wygasła. Zaloguj się ponownie.'), { status: 401 });
  return { Authorization: `Bearer ${token}`, 'x-mavinci-client': 'web', ...(json ? { 'Content-Type': 'application/json' } : {}) };
}

async function parse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(body?.error || 'Operacja nie powiodła się.'), { status: response.status });
  return body as T;
}

export async function portfolioGet<T>(op: string, params: Record<string, string | number | null | undefined> = {}): Promise<T> {
  const query = new URLSearchParams({ op });
  for (const [key, value] of Object.entries(params)) if (value !== null && value !== undefined && value !== '') query.set(key, String(value));
  return parse<T>(await fetch(`${ENDPOINT}?${query.toString()}`, { headers: await headers(false), cache: 'no-store' }));
}

export async function portfolioPost<T>(op: string, body: Record<string, unknown>): Promise<T> {
  return parse<T>(await fetch(ENDPOINT, { method: 'POST', headers: await headers(true), body: JSON.stringify({ ...body, op }) }));
}

/** Zdjęcie z dysku → wersje WebP strony (serwer) → zdjęcie do dodania w kreatorze. */
export async function portfolioUploadPhoto(itemId: string, file: File): Promise<PortfolioPhoto> {
  const response = await fetch(`${ENDPOINT}?op=upload&id=${encodeURIComponent(itemId)}`, {
    method: 'POST', headers: { ...(await headers(false)), 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  });
  return (await parse<{ photo: PortfolioPhoto }>(response)).photo;
}

export const errorMessage = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);
