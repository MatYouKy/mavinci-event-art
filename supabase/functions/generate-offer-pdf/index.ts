import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, appendBezierCurve, closePath, clip, endPath } from "npm:pdf-lib@1.17.1";
import fontkit from "npm:@pdf-lib/fontkit@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface GenerateOfferPdfRequest {
  offerId: string;
  employeeId?: string;
}

interface TextFieldConfig {
  field_name: string;
  label: string;
  x: number;
  y: number;
  type?: 'text' | 'image';
  font_size?: number;
  font_color?: string;
  max_width?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  border_radius?: number;
  is_circular?: boolean;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { offerId, employeeId }: GenerateOfferPdfRequest = await req.json();

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
        organization:organizations(*, location:locations(*)),
        event:events(*, location:locations(*)),
        created_by_employee:employees!created_by(
          id,
          name,
          surname,
          email,
          phone_number,
          avatar_url,
          avatar_metadata
        ),
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

    let currentEmployee: any = null;
    if (employeeId) {
      const { data: empData } = await supabase
        .from("employees")
        .select("id, name, surname, email, phone_number, avatar_url, avatar_metadata")
        .eq("id", employeeId)
        .maybeSingle();

      currentEmployee = empData;
    }

    if (!currentEmployee) {
      currentEmployee = offer.created_by_employee || {};
      console.log('Using offer creator employee (fallback):', currentEmployee.id);
    } else {
      console.log('Using logged-in employee:', currentEmployee.id);
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
        employee_avatar_metadata: employee.avatar_metadata || null,

        seller_name: 'Mavinci Event & Entertainment',
        seller_address: 'ul. Przykładowa 1, 00-000 Warszawa',
        seller_nip: 'NIP: 1234567890',
      };

