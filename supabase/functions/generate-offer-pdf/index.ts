import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GenerateOfferPdfRequest {
  offerId: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { offerId }: GenerateOfferPdfRequest = await req.json();

    if (!offerId) {
      throw new Error("offerId is required");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(`
        *,
        client:contacts(*),
        created_by_employee:employees(*),
        offer_items(
          *,
          product:offer_products(
            id,
            name,
            description,
            pdf_page_url
          )
        )
      `)
      .eq("id", offerId)
      .maybeSingle();

    if (offerError || !offer) {
      throw new Error("Offer not found: " + offerError?.message);
    }

    const mergedPdf = await PDFDocument.create();

    const productPagesWithPdf = offer.offer_items
      .filter((item: any) => item.product?.pdf_page_url)
      .sort((a: any, b: any) => a.display_order - b.display_order);

    for (const item of productPagesWithPdf) {
      try {
        const pdfPath = item.product.pdf_page_url;
        
        const { data: pdfData, error: downloadError } = await supabase.storage
          .from('offer-product-pages')
          .download(pdfPath);

        if (downloadError || !pdfData) {
          console.error(`Failed to download PDF for product ${item.product.name}:`, downloadError);
          continue;
        }

        const arrayBuffer = await pdfData.arrayBuffer();
        const productPdf = await PDFDocument.load(arrayBuffer);
        
        const copiedPages = await mergedPdf.copyPages(productPdf, productPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      } catch (error) {
        console.error(`Error processing PDF for product ${item.product.name}:`, error);
      }
    }

    if (mergedPdf.getPageCount() === 0) {
      throw new Error("No PDF pages found in products. Please add PDF pages to products first.");
    }

    const pdfBytes = await mergedPdf.save();

    const fileName = `offer-${offerId}-${Date.now()}.pdf`;
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('generated-offers')
      .upload(fileName, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      throw new Error("Failed to upload PDF: " + uploadError.message);
    }

    const { error: updateError } = await supabase
      .from('offers')
      .update({ generated_pdf_url: fileName })
      .eq('id', offerId);

    if (updateError) {
      throw new Error("Failed to update offer: " + updateError.message);
    }

    const { data: signedUrlData } = await supabase.storage
      .from('generated-offers')
      .createSignedUrl(fileName, 3600);

    return new Response(
      JSON.stringify({
        success: true,
        message: "Offer PDF generated successfully",
        fileName: fileName,
        pageCount: mergedPdf.getPageCount(),
        downloadUrl: signedUrlData?.signedUrl,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error generating offer PDF:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to generate offer PDF",
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});