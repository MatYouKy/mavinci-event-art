import { supabase } from './supabase';

export interface SiteImageMetadata {
  desktop?: {
    src?: string;
    position?: {
      posX: number;
      posY: number;
      scale: number;
    };
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  };
  mobile?: {
    src?: string;
    position?: {
      posX: number;
      posY: number;
      scale: number;
    };
    objectFit?: 'cover' | 'contain' | 'fill' | 'none' | 'scale-down';
  };
}

export interface SiteImage {
  id: string;
  section: string;
  name: string;
  description: string;
  desktop_url: string;
  mobile_url: string | null;
  alt_text: string;
  position: string;
  order_index: number;
  is_active: boolean;
  opacity?: number;
  image_metadata?: SiteImageMetadata;
  created_at: string;
  updated_at: string;
}

export async function getSiteImage(section: string): Promise<SiteImage | null> {
  try {
    const { data, error } = await supabase
      .from('site_images')
      .select('*')
      .eq('section', section)
      .eq('is_active', true)
      .order('order_index')
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error(`Error fetching image for section ${section}:`, error);
      return null;
    }

    return data;
  } catch (error) {
    console.error(`Error fetching image for section ${section}:`, error);
    return null;
  }
}

export async function getSiteImages(section: string): Promise<SiteImage[]> {
  try {
    const { data, error } = await supabase
      .from('site_images')
      .select('*')
      .eq('section', section)
      .eq('is_active', true)
      .order('order_index');

    if (error) {
      console.error(`Error fetching images for section ${section}:`, error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error(`Error fetching images for section ${section}:`, error);
    return [];
  }
}

export function getImageUrl(image: SiteImage | null, isMobile: boolean = false): string {
  if (!image) return '';

  if (isMobile && image.mobile_url) {
    return image.mobile_url;
  }

  return image.desktop_url;
}

export function getImageStyle(
  image: SiteImage | null,
  isMobile: boolean = false,
): React.CSSProperties {
  const url = getImageUrl(image, isMobile);

  if (!url) return {};

  return {
    backgroundImage: `url(${url})`,
    backgroundPosition: image?.position || 'center',
    backgroundSize: 'cover',
  };
}
