import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GeneratePdfRequest {
  contractId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { contractId }: GeneratePdfRequest = await req.json();

    if (!contractId) {
      throw new Error("contractId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: contract, error } = await supabase
      .from("contracts")
      .select(`
        *,
        template:contract_templates!template_id(
          show_header_logo,
          header_logo_url,
          header_logo_height,
          header_logo_align,
          show_center_logo,
          center_logo_url,
          center_logo_height,
          show_footer,
          footer_content
        )
      `)
      .eq("id", contractId)
      .maybeSingle();

    if (error || !contract) {
      throw new Error("Contract not found");
    }

    const template = contract.template || {};

    const headerLogoHtml = template.show_header_logo && template.header_logo_url
      ? `<div class="contract-header-logo justify-${template.header_logo_align || 'start'}">
          <img src="${template.header_logo_url}" alt="Logo" style="height: ${template.header_logo_height || 50}px;" />
        </div>`
      : '';

    const centerLogoHtml = template.show_center_logo && template.center_logo_url
      ? `<div class="contract-center-logo">
          <img src="${template.center_logo_url}" alt="Logo" style="height: ${template.center_logo_height || 100}px;" />
        </div>`
      : '';

    const footerHtml = template.show_footer && template.footer_content
      ? `<div class="contract-footer">${template.footer_content}</div>`
      : '';

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4 portrait;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
            background: white;
          }
          .contract-a4-page {
            position: relative;
            width: 210mm;
            padding: 20mm 25mm 30mm;
            min-height: 297mm;
            background: white;
            font-family: Arial, sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            color: #000;
            display: flex;
            flex-direction: column;
            box-sizing: border-box;
          }
          .contract-header-logo {
            width: 100%;
            display: flex;
            align-items: center;
            margin-bottom: 4mm;
            flex-shrink: 0;
          }
          .contract-header-logo.justify-start {
            justify-content: flex-start;
          }
          .contract-header-logo.justify-center {
            justify-content: center;
          }
          .contract-header-logo.justify-end {
            justify-content: flex-end;
          }
          .contract-header-logo img {
            height: auto;
            object-fit: contain;
            max-width: 80%;
          }
          .contract-center-logo {
            text-align: center;
            margin-bottom: 10mm;
            flex-shrink: 0;
          }
          .contract-center-logo img {
            height: auto;
            object-fit: contain;
            max-width: 80%;
          }
          .contract-content {
            flex: 1;
            text-align: justify;
            color: #000;
            font-family: Arial, sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            overflow-wrap: break-word;
            word-wrap: break-word;
          }
          .contract-content p, .contract-content pre {
            margin: 0;
            padding: 0;
            text-align: justify;
            white-space: pre-wrap;
            font-family: Arial, sans-serif;
            font-size: 12pt;
            line-height: 1.6;
            background: transparent;
            color: #000;
          }
          .contract-content h1, .contract-content h2, .contract-content h3, .contract-content h4 {
            margin-top: 1.5em;
            margin-bottom: 0.75em;
            font-weight: bold;
            white-space: pre-wrap;
            color: #000;
          }
          .contract-content h1 {
            font-size: 18pt;
            text-align: center;
          }
          .contract-content h2 {
            font-size: 16pt;
          }
          .contract-content h3 {
            font-size: 14pt;
          }
          .contract-content strong, .contract-content b {
            font-weight: bold;
            color: #000;
          }
          .contract-content em, .contract-content i {
            font-style: italic;
            color: #000;
          }
          .contract-footer {
            display: flex;
            justify-content: space-between;
            border-top: 1px solid #d3bb73;
            margin-top: auto;
            width: 100%;
            min-height: 15mm;
            padding-top: 5px;
            background: white;
            flex-shrink: 0;
            opacity: 0.7;
          }
          .footer-logo {
            width: 100%;
            display: flex;
            justify-content: flex-start;
            align-items: center;
          }
          .footer-logo img {
            height: 50px;
            width: auto;
            object-fit: contain;
          }
          .footer-info {
            width: 100%;
            text-align: right;
            font-size: 10pt;
            color: #333;
            line-height: 1.2;
          }
          .footer-info p {
            margin: 4px 0;
            color: #333;
          }
        </style>
      </head>
      <body>
        <div class="contract-a4-page">
          ${headerLogoHtml}
          ${centerLogoHtml}
          <div class="contract-content">${contract.content}</div>
          ${footerHtml}
        </div>
      </body>
      </html>
    `;

    const puppeteer = await import("npm:puppeteer-core@21.6.1");
    const chromium = await import("https://deno.land/x/puppeteer@16.2.0/src/deno/Puppeteer.ts");

    const browser = await puppeteer.default.launch({
      executablePath: await chromium.default.executablePath(),
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const page = await browser.newPage();
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
    
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '20mm',
        bottom: '20mm',
        left: '20mm',
      },
    });

    await browser.close();

    const base64Pdf = btoa(
      String.fromCharCode(...new Uint8Array(pdfBuffer))
    );

    return new Response(
      JSON.stringify({ 
        success: true, 
        pdf: base64Pdf,
        filename: `${contract.contract_number}.pdf`
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error generating PDF:", error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : "Unknown error" 
      }),
      {
        status: 400,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});