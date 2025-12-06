import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GenerateOfferPdfRequest {
  offerId: string;
}

interface TextFieldConfig {
  field_name: string;
  label: string;
  x: number;
  y: number;
  type?: 'text' | 'image';
  font_size?: number;
  font_color?: string;
  font_weight?: 'normal' | 'bold';
  letter_spacing?: number;
  line_height?: number;
  max_width?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  border_radius?: number;
  sample_text?: string;
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

    const authHeader = req.headers.get("Authorization");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authHeader!,
        },
      },
    });

    const { data: { user } } = await supabaseClient.auth.getUser();

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: offer, error: offerError } = await supabase
      .from("offers")
      .select(`
        *,
        organization:organizations(*, location:locations(*)),
        event:events(*, location:locations(*)),
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

    const { data: currentEmployee, error: employeeError } = await supabase
      .from("employees")
      .select("id, name, surname, email, phone_number, avatar_url")
      .eq("id", user?.id)
      .maybeSingle();

    if (employeeError) {
      console.error("Error fetching employee:", employeeError);
    }

    const prepareOfferData = (offer: any, employee: any) => {
      const org = offer.organization;
      const event = offer.event;
      const location = org?.location || {};
      const eventLocation = event?.location || {};

      const data = {
        client_name: org?.name || '',
        client_address: location.address || `${location.street || ''} ${location.city || ''}`.trim(),
        client_nip: org?.nip || '',
        client_city: location.city || '',
        client_postal_code: location.postal_code || '',
        client_street: location.street || '',

        offer_number: offer.offer_number || '',
        offer_name: offer.name || '',
        offer_date: offer.created_at ? new Date(offer.created_at).toLocaleDateString('pl-PL') : '',

        event_name: event?.name || '',
        event_date: event?.start_date ? new Date(event.start_date).toLocaleDateString('pl-PL') : '',
        event_location: eventLocation.address || eventLocation.city || '',

        total_price: offer.total_price ? `${offer.total_price.toFixed(2)} PLN` : '',

        employee_first_name: employee.name || '',
        employee_last_name: employee.surname || '',
        employee_full_name: employee.name && employee.surname
          ? `${employee.name} ${employee.surname}`
          : '',
        employee_email: employee.email || '',
        employee_phone: employee.phone_number || '',
        employee_avatar_url: employee.avatar_url || '',

        seller_name: 'Mavinci Event & Entertainment',
        seller_address: 'ul. Przykładowa 1, 00-000 Warszawa',
        seller_nip: 'NIP: 1234567890',
      };

      console.log('Prepared offer data:', JSON.stringify(data, null, 2));
      return data;
    };

    const renderTextFields = async (
      page: any,
      fields: TextFieldConfig[],
      data: any,
      pdfDoc: any,
      regularFont: any,
      boldFont: any
    ) => {
      const { width, height } = page.getSize();

      for (const field of fields) {
        const value = data[field.field_name];
        if (!value) {
          console.log(`Skipping field ${field.field_name} - no value`);
          continue;
        }

        if (field.type === 'image') {
          if (typeof value !== 'string' || !value.startsWith('http')) {
            console.log(`Skipping image field ${field.field_name} - invalid URL`);
            continue;
          }

          try {
            console.log(`Fetching image from URL: ${value}`);
            const imageResponse = await fetch(value);
            if (!imageResponse.ok) {
              console.error(`Failed to fetch image: ${imageResponse.status}`);
              continue;
            }

            const imageBytes = await imageResponse.arrayBuffer();
            const imageType = imageResponse.headers.get('content-type');

            let image;
            if (imageType?.includes('png')) {
              image = await pdfDoc.embedPng(imageBytes);
            } else if (imageType?.includes('jpeg') || imageType?.includes('jpg')) {
              image = await pdfDoc.embedJpg(imageBytes);
            } else {
              console.error(`Unsupported image type: ${imageType}`);
              continue;
            }

            const imgWidth = field.width || 100;
            const imgHeight = field.height || 100;
            const y = height - field.y - imgHeight;

            console.log(`Drawing image at x=${field.x}, y=${y}, width=${imgWidth}, height=${imgHeight}`);

            page.drawImage(image, {
              x: field.x,
              y: y,
              width: imgWidth,
              height: imgHeight,
            });
          } catch (error) {
            console.error(`Error drawing image ${field.field_name}:`, error);
          }
          continue;
        }

        const fontSize = field.font_size || 12;
        const font = field.font_weight === 'bold' ? boldFont : regularFont;

        const colorMatch = field.font_color?.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
        const color = colorMatch
          ? rgb(
              parseInt(colorMatch[1], 16) / 255,
              parseInt(colorMatch[2], 16) / 255,
              parseInt(colorMatch[3], 16) / 255
            )
          : rgb(0, 0, 0);

        const textValue = String(value);
        const lineHeight = field.line_height || 1.5;

        const textWidth = font.widthOfTextAtSize(textValue, fontSize);
        const maxWidth = field.max_width || width - field.x - 20;

        let x = field.x;
        if (field.align === 'center') {
          x = field.x - textWidth / 2;
        } else if (field.align === 'right') {
          x = field.x - textWidth;
        }

        const y = height - field.y - (fontSize * lineHeight);

        console.log(`Drawing text "${textValue}" at x=${x}, y=${y}, fontSize=${fontSize}, weight=${field.font_weight}, lineHeight=${lineHeight}`);

        if (field.letter_spacing && field.letter_spacing !== 0) {
          const chars = textValue.split('');
          let currentX = x;

          for (const char of chars) {
            page.drawText(char, {
              x: currentX,
              y,
              size: fontSize,
              font,
              color,
            });
            const charWidth = font.widthOfTextAtSize(char, fontSize);
            currentX += charWidth + field.letter_spacing;
          }
        } else {
          page.drawText(textValue, {
            x,
            y,
            size: fontSize,
            font,
            color,
            maxWidth,
            lineHeight: fontSize * lineHeight,
          });
        }

        if (field.field_name === 'employee_email' && textValue) {
          const textWidthActual = font.widthOfTextAtSize(textValue, fontSize);
          const linkHeight = fontSize * (lineHeight || 1.5);

          page.node.set('Annots', [
            pdfDoc.context.obj({
              Type: 'Annot',
              Subtype: 'Link',
              Rect: [x, y, x + textWidthActual, y + linkHeight],
              Border: [0, 0, 0],
              A: {
                Type: 'Action',
                S: 'URI',
                URI: `mailto:${textValue}`
              }
            })
          ]);
        }

        if (field.field_name === 'employee_phone' && textValue) {
          const textWidthActual = font.widthOfTextAtSize(textValue, fontSize);
          const linkHeight = fontSize * (lineHeight || 1.5);
          const cleanPhone = textValue.replace(/\s/g, '');

          page.node.set('Annots', [
            pdfDoc.context.obj({
              Type: 'Annot',
              Subtype: 'Link',
              Rect: [x, y, x + textWidthActual, y + linkHeight],
              Border: [0, 0, 0],
              A: {
                Type: 'Action',
                S: 'URI',
                URI: `tel:${cleanPhone}`
              }
            })
          ]);
        }
      }
    };

    const mergedPdf = await PDFDocument.create();
    const regularFont = await mergedPdf.embedFont(StandardFonts.Helvetica);
    const boldFont = await mergedPdf.embedFont(StandardFonts.HelveticaBold);

    const offerData = prepareOfferData(offer, currentEmployee || {});

    const addPdfFromTemplate = async (templateType: string) => {
      try {
        const { data: template } = await supabase
          .from("offer_page_templates")
          .select("*")
          .eq("type", templateType)
          .eq("is_active", true)
          .maybeSingle();

        if (!template || !template.pdf_url) {
          console.log(`No template found for type: ${templateType}`);
          return;
        }

        console.log(`Processing template ${templateType} from ${template.pdf_url}`);

        const pdfUrl = `${supabaseUrl}/storage/v1/object/public/offer-template-pages/${template.pdf_url}`;
        const pdfResponse = await fetch(pdfUrl);

        if (!pdfResponse.ok) {
          throw new Error(`Failed to fetch PDF: ${pdfResponse.status}`);
        }

        const pdfBytes = await pdfResponse.arrayBuffer();
        const templatePdf = await PDFDocument.load(pdfBytes);

        const [copiedPage] = await mergedPdf.copyPages(templatePdf, [0]);
        mergedPdf.addPage(copiedPage);

        if (template.text_fields_config && template.text_fields_config.length > 0) {
          await renderTextFields(copiedPage, template.text_fields_config, offerData, mergedPdf, regularFont, boldFont);
        }

        console.log(`Successfully added ${templateType} page`);
      } catch (error) {
        console.error(`Error adding ${templateType} page:`, error);
      }
    };

    await addPdfFromTemplate('cover');

    if (offer.offer_items && offer.offer_items.length > 0) {
      for (const item of offer.offer_items) {
        if (item.product?.pdf_page_url) {
          try {
            console.log(`Adding product page from ${item.product.pdf_page_url}`);

            const productPdfUrl = `${supabaseUrl}/storage/v1/object/public/offer-template-pages/${item.product.pdf_page_url}`;
            const productPdfResponse = await fetch(productPdfUrl);

            if (productPdfResponse.ok) {
              const productPdfBytes = await productPdfResponse.arrayBuffer();
              const productPdf = await PDFDocument.load(productPdfBytes);

              const productPages = productPdf.getPages();
              for (let i = 0; i < productPages.length; i++) {
                const [copiedPage] = await mergedPdf.copyPages(productPdf, [i]);
                mergedPdf.addPage(copiedPage);
              }

              console.log(`Successfully added product pages for ${item.product.name}`);
            }
          } catch (error) {
            console.error(`Error adding product page:`, error);
          }
        }
      }
    }

    await addPdfFromTemplate('pricing');
    await addPdfFromTemplate('about');
    await addPdfFromTemplate('final');

    const finalPdfBytes = await mergedPdf.save();
    const filename = `oferta-${offer.offer_number}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('generated-offers')
      .upload(filename, finalPdfBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data: signedUrlData, error: signedUrlError } = await supabase.storage
      .from('generated-offers')
      .createSignedUrl(filename, 3600);

    if (signedUrlError) {
      throw signedUrlError;
    }

    await supabase
      .from('offers')
      .update({ generated_pdf_url: filename })
      .eq('id', offerId);

    return new Response(
      JSON.stringify({
        success: true,
        pdfUrl: signedUrlData.signedUrl,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
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