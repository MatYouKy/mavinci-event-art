import { createClient } from '@supabase/supabase-js';

const getSupabaseClient = () => {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase environment variables');
  }

  return createClient(supabaseUrl, supabaseKey);
};

interface ImageInfo {
  url: string;
  title?: string;
  caption?: string;
}

interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: number;
  images?: ImageInfo[];
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function generateSitemapXml(urls: SitemapUrl[]): string {
  const urlsXml = urls
    .map((url) => {
      const imagesXml = url.images
        ?.map(
          (img) => `
    <image:image>
      <image:loc>${escapeXml(img.url)}</image:loc>${img.title ? `
      <image:title>${escapeXml(img.title)}</image:title>` : ''}${img.caption ? `
      <image:caption>${escapeXml(img.caption)}</image:caption>` : ''}
    </image:image>`
        )
        .join('');

      return `
  <url>
    <loc>${escapeXml(url.loc)}</loc>${url.lastmod ? `
    <lastmod>${url.lastmod}</lastmod>` : ''}${url.changefreq ? `
    <changefreq>${url.changefreq}</changefreq>` : ''}${url.priority !== undefined ? `
    <priority>${url.priority}</priority>` : ''}${imagesXml || ''}
  </url>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urlsXml}
</urlset>`;
}

export async function GET() {
  const baseUrl = 'https://mavinci.pl';
  const supabase = getSupabaseClient();
  const urls: SitemapUrl[] = [];

  try {
    const { data: metadataPages } = await supabase
      .from('schema_org_page_metadata')
      .select('page_slug, updated_at, priority, change_frequency, og_image')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (metadataPages && metadataPages.length > 0) {
      for (const page of metadataPages) {
        const images: ImageInfo[] = [];
        if (page.og_image) {
          images.push({
            url: page.og_image,
            title: page.page_slug === 'home' ? 'MAVINCI Event & ART' : page.page_slug,
          });
        }

        const pageUrl = page.page_slug === 'home' ? baseUrl : `${baseUrl}/${page.page_slug}`;

        urls.push({
          loc: pageUrl,
          lastmod: page.updated_at || new Date().toISOString(),
          changefreq: page.change_frequency || 'weekly',
          priority: page.priority || 0.8,
          images: images.length > 0 ? images : undefined,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching metadata pages:', error);
  }

  // Fetch dynamic service detail pages with images
  try {
    const { data: services } = await supabase
      .from('conferences_service_items')
      .select('id, slug, name, thumbnail_url, updated_at')
      .eq('is_active', true);

    if (services && services.length > 0) {
      for (const service of services) {
        const images: ImageInfo[] = [];

        // Fetch hero image for this service
        const { data: heroImage } = await supabase
          .from('service_hero_images')
          .select('image_url, alt_text')
          .eq('page_slug', `uslugi/${service.slug}`)
          .eq('is_active', true)
          .maybeSingle();

        if (heroImage?.image_url) {
          images.push({
            url: heroImage.image_url,
            title: service.name,
            caption: heroImage.alt_text || service.name,
          });
        } else if (service.thumbnail_url) {
          images.push({
            url: service.thumbnail_url,
            title: service.name,
            caption: service.name,
          });
        }

        // Fetch gallery images for this service using service ID
        const { data: gallery } = await supabase
          .from('conferences_service_gallery')
          .select('image_url, caption, alt_text')
          .eq('service_id', service.id)
          .eq('is_active', true)
          .order('display_order')
          .limit(5);

        if (gallery && gallery.length > 0) {
          gallery.forEach((img) => {
            if (img.image_url) {
              images.push({
                url: img.image_url,
                title: img.caption || service.name,
                caption: img.alt_text || service.name,
              });
            }
          });
        }

        urls.push({
          loc: `${baseUrl}/uslugi/${service.slug}`,
          lastmod: service.updated_at || new Date().toISOString(),
          changefreq: 'monthly',
          priority: 0.7,
          images: images.length > 0 ? images : undefined,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching service detail pages for image sitemap:', error);
  }

  const casinoSubpages = ['blackjack', 'ruletka', 'poker'];
  for (const subpage of casinoSubpages) {
    urls.push({
      loc: `${baseUrl}/oferta/kasyno/zasady/${subpage}`,
      lastmod: new Date().toISOString(),
      changefreq: 'yearly',
      priority: 0.5,
    });
  }

  try {
    const { data: projects } = await supabase
      .from('portfolio_projects')
      .select('slug, title, image_url, gallery_images, alt, updated_at')
      .order('order_index');

    if (projects && projects.length > 0) {
      for (const project of projects) {
        const images: ImageInfo[] = [];

        if (project.image_url) {
          images.push({
            url: project.image_url,
            title: project.title,
            caption: project.alt || project.title,
          });
        }

        if (project.gallery_images && Array.isArray(project.gallery_images)) {
          project.gallery_images.forEach((imgUrl: string, idx: number) => {
            if (imgUrl && typeof imgUrl === 'string') {
              images.push({
                url: imgUrl,
                title: `${project.title} - Zdjęcie ${idx + 1}`,
                caption: project.title,
              });
            }
          });
        }

        urls.push({
          loc: `${baseUrl}/portfolio/${project.slug}`,
          lastmod: project.updated_at || new Date().toISOString(),
          changefreq: 'monthly',
          priority: 0.7,
          images: images.length > 0 ? images : undefined,
        });
      }
    }
  } catch (error) {
    console.error('Error fetching portfolio projects:', error);
  }

  try {
    const { data: cities } = await supabase
      .from('conferences_cities')
      .select('slug, name, updated_at')
      .eq('is_active', true)
      .order('name');

    if (cities && cities.length > 0) {
      cities.forEach((city) => {
        urls.push({
          loc: `${baseUrl}/oferta/konferencje/${city.slug}`,
          lastmod: city.updated_at || new Date().toISOString(),
          changefreq: 'monthly',
          priority: 0.6,
        });
      });
    }
  } catch (error) {
    console.error('Error fetching city pages:', error);
  }

  const xml = generateSitemapXml(urls);

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
