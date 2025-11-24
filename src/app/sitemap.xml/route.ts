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
  license?: string;
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
      <image:loc>${escapeXml(img.url)}</image:loc>
      ${img.title ? `<image:title>${escapeXml(img.title)}</image:title>` : ''}
      ${img.caption ? `<image:caption>${escapeXml(img.caption)}</image:caption>` : ''}
    </image:image>`
        )
        .join('');

      return `
  <url>
    <loc>${escapeXml(url.loc)}</loc>
    ${url.lastmod ? `<lastmod>${url.lastmod}</lastmod>` : ''}
    ${url.changefreq ? `<changefreq>${url.changefreq}</changefreq>` : ''}
    ${url.priority !== undefined ? `<priority>${url.priority}</priority>` : ''}${imagesXml || ''}
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

  urls.push({
    loc: baseUrl,
    lastmod: new Date().toISOString(),
    changefreq: 'daily',
    priority: 1.0,
  });

  try {
    const { data: metadataPages } = await supabase
      .from('schema_org_page_metadata')
      .select('page_slug, updated_at, priority, change_frequency, og_image')
      .eq('is_active', true)
      .order('priority', { ascending: false });

    if (metadataPages && metadataPages.length > 0) {
      for (const page of metadataPages) {
        if (page.page_slug === 'home') continue;

        const images: ImageInfo[] = [];
        if (page.og_image) {
          images.push({
            url: page.og_image,
            title: page.page_slug,
          });
        }

        urls.push({
          loc: `${baseUrl}/${page.page_slug}`,
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

  const serviceSlugs = [
    'naglosnienie',
    'konferencje',
    'streaming',
    'symulatory-vr',
    'quizy-teleturnieje',
    'integracje',
    'kasyno',
    'wieczory-tematyczne',
    'technika-sceniczna',
  ];

  for (const slug of serviceSlugs) {
    try {
      const tableName = `${slug.replace(/-/g, '_')}_page_images`;
      const { data: heroData } = await supabase
        .from(tableName)
        .select('image_url, title, alt, updated_at, image_metadata')
        .eq('section', 'hero')
        .eq('is_active', true)
        .maybeSingle();

      const images: ImageInfo[] = [];
      if (heroData?.image_url) {
        images.push({
          url: heroData.image_url,
          title: heroData.title || heroData.alt || slug,
          caption: heroData.alt,
        });
      }

      urls.push({
        loc: `${baseUrl}/oferta/${slug}`,
        lastmod: heroData?.updated_at || new Date().toISOString(),
        changefreq: 'monthly',
        priority: 0.8,
        images: images.length > 0 ? images : undefined,
      });
    } catch (error) {
      console.error(`Error fetching service ${slug}:`, error);
    }
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
      .select('slug, title, image_url, gallery_images, alt, updated_at, image_metadata')
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
            if (imgUrl) {
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
