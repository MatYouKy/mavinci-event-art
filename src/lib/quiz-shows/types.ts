export interface QuizShowFormat {
  id: string;
  title: string;
  level: string;
  description: string;
  features: string[];
  image_url: string | null;
  icon_id: string | null;
  layout_direction: 'left' | 'right';
  order_index: number;
  is_visible: boolean;
  link_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuizGalleryImage {
  id: string;
  image_url: string;
  title: string | null;
  description?: string | null;
  is_primary: boolean;
  updated_at?: string;
  order_index: number;
  is_visible: boolean;
}

export function safeQuizLink(value: string | null): string | null {
  const link = value?.trim();
  if (!link || /[\\\s]/.test(link)) return null;
  if (link.startsWith('/') && !link.startsWith('//')) return link;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Only newly generated pairs have a guaranteed mobile variant. */
export function quizImageSrcSet(url: string): string | undefined {
  if (!/\/site-images\/quiz-(formats|gallery)\/[a-f0-9-]+-1280\.webp$/.test(url)) return undefined;
  return `${url.replace(/-1280\.webp$/, '-640.webp')} 640w, ${url} 1280w`;
}

export function isQuizStockImage(url: string | null): boolean {
  if (!url) return false;
  try { return new URL(url).hostname === 'images.unsplash.com'; } catch { return false; }
}
