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

      const hexToRgb = (hex: string) => {
        const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
        return result ? rgb(
          parseInt(result[1], 16) / 255,
          parseInt(result[2], 16) / 255,
          parseInt(result[3], 16) / 255
        ) : rgb(0.827, 0.733, 0.451);
      };

      const startY = config.start_y || 200;
      const marginLeft = config.margin_left ?? 50;
      const marginRight = config.margin_right ?? 50;
      const showUnitPriceNet = config.show_unit_price_net !== false;
      const showValueNet = config.show_value_net !== false;
      const showValueGross = config.show_value_gross !== false;
      const showVatColumn = config.show_vat_column === true;
      const showDescription = config.show_description === true;
      const defaultVatRate = config.vat_rate || 23;
      const rowHeight = config.row_height || 25;
      const headerHeight = config.header_height || 30;
      const fontSize = config.body_font_size || 10;
      const headerFontSize = config.header_font_size || 11;
      const summaryThickness = config.summary_separator_thickness ?? 2;

      const headerColor = config.header_color ? hexToRgb(config.header_color) : rgb(0.827, 0.733, 0.451);
      const headerTextColor = config.header_text_color ? hexToRgb(config.header_text_color) : rgb(1, 1, 1);
      const textColor = config.text_color ? hexToRgb(config.text_color) : rgb(0.11, 0.12, 0.2);
      const rowBgColor = config.row_bg_color ? hexToRgb(config.row_bg_color) : rgb(0.95, 0.95, 0.95);
      const rowOddBgColor = config.row_odd_bg_color ? hexToRgb(config.row_odd_bg_color) : rgb(1, 1, 1);
      const summaryColor = config.summary_color ? hexToRgb(config.summary_color) : headerColor;
      const summaryLabelColor = config.summary_label_color ? hexToRgb(config.summary_label_color) : textColor;

      const showBorders = config.show_borders === true;
      const showHBorders = config.show_horizontal_borders !== false;
      const showVBorders = config.show_vertical_borders === true;
      const showOuterBorder = config.show_outer_border === true;
      const borderWidth = config.border_width ?? 0.5;
      const borderColor = config.border_color ? hexToRgb(config.border_color) : rgb(0.8, 0.8, 0.8);

      const configTableWidth = config.table_width || 0;
      const tableWidth = configTableWidth > 0 ? configTableWidth : (width - marginLeft - marginRight);

      const colWidths: Record<string, number> = {
        lp: config.col_lp_width || 30,
        name: 0,
        quantity: config.col_qty_width || 50,
        unit: config.col_unit_width || 45,
        unitPriceNet: showUnitPriceNet ? (config.col_unit_price_width || 70) : 0,
        vat: showVatColumn ? (config.col_vat_width || 45) : 0,
        valueNet: showValueNet ? (config.col_value_net_width || 80) : 0,
        valueGross: showValueGross ? (config.col_value_gross_width || 80) : 0,
      };

      const fixedWidth = colWidths.lp + colWidths.quantity + colWidths.unit +
                         colWidths.unitPriceNet + colWidths.vat + colWidths.valueNet + colWidths.valueGross;
      colWidths.name = Math.max(80, tableWidth - fixedWidth);

      let y = height - startY;

      const drawBorderLine = (x1: number, y1: number, x2: number, y2: number) => {
        if (!showBorders) return;
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: borderWidth, color: borderColor });
      };

      page.drawRectangle({
        x: marginLeft,
        y: y - headerHeight,
        width: tableWidth,
        height: headerHeight,
        color: headerColor,
      });

      const headerDefs: { text: string; colKey: string; align: 'left' | 'right' | 'center' }[] = [
        { text: 'Lp.', colKey: 'lp', align: 'left' },
        { text: 'Nazwa pozycji', colKey: 'name', align: 'left' },
        { text: 'Ilość', colKey: 'quantity', align: 'center' },
        { text: 'Jedn.', colKey: 'unit', align: 'center' },
      ];
      if (showUnitPriceNet) headerDefs.push({ text: 'Cena jedn. netto', colKey: 'unitPriceNet', align: 'right' });
      if (showVatColumn) headerDefs.push({ text: 'VAT', colKey: 'vat', align: 'center' });
      if (showValueNet) headerDefs.push({ text: 'Wartość netto', colKey: 'valueNet', align: 'right' });
      if (showValueGross) headerDefs.push({ text: 'Wartość brutto', colKey: 'valueGross', align: 'right' });

      let hx = marginLeft;
      for (let hi = 0; hi < headerDefs.length; hi++) {
        const hd = headerDefs[hi];
        const cw = colWidths[hd.colKey];
        const textY = y - headerHeight / 2 - headerFontSize / 2 + 2;
        if (hd.align === 'right') {
          const tw = boldFont.widthOfTextAtSize(hd.text, headerFontSize);
          page.drawText(hd.text, { x: hx + cw - tw - 5, y: textY, size: headerFontSize, font: boldFont, color: headerTextColor });
        } else if (hd.align === 'center') {
          const tw = boldFont.widthOfTextAtSize(hd.text, headerFontSize);
          page.drawText(hd.text, { x: hx + (cw - tw) / 2, y: textY, size: headerFontSize, font: boldFont, color: headerTextColor });
        } else {
          page.drawText(hd.text, { x: hx + 5, y: textY, size: headerFontSize, font: boldFont, color: headerTextColor });
        }
        if (showBorders && showVBorders && hi < headerDefs.length - 1) {
          drawBorderLine(hx + cw, y, hx + cw, y - headerHeight);
        }
        hx += cw;
      }

      if (showBorders && showOuterBorder) {
        page.drawRectangle({ x: marginLeft, y: y - headerHeight, width: tableWidth, height: headerHeight, borderColor, borderWidth, color: undefined as any });
      }
      if (showBorders && showHBorders) {
        drawBorderLine(marginLeft, y - headerHeight, marginLeft + tableWidth, y - headerHeight);
      }

      y -= headerHeight;

      let totalNet = 0;
      let totalGross = 0;

      offerItems.forEach((item, index) => {
        const isEven = index % 2 === 0;
        const bgColor = isEven ? rowBgColor : rowOddBgColor;

        const descFontSize = Math.max(fontSize - 2, 7);
        const effectiveRowHeight = showDescription ? rowHeight + descFontSize + 4 : rowHeight;

        page.drawRectangle({
          x: marginLeft,
          y: y - effectiveRowHeight,
          width: tableWidth,
          height: effectiveRowHeight,
          color: bgColor,
        });

        const itemName = item.name || item.product?.name || 'Pozycja';
        const itemDesc = item.description || item.product?.description || '';
        const quantity = item.quantity || 1;
        const unit = item.unit || 'szt';
        const unitPrice = item.unit_price || item.final_price || 0;
        const vatRate = item.product?.vat_rate || item.vat_rate || defaultVatRate;

        const valueNet = quantity * unitPrice;
        const valueGross = valueNet * (1 + vatRate / 100);

        totalNet += valueNet;
        totalGross += valueGross;

        const textY = y - fontSize - (effectiveRowHeight - fontSize) / 2 + 3;
        let cx = marginLeft;

        page.drawText(`${index + 1}.`, { x: cx + 5, y: textY, size: fontSize, font: regularFont, color: textColor });
        if (showBorders && showVBorders) drawBorderLine(cx + colWidths.lp, y, cx + colWidths.lp, y - effectiveRowHeight);
        cx += colWidths.lp;

        const maxNameWidth = colWidths.name - 10;
        let truncatedName = itemName;
        while (regularFont.widthOfTextAtSize(truncatedName, fontSize) > maxNameWidth && truncatedName.length > 1) {
          truncatedName = truncatedName.slice(0, -1);
        }
        page.drawText(truncatedName, { x: cx + 5, y: showDescription ? y - fontSize - 4 : textY, size: fontSize, font: regularFont, color: textColor });
        if (showDescription && itemDesc) {
          let truncDesc = itemDesc;
          while (regularFont.widthOfTextAtSize(truncDesc, descFontSize) > maxNameWidth && truncDesc.length > 1) {
            truncDesc = truncDesc.slice(0, -1);
          }
          page.drawText(truncDesc, { x: cx + 5, y: y - fontSize - descFontSize - 6, size: descFontSize, font: regularFont, color: textColor });
        }
        if (showBorders && showVBorders) drawBorderLine(cx + colWidths.name, y, cx + colWidths.name, y - effectiveRowHeight);
        cx += colWidths.name;

        const qtyText = quantity.toString();
        const qtyW = regularFont.widthOfTextAtSize(qtyText, fontSize);
        page.drawText(qtyText, { x: cx + (colWidths.quantity - qtyW) / 2, y: textY, size: fontSize, font: regularFont, color: textColor });
        if (showBorders && showVBorders) drawBorderLine(cx + colWidths.quantity, y, cx + colWidths.quantity, y - effectiveRowHeight);
        cx += colWidths.quantity;

        const unitW = regularFont.widthOfTextAtSize(unit, fontSize);
        page.drawText(unit, { x: cx + (colWidths.unit - unitW) / 2, y: textY, size: fontSize, font: regularFont, color: textColor });
        if (showBorders && showVBorders) drawBorderLine(cx + colWidths.unit, y, cx + colWidths.unit, y - effectiveRowHeight);
        cx += colWidths.unit;

        if (showUnitPriceNet) {
          const upText = `${unitPrice.toFixed(2)}`;
          const upW = regularFont.widthOfTextAtSize(upText, fontSize);
          page.drawText(upText, { x: cx + colWidths.unitPriceNet - upW - 5, y: textY, size: fontSize, font: regularFont, color: textColor });
          if (showBorders && showVBorders) drawBorderLine(cx + colWidths.unitPriceNet, y, cx + colWidths.unitPriceNet, y - effectiveRowHeight);
          cx += colWidths.unitPriceNet;
        }

        if (showVatColumn) {
          const vatText = `${vatRate}%`;
          const vatW = regularFont.widthOfTextAtSize(vatText, fontSize);
          page.drawText(vatText, { x: cx + (colWidths.vat - vatW) / 2, y: textY, size: fontSize, font: regularFont, color: textColor });
          if (showBorders && showVBorders) drawBorderLine(cx + colWidths.vat, y, cx + colWidths.vat, y - effectiveRowHeight);
          cx += colWidths.vat;
        }

        if (showValueNet) {
          const vnText = `${valueNet.toFixed(2)}`;
          const vnW = regularFont.widthOfTextAtSize(vnText, fontSize);
          page.drawText(vnText, { x: cx + colWidths.valueNet - vnW - 5, y: textY, size: fontSize, font: regularFont, color: textColor });
          if (showBorders && showVBorders) drawBorderLine(cx + colWidths.valueNet, y, cx + colWidths.valueNet, y - effectiveRowHeight);
          cx += colWidths.valueNet;
        }

        if (showValueGross) {
          const vgText = `${valueGross.toFixed(2)}`;
          const vgW = regularFont.widthOfTextAtSize(vgText, fontSize);
          page.drawText(vgText, { x: cx + colWidths.valueGross - vgW - 5, y: textY, size: fontSize, font: regularFont, color: textColor });
        }

        if (showBorders && showHBorders) {
          drawBorderLine(marginLeft, y - effectiveRowHeight, marginLeft + tableWidth, y - effectiveRowHeight);
        }

        y -= effectiveRowHeight;
      });

      if (showBorders && showOuterBorder) {
        const tableTop = height - startY;
        const totalTableHeight = tableTop - y + headerHeight;
        drawBorderLine(marginLeft, y, marginLeft, tableTop);
        drawBorderLine(marginLeft + tableWidth, y, marginLeft + tableWidth, tableTop);
        if (!showHBorders) {
          drawBorderLine(marginLeft, y, marginLeft + tableWidth, y);
        }
      }

      y -= 10;
      page.drawLine({
        start: { x: marginLeft, y: y },
        end: { x: marginLeft + tableWidth, y: y },
        thickness: summaryThickness,
        color: summaryColor,
      });

      y -= 15;

      let colX = marginLeft + colWidths.lp + colWidths.name + colWidths.quantity + colWidths.unit;
      if (showUnitPriceNet) colX += colWidths.unitPriceNet;
      if (showVatColumn) colX += colWidths.vat;

      const labelY = y;
      const valueY = y - (headerFontSize + 4);

      if (showValueNet) {
        const labelText = 'SUMA NETTO:';
        const labelW = boldFont.widthOfTextAtSize(labelText, headerFontSize - 1);
        page.drawText(labelText, { x: colX + colWidths.valueNet - labelW - 5, y: labelY, size: headerFontSize - 1, font: boldFont, color: summaryLabelColor });

        const totalNetText = `${totalNet.toFixed(2)} PLN`;
        const totalNetWidth = boldFont.widthOfTextAtSize(totalNetText, headerFontSize);
        page.drawText(totalNetText, { x: colX + colWidths.valueNet - totalNetWidth - 5, y: valueY, size: headerFontSize, font: boldFont, color: summaryColor });
        colX += colWidths.valueNet;
      }

      if (showValueGross) {
        const labelText = 'SUMA BRUTTO:';
        const labelW = boldFont.widthOfTextAtSize(labelText, headerFontSize - 1);
        page.drawText(labelText, { x: colX + colWidths.valueGross - labelW - 5, y: labelY, size: headerFontSize - 1, font: boldFont, color: summaryLabelColor });

        const totalGrossText = `${totalGross.toFixed(2)} PLN`;
        const totalGrossWidth = boldFont.widthOfTextAtSize(totalGrossText, headerFontSize);
        page.drawText(totalGrossText, { x: colX + colWidths.valueGross - totalGrossWidth - 5, y: valueY, size: headerFontSize, font: boldFont, color: summaryColor });
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