      console.log('Prepared offer data:', JSON.stringify(data, null, 2));
      return data;
    };

    const wrapText = (text: string, font: any, fontSize: number, maxWidth: number): string[] => {
      const words = text.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        const testLine = currentLine ? `${currentLine} ${word}` : word;
        const width = font.widthOfTextAtSize(testLine, fontSize);

        if (width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      }

      if (currentLine) {
        lines.push(currentLine);
      }

      return lines;
    };

    const overlayTextOnPages = async (
      pdfDoc: PDFDocument,
      startPageIndex: number,
      pageCount: number,
      textFields: TextFieldConfig[],
      data: Record<string, string>
    ) => {
      if (!textFields || textFields.length === 0) return;

      pdfDoc.registerFontkit(fontkit);

      const regularFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf';
      const boldFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf';

      const regularFontBytes = await fetch(regularFontUrl).then(res => res.arrayBuffer());
      const boldFontBytes = await fetch(boldFontUrl).then(res => res.arrayBuffer());

      const regularFont = await pdfDoc.embedFont(regularFontBytes);
      const boldFont = await pdfDoc.embedFont(boldFontBytes);

      const pages = pdfDoc.getPages();

      for (let i = startPageIndex; i < startPageIndex + pageCount && i < pages.length; i++) {
        const page = pages[i];
        const { height } = page.getSize();

        for (const field of textFields) {
          const value = data[field.field_name] || '';

          console.log(`Processing field ${field.field_name}: type=${field.type}, value="${value}"`);

          if (!value) {
            console.log(`Skipping field ${field.field_name} - no value`);
            continue;
          }

          if (field.type === 'image') {
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

              const isCircular = field.is_circular || field.field_name.includes('avatar');

              console.log(`Drawing image at x=${field.x}, y=${y}, width=${imgWidth}, height=${imgHeight}, circular=${isCircular}`);

              if (isCircular) {
                const size = Math.min(imgWidth, imgHeight);
                const radius = size / 2;
                const centerX = field.x + radius;
                const centerY = y + radius;

                const imgDims = image.scale(1);
                const imgAspect = imgDims.width / imgDims.height;

                let metadata = null;
                if (field.field_name.includes('avatar')) {
                  const metadataValue = data['employee_avatar_metadata'];
                  if (metadataValue && typeof metadataValue === 'object') {
                    metadata = metadataValue;
                  } else if (typeof metadataValue === 'string') {
                    try {
                      metadata = JSON.parse(metadataValue);
                    } catch (e) {
                      console.error('Failed to parse avatar metadata:', e);
                    }
                  }
                }

                const positionData = metadata?.desktop?.position;
                const scale = positionData?.scale || 1;
                const posXPercent = positionData?.posX || 50;
                const posYPercent = positionData?.posY || 50;

                console.log(`Avatar positioning: scale=${scale}, posX=${posXPercent}%, posY=${posYPercent}%`);

                let drawWidth = size * scale;
                let drawHeight = size * scale;

                if (imgAspect > 1) {
                  drawWidth = size * imgAspect * scale;
                  drawHeight = size * scale;
                } else if (imgAspect < 1) {
                  drawWidth = size * scale;
                  drawHeight = (size / imgAspect) * scale;
                }

                const maxOffsetX = drawWidth - size;
                const maxOffsetY = drawHeight - size;

                const offsetX = -(maxOffsetX * posXPercent / 100);
                const offsetY = -(maxOffsetY * posYPercent / 100);

                const kappa = 0.5522847498;
                const ox = radius * kappa;
                const oy = radius * kappa;

                page.pushOperators(
                  pushGraphicsState(),
                  moveTo(centerX, centerY + radius),
                  appendBezierCurve(centerX + ox, centerY + radius, centerX + radius, centerY + oy, centerX + radius, centerY),
                  appendBezierCurve(centerX + radius, centerY - oy, centerX + ox, centerY - radius, centerX, centerY - radius),
                  appendBezierCurve(centerX - ox, centerY - radius, centerX - radius, centerY - oy, centerX - radius, centerY),
                  appendBezierCurve(centerX - radius, centerY + oy, centerX - ox, centerY + radius, centerX, centerY + radius),
                  closePath(),
                  clip(),
                  endPath()
                );

                page.drawImage(image, {
                  x: field.x + offsetX,
                  y: y + offsetY,
                  width: drawWidth,
                  height: drawHeight,
                });

                page.pushOperators(popGraphicsState());

              } else {
                page.drawImage(image, {
                  x: field.x,
                  y: y,
                  width: imgWidth,
                  height: imgHeight,
                });
              }
            } catch (error) {
              console.error(`Error drawing image ${field.field_name}:`, error);
            }
            continue;
          }

          const fontSize = field.font_size || 12;
          const font = field.field_name.includes('name') || field.field_name.includes('title')
            ? boldFont
            : regularFont;

          const colorMatch = field.font_color?.match(/^#([0-9A-F]{2})([0-9A-F]{2})([0-9A-F]{2})$/i);
          const color = colorMatch
            ? rgb(
                parseInt(colorMatch[1], 16) / 255,
                parseInt(colorMatch[2], 16) / 255,
                parseInt(colorMatch[3], 16) / 255
              )
            : rgb(0, 0, 0);

          const lines = field.max_width
            ? wrapText(value, font, fontSize, field.max_width)
            : [value];

          const lineHeight = fontSize * 1.2;

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            let x = field.x;
            const y = height - field.y - fontSize - (lineIndex * lineHeight);

            if (field.align === 'center' && field.max_width) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              x = field.x + (field.max_width - textWidth) / 2;
            } else if (field.align === 'right' && field.max_width) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              x = field.x + field.max_width - textWidth;
            }

            console.log(`Drawing line ${lineIndex + 1}/${lines.length}: "${line}" at x=${x}, y=${y}`);

            page.drawText(line, {
              x,
              y,
              size: fontSize,
              font,
              color,
            });
          }
        }
      }
    };

    const mergedPdf = await PDFDocument.create();
    const offerData = prepareOfferData(offer, currentEmployee);

    const addPdfFromTemplate = async (templateType: string) => {
      try {
        const { data: template } = await supabase
          .from('offer_page_templates')
          .select('pdf_url, text_fields_config')
          .eq('type', templateType)
          .eq('is_default', true)
          .eq('is_active', true)
          .maybeSingle();

        if (template?.pdf_url) {
          const { data: pdfData } = await supabase.storage
            .from('offer-template-pages')
            .download(template.pdf_url);

          if (pdfData) {
            const arrayBuffer = await pdfData.arrayBuffer();
            const templatePdf = await PDFDocument.load(arrayBuffer);

            const startPageIndex = mergedPdf.getPageCount();
            const copiedPages = await mergedPdf.copyPages(templatePdf, templatePdf.getPageIndices());
            copiedPages.forEach((page) => mergedPdf.addPage(page));

            if (template.text_fields_config && Array.isArray(template.text_fields_config)) {
              await overlayTextOnPages(
                mergedPdf,
                startPageIndex,
                copiedPages.length,
                template.text_fields_config as TextFieldConfig[],
                offerData
              );
            }

            return true;
          }
        }
      } catch (error) {
        console.error(`Error adding ${templateType} template:`, error);
      }
      return false;
    };

    await addPdfFromTemplate('cover');
    await addPdfFromTemplate('about');

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

    await addPdfFromTemplate('final');

    if (mergedPdf.getPageCount() === 0) {
      throw new Error("No PDF pages found. Please add PDF pages to templates or products first.");
    }

    const pdfBytes = await mergedPdf.save();

    const sanitizeFileName = (name: string) => {
      return name
        .replace(/[^a-zA-Z0-9\u0105\u0107\u0119\u0142\u0144\u00f3\u015b\u017a\u017c\u0104\u0106\u0118\u0141\u0143\u00d3\u015a\u0179\u017b\s\-_]/g, '')
        .replace(/\s+/g, '-')
        .toLowerCase();
    };

    const offerName = offer.name ? sanitizeFileName(offer.name) : (offer.offer_number || offerId);
    const fileName = `oferta-${offerName}.pdf`;
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