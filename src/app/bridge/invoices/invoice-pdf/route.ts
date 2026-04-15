import { NextResponse } from 'next/server';
import { chromium } from 'playwright';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Body = {
  html: string;
  fileName?: string;
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const { html, fileName } = body;

    if (!html) {
      return NextResponse.json({ error: 'Brak HTML do wygenerowania PDF' }, { status: 400 });
    }

    const browser = await chromium.launch({
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--font-render-hinting=medium'],
    });

    try {
      const page = await browser.newPage();

      await page.setContent(html, { waitUntil: 'networkidle' });

      await page.evaluate(async () => {
        // @ts-ignore
        if (document.fonts?.ready) {
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
        margin: {
          top: '10mm',
          right: '10mm',
          bottom: '12mm',
          left: '10mm',
        },
      });

      const base64 = Buffer.from(pdfBuffer).toString('base64');

      return NextResponse.json({
        ok: true,
        base64,
        filename: fileName || 'faktura.pdf',
        contentType: 'application/pdf',
      });
    } finally {
      await browser.close();
    }
  } catch (e: any) {
    console.error('Invoice PDF generate API error:', e);
    return NextResponse.json({ error: e?.message || 'Błąd generowania PDF' }, { status: 500 });
  }
}