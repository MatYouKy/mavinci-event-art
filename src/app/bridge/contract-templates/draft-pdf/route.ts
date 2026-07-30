import { NextResponse } from 'next/server';
import { chromium } from 'playwright';
import { buildContractHtml } from '@/app/(crm)/crm/events/[id]/helpers/buildContractHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  pagesHtml: string;
  cssText: string;
  title?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { pagesHtml, cssText, title } = body;

    if (!pagesHtml || !cssText) {
      return NextResponse.json({ error: 'Brak wymaganych danych' }, { status: 400 });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      'http://localhost:3000';

    const html = buildContractHtml({
      pagesHtml,
      cssText,
      baseUrl,
      title: title || 'Umowa - wersja robocza',
    });

    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });

    try {
      const page = await browser.newPage();

      await page.setContent(html, { waitUntil: 'networkidle' });

      await page.evaluate(async () => {
        // @ts-ignore
        if (document.fonts && document.fonts.ready) {
          // @ts-ignore
          await document.fonts.ready;
        }
        const imgs = Array.from(document.images || []);
        await Promise.all(
          imgs.map(
            (img) =>
              new Promise<void>((resolve) => {
                if (img.complete) return resolve();
                img.onload = () => resolve();
                img.onerror = () => resolve();
              }),
          ),
        );
      });

      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '0mm', right: '0mm', bottom: '0mm', left: '0mm' },
        preferCSSPageSize: true,
      });

      return new NextResponse(new Uint8Array(pdfBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'inline; filename="umowa-draft.pdf"',
          'Cache-Control': 'no-store',
        },
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    console.error('Draft PDF generate error:', e);
    return NextResponse.json({ error: e?.message || 'Błąd generowania PDF' }, { status: 500 });
  }
}
