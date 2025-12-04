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
      .select("*")
      .eq("id", contractId)
      .maybeSingle();

    if (error || !contract) {
      throw new Error("Contract not found");
    }

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          @page {
            size: A4;
            margin: 2cm;
          }
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            color: #333;
          }
          h1 {
            text-align: center;
            margin-bottom: 30px;
            color: #1a1a1a;
            font-size: 24px;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            padding-bottom: 20px;
            border-bottom: 2px solid #d3bb73;
          }
          .contract-number {
            color: #d3bb73;
            font-size: 14px;
            font-weight: bold;
          }
          .content {
            white-space: pre-wrap;
            font-size: 12px;
          }
          .footer {
            margin-top: 50px;
            padding-top: 20px;
            border-top: 1px solid #ccc;
            font-size: 10px;
            color: #666;
            text-align: center;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${contract.title || 'Umowa'}</h1>
          <div class="contract-number">Numer: ${contract.contract_number}</div>
        </div>
        <div class="content">${contract.content}</div>
        <div class="footer">
          Wygenerowano: ${new Date().toLocaleString('pl-PL')}
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