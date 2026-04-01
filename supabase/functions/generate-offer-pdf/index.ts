import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, appendBezierCurve, closePath, clip, endPath, PDFName, PDFDict, PDFString, PDFArray, PDFNumber } from "npm:pdf-lib@1.17.1";
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
  type?: 'text' | 'image' | 'email' | 'phone';
  font_size?: number;
  font_color?: string;
  max_width?: number;
  align?: 'left' | 'center' | 'right';
  width?: number;
  height?: number;
  border_radius?: number;
  is_circular?: boolean;
  icon_id?: string;
  clickable?: boolean;
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
            pdf_page_url,
            vat_rate
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
        total_price_numeric: offer.total_price || 0,

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

        offer_items: offer.offer_items || [],
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

    const drawOfferItemsTable = async (
      pdfDoc: PDFDocument,
      pageIndex: number,
      offerItems: any[],
      totalPrice: number,
      config: any = {}
    ) => {
      if (!offerItems || offerItems.length === 0) return;

      pdfDoc.registerFontkit(fontkit);

      const regularFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf';
      const boldFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf';

      const regularFontBytes = await fetch(regularFontUrl).then(res => res.arrayBuffer());
      const boldFontBytes = await fetch(boldFontUrl).then(res => res.arrayBuffer());

      const regularFont = await pdfDoc.embedFont(regularFontBytes);
      const boldFont = await pdfDoc.embedFont(boldFontBytes);

      const pages = pdfDoc.getPages();
      const page = pages[pageIndex];
      const { width, height } = page.getSize();

      const startY = config.start_y || 200;
      const showUnitPriceNet = config.show_unit_price_net !== false;
      const showValueNet = config.show_value_net !== false;
      const showValueGross = config.show_value_gross !== false;
      const defaultVatRate = config.vat_rate || 23;

      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? rgb(
          parseInt(result[1], 16) / 255,
          parseInt(result[2], 16) / 255,
          parseInt(result[3], 16) / 255
        ) : rgb(0.827, 0.733, 0.451);
      };

      const headerColor = config.header_color ? hexToRgb(config.header_color) : rgb(0.827, 0.733, 0.451);
      const textColor = config.text_color ? hexToRgb(config.text_color) : rgb(0.11, 0.12, 0.2);
      const rowBgColor = config.row_bg_color ? hexToRgb(config.row_bg_color) : rgb(0.95, 0.95, 0.95);

      const margin = 50;
      const tableWidth = width - 2 * margin;

      const colWidths = {
        lp: 30,
        name: 180,
        quantity: 50,
        unit: 45,
        unitPriceNet: showUnitPriceNet ? 70 : 0,
        valueNet: showValueNet ? 80 : 0,
        valueGross: showValueGross ? 80 : 0,
      };

      const totalColWidth = colWidths.lp + colWidths.name + colWidths.quantity + colWidths.unit +
                            colWidths.unitPriceNet + colWidths.valueNet + colWidths.valueGross;

      if (totalColWidth < tableWidth) {
        colWidths.name = tableWidth - (totalColWidth - colWidths.name);
      }

      let y = height - startY;
      const rowHeight = 25;
      const fontSize = 10;
      const headerFontSize = 11;

      page.drawRectangle({
        x: margin,
        y: y - headerFontSize - 10,
        width: tableWidth,
        height: headerFontSize + 15,
        color: headerColor,
      });

      const headers = [
        { text: 'Lp.', x: margin + 5, width: colWidths.lp },
        { text: 'Nazwa pozycji', x: margin + colWidths.lp + 5, width: colWidths.name },
        { text: 'Ilość', x: margin + colWidths.lp + colWidths.name + 5, width: colWidths.quantity },
        { text: 'Jedn.', x: margin + colWidths.lp + colWidths.name + colWidths.quantity + 5, width: colWidths.unit },
      ];

      let currentX = margin + colWidths.lp + colWidths.name + colWidths.quantity + colWidths.unit;

      if (showUnitPriceNet) {
        headers.push({ text: 'Cena jedn. netto', x: currentX + 5, width: colWidths.unitPriceNet });
        currentX += colWidths.unitPriceNet;
      }

      if (showValueNet) {
        headers.push({ text: 'Wartość netto', x: currentX + 5, width: colWidths.valueNet });
        currentX += colWidths.valueNet;
      }

      if (showValueGross) {
        headers.push({ text: 'Wartość brutto', x: currentX + 5, width: colWidths.valueGross });
      }

      for (const header of headers) {
        page.drawText(header.text, {
          x: header.x,
          y: y - headerFontSize - 5,
          size: headerFontSize,
          font: boldFont,
          color: rgb(1, 1, 1),
        });
      }

      y -= headerFontSize + 20;

      let totalNet = 0;
      let totalGross = 0;

      offerItems.forEach((item, index) => {
        const isEven = index % 2 === 0;
        if (isEven) {
          page.drawRectangle({
            x: margin,
            y: y - rowHeight + 5,
            width: tableWidth,
            height: rowHeight,
            color: rowBgColor,
          });
        }

        const itemName = item.name || item.product?.name || 'Pozycja';
        const quantity = item.quantity || 1;
        const unit = item.unit || 'szt';
        const unitPrice = item.unit_price || item.final_price || 0;
        const vatRate = item.product?.vat_rate || item.vat_rate || defaultVatRate;

        const valueNet = quantity * unitPrice;
        const valueGross = valueNet * (1 + vatRate / 100);

        totalNet += valueNet;
        totalGross += valueGross;

        page.drawText(`${index + 1}.`, {
          x: margin + 5,
          y: y - fontSize - 5,
          size: fontSize,
          font: regularFont,
          color: textColor,
        });

        page.drawText(itemName, {
          x: margin + colWidths.lp + 5,
          y: y - fontSize - 5,
          size: fontSize,
          font: regularFont,
          color: textColor,
        });

        page.drawText(quantity.toString(), {
          x: margin + colWidths.lp + colWidths.name + 5,
          y: y - fontSize - 5,
          size: fontSize,
          font: regularFont,
          color: textColor,
        });

        page.drawText(unit, {
          x: margin + colWidths.lp + colWidths.name + colWidths.quantity + 5,
          y: y - fontSize - 5,
          size: fontSize,
          font: regularFont,
          color: textColor,
        });

        let currentX = margin + colWidths.lp + colWidths.name + colWidths.quantity + colWidths.unit;

        if (showUnitPriceNet) {
          const unitPriceText = `${unitPrice.toFixed(2)}`;
          const unitPriceWidth = regularFont.widthOfTextAtSize(unitPriceText, fontSize);
          page.drawText(unitPriceText, {
            x: currentX + colWidths.unitPriceNet - unitPriceWidth - 5,
            y: y - fontSize - 5,
            size: fontSize,
            font: regularFont,
            color: textColor,
          });
          currentX += colWidths.unitPriceNet;
        }

        if (showValueNet) {
          const valueNetText = `${valueNet.toFixed(2)}`;
          const valueNetWidth = regularFont.widthOfTextAtSize(valueNetText, fontSize);
          page.drawText(valueNetText, {
            x: currentX + colWidths.valueNet - valueNetWidth - 5,
            y: y - fontSize - 5,
            size: fontSize,
            font: regularFont,
            color: textColor,
          });
          currentX += colWidths.valueNet;
        }

        if (showValueGross) {
          const valueGrossText = `${valueGross.toFixed(2)}`;
          const valueGrossWidth = regularFont.widthOfTextAtSize(valueGrossText, fontSize);
          page.drawText(valueGrossText, {
            x: currentX + colWidths.valueGross - valueGrossWidth - 5,
            y: y - fontSize - 5,
            size: fontSize,
            font: regularFont,
            color: textColor,
          });
        }

        y -= rowHeight;
      });

      y -= 10;
      page.drawLine({
        start: { x: margin, y: y },
        end: { x: margin + tableWidth, y: y },
        thickness: 2,
        color: headerColor,
      });

      y -= 25;

      const summaryStartX = margin + colWidths.lp + colWidths.name + colWidths.quantity + colWidths.unit;

      if (showUnitPriceNet) {
        page.drawText('', {
          x: summaryStartX,
          y: y,
          size: headerFontSize,
          font: boldFont,
          color: textColor,
        });
      }

      let summaryX = summaryStartX;
      if (showUnitPriceNet) summaryX += colWidths.unitPriceNet;

      if (showValueNet) {
        page.drawText('SUMA NETTO:', {
          x: summaryX - 60,
          y: y,
          size: headerFontSize - 1,
          font: boldFont,
          color: textColor,
        });

        const totalNetText = `${totalNet.toFixed(2)} PLN`;
        const totalNetWidth = boldFont.widthOfTextAtSize(totalNetText, headerFontSize);
        page.drawText(totalNetText, {
          x: summaryX + colWidths.valueNet - totalNetWidth - 5,
          y: y,
          size: headerFontSize,
          font: boldFont,
          color: headerColor,
        });
        summaryX += colWidths.valueNet;
      }

      if (showValueGross) {
        if (showValueNet) {
          y -= 20;
          summaryX = summaryStartX;
          if (showUnitPriceNet) summaryX += colWidths.unitPriceNet;
          if (showValueNet) summaryX += colWidths.valueNet;
        }

        page.drawText('SUMA BRUTTO:', {
          x: summaryX - 65,
          y: y,
          size: headerFontSize - 1,
          font: boldFont,
          color: textColor,
        });

        const totalGrossText = `${totalGross.toFixed(2)} PLN`;
        const totalGrossWidth = boldFont.widthOfTextAtSize(totalGrossText, headerFontSize);
        page.drawText(totalGrossText, {
          x: summaryX + colWidths.valueGross - totalGrossWidth - 5,
          y: y,
          size: headerFontSize,
          font: boldFont,
          color: headerColor,
        });
      }

      console.log(`Drew offer items table with ${offerItems.length} items, total net: ${totalNet.toFixed(2)} PLN, total gross: ${totalGross.toFixed(2)} PLN`);
    };

    const overlayTextOnPages = async (
      pdfDoc: PDFDocument,
      startPageIndex: number,
      pageCount: number,
      textFields: TextFieldConfig[],
      data: Record<string, any>
    ) => {
      if (!textFields || textFields.length === 0) return;

      pdfDoc.registerFontkit(fontkit);

      const regularFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf';
      const boldFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf';
      const symbolsFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf';

      const regularFontBytes = await fetch(regularFontUrl).then(res => res.arrayBuffer());
      const boldFontBytes = await fetch(boldFontUrl).then(res => res.arrayBuffer());
      const symbolsFontBytes = await fetch(symbolsFontUrl).then(res => res.arrayBuffer()).catch(() => null);

      const regularFont = await pdfDoc.embedFont(regularFontBytes);
      const boldFont = await pdfDoc.embedFont(boldFontBytes);
      const symbolsFont = symbolsFontBytes ? await pdfDoc.embedFont(symbolsFontBytes) : regularFont;

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

                  console.log('Raw metadata:', JSON.stringify(metadata, null, 2));
                }

                const positionData = metadata?.desktop?.position;
                const baseScale = positionData?.scale !== undefined ? positionData.scale : 1;
                const scale = baseScale * 0.85;
                const posXPercent = positionData?.posX !== undefined ? positionData.posX : 0;
                const posYPercent = positionData?.posY !== undefined ? positionData.posY : 0;

                console.log(`Avatar positioning: baseScale=${baseScale}, finalScale=${scale}, posX=${posXPercent}%, posY=${posYPercent}%, raw position data:`, positionData);

                let drawWidth = size * scale;
                let drawHeight = size * scale;

                if (imgAspect > 1) {
                  drawWidth = size * imgAspect * scale;
                  drawHeight = size * scale;
                } else if (imgAspect < 1) {
                  drawWidth = size * scale;
                  drawHeight = (size / imgAspect) * scale;
                }

                const maxOffsetX = (drawWidth - size) / 2;
                const maxOffsetY = (drawHeight - size) / 2;

                const offsetX = (posXPercent / 50) * maxOffsetX;
                const offsetY = -(posYPercent / 50) * maxOffsetY;

                const imageX = centerX - drawWidth / 2 + offsetX;
                const imageY = centerY - drawHeight / 2 + offsetY;

                console.log(`Avatar calculations:
  - Image size: ${imgDims.width} x ${imgDims.height} (aspect: ${imgAspect.toFixed(2)})
  - Circle size: ${size}px, radius: ${radius}px
  - Circle center: X=${centerX.toFixed(1)}, Y=${centerY.toFixed(1)}
  - Draw size: ${drawWidth.toFixed(1)} x ${drawHeight.toFixed(1)}
  - Max offset: X=${maxOffsetX.toFixed(1)}, Y=${maxOffsetY.toFixed(1)}
  - Position %: X=${posXPercent}, Y=${posYPercent}
  - Final offset: X=${offsetX.toFixed(1)}, Y=${offsetY.toFixed(1)}
  - Image draw position: X=${imageX.toFixed(1)}, Y=${imageY.toFixed(1)}`);

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
                  x: imageX,
                  y: imageY,
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

          const isEmail = field.type === 'email' || field.field_name.includes('email');
          const isPhone = field.type === 'phone' || field.field_name.includes('phone');
          const iconSize = fontSize * 0.9;
          const iconPadding = 4;

          let iconSymbol = '';
          if (isEmail) {
            iconSymbol = '✉';
          } else if (isPhone) {
            iconSymbol = '☎';
          }

          const lines = field.max_width
            ? wrapText(value, font, fontSize, field.max_width)
            : [value];

          const lineHeight = fontSize * 1.2;

          for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
            const line = lines[lineIndex];
            let x = field.x;
            const y = height - field.y - fontSize - (lineIndex * lineHeight);

            let iconWidth = 0;
            if (iconSymbol) {
              try {
                iconWidth = symbolsFont.widthOfTextAtSize(iconSymbol, iconSize);
              } catch {
                iconWidth = fontSize;
              }
              x += iconWidth + iconPadding;
            }

            if (field.align === 'center' && field.max_width) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const totalWidth = iconSymbol ? textWidth + iconWidth + iconPadding : textWidth;
              x = field.x + (field.max_width - totalWidth) / 2;
              if (iconSymbol) {
                x += iconWidth + iconPadding;
              }
            } else if (field.align === 'right' && field.max_width) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const totalWidth = iconSymbol ? textWidth + iconWidth + iconPadding : textWidth;
              x = field.x + field.max_width - totalWidth;
              if (iconSymbol) {
                x += iconWidth + iconPadding;
              }
            }

            if (iconSymbol && lineIndex === 0) {
              try {
                const iconWidth = symbolsFont.widthOfTextAtSize(iconSymbol, iconSize);
                page.drawText(iconSymbol, {
                  x: x - iconWidth - iconPadding,
                  y: y,
                  size: iconSize,
                  font: symbolsFont,
                  color: rgb(0.8, 0.7, 0.45),
                });
              } catch (error) {
                console.error('Error drawing icon:', error);
              }
            }

            console.log(`Drawing line ${lineIndex + 1}/${lines.length}: "${line}" at x=${x}, y=${y}`);

            page.drawText(line, {
              x,
              y,
              size: fontSize,
              font,
              color,
            });

            if ((isEmail || isPhone) && lineIndex === 0) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const linkUri = isEmail ? `mailto:${line}` : `tel:${line.replace(/\s/g, '')}`;

              try {
                const linkAnnotation = pdfDoc.context.obj({
                  Type: 'Annot',
                  Subtype: 'Link',
                  Rect: [x, y - 2, x + textWidth, y + fontSize],
                  Border: [0, 0, 0],
                  C: [0, 0, 1],
                  A: {
                    S: 'URI',
                    URI: PDFString.of(linkUri),
                  },
                });

                const linkAnnotationRef = pdfDoc.context.register(linkAnnotation);

                const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray) || pdfDoc.context.obj([]);
                annotations.push(linkAnnotationRef);
                page.node.set(PDFName.of('Annots'), annotations);
              } catch (error) {
                console.error('Error adding link annotation:', error);
              }
            }
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
          .select('pdf_url, text_fields_config, table_config')
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

            return { success: true, tableConfig: template.table_config };
          }
        }
      } catch (error) {
        console.error(`Error adding ${templateType} template:`, error);
      }
      return { success: false };
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

    const pricingResult = await addPdfFromTemplate('pricing');
    if (pricingResult.success && offerData.offer_items.length > 0) {
      const pricingPageIndex = mergedPdf.getPageCount() - 1;
      await drawOfferItemsTable(
        mergedPdf,
        pricingPageIndex,
        offerData.offer_items,
        offerData.total_price_numeric,
        pricingResult.tableConfig || {}
      );
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
      .update({
        generated_pdf_url: fileName,
        modified_after_generation: false
      })
      .eq('id', offerId);

    if (updateError) {
      throw new Error("Failed to update offer: " + updateError.message);
    }

    if (offer.event_id) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const eventFileName = `oferta-${offerName}-${timestamp}.pdf`;
      const eventFilePath = `${offer.event_id}/${eventFileName}`;

      const { error: eventUploadError } = await supabase.storage
        .from('event-files')
        .upload(eventFilePath, pdfBytes, {
          contentType: 'application/pdf',
          upsert: false,
        });

      if (!eventUploadError) {
        const { data: folderId } = await supabase.rpc('get_or_create_documents_subfolder', {
          p_event_id: offer.event_id,
          p_subfolder_name: 'Oferty',
          p_required_permission: 'offers_create',
          p_created_by: currentEmployee?.id || offer.created_by,
        });

        await supabase.from('event_files').insert([
          {
            event_id: offer.event_id,
            folder_id: folderId,
            name: eventFileName,
            original_name: eventFileName,
            file_path: eventFilePath,
            file_size: pdfBytes.length,
            mime_type: 'application/pdf',
            document_type: 'offer',
            offer_id: offerId,
            thumbnail_url: null,
            uploaded_by: currentEmployee?.id || offer.created_by,
          },
        ]);
        console.log('Offer PDF saved to event files');
      } else {
        console.error('Failed to save offer PDF to event files:', eventUploadError);
      }
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