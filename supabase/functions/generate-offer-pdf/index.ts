import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, pushGraphicsState, popGraphicsState, moveTo, lineTo, appendBezierCurve, closePath, clip, endPath, PDFName, PDFDict, PDFString, PDFArray, PDFNumber } from "npm:pdf-lib@1.17.1";
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
  type?: 'text' | 'image' | 'email' | 'phone' | 'url';
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
  line_height?: number;
  font_role?: 'heading' | 'body';
  image_fit?: 'cover' | 'contain';
  image_position_x?: number;
  image_position_y?: number;
  image_zoom?: number;
  show_icon?: boolean;
  link_url?: string;
}

type OfferAssumptionItem = {
  key: string;
  label: string;
  value: string;
  badge_value?: string;
};

const offerAssumptionLabels: Record<string, string> = {
  guest_count: 'Liczba gości',
  event_hours: 'Godziny wydarzenia',
  client_needs: 'Przebieg i potrzeby klienta',
  event_format: 'Format wydarzenia',
  agenda: 'Agenda i kluczowe momenty',
  venue: 'Miejsce i warunki',
  audience: 'Grupa odbiorców',
  engagement: 'Zaangażowanie uczestników',
  brand_visibility: 'Widoczność marki',
  guest_experience: 'Doświadczenie uczestników',
  online_participants: 'Uczestnicy online',
  technical_scope: 'Zakres techniczny',
  special_requirements: 'Wymagania szczególne',
  custom: 'Własne założenie',
};

const normalizeOfferAssumptionItems = (rawValue: unknown): OfferAssumptionItem[] => {
  let parsed = rawValue;
  if (typeof rawValue === 'string') {
    try {
      parsed = JSON.parse(rawValue);
    } catch {
      parsed = [];
    }
  }

  if (!Array.isArray(parsed)) return [];
  const used = new Set<string>();
  return parsed
    .map((candidate) => {
      if (!candidate || typeof candidate !== 'object') return null;
      const key = String((candidate as Record<string, unknown>).key || '');
      const isCustom = key === 'custom';
      if (!offerAssumptionLabels[key] || (!isCustom && used.has(key))) return null;
      if (!isCustom) used.add(key);
      const customLabel = String((candidate as Record<string, unknown>).label || '').trim();
      return {
        key,
        label: isCustom
          ? customLabel.slice(0, 80) || offerAssumptionLabels[key]
          : offerAssumptionLabels[key],
        value: String((candidate as Record<string, unknown>).value || '').trim(),
        badge_value: String((candidate as Record<string, unknown>).badge_value || '').trim().slice(0, 7),
      };
    })
    .filter((item): item is OfferAssumptionItem => Boolean(item))
    .slice(0, 3);
};

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
        organization:organizations(*, location:locations(*), primary_contact:contacts!organizations_primary_contact_id_fkey(*)),
        contact:contacts!contact_id(*),
        contact_person:contacts!contact_id(*),
        inquiry:tasks!inquiry_id(id, title, description, due_date, inquiry_details),
        event:events(*, location:locations(*), category:event_categories(id, name, default_offer_template_category_id)),
        created_by_employee:employees!created_by(
          id,
          name,
          surname,
          email,
          phone_number,
          avatar_url,
          signature_thumb,
          avatar_metadata,
          linkedin_url,
          instagram_url,
          facebook_url
        ),
        offer_items(
          *,
          selected_variant:offer_product_variants!product_variant_id(*),
          product:offer_products(
            *,
            variants:offer_product_variants(*)
          )
        ),
        packages:offer_packages!offer_id(
          id,
          name,
          description,
          list_price_net,
          discount_percent,
          discount_amount,
          price_net,
          is_recommended,
          display_order,
          items:offer_package_items(
            id,
            product_id,
            product_variant_id,
            quantity,
            display_order,
            product:offer_products(id, name, unit, offer_requirements),
            selected_variant:offer_product_variants!product_variant_id(id, name)
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
        .select("id, name, surname, email, phone_number, avatar_url, signature_thumb, avatar_metadata, linkedin_url, instagram_url, facebook_url")
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

    const getPdfAvatarUrl = (rawValue: unknown) => {
      const value = String(rawValue || '').trim();
      if (!value) return '';
      try {
        const url = new URL(value);
        const publicObjectPath = '/storage/v1/object/public/';
        if (!url.pathname.includes(publicObjectPath)) return value;
        url.pathname = url.pathname.replace(publicObjectPath, '/storage/v1/render/image/public/');
        url.searchParams.set('width', '480');
        url.searchParams.set('height', '480');
        url.searchParams.set('resize', 'contain');
        url.searchParams.set('quality', '78');
        return url.toString();
      } catch {
        return value;
      }
    };

    const prepareOfferData = (offer: any, employee: any) => {
      const org = offer.organization;
      const contact = offer.client_type === 'business'
        ? offer.contact_person || offer.contact || offer.organization?.primary_contact
        : offer.contact;
      const inquiry = offer.inquiry;
      const event = offer.event;
      const location = org?.location || {};
      const eventLocation = event?.location || {};
      const inquiryDetails = inquiry?.inquiry_details && typeof inquiry.inquiry_details === 'object'
        ? inquiry.inquiry_details
        : {};
      const inquiryDetailsText = typeof inquiry?.inquiry_details === 'string'
        ? inquiry.inquiry_details
        : JSON.stringify(inquiry?.inquiry_details || {});
      const inquiryText = [inquiry?.description || '', inquiryDetailsText]
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const stationaryMatch = inquiryText.match(/(?:około|ok\.?|dla)?\s*(\d+)\s*(?:os(?:ób|oby)?|uczestnik(?:ów|i)?)\s*stacjon/i);
      const onlineMatch = inquiryText.match(/(?:do|około|ok\.?)\s*(\d+)\s*(?:os(?:ób|oby)?|uczestnik(?:ów|i)?)[^.]{0,45}(?:zoom|online|zdaln)/i);
      const timeMatch = inquiryText.match(/(\d{1,2}):?(\d{2})?\s*[-–]\s*(\d{1,2}):?(\d{2})?/);
      const durationHours = timeMatch
        ? Math.max(0, Number(timeMatch[3]) - Number(timeMatch[1]))
        : 0;
      const inquiryClientName = String(inquiryDetails.client_text || '')
        .split('<')[0]
        .replace(/["']/g, '')
        .trim();
      const organizationName = String(org?.alias || org?.name || '').trim();
      const organizationLegalName = String(org?.name || '').trim();
      const contactPersonName = String(
        contact?.full_name || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim(),
      ).trim();
      const rawClientName = (offer.client_type === 'business' ? organizationName : contactPersonName)
        || contact?.full_name
        || `${contact?.first_name || ''} ${contact?.last_name || ''}`.trim()
        || inquiryClientName
        || '';
      const clientName = String(rawClientName)
        .split('<')[0]
        .replace(/["']/g, '')
        .trim();
      const firstLocationValue = (...values: unknown[]) => values
        .map((value) => String(value || '').trim())
        .find(Boolean) || '';
      const eventLocationText = typeof event?.location === 'string'
        ? event.location.trim()
        : firstLocationValue(
            eventLocation.name,
            eventLocation.formatted_address,
            eventLocation.address,
            [eventLocation.street, eventLocation.postal_code, eventLocation.city]
              .filter(Boolean)
              .join(' '),
            eventLocation.city,
          );
      const inquiryLocationText = firstLocationValue(
        inquiryDetails.location_text,
        inquiryDetails.event_location,
        inquiryDetails.venue,
        inquiryDetails.place,
        inquiryDetails.miejsce,
      );

      const data = {
        client_name: clientName,
        organization_name: organizationName,
        organization_legal_name: organizationLegalName,
        contact_person_name: contactPersonName,
        contact_person_email: contact?.email || '',
        contact_person_phone: contact?.mobile || contact?.phone || '',
        client_address: location.address || `${location.street || ''} ${location.city || ''}`.trim() || contact?.address || '',
        client_nip: org?.nip || '',
        client_city: location.city || '',
        client_postal_code: location.postal_code || '',
        client_street: location.street || '',

        offer_number: offer.offer_number || '',
        offer_name: offer.name || '',
        offer_date: offer.created_at ? new Date(offer.created_at).toLocaleDateString('pl-PL') : '',
        offer_valid_until: offer.valid_until
          ? new Date(offer.valid_until).toLocaleDateString('pl-PL')
          : '',

        event_name: event?.name || inquiryDetails.event_name || inquiry?.title?.replace(/^Zapytanie:\s*/i, '') || '',
        event_category_id: event?.category?.id || event?.category_id || '',
        event_category_name: event?.category?.name || '',
        event_date: (event?.event_date || offer.event_date || inquiry?.inquiry_details?.termin || inquiry?.due_date)
          ? new Date(event?.event_date || offer.event_date || inquiry?.inquiry_details?.termin || inquiry?.due_date).toLocaleDateString('pl-PL')
          : '',
        event_location: firstLocationValue(offer.event_location, eventLocationText, inquiryLocationText),
        event_brief: inquiry?.description || inquiry?.inquiry_details?.description || inquiryText || '',
        event_assumptions: offer.event_assumptions || inquiryDetails.event_assumptions || inquiryDetails.scope || inquiry?.description || '',
        event_assumption_items: normalizeOfferAssumptionItems(offer.event_assumption_items),
        event_goal: offer.event_goal || inquiryDetails.event_goal || '',
        event_participants_stationary: stationaryMatch?.[1] || '',
        event_participants_online: onlineMatch?.[1] || '',
        event_duration: durationHours ? `${durationHours} h` : '',

        total_price: Number(offer.total_price || offer.total_amount || 0)
          ? `${Number(offer.total_price || offer.total_amount || 0).toFixed(2)} PLN`
          : '',
        total_price_numeric: Number(offer.total_price || offer.total_amount || 0),
        subtotal: Number(offer.subtotal || 0),
        discount_percent: Number(offer.discount_percent || 0),
        discount_amount: Number(offer.discount_amount || 0),
        tax_percent: Number(offer.tax_percent || 23),
        tax_amount: Number(offer.tax_amount || 0),

        employee_first_name: employee.name || '',
        employee_last_name: employee.surname || '',
        employee_full_name: employee.name && employee.surname
          ? `${employee.name} ${employee.surname}`
          : '',
        employee_email: employee.email || '',
        employee_phone: employee.phone_number || '',
        employee_avatar_url: getPdfAvatarUrl(employee.signature_thumb || employee.avatar_url),
        employee_avatar_metadata: employee.avatar_metadata || null,
        employee_linkedin_url: employee.linkedin_url || '',
        employee_instagram_url: employee.instagram_url || '',
        employee_facebook_url: employee.facebook_url || '',

        seller_name: 'Mavinci Event & Entertainment',
        seller_address: '',
        seller_nip: '',

        offer_items: offer.offer_items || [],
        offer_packages: offer.packages || [],
        package_mode: offer.package_mode === true,
        logistics_enabled: offer.logistics_enabled === true,
        logistics_price_net: Number(offer.logistics_price_net || 0),
        logistics_description: offer.logistics_description || '',
      };

      console.log('Prepared offer data:', JSON.stringify(data, null, 2));
      return data;
    };

    const wrapText = (text: string, font: any, fontSize: number, maxWidth: number): string[] => {
      const lines: string[] = [];
      const paragraphs = String(text).split(/\r?\n/);

      paragraphs.forEach((paragraph, paragraphIndex) => {
        const words = paragraph.split(/\s+/).filter(Boolean);
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

        if (currentLine) lines.push(currentLine);
        if (!paragraph && paragraphIndex < paragraphs.length - 1) lines.push('');
      });

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

      let regularFont: any;
      let boldFont: any;
      if (overlayFontCache?.pdfDoc === pdfDoc) {
        regularFont = overlayFontCache.regularFont;
        boldFont = overlayFontCache.boldFont;
      } else {
        pdfDoc.registerFontkit(fontkit);
        const regularFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf';
        const boldFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf';
        const [regularFontBytes, boldFontBytes] = await Promise.all([
          fetch(regularFontUrl).then((res) => res.arrayBuffer()),
          fetch(boldFontUrl).then((res) => res.arrayBuffer()),
        ]);
        regularFont = await pdfDoc.embedFont(regularFontBytes);
        boldFont = await pdfDoc.embedFont(boldFontBytes);
      }

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
      const showSummary = config.show_summary !== false;

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
        lp: config.col_lp_width || 22,
        name: 0,
        quantity: config.col_qty_width || 34,
        unit: config.col_unit_width || 32,
        unitPriceNet: showUnitPriceNet ? (config.col_unit_price_width || 56) : 0,
        vat: showVatColumn ? (config.col_vat_width || 34) : 0,
        valueNet: showValueNet ? (config.col_value_net_width || 66) : 0,
        valueGross: showValueGross ? (config.col_value_gross_width || 66) : 0,
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
      if (showUnitPriceNet) headerDefs.push({ text: 'Cena jedn.\nnetto', colKey: 'unitPriceNet', align: 'right' });
      if (showVatColumn) headerDefs.push({ text: 'VAT', colKey: 'vat', align: 'center' });
      if (showValueNet) headerDefs.push({ text: 'Wartość\nnetto', colKey: 'valueNet', align: 'right' });
      if (showValueGross) headerDefs.push({ text: 'Wartość\nbrutto', colKey: 'valueGross', align: 'right' });

      let hx = marginLeft;
      for (let hi = 0; hi < headerDefs.length; hi++) {
        const hd = headerDefs[hi];
        const cw = colWidths[hd.colKey];
        const headerLines = hd.text.split('\n');
        const headerLineHeight = headerFontSize + 1;
        const headerTextBlockHeight = headerFontSize + (headerLines.length - 1) * headerLineHeight;
        const firstLineY = y - (headerHeight - headerTextBlockHeight) / 2 - headerFontSize + 2;
        headerLines.forEach((headerLine, lineIndex) => {
          const textY = firstLineY - lineIndex * headerLineHeight;
          const tw = boldFont.widthOfTextAtSize(headerLine, headerFontSize);
          const textX = hd.align === 'right'
            ? hx + cw - tw - 4
            : hd.align === 'center'
              ? hx + (cw - tw) / 2
              : hx + 5;
          page.drawText(headerLine, { x: textX, y: textY, size: headerFontSize, font: boldFont, color: headerTextColor });
        });
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
        const quantity = item.quantity;
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

      if (showSummary) {
        y -= 10;
        page.drawLine({
          start: { x: marginLeft, y },
          end: { x: marginLeft + tableWidth, y },
          thickness: summaryThickness,
          color: summaryColor,
        });

        y -= 15;

        let colX = marginLeft + colWidths.lp + colWidths.name + colWidths.quantity + colWidths.unit;
        if (showUnitPriceNet) colX += colWidths.unitPriceNet;
        if (showVatColumn) colX += colWidths.vat;

        const labelY = y;
        const valueY = y - (headerFontSize + 4);

        const discountAmount = Math.max(0, Number(config.discount_amount || 0));
        const discountPercent = Math.max(0, Number(config.discount_percent || 0));
        if (discountAmount > 0) {
          page.drawText(
            `RABAT ${discountPercent.toFixed(2)}% · -${discountAmount.toFixed(2)} PLN NETTO`,
            {
              x: marginLeft + 5,
              y: valueY,
              size: headerFontSize - 1,
              font: boldFont,
              color: summaryColor,
            },
          );
        }

        if (showValueNet) {
          const labelText = 'SUMA NETTO:';
          const labelW = boldFont.widthOfTextAtSize(labelText, headerFontSize - 1);
          page.drawText(labelText, { x: colX + colWidths.valueNet - labelW - 5, y: labelY, size: headerFontSize - 1, font: boldFont, color: summaryLabelColor });

          const displayedTotalNet = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : totalNet;
          const totalNetText = `${displayedTotalNet.toFixed(2)} PLN`;
          const totalNetWidth = boldFont.widthOfTextAtSize(totalNetText, headerFontSize);
          page.drawText(totalNetText, { x: colX + colWidths.valueNet - totalNetWidth - 5, y: valueY, size: headerFontSize, font: boldFont, color: summaryColor });
          colX += colWidths.valueNet;
        }

        if (showValueGross) {
          const labelText = 'SUMA BRUTTO:';
          const labelW = boldFont.widthOfTextAtSize(labelText, headerFontSize - 1);
          page.drawText(labelText, { x: colX + colWidths.valueGross - labelW - 5, y: labelY, size: headerFontSize - 1, font: boldFont, color: summaryLabelColor });

          const displayedTotalNet = Number.isFinite(Number(totalPrice)) ? Number(totalPrice) : totalNet;
          const displayedTotalGross = Number.isFinite(Number(config.total_gross))
            ? Number(config.total_gross)
            : displayedTotalNet * (1 + defaultVatRate / 100);
          const totalGrossText = `${displayedTotalGross.toFixed(2)} PLN`;
          const totalGrossWidth = boldFont.widthOfTextAtSize(totalGrossText, headerFontSize);
          page.drawText(totalGrossText, { x: colX + colWidths.valueGross - totalGrossWidth - 5, y: valueY, size: headerFontSize, font: boldFont, color: summaryColor });
        }
      }

      console.log(`Drew offer items table with ${offerItems.length} items, total net: ${totalNet.toFixed(2)} PLN, total gross: ${totalGross.toFixed(2)} PLN`);
    };

    let overlayFontCache: {
      pdfDoc: PDFDocument;
      regularFont: any;
      boldFont: any;
      symbolsFont: any;
      headingFont: any;
    } | null = null;
    let embeddedImageCache: {
      pdfDoc: PDFDocument;
      images: Map<string, any>;
    } | null = null;
    const imageFallbackUrls = new Map<string, string>();
    let brandHeadingFontUrl = '';
    let brandLogoUrl = '';
    let brandCompanyName = 'MAVINCI';

    const embedImageFromUrl = async (pdfDoc: PDFDocument, imageUrl: string) => {
      if (!embeddedImageCache || embeddedImageCache.pdfDoc !== pdfDoc) {
        embeddedImageCache = { pdfDoc, images: new Map() };
      }

      const cacheKey = imageUrl.split('?')[0];
      const cached = embeddedImageCache.images.get(cacheKey);
      if (cached) return cached;

      let resolvedUrl = imageUrl;
      let imageResponse = await fetch(resolvedUrl);
      let imageType = imageResponse.headers.get('content-type') || '';
      const unsupportedOptimizedFormat = imageType.includes('webp') || imageType.includes('avif');
      if (!imageResponse.ok || unsupportedOptimizedFormat) {
        const fallbackUrl = imageFallbackUrls.get(imageUrl);
        if (!fallbackUrl) throw new Error(`Failed to fetch supported image: ${imageResponse.status}`);
        resolvedUrl = fallbackUrl;
        imageResponse = await fetch(resolvedUrl);
        imageType = imageResponse.headers.get('content-type') || '';
      }
      if (!imageResponse.ok) throw new Error(`Failed to fetch image: ${imageResponse.status}`);
      const imageBytes = await imageResponse.arrayBuffer();
      const resolvedPath = resolvedUrl.split('?')[0];
      const isPng = imageType.includes('png') || resolvedPath.toLowerCase().endsWith('.png');
      const image = isPng
        ? await pdfDoc.embedPng(imageBytes)
        : await pdfDoc.embedJpg(imageBytes);
      embeddedImageCache.images.set(cacheKey, image);
      return image;
    };

    const createOptimizedSignedImageUrl = async (bucket: string, path: string, width = 1600) => {
      const storage = supabase.storage.from(bucket);
      const [optimizedResult, originalResult] = await Promise.all([
        storage.createSignedUrl(path, 600, {
          transform: {
            width,
            resize: 'contain',
            quality: 80,
            format: 'origin',
          },
        } as any),
        storage.createSignedUrl(path, 600),
      ]);
      const originalUrl = originalResult.data?.signedUrl || '';
      const optimizedUrl = optimizedResult.data?.signedUrl || '';
      if (optimizedUrl && originalUrl) imageFallbackUrls.set(optimizedUrl, originalUrl);
      return optimizedUrl || originalUrl;
    };

    const overlayTextOnPages = async (
      pdfDoc: PDFDocument,
      startPageIndex: number,
      pageCount: number,
      textFields: TextFieldConfig[],
      data: Record<string, any>
    ) => {
      if (!textFields || textFields.length === 0) return;

      if (!overlayFontCache || overlayFontCache.pdfDoc !== pdfDoc) {
        pdfDoc.registerFontkit(fontkit);

        const regularFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Regular.ttf';
        const boldFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSans/hinted/ttf/NotoSans-Bold.ttf';
        const symbolsFontUrl = 'https://cdn.jsdelivr.net/gh/notofonts/notofonts.github.io/fonts/NotoSansSymbols2/hinted/ttf/NotoSansSymbols2-Regular.ttf';

        const regularFontBytes = await fetch(regularFontUrl).then(res => res.arrayBuffer());
        const boldFontBytes = await fetch(boldFontUrl).then(res => res.arrayBuffer());
        const symbolsFontBytes = await fetch(symbolsFontUrl).then(res => res.arrayBuffer()).catch(() => null);
        const regularFont = await pdfDoc.embedFont(regularFontBytes);
        const headingFontBytes = brandHeadingFontUrl
          ? await fetch(brandHeadingFontUrl).then((res) => res.ok ? res.arrayBuffer() : null).catch(() => null)
          : null;

        overlayFontCache = {
          pdfDoc,
          regularFont,
          boldFont: await pdfDoc.embedFont(boldFontBytes),
          symbolsFont: symbolsFontBytes ? await pdfDoc.embedFont(symbolsFontBytes) : regularFont,
          headingFont: headingFontBytes ? await pdfDoc.embedFont(headingFontBytes) : regularFont,
        };
      }

      const { regularFont, boldFont, symbolsFont, headingFont } = overlayFontCache;

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
              const image = await embedImageFromUrl(pdfDoc, String(value));

              const imgWidth = field.width || 100;
              const imgHeight = field.height || 100;
              const y = height - field.y - imgHeight;

              // O kształcie zdjęcia decyduje wyłącznie konfiguracja pola.
              // Avatar opiekuna na stronie końcowej jest gotowym PNG i nie może
              // być automatycznie przycinany do koła tylko ze względu na nazwę.
              const isCircular = field.is_circular === true;

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
                const imageDimensions = image.scale(1);
                const baseScale = field.image_fit === 'contain'
                  ? Math.min(imgWidth / imageDimensions.width, imgHeight / imageDimensions.height)
                  : Math.max(imgWidth / imageDimensions.width, imgHeight / imageDimensions.height);
                const imageZoom = Math.min(3, Math.max(1, Number(field.image_zoom || 1)));
                const coverScale = baseScale * imageZoom;
                const drawWidth = imageDimensions.width * coverScale;
                const drawHeight = imageDimensions.height * coverScale;
                const positionX = Math.min(100, Math.max(0, Number(field.image_position_x ?? 50))) / 100;
                const positionY = Math.min(100, Math.max(0, Number(field.image_position_y ?? 50))) / 100;
                const drawX = field.x + (imgWidth - drawWidth) * positionX;
                const drawY = y + (imgHeight - drawHeight) * (1 - positionY);

                if (field.image_fit !== 'contain') {
                  const radius = Math.max(0, Math.min(
                    Number(field.border_radius || 8),
                    imgWidth / 2,
                    imgHeight / 2,
                  ));
                  if (radius > 0) {
                    const kappa = 0.5522847498;
                    const offset = radius * kappa;
                    page.pushOperators(
                      pushGraphicsState(),
                      moveTo(field.x + radius, y),
                      lineTo(field.x + imgWidth - radius, y),
                      appendBezierCurve(field.x + imgWidth - radius + offset, y, field.x + imgWidth, y + radius - offset, field.x + imgWidth, y + radius),
                      lineTo(field.x + imgWidth, y + imgHeight - radius),
                      appendBezierCurve(field.x + imgWidth, y + imgHeight - radius + offset, field.x + imgWidth - radius + offset, y + imgHeight, field.x + imgWidth - radius, y + imgHeight),
                      lineTo(field.x + radius, y + imgHeight),
                      appendBezierCurve(field.x + radius - offset, y + imgHeight, field.x, y + imgHeight - radius + offset, field.x, y + imgHeight - radius),
                      lineTo(field.x, y + radius),
                      appendBezierCurve(field.x, y + radius - offset, field.x + radius - offset, y, field.x + radius, y),
                      closePath(),
                      clip(),
                      endPath(),
                    );
                  } else {
                    page.pushOperators(
                      pushGraphicsState(),
                      moveTo(field.x, y),
                      lineTo(field.x + imgWidth, y),
                      lineTo(field.x + imgWidth, y + imgHeight),
                      lineTo(field.x, y + imgHeight),
                      closePath(),
                      clip(),
                      endPath(),
                    );
                  }
                }
                page.drawImage(image, {
                  x: drawX,
                  y: drawY,
                  width: drawWidth,
                  height: drawHeight,
                });
                if (field.image_fit !== 'contain') page.pushOperators(popGraphicsState());
              }
            } catch (error) {
              console.error(`Error drawing image ${field.field_name}:`, error);
            }
            continue;
          }

          const fontSize = field.font_size || 12;
          const autoBold = /(^|_)(name|title)$/.test(field.field_name);
          const font = field.font_role === 'heading'
            ? headingFont
            : autoBold
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
          const isUrl = field.type === 'url';
          const iconSize = fontSize * 0.9;
          const iconPadding = 4;

          let iconSymbol = '';
          if (field.show_icon !== false && isEmail) {
            iconSymbol = '✉';
          } else if (field.show_icon !== false && isPhone) {
            iconSymbol = '☎';
          }

          const lines = field.max_width
            ? wrapText(value, font, fontSize, field.max_width)
            : [value];

          const lineHeight = field.line_height || fontSize * 1.2;

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

            if ((isEmail || isPhone || isUrl) && lineIndex === 0) {
              const textWidth = font.widthOfTextAtSize(line, fontSize);
              const linkUri = isEmail
                ? `mailto:${line}`
                : isPhone
                  ? `tel:${line.replace(/\s/g, '')}`
                  : field.link_url || '';

              try {
                if (!linkUri) continue;
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
    const generatedProductPages: Array<Record<string, any>> = [];

    const requestedCompanyId = offer.event?.my_company_id || offer.my_company_id || null;
    const companyQuery = supabase
      .from('my_companies')
      .select('id, name, legal_name, logo_url, email, phone, website, nip')
      .eq('is_active', true)
      .limit(1);
    const { data: company } = requestedCompanyId
      ? await companyQuery.eq('id', requestedCompanyId).maybeSingle()
      : await companyQuery.eq('is_default', true).maybeSingle();

    if (company) {
      const [{ data: brandLogos }, { data: brandFonts }] = await Promise.all([
        supabase
          .from('company_brandbook_logos')
          .select('url, label, variant, background, is_default, order_index')
          .eq('company_id', company.id)
          .order('is_default', { ascending: false })
          .order('order_index'),
        supabase
          .from('company_brandbook_fonts')
          .select('family, role, weight, file_url, storage_path, order_index')
          .eq('company_id', company.id)
          .order('order_index'),
      ]);

      const logo = (brandLogos || []).find((item: any) => item.is_default)
        || (brandLogos || []).find((item: any) => item.background === 'transparent')
        || brandLogos?.[0];
      const rawLogoUrl = logo?.url || company.logo_url || '';
      brandLogoUrl = rawLogoUrl
        ? rawLogoUrl.startsWith('http')
          ? rawLogoUrl
          : supabase.storage.from('company-logos').getPublicUrl(rawLogoUrl).data.publicUrl
        : '';

      const headingFont = (brandFonts || []).find((item: any) => item.role === 'heading' && (item.file_url || item.storage_path));
      if (headingFont?.file_url) {
        brandHeadingFontUrl = headingFont.file_url;
      } else if (headingFont?.storage_path) {
        brandHeadingFontUrl = supabase.storage
          .from('company-logos')
          .getPublicUrl(headingFont.storage_path).data.publicUrl;
      }

      brandCompanyName = company.name || company.legal_name || 'MAVINCI';
      offerData.seller_name = company.legal_name || company.name || offerData.seller_name;
      offerData.seller_nip = company.nip || '';
      offerData.seller_email = company.email || '';
      offerData.seller_phone = company.phone || '';
      offerData.seller_website = company.website || '';
      offerData.company_logo = brandLogoUrl;
    }

    const { data: globalSocials } = await supabase
      .from('schema_org_global')
      .select('facebook_url, instagram_url, linkedin_url, youtube_url, twitter_url')
      .limit(1)
      .maybeSingle();
    offerData.social_facebook_url = offerData.employee_facebook_url || globalSocials?.facebook_url || '';
    offerData.social_instagram_url = offerData.employee_instagram_url || globalSocials?.instagram_url || '';
    offerData.social_linkedin_url = offerData.employee_linkedin_url || globalSocials?.linkedin_url || '';
    offerData.social_youtube_url = globalSocials?.youtube_url || '';
    offerData.social_twitter_url = globalSocials?.twitter_url || '';

    const { data: defaultCategory } = await supabase
      .from('offer_template_categories')
      .select('id, hero_image_path, hero_image_alt, design_config')
      .eq('is_default', true)
      .limit(1)
      .maybeSingle();
    const defaultTemplateCategoryId = defaultCategory?.id || null;
    const eventTemplateCategoryId =
      offer.event?.category?.default_offer_template_category_id || null;
    const templateCategoryId = eventTemplateCategoryId || defaultTemplateCategoryId;

    const loadDefaultTemplate = async (templateType: string, variantKey = 'default') => {
      const findTemplate = async (categoryId: string | null, requestedVariant: string) => {
        let query = supabase
          .from('offer_page_templates')
          .select('id, pdf_url, text_fields_config, table_config, template_category_id, variant_key')
          .eq('type', templateType)
          .eq('variant_key', requestedVariant)
          .eq('is_active', true)
          .order('is_default', { ascending: false })
          .order('updated_at', { ascending: false })
          .limit(1);

        if (categoryId) query = query.eq('template_category_id', categoryId);
        const { data } = await query.maybeSingle();
        return data;
      };

      if (eventTemplateCategoryId) {
        const categoryTemplate =
          await findTemplate(eventTemplateCategoryId, variantKey) ||
          (templateType !== 'product' && variantKey !== 'default'
            ? await findTemplate(eventTemplateCategoryId, 'default')
            : null);
        if (categoryTemplate) return categoryTemplate;
      }

      if (defaultTemplateCategoryId) {
        return (
          await findTemplate(defaultTemplateCategoryId, variantKey) ||
          (templateType !== 'product' && variantKey !== 'default'
            ? await findTemplate(defaultTemplateCategoryId, 'default')
            : null)
        );
      }

      return null;
    };

    const addPdfFromTemplate = async (
      templateType: string,
      data: Record<string, any> = offerData,
      variantKey = 'default',
      requiredFieldPrefix?: string,
    ) => {
      try {
        const template = await loadDefaultTemplate(templateType, variantKey);

        const configuredFields = Array.isArray(template?.text_fields_config)
          ? template.text_fields_config as TextFieldConfig[]
          : [];
        const configuredFieldNames = new Set(configuredFields.map((field) => field.field_name));
        const supportsRequiredFields = !requiredFieldPrefix
          || configuredFields.some((field) => field.field_name.startsWith(requiredFieldPrefix));
        const dynamicFieldRequirements: Record<string, string[]> = {
          cover: ['event_name', 'event_date'],
          about: ['event_assumptions', 'event_goal'],
          final: ['employee_full_name'],
        };
        const supportsDynamicCrmData = (dynamicFieldRequirements[templateType] || [])
          .every((fieldName) => configuredFieldNames.has(fieldName));

        if (template?.pdf_url && supportsRequiredFields && supportsDynamicCrmData) {
          const { data: pdfData } = await supabase.storage
            .from('offer-template-pages')
            .download(template.pdf_url);

          if (pdfData) {
            const arrayBuffer = await pdfData.arrayBuffer();
            const templatePdf = await PDFDocument.load(arrayBuffer);

            if (templatePdf.getPageCount() === 0) {
              return { success: false };
            }

            // A page template is a single logical A4 page. Older uploads can be
            // complete multi-page offers, so only their first page belongs here.
            const a4Width = 595.28;
            const a4Height = 841.89;
            const sourcePage = templatePdf.getPage(0);
            const { width: sourceWidth, height: sourceHeight } = sourcePage.getSize();
            const scale = Math.min(a4Width / sourceWidth, a4Height / sourceHeight);
            const renderedWidth = sourceWidth * scale;
            const renderedHeight = sourceHeight * scale;
            const offsetX = (a4Width - renderedWidth) / 2;
            const offsetY = (a4Height - renderedHeight) / 2;
            const topOffset = a4Height - offsetY - renderedHeight;
            const [embeddedPage] = await mergedPdf.embedPdf(arrayBuffer, [0]);

            const startPageIndex = mergedPdf.getPageCount();
            const page = mergedPdf.addPage([a4Width, a4Height]);
            page.drawPage(embeddedPage, {
              x: offsetX,
              y: offsetY,
              width: renderedWidth,
              height: renderedHeight,
            });

            const scaledFields = configuredFields.map((field) => ({
              ...field,
              x: offsetX + field.x * scale,
              y: topOffset + field.y * scale,
              font_size: field.font_size ? field.font_size * scale : field.font_size,
              max_width: field.max_width ? field.max_width * scale : field.max_width,
              width: field.width ? field.width * scale : field.width,
              height: field.height ? field.height * scale : field.height,
              border_radius: field.border_radius ? field.border_radius * scale : field.border_radius,
              line_height: field.line_height ? field.line_height * scale : field.line_height,
              image_position_x: field.field_name === 'product_image'
                ? Number(data.product_image_position_x ?? 50)
                : field.image_position_x,
              image_position_y: field.field_name === 'product_image'
                ? Number(data.product_image_position_y ?? 25)
                : field.image_position_y,
              image_zoom: field.field_name === 'product_image'
                ? Number(data.product_image_zoom ?? 1)
                : field.image_zoom,
            }));

            if (scaledFields.length > 0) {
              await overlayTextOnPages(
                mergedPdf,
                startPageIndex,
                1,
                scaledFields,
                data
              );
            }

            return {
              success: true,
              tableConfig: template.table_config,
              templateId: template.id,
              templateVariant: template.variant_key,
            };
          }
        }
      } catch (error) {
        console.error(`Error adding ${templateType} template:`, error);
      }
      return { success: false };
    };

    const sortedOfferItems = [...(offer.offer_items || [])]
      .sort((a: any, b: any) => a.display_order - b.display_order);

    const { data: selectedTemplateCategory } = templateCategoryId
      ? await supabase
          .from('offer_template_categories')
          .select('id, hero_image_path, hero_image_alt, design_config')
          .eq('id', templateCategoryId)
          .maybeSingle()
      : { data: null };

    const categoryDesign = {
      primary_color: '#4A001F',
      secondary_color: '#1c1f33',
      accent_color: '#D5C489',
      surface_color: '#faf7f2',
      hero_opacity: 0.58,
      hero_gradient_enabled: true,
      hero_gradient_end: 0.45,
      hero_height: 395,
      logo_scale: 1,
      cover_decorations_enabled: true,
      cover_primary_color: '#4A001F',
      cover_decoration_color: '#69002C',
      cover_accent_color: '#D5C489',
      assumptions_layout: 'cards',
      visual_image_height: 285,
      pricing_style: 'card',
      info_page_enabled: true,
      info_page_title: 'INFORMACJE I WARUNKI',
      order_process_text: 'Akceptacja zakresu i wyceny\nPotwierdzenie terminu i podpisanie umowy\nUstalenia techniczne z obiektem\nRealizacja wydarzenia',
      requirements_page_enabled: true,
      requirements_page_title: 'WARUNKI TECHNICZNE I ORGANIZACYJNE',
      requirements_page_subtitle: 'Wymagania niezbędne do bezpiecznego i sprawnego przygotowania realizacji.',
      technical_requirements_text: 'Dostęp do sali przed wydarzeniem w czasie uzgodnionym z realizatorem\nStabilne zasilanie 230 V oraz miejsce dla stanowiska technicznego\nDostęp do internetu przewodowego przy realizacjach online\nKontakt do osoby technicznej po stronie obiektu',
      reservation_terms_text: 'Termin rezerwujemy po akceptacji oferty i podpisaniu umowy\nZakres końcowy potwierdzamy po weryfikacji warunków technicznych\nDodatkowe usługi i zmiany wymagają potwierdzenia przed wydarzeniem',
      ...(selectedTemplateCategory?.design_config || defaultCategory?.design_config || {}),
    };
    const colorFromHex = (hex: string, fallback: [number, number, number]) => {
      const normalized = String(hex || '').replace('#', '').slice(0, 6);
      if (!/^[0-9a-f]{6}$/i.test(normalized)) return rgb(...fallback);
      return rgb(
        parseInt(normalized.slice(0, 2), 16) / 255,
        parseInt(normalized.slice(2, 4), 16) / 255,
        parseInt(normalized.slice(4, 6), 16) / 255,
      );
    };
    const cream = colorFromHex(categoryDesign.surface_color, [0.98, 0.97, 0.95]);
    const burgundy = colorFromHex(categoryDesign.primary_color, [0.357, 0, 0.122]);
    const accent = colorFromHex(categoryDesign.accent_color, [0.827, 0.733, 0.451]);
    const coverBurgundy = colorFromHex(categoryDesign.cover_primary_color, [0.29, 0, 0.122]);
    const coverDecoration = colorFromHex(categoryDesign.cover_decoration_color, [0.412, 0, 0.173]);
    const coverAccent = colorFromHex(categoryDesign.cover_accent_color, [0.835, 0.769, 0.537]);

    const crc32 = (bytes: Uint8Array) => {
      let crc = 0xffffffff;
      for (const byte of bytes) {
        crc ^= byte;
        for (let bit = 0; bit < 8; bit += 1) {
          crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
        }
      }
      return (crc ^ 0xffffffff) >>> 0;
    };

    const pngChunk = (type: string, data: Uint8Array) => {
      const typeBytes = new TextEncoder().encode(type);
      const chunk = new Uint8Array(12 + data.length);
      const view = new DataView(chunk.buffer);
      view.setUint32(0, data.length);
      chunk.set(typeBytes, 4);
      chunk.set(data, 8);
      const crcInput = new Uint8Array(typeBytes.length + data.length);
      crcInput.set(typeBytes);
      crcInput.set(data, typeBytes.length);
      view.setUint32(8 + data.length, crc32(crcInput));
      return chunk;
    };

    const createHorizontalAlphaGradientPng = async (
      hexColor: string,
      rightVisibility: number,
    ) => {
      const width = 1024;
      const normalized = String(hexColor || '#5b001f').replace('#', '').slice(0, 6);
      const red = parseInt(normalized.slice(0, 2), 16) || 91;
      const green = parseInt(normalized.slice(2, 4), 16) || 0;
      const blue = parseInt(normalized.slice(4, 6), 16) || 31;
      const scanline = new Uint8Array(1 + width * 4);
      scanline[0] = 0;
      for (let index = 0; index < width; index += 1) {
        const progress = index / (width - 1);
        const alpha = Math.round(255 * (1 - rightVisibility * progress));
        const offset = 1 + index * 4;
        scanline[offset] = red;
        scanline[offset + 1] = green;
        scanline[offset + 2] = blue;
        scanline[offset + 3] = alpha;
      }

      const compressedStream = new Blob([scanline])
        .stream()
        .pipeThrough(new CompressionStream('deflate'));
      const compressed = new Uint8Array(await new Response(compressedStream).arrayBuffer());
      const ihdr = new Uint8Array(13);
      const ihdrView = new DataView(ihdr.buffer);
      ihdrView.setUint32(0, width);
      ihdrView.setUint32(4, 1);
      ihdr[8] = 8;
      ihdr[9] = 6;
      const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
      const chunks = [signature, pngChunk('IHDR', ihdr), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array())];
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const png = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        png.set(chunk, offset);
        offset += chunk.length;
      }
      return png;
    };

    const drawRoundedRectangle = (
      page: any,
      options: { x: number; y: number; width: number; height: number; radius?: number; color: any; opacity?: number },
    ) => {
      const radius = Math.max(0, Math.min(options.radius ?? 8, options.width / 2, options.height / 2));
      if (radius === 0) {
        page.drawRectangle(options);
        return;
      }
      const opacity = options.opacity ?? 1;
      page.drawRectangle({ x: options.x + radius, y: options.y, width: options.width - radius * 2, height: options.height, color: options.color, opacity });
      page.drawRectangle({ x: options.x, y: options.y + radius, width: options.width, height: options.height - radius * 2, color: options.color, opacity });
      page.drawCircle({ x: options.x + radius, y: options.y + radius, size: radius, color: options.color, opacity });
      page.drawCircle({ x: options.x + options.width - radius, y: options.y + radius, size: radius, color: options.color, opacity });
      page.drawCircle({ x: options.x + radius, y: options.y + options.height - radius, size: radius, color: options.color, opacity });
      page.drawCircle({ x: options.x + options.width - radius, y: options.y + options.height - radius, size: radius, color: options.color, opacity });
    };

    const truncateAtWord = (value: string, limit: number) => {
      const normalized = String(value || '').replace(/\s+/g, ' ').trim();
      if (normalized.length <= limit) return normalized;
      const shortened = normalized.slice(0, limit);
      return `${shortened.slice(0, shortened.lastIndexOf(' '))}…`;
    };

    const productImageUrlCache = new Map<string, string>();
    const getProductImageUrl = async (product: any) => {
      if (!product?.offer_image_path) return '';
      const cached = productImageUrlCache.get(product.offer_image_path);
      if (cached) return cached;
      const signedUrl = await createOptimizedSignedImageUrl(
        'offer-product-pages',
        product.offer_image_path,
      );
      if (signedUrl) productImageUrlCache.set(product.offer_image_path, signedUrl);
      return signedUrl;
    };

    const firstProductImage = await getProductImageUrl(
      sortedOfferItems.find((item: any) => item.product?.offer_image_path)?.product,
    );
    let categoryHeroImage = '';
    if (selectedTemplateCategory?.hero_image_path) {
      categoryHeroImage = await createOptimizedSignedImageUrl(
        'offer-template-pages',
        selectedTemplateCategory.hero_image_path,
      );
    }
    const recommendedScope = sortedOfferItems
      .map((item: any) => item.name || item.product?.name)
      .filter(Boolean)
      .slice(0, 6)
      .join('  •  ');

    const addBuiltInCover = async () => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: coverBurgundy });
      const coverImage = eventTemplateCategoryId
        ? categoryHeroImage
        : categoryHeroImage || firstProductImage;
      const imageSectionBottom = 210;
      const imageSectionHeight = Math.min(470, Math.max(320, Number(categoryDesign.hero_height || 395)));
      const coverDecorationRadius = 155;
      const coverDecorationGap = 34; // 1.2 cm on an A4 PDF page
      const coverDecorationCenterY = imageSectionBottom
        + imageSectionHeight
        + coverDecorationGap
        + coverDecorationRadius;

      if (coverImage) {
        try {
          const image = await embedImageFromUrl(mergedPdf, coverImage);
          if (image) {
            const imageDimensions = image.scale(1);
            const coverScale = Math.max(
              595.28 / imageDimensions.width,
              imageSectionHeight / imageDimensions.height,
            );
            const drawWidth = imageDimensions.width * coverScale;
            const drawHeight = imageDimensions.height * coverScale;

            page.drawImage(image, {
              x: (595.28 - drawWidth) / 2,
              y: imageSectionBottom + (imageSectionHeight - drawHeight) / 2,
              width: drawWidth,
              height: drawHeight,
            });
            page.drawRectangle({ x: 0, y: imageSectionBottom + imageSectionHeight, width: 595.28, height: 841.89 - imageSectionBottom - imageSectionHeight, color: coverBurgundy });
            page.drawRectangle({ x: 0, y: 0, width: 595.28, height: imageSectionBottom, color: coverBurgundy });
            if (categoryDesign.hero_gradient_enabled !== false) {
              const rightVisibility = Math.min(0.8, Math.max(0.2, Number(categoryDesign.hero_gradient_end || 0.45)));
              const gradientPng = await createHorizontalAlphaGradientPng(categoryDesign.cover_primary_color, rightVisibility);
              const gradientImage = await mergedPdf.embedPng(gradientPng);
              page.drawImage(gradientImage, {
                x: 0,
                y: imageSectionBottom,
                width: 595.28,
                height: imageSectionHeight,
              });
            } else {
              page.drawRectangle({
                x: 0,
                y: imageSectionBottom,
                width: 595.28,
                height: imageSectionHeight,
                color: coverBurgundy,
                opacity: Math.min(0.85, Math.max(0.2, Number(categoryDesign.hero_opacity || 0.58))),
              });
            }
          }
        } catch (error) {
          console.error('Error drawing category hero image:', error);
        }
      }

      // Subtle vector decoration inspired by the brand's circular motif.
      // It is drawn after the hero image, so preview and exported PDF stay identical.
      if (categoryDesign.cover_decorations_enabled !== false) {
        page.drawCircle({
          x: 575,
          y: coverDecorationCenterY,
          size: coverDecorationRadius,
          color: coverDecoration,
          opacity: 1,
        });
        page.drawCircle({
          x: 530,
          y: coverDecorationCenterY,
          size: 90,
          borderColor: coverAccent,
          borderWidth: 1.15,
          opacity: 1,
        });
      }

      page.drawLine({ start: { x: 45, y: 447 }, end: { x: 550, y: 447 }, thickness: 0.8, color: coverAccent, opacity: 0.9 });

      const timeRangeMatch = String(offerData.event_brief || '').match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      const eventDateWithTime = `${offerData.event_date || ''}${timeRangeMatch ? ` · ${timeRangeMatch[1]}–${timeRangeMatch[2]}` : ''}`.trim();
      const logoScale = Math.min(1.5, Math.max(0.7, Number(categoryDesign.logo_scale || 1)));
      const coverTitle = String(offerData.event_name || offer.offer_number || 'OFERTA').toLocaleUpperCase('pl-PL');
      const splitCoverTitle = (() => {
        if (coverTitle.length <= 25) return coverTitle;
        const breakpoint = coverTitle.lastIndexOf(' ', 22);
        return breakpoint > 8
          ? `${coverTitle.slice(0, breakpoint)}\n${coverTitle.slice(breakpoint + 1)}`
          : coverTitle;
      })();

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'company_logo', label: 'Logo firmy', type: 'image', image_fit: 'contain', x: 45, y: 42, width: 112 * logoScale, height: 78 * logoScale },
        { field_name: 'brand_title', label: 'Marka', x: 45, y: 62, font_size: 18, font_color: '#ffffff', font_role: 'heading' },
        { field_name: 'cover_kicker_title', label: 'Typ dokumentu', x: 45, y: 235, font_size: 8.5, font_color: categoryDesign.cover_accent_color },
        { field_name: 'event_name_cover', label: 'Nazwa wydarzenia', x: 45, y: 285, font_size: 25, line_height: 31, font_color: '#ffffff', max_width: 505, font_role: 'heading' },
        { field_name: 'cover_date_title', label: 'Data', x: 45, y: 430, font_size: 8, font_color: categoryDesign.cover_accent_color },
        { field_name: 'event_date_time', label: 'Termin wydarzenia', x: 45, y: 458, font_size: 13, font_color: '#ffffff', max_width: 300 },
        { field_name: 'event_location', label: 'Lokalizacja', x: 45, y: 485, font_size: 12, font_color: '#ffffff', max_width: 380 },
        { field_name: 'cover_client_title', label: 'Odbiorca', x: 45, y: 530, font_size: 8, font_color: categoryDesign.cover_accent_color },
        { field_name: 'cover_client_name', label: 'Organizacja lub klient', x: 45, y: 548, font_size: 13, font_color: '#ffffff', max_width: 380, font_role: 'heading' },
        { field_name: 'cover_contact_title', label: 'Osoba kontaktowa', x: 45, y: 578, font_size: 8, font_color: categoryDesign.cover_accent_color },
        { field_name: 'cover_contact_name', label: 'Imię i nazwisko kontaktu', x: 45, y: 596, font_size: 12, font_color: '#ffffff', max_width: 380 },
        { field_name: 'cover_footer_title', label: 'Stopka', x: 45, y: 765, font_size: 7.5, font_color: '#ffffff', max_width: 350 },
        { field_name: 'cover_valid_until', label: 'Ważność oferty', x: 45, y: 783, font_size: 8, font_color: categoryDesign.cover_accent_color, max_width: 400, font_role: 'heading' },
        { field_name: 'cover_page_number', label: 'Numer strony', x: 505, y: 765, font_size: 8, font_color: categoryDesign.cover_accent_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        ...offerData,
        brand_title: brandLogoUrl ? '' : brandCompanyName.toLocaleUpperCase('pl-PL'),
        cover_kicker_title: 'OFERTA OBSŁUGI TECHNICZNEJ',
        event_name_cover: splitCoverTitle,
        cover_date_title: 'TERMIN I MIEJSCE',
        event_date_time: eventDateWithTime,
        cover_client_title: offer.client_type === 'business' ? 'ORGANIZACJA' : 'OFERTA DLA',
        cover_client_name: offer.client_type === 'business'
          ? String(offerData.organization_name || offerData.client_name).toLocaleUpperCase('pl-PL')
          : offerData.client_name,
        cover_contact_title: offer.client_type === 'business' && offerData.contact_person_name
          ? 'OSOBA KONTAKTOWA'
          : '',
        cover_contact_name: offer.client_type === 'business'
          ? offerData.contact_person_name
          : '',
        category_hero_image: categoryHeroImage,
        cover_footer_title: 'OFERTA PRZYGOTOWANA NA PODSTAWIE ZAPYTANIA',
        cover_valid_until: offerData.offer_valid_until
          ? `OFERTA WAŻNA DO ${offerData.offer_valid_until}`
          : '',
        cover_page_number: '01',
      });
    };

    const addBuiltInAbout = async () => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      page.drawLine({ start: { x: 45, y: 690 }, end: { x: 550, y: 690 }, thickness: 0.8, color: burgundy });

      const assumptionsText = String(offerData.event_assumptions || offerData.event_brief || '');
      const tableCountMatch = assumptionsText.match(/(\d+)\s*osób\s*przy\s*stole/i);
      const extraCountMatch = assumptionsText.match(/(\d+)\s*osób\s*(?:za\s*nimi|dodatkow)/i);
      const stationaryDetail = tableCountMatch
        ? `Układ konferencyjny „U”: ${tableCountMatch[1]} miejsc przy stole${extraCountMatch ? ` i ${extraCountMatch[1]} miejsc dodatkowych` : ''}.`
        : truncateAtWord(assumptionsText, 150);
      const timeRangeMatch = String(offerData.event_brief || assumptionsText).match(/(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})/);
      const durationDetail = timeRangeMatch
        ? `Pełne wsparcie techniczne od ${timeRangeMatch[1]} do ${timeRangeMatch[2]}.`
        : 'Czas realizacji zgodny z harmonogramem wydarzenia.';
      const configuredAssumptions = normalizeOfferAssumptionItems(offerData.event_assumption_items);
      const assumptionCards: OfferAssumptionItem[] = configuredAssumptions.length > 0
        ? configuredAssumptions
        : [
            {
              key: 'guest_count',
              label: 'Liczba gości',
              value: offerData.event_participants_stationary
                ? `${offerData.event_participants_stationary} osób`
                : stationaryDetail,
            },
            {
              key: 'event_hours',
              label: 'Godziny wydarzenia',
              value: timeRangeMatch
                ? `${timeRangeMatch[1]}–${timeRangeMatch[2]}`
                : durationDetail,
            },
            {
              key: 'client_needs',
              label: 'Przebieg i potrzeby klienta',
              value: assumptionsText,
            },
          ];

      while (assumptionCards.length < 3) {
        const fallbackIndex = assumptionCards.length;
        const fallback = [
          { key: 'guest_count', label: 'Liczba gości' },
          { key: 'event_hours', label: 'Godziny wydarzenia' },
          { key: 'client_needs', label: 'Przebieg i potrzeby klienta' },
        ][fallbackIndex];
        assumptionCards.push({ ...fallback, value: '' });
      }

      const assumptionTiles = assumptionCards.slice(0, 3).map((item, index) => {
        const explicitBadge = String(item.badge_value || '').trim();
        const rawValue = String(item.value || '').trim();
        const canUseValueInTile = !explicitBadge && rawValue.length > 0 && rawValue.length <= 7 && !rawValue.includes('\n');
        const tileValue = explicitBadge || (canUseValueInTile ? rawValue : String(index + 1).padStart(2, '0'));
        const tileFontSize = tileValue.length >= 6 ? 8 : tileValue.length >= 4 ? 9.5 : 12;
        const detail = canUseValueInTile ? '' : rawValue;
        const hasDetail = detail.length > 0;
        return {
          tileValue: tileValue.toLocaleUpperCase('pl-PL'),
          tileFontSize,
          detail,
          labelY: hasDetail ? 207 + index * 110 : 229 + index * 110,
          tileY: 229 + index * 110 + (12 - tileFontSize) / 2,
        };
      });

      if (categoryDesign.assumptions_layout === 'cards') {
        [190, 300, 410].forEach((top) => drawRoundedRectangle(page, {
          x: 45,
          y: 841.89 - top - 90,
          width: 505,
          height: 90,
          radius: 9,
          color: rgb(1, 1, 1),
        }));
      }
      [190, 300, 410].forEach((top) => drawRoundedRectangle(page, {
        x: 65,
        y: 841.89 - top - 64,
        width: 38,
        height: 38,
        radius: 8,
        color: burgundy,
      }));
      drawRoundedRectangle(page, { x: 45, y: 74, width: 505, height: 108, radius: 9, color: burgundy });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'about_title', label: 'Tytuł', x: 45, y: 52, font_size: 25, font_color: categoryDesign.primary_color, font_role: 'heading' },
        { field_name: 'about_subtitle', label: 'Podtytuł', x: 45, y: 105, font_size: 9.5, font_color: '#765f55', max_width: 505 },
        { field_name: 'stationary_value_title', label: 'Wartość', x: 65, y: assumptionTiles[0].tileY, font_size: assumptionTiles[0].tileFontSize, font_color: '#ffffff', max_width: 38, align: 'center', font_role: 'heading' },
        { field_name: 'stationary_label', label: 'Etykieta', x: 125, y: assumptionTiles[0].labelY, font_size: 10, font_color: categoryDesign.primary_color, max_width: 395, font_role: 'heading' },
        { field_name: 'stationary_detail', label: 'Szczegóły', x: 125, y: 240, font_size: 8.5, font_color: '#171717', max_width: 395 },
        { field_name: 'online_value_title', label: 'Wartość', x: 65, y: assumptionTiles[1].tileY, font_size: assumptionTiles[1].tileFontSize, font_color: '#ffffff', max_width: 38, align: 'center', font_role: 'heading' },
        { field_name: 'online_label', label: 'Etykieta', x: 125, y: assumptionTiles[1].labelY, font_size: 10, font_color: categoryDesign.primary_color, max_width: 395, font_role: 'heading' },
        { field_name: 'online_detail', label: 'Szczegóły', x: 125, y: 350, font_size: 8.5, font_color: '#171717', max_width: 395 },
        { field_name: 'duration_value_title', label: 'Wartość', x: 65, y: assumptionTiles[2].tileY, font_size: assumptionTiles[2].tileFontSize, font_color: '#ffffff', max_width: 38, align: 'center', font_role: 'heading' },
        { field_name: 'duration_label', label: 'Etykieta', x: 125, y: assumptionTiles[2].labelY, font_size: 10, font_color: categoryDesign.primary_color, max_width: 395, font_role: 'heading' },
        { field_name: 'duration_detail', label: 'Szczegóły', x: 125, y: 460, font_size: 8.5, font_color: '#171717', max_width: 395 },
        { field_name: 'goal_title', label: 'Cel', x: 45, y: 545, font_size: 8.5, font_color: categoryDesign.primary_color },
        { field_name: 'event_goal_short', label: 'Cel wydarzenia', x: 45, y: 575, font_size: 11.5, line_height: 17, font_color: '#111111', max_width: 505 },
        { field_name: 'scope_title', label: 'Zakres', x: 65, y: 678, font_size: 8.5, font_color: categoryDesign.accent_color },
        { field_name: 'recommended_scope', label: 'Rekomendacja', x: 65, y: 713, font_size: 12.5, line_height: 18, font_color: '#ffffff', max_width: 465 },
        { field_name: 'about_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'about_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        ...offerData,
        about_title: 'ZAŁOŻENIA SPOTKANIA',
        about_subtitle: 'Najważniejsze parametry i potrzeby klienta przyjęte do przygotowania realizacji.',
        stationary_value_title: assumptionTiles[0].tileValue,
        stationary_label: assumptionCards[0].label.toLocaleUpperCase('pl-PL'),
        stationary_detail: truncateAtWord(assumptionTiles[0].detail, 180),
        online_value_title: assumptionTiles[1].tileValue,
        online_label: assumptionCards[1].label.toLocaleUpperCase('pl-PL'),
        online_detail: truncateAtWord(assumptionTiles[1].detail, 180),
        duration_value_title: assumptionTiles[2].tileValue,
        duration_label: assumptionCards[2].label.toLocaleUpperCase('pl-PL'),
        duration_detail: truncateAtWord(assumptionTiles[2].detail, 180),
        goal_title: 'CEL REALIZACJI',
        event_goal_short: truncateAtWord(offerData.event_goal, 280) || 'Cel zostanie doprecyzowany wspólnie przed akceptacją zakresu.',
        scope_title: 'REKOMENDOWANY ZESTAW',
        recommended_scope: recommendedScope || 'Zakres zostanie dopasowany do ustaleń z klientem.',
        about_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        about_page_number: '02',
      });
    };

    const formatMoney = (value: number) =>
      `${Number(value || 0).toLocaleString('pl-PL', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })} PLN`;

    const formatPackageMoney = (value: number) => {
      const numericValue = Number(value || 0);
      const hasFraction = !Number.isInteger(numericValue);
      return `${numericValue.toLocaleString('pl-PL', {
        minimumFractionDigits: hasFraction ? 2 : 0,
        maximumFractionDigits: hasFraction ? 2 : 0,
      })} PLN`;
    };

    const addBuiltInPackageComparison = async () => {
      const packages = [...(offerData.offer_packages || [])]
        .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .slice(0, 3);
      if (!offerData.package_mode || packages.length === 0) return false;

      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      page.drawLine({ start: { x: 45, y: height - 137 }, end: { x: 550, y: height - 137 }, thickness: 0.8, color: burgundy });

      const gap = 10;
      const cardWidth = (505 - gap * (packages.length - 1)) / packages.length;
      const cardTop = 176;
      const maxPackageItems = Math.max(...packages.map((pkg: any) => (pkg.items || []).length), 1);
      const cardHeight = Math.min(430, Math.max(350, 300 + maxPackageItems * 18));
      const fallbackRecommendedId = packages.find((pkg: any) => pkg.is_recommended)?.id
        || packages[Math.min(1, packages.length - 1)].id;
      const packageNotes: string[] = [];
      if (offerData.logistics_enabled && Number(offerData.logistics_price_net || 0) > 0) {
        const logisticsNet = Number(offerData.logistics_price_net || 0);
        packageNotes.push(
          `* Logistyka: ${formatMoney(logisticsNet)} netto / ${formatMoney(logisticsNet * 1.23)} brutto (VAT 23%). ${offerData.logistics_description || ''}`.trim(),
        );
      }
      const fields: TextFieldConfig[] = [
        { field_name: 'packages_title', label: 'Tytuł pakietów', x: 45, y: 52, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'packages_lead', label: 'Opis pakietów', x: 45, y: 102, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
        { field_name: 'packages_note', label: 'Nota', x: 45, y: cardTop + cardHeight + 28, font_size: 7.5, line_height: 11, font_color: '#756f6b', max_width: 505 },
        { field_name: 'packages_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'packages_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ];
      const pageData: Record<string, any> = {
        ...offerData,
        packages_title: 'WYBIERZ PAKIET REALIZACJI',
        packages_lead: 'Trzy czytelne poziomy zakresu - bez nadmiaru opcji i z rekomendacją najlepszego balansu.',
        packages_note: packageNotes.join('\n'),
        packages_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        packages_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
      };

      packages.forEach((pkg: any, index: number) => {
        const x = 45 + index * (cardWidth + gap);
        const isRecommended = pkg.id === fallbackRecommendedId;
        const cardColor = isRecommended ? burgundy : rgb(1, 1, 1);
        const titleColor = isRecommended ? '#ffffff' : categoryDesign.primary_color;
        const bodyColor = isRecommended ? '#f8eef1' : '#171717';
        const mutedColor = isRecommended ? '#e8b7c4' : '#756f6b';
        if (isRecommended) {
          drawRoundedRectangle(page, {
            x: x - 7,
            y: height - cardTop - cardHeight - 7,
            width: cardWidth + 14,
            height: cardHeight + 14,
            radius: 15,
            color: accent,
            opacity: 0.06,
          });
          drawRoundedRectangle(page, {
            x: x - 3,
            y: height - cardTop - cardHeight - 3,
            width: cardWidth + 6,
            height: cardHeight + 6,
            radius: 12,
            color: accent,
            opacity: 0.16,
          });
        }
        drawRoundedRectangle(page, {
          x,
          y: height - cardTop - cardHeight,
          width: cardWidth,
          height: cardHeight,
          radius: 10,
          color: cardColor,
        });
        if (!isRecommended) {
          page.drawRectangle({ x: x + 14, y: height - cardTop - 4, width: cardWidth - 28, height: 4, color: accent });
        }

        const prefix = `package_${index + 1}`;
        const itemLabels = [...(pkg.items || [])]
          .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
          .slice(0, 8)
          .map((item: any) => {
            const productName = item.product?.name || 'Pozycja oferty';
            const variantName = item.selected_variant?.name;
            const quantity = Number(item.quantity || 1);
            return `• ${productName}${variantName ? ` — ${variantName}` : ''}${quantity !== 1 ? ` × ${quantity}` : ''}`;
          });
        const priceWithLogistics = Number(pkg.price_net || 0)
          + (offerData.logistics_enabled ? Number(offerData.logistics_price_net || 0) : 0);
        const listPriceWithLogistics = Number(pkg.list_price_net || pkg.price_net || 0)
          + (offerData.logistics_enabled ? Number(offerData.logistics_price_net || 0) : 0);
        const packageBenefit = Number(pkg.discount_amount || 0);

        fields.push(
          { field_name: `${prefix}_badge`, label: 'Status', x: x + 15, y: cardTop + 24, font_size: 6.8, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_name`, label: 'Nazwa pakietu', x: x + 15, y: cardTop + 57, font_size: 15, font_color: titleColor, max_width: cardWidth - 30, align: 'center', font_role: 'heading' },
          { field_name: `${prefix}_description`, label: 'Opis pakietu', x: x + 15, y: cardTop + 91, font_size: 8.2, line_height: 12, font_color: mutedColor, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_list_price`, label: 'Suma produktów', x: x + 12, y: cardTop + 126, font_size: 7.2, font_color: mutedColor, max_width: cardWidth - 24, align: 'center' },
          { field_name: `${prefix}_price`, label: 'Cena pakietu', x: x + 12, y: cardTop + 148, font_size: 14.5, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 24, align: 'center', font_role: 'heading' },
          { field_name: `${prefix}_price_label`, label: 'Rodzaj ceny', x: x + 15, y: cardTop + 176, font_size: 6.8, font_color: mutedColor, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_benefit`, label: 'Korzyść klienta', x: x + 15, y: cardTop + 194, font_size: 7.2, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 30, align: 'center' },
          { field_name: `${prefix}_scope_title`, label: 'Zakres', x: x + 15, y: cardTop + 224, font_size: 7, font_color: isRecommended ? categoryDesign.accent_color : categoryDesign.primary_color, max_width: cardWidth - 30 },
          { field_name: `${prefix}_items`, label: 'Produkty', x: x + 15, y: cardTop + 248, font_size: 7.8, line_height: 18, font_color: bodyColor, max_width: cardWidth - 30 },
        );
        pageData[`${prefix}_badge`] = isRecommended ? 'NAJLEPSZY WYBÓR' : `PAKIET ${index + 1}`;
        pageData[`${prefix}_name`] = String(pkg.name || '').toLocaleUpperCase('pl-PL');
        pageData[`${prefix}_description`] = truncateAtWord(pkg.description || '', 125);
        pageData[`${prefix}_list_price`] = packageBenefit > 0
          ? `WARTOŚĆ PRODUKTÓW: ${formatPackageMoney(listPriceWithLogistics)}`
          : '';
        pageData[`${prefix}_price`] = formatPackageMoney(priceWithLogistics);
        pageData[`${prefix}_price_label`] = `${formatPackageMoney(priceWithLogistics * 1.23)} BRUTTO · VAT 23%`;
        pageData[`${prefix}_benefit`] = packageBenefit > 0
          ? `OSZCZĘDZASZ ${formatPackageMoney(packageBenefit)} · ${Number(pkg.discount_percent || 0).toLocaleString('pl-PL')}%`
          : 'CENA WYNIKA Z SUMY WYBRANYCH PRODUKTÓW';
        pageData[`${prefix}_scope_title`] = 'W PAKIECIE';
        pageData[`${prefix}_items`] = itemLabels.join('\n');
      });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, fields, pageData);
      return true;
    };

    const coverResult = await addPdfFromTemplate('cover');
    if (!coverResult.success) await addBuiltInCover();
    const aboutResult = await addPdfFromTemplate('about');
    if (!aboutResult.success) await addBuiltInAbout();

    const addStaticProductPdf = async (item: any): Promise<boolean> => {
      if (!item.product?.pdf_page_url) return false;
      try {
        const pdfPath = item.product.pdf_page_url;

        const { data: pdfData, error: downloadError } = await supabase.storage
          .from('offer-product-pages')
          .download(pdfPath);

        if (downloadError || !pdfData) {
          console.error(`Failed to download PDF for product ${item.product.name}:`, downloadError);
          return false;
        }

        const arrayBuffer = await pdfData.arrayBuffer();
        const productPdf = await PDFDocument.load(arrayBuffer);

        const copiedPages = await mergedPdf.copyPages(productPdf, productPdf.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
        return true;
      } catch (error) {
        console.error(`Error processing PDF for product ${item.product.name}:`, error);
        return false;
      }
    };

    const addFallbackProductPage = async (
      data: Record<string, any>,
      requestedVariant = 'default',
    ) => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      const variant = ['default', 'compact', 'visual'].includes(requestedVariant)
        ? requestedVariant
        : 'default';

      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      if (variant !== 'visual') {
        page.drawLine({ start: { x: 45, y: height - 142 }, end: { x: 550, y: height - 142 }, thickness: 0.8, color: burgundy });
      }
      if (variant === 'default') {
        page.drawRectangle({
          x: 325,
          y: height - 370,
          width: 225,
          height: 190,
          color: rgb(1, 1, 1),
        });
        page.drawLine({ start: { x: 45, y: height - 430 }, end: { x: 550, y: height - 430 }, thickness: 0.8, color: rgb(0.82, 0.78, 0.74) });
      } else if (variant === 'compact') {
        page.drawRectangle({
          x: 45,
          y: height - 385,
          width: 505,
          height: 220,
          color: rgb(1, 1, 1),
        });
        page.drawLine({ start: { x: 45, y: height - 585 }, end: { x: 550, y: height - 585 }, thickness: 0.8, color: rgb(0.82, 0.78, 0.74) });
      } else {
        const visualImageHeight = Math.min(330, Math.max(220, Number(categoryDesign.visual_image_height || 285)));
        page.drawLine({ start: { x: 45, y: height - 120 }, end: { x: 550, y: height - 120 }, thickness: 0.8, color: burgundy });
        page.drawRectangle({
          x: 82,
          y: height - 235 - visualImageHeight,
          width: 431,
          height: visualImageHeight,
          color: rgb(1, 1, 1),
        });
        drawRoundedRectangle(page, { x: 45, y: 80, width: 505, height: 165, radius: 9, color: rgb(1, 1, 1) });
      }

      const defaultFields: TextFieldConfig[] = [
        { field_name: 'product_name', label: 'Nazwa produktu', type: 'text', x: 45, y: 55, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'product_short_description', label: 'Krótki opis', type: 'text', x: 45, y: 108, font_size: 11, font_color: '#575c66', max_width: 505 },
        { field_name: 'scope_title', label: 'Zakres', type: 'text', x: 45, y: 175, font_size: 12, font_color: '#7f1734' },
        { field_name: 'product_description', label: 'Opis', type: 'text', x: 45, y: 210, font_size: 10.5, line_height: 15, font_color: '#0c1a30', max_width: 245 },
        { field_name: 'product_image', label: 'Grafika', type: 'image', x: 325, y: 180, width: 225, height: 190 },
        { field_name: 'reason_title', label: 'Korzyści', type: 'text', x: 45, y: 455, font_size: 12, font_color: '#7f1734' },
        { field_name: 'product_benefits_narrative', label: 'Korzyści', type: 'text', x: 45, y: 490, font_size: 9.5, line_height: 14, font_color: '#0c1a30', max_width: 245 },
      ];
      const compactFields: TextFieldConfig[] = [
        { field_name: 'product_name', label: 'Nazwa produktu', type: 'text', x: 45, y: 55, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'product_short_description', label: 'Krótki opis', type: 'text', x: 45, y: 108, font_size: 11, font_color: '#575c66', max_width: 505 },
        { field_name: 'product_image', label: 'Grafika', type: 'image', x: 45, y: 165, width: 505, height: 220 },
        { field_name: 'scope_title', label: 'Zakres', type: 'text', x: 45, y: 420, font_size: 12, font_color: '#7f1734' },
        { field_name: 'product_description', label: 'Opis', type: 'text', x: 45, y: 455, font_size: 10.5, line_height: 16, font_color: '#0c1a30', max_width: 505 },
        { field_name: 'reason_title', label: 'Korzyści', type: 'text', x: 45, y: 610, font_size: 12, font_color: '#7f1734' },
        { field_name: 'product_benefits_narrative', label: 'Korzyści', type: 'text', x: 45, y: 645, font_size: 9.5, line_height: 14, font_color: '#0c1a30', max_width: 245 },
      ];
      const visualImageHeight = Math.min(330, Math.max(220, Number(categoryDesign.visual_image_height || 285)));
      const visualFields: TextFieldConfig[] = [
        { field_name: 'product_name', label: 'Nazwa produktu', type: 'text', x: 45, y: 45, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'product_short_description', label: 'Krótki opis', type: 'text', x: 45, y: 93, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
        { field_name: 'visual_scope_title', label: 'Typ zakresu', type: 'text', x: 45, y: 132, font_size: 11.5, font_color: categoryDesign.primary_color, font_role: 'heading' },
        { field_name: 'product_description', label: 'Opis', type: 'text', x: 45, y: 158, font_size: 8.8, line_height: 12, font_color: '#171717', max_width: 505 },
        { field_name: 'product_image', label: 'Grafika', type: 'image', x: 82, y: 235, width: 431, height: visualImageHeight, border_radius: 9 },
        { field_name: 'scope_title', label: 'Zakres', type: 'text', x: 67, y: 620, font_size: 8.5, font_color: categoryDesign.primary_color },
        { field_name: 'product_benefits', label: 'Korzyści', type: 'text', x: 67, y: 650, font_size: 7.6, line_height: 10.5, font_color: '#171717', max_width: 250 },
      ];
      const fallbackFields = (variant === 'compact'
        ? compactFields
        : variant === 'visual'
        ? visualFields
        : defaultFields).map((field) => field.field_name === 'product_image'
          ? {
              ...field,
              image_position_x: Number(data.product_image_position_x ?? 50),
              image_position_y: Number(data.product_image_position_y ?? 25),
              image_zoom: Number(data.product_image_zoom ?? 1),
            }
          : field);

      const fallbackData = variant === 'visual'
        ? { ...data, product_description: truncateAtWord(data.product_description || '', 235) }
        : data;

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        fallbackFields,
        {
          ...fallbackData,
          scope_title: variant === 'visual' ? 'W ZAKRESIE' : 'CO ZAPEWNIAMY',
          visual_scope_title: 'ZAKRES REALIZACJI',
          reason_title: 'DLACZEGO TEN ZAKRES?',
          requirements_title: '',
          product_requirements: '',
        },
      );

      if (variant === 'visual' && data.product_image) {
        const visualImageBottom = height - 235 - visualImageHeight;
        page.drawRectangle({
          x: 45,
          y: visualImageBottom - 32,
          width: 505,
          height: 92,
          color: burgundy,
          opacity: 0.82,
        });
        const hasProductTags = Array.isArray(data.product_tags) && data.product_tags.length > 0;
        const rawTags = hasProductTags
          ? data.product_tags
          : Array.isArray(data.product_benefit_tags)
            ? data.product_benefit_tags
            : [];
        const productTags = rawTags
          .map((tag: unknown) => {
            const normalized = String(tag || '').replace(/[.!?]+$/, '').trim();
            const concise = hasProductTags
              ? truncateAtWord(normalized, 24)
              : normalized
                  .replace(/^(możliwość|bieżąca|zakres)\s+/i, '')
                  .split(/\s+/)
                  .slice(0, 3)
                  .join(' ');
            return concise.toLocaleUpperCase('pl-PL');
          })
          .filter(Boolean)
          .slice(0, 5);
        const tagFont = overlayFontCache?.boldFont || overlayFontCache?.regularFont;
        const displayTags = productTags.map((tag: string) => {
          let displayTag = tag;
          let measuredWidth = tagFont?.widthOfTextAtSize(displayTag, 7.2) || displayTag.length * 4.2;
          const words = displayTag.split(/\s+/);
          while (measuredWidth > 95 && words.length > 1) {
            words.pop();
            displayTag = words.join(' ');
            measuredWidth = tagFont?.widthOfTextAtSize(displayTag, 7.2) || displayTag.length * 4.2;
          }
          return displayTag;
        });
        let productTagsLine = displayTags.join('  •  ');
        let productTagsFontSize = 8;
        while (
          productTagsLine &&
          tagFont &&
          tagFont.widthOfTextAtSize(productTagsLine, productTagsFontSize) > 455 &&
          productTagsFontSize > 6.5
        ) {
          productTagsFontSize -= 0.5;
        }
        while (
          displayTags.length > 1 &&
          tagFont &&
          tagFont.widthOfTextAtSize(productTagsLine, productTagsFontSize) > 455
        ) {
          displayTags.pop();
          productTagsLine = displayTags.join('  •  ');
        }
        await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
          { field_name: 'product_image_caption', label: 'Podpis zdjęcia', x: 67, y: visualImageHeight + 200, font_size: 13, font_color: '#ffffff', max_width: 455, font_role: 'heading' },
          { field_name: 'product_tags_line', label: 'Tagi produktu', x: 67, y: visualImageHeight + 240, font_size: productTagsFontSize, font_color: '#ffffff', max_width: 455, align: 'center' },
        ], {
          product_image_caption: String(data.product_name || '').toLocaleUpperCase('pl-PL'),
          product_tags_line: productTagsLine,
        });
      }
    };

    type PreparedProductEntry = {
      item: any;
      product: any;
      benefits: string[];
      quantity: number;
      unitPrice: number;
      itemTotal: number;
      data: Record<string, any>;
    };

    const prepareProductEntry = async (item: any): Promise<PreparedProductEntry> => {
      const product = item.product;
      const selectedVariant = item.selected_variant || null;
      const productImage = await getProductImageUrl(
        selectedVariant?.offer_image_path ? selectedVariant : product,
      );
      const benefitsSource = Array.isArray(selectedVariant?.benefits) && selectedVariant.benefits.length > 0
        ? selectedVariant.benefits
        : product.offer_benefits;
      const benefits = Array.isArray(benefitsSource)
        ? benefitsSource.filter((benefit: unknown) => typeof benefit === 'string')
        : [];
      const productTags = Array.isArray(product.tags)
        ? product.tags
            .filter((tag: unknown) => typeof tag === 'string' && tag.trim())
            .map((tag: string) => tag.trim())
        : [];
      const quantity = Number(item.quantity || 0);
      const unitPrice = Number(item.unit_price || item.final_price || 0);
      const itemTotal = Number(item.total ?? quantity * unitPrice);
      const benefitsNarrative = benefits.length
        ? `Ten zakres łączy ${benefits
            .map((benefit: string) => benefit.trim().replace(/[.!?]+$/, '').toLocaleLowerCase('pl-PL'))
            .join(', ')}. Dzięki temu rozwiązanie pozostaje spójne, czytelne dla uczestników i dopasowane do przebiegu wydarzenia.`
        : 'Zakres dobieramy do miejsca, liczby uczestników i ustalonego przebiegu wydarzenia.';

      return {
        item,
        product,
        benefits,
        quantity,
        unitPrice,
        itemTotal,
        data: {
          ...offerData,
          product_name: String(item.name || selectedVariant?.name || product.name || '').toLocaleUpperCase('pl-PL'),
          product_short_description: selectedVariant?.short_description || product.offer_short_description || '',
          product_description: item.description || selectedVariant?.description || product.offer_description || product.description || '',
          product_benefits: benefits.map((benefit: string) => `• ${benefit}`).join('\n'),
          product_requirements: '',
          product_requirements_inline: '',
          product_benefit_tags: benefits,
          product_tags: productTags,
          product_benefits_narrative: benefitsNarrative,
          product_image: productImage,
          product_image_alt: selectedVariant?.offer_image_alt || product.offer_image_alt || '',
          product_image_position_x: Number(product.offer_image_position_x ?? 50),
          product_image_position_y: Number(product.offer_image_position_y ?? 25),
          product_image_zoom: Number(product.offer_image_zoom ?? 1),
          product_page_url: product.product_page_url || '',
          product_quantity: quantity.toLocaleString('pl-PL'),
          product_unit: item.unit || product.unit || 'szt',
          product_unit_price: formatMoney(unitPrice),
          product_total: formatMoney(itemTotal),
        },
      };
    };

    const addFallbackCompactProductPage = async (entries: PreparedProductEntry[]) => {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      page.drawLine({ start: { x: 45, y: height - 112 }, end: { x: 550, y: height - 112 }, thickness: 2, color: burgundy });

      const fields: TextFieldConfig[] = [
        { field_name: 'compact_page_title', label: 'Tytuł strony', x: 45, y: 55, font_size: 23, font_color: '#7f1734', max_width: 505 },
      ];
      const compactData: Record<string, any> = {
        ...offerData,
        compact_page_title: 'ZAKRES OFERTY',
      };

      entries.slice(0, 3).forEach((entry, index) => {
        const slot = index + 1;
        const top = 145 + index * 215;
        page.drawRectangle({
          x: 45,
          y: height - top - 150,
          width: 4,
          height: 150,
          color: burgundy,
        });
        page.drawRectangle({
          x: 405,
          y: height - top - 145,
          width: 145,
          height: 135,
          color: rgb(1, 1, 1),
        });
        page.drawLine({
          start: { x: 45, y: height - top - 188 },
          end: { x: 550, y: height - top - 188 },
          thickness: 0.7,
          color: rgb(0.82, 0.78, 0.74),
        });

        fields.push(
          { field_name: `product_${slot}_name`, label: `Produkt ${slot}: nazwa`, x: 65, y: top + 8, font_size: 16, font_color: '#7f1734', max_width: 315 },
          { field_name: `product_${slot}_short_description`, label: `Produkt ${slot}: lead`, x: 65, y: top + 44, font_size: 9.5, font_color: '#575c66', max_width: 315 },
          { field_name: `product_${slot}_description`, label: `Produkt ${slot}: opis`, x: 65, y: top + 73, font_size: 9.3, line_height: 13, font_color: '#0c1a30', max_width: 315 },
          { field_name: `product_${slot}_requirements`, label: `Produkt ${slot}: wymagania`, x: 65, y: top + 132, font_size: 7.2, line_height: 9, font_color: '#7f1734', max_width: 315 },
          { field_name: `product_${slot}_image`, label: `Produkt ${slot}: zdjęcie`, type: 'image', x: 405, y: top + 10, width: 145, height: 135 },
          ...(entry.data.product_page_url ? [{
            field_name: `product_${slot}_more`,
            label: `Produkt ${slot}: link`,
            type: 'url' as const,
            link_url: entry.data.product_page_url,
            x: 65,
            y: top + 164,
            font_size: 7.8,
            font_color: categoryDesign.primary_color,
            max_width: 315,
          }] : []),
        );

        compactData[`product_${slot}_name`] = entry.data.product_name;
        compactData[`product_${slot}_short_description`] = entry.data.product_short_description;
        compactData[`product_${slot}_description`] = truncateAtWord(entry.data.product_description, 330);
        compactData[`product_${slot}_requirements`] = entry.data.product_requirements_inline
          ? `WYMAGANIA: ${truncateAtWord(entry.data.product_requirements_inline, 110)}`
          : '';
        compactData[`product_${slot}_image`] = entry.data.product_image;
        compactData[`product_${slot}_more`] = entry.data.product_page_url ? 'ZOBACZ WIĘCEJ  →' : '';
      });

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        fields,
        compactData,
      );
    };

    const compactBuffer: PreparedProductEntry[] = [];

    const flushCompactProducts = async () => {
      if (compactBuffer.length === 0) return;
      const entries = compactBuffer.splice(0, 3);
      const groupedData: Record<string, any> = { ...offerData };
      entries.forEach((entry, index) => {
        const slot = index + 1;
        groupedData[`product_${slot}_name`] = entry.data.product_name;
        groupedData[`product_${slot}_short_description`] = entry.data.product_short_description;
        groupedData[`product_${slot}_description`] = truncateAtWord(entry.data.product_description, 330);
        groupedData[`product_${slot}_requirements`] = entry.data.product_requirements_inline
          ? `WYMAGANIA: ${truncateAtWord(entry.data.product_requirements_inline, 110)}`
          : '';
        groupedData[`product_${slot}_image`] = entry.data.product_image;
      });

      const compactResult = await addPdfFromTemplate(
        'product',
        groupedData,
        'compact',
        'product_1_',
      );
      if (!compactResult.success) await addFallbackCompactProductPage(entries);

      if (compactResult.success) {
        const compactLinkFields: TextFieldConfig[] = [];
        const compactLinkData: Record<string, any> = {};
        entries.forEach((entry, index) => {
          if (!entry.data.product_page_url) return;
          const top = 145 + index * 215;
          const fieldName = `product_${index + 1}_more_link`;
          compactLinkFields.push({
            field_name: fieldName,
            label: 'Zobacz więcej',
            type: 'url',
            link_url: entry.data.product_page_url,
            x: 65,
            y: top + 164,
            font_size: 7.8,
            font_color: categoryDesign.primary_color,
            max_width: 315,
          });
          compactLinkData[fieldName] = 'ZOBACZ WIĘCEJ  →';
        });
        if (compactLinkFields.length > 0) {
          await overlayTextOnPages(
            mergedPdf,
            mergedPdf.getPageCount() - 1,
            1,
            compactLinkFields,
            compactLinkData,
          );
        }
      }

      entries.forEach((entry, index) => generatedProductPages.push({
        offer_item_id: entry.item.id,
        product_id: entry.product.id,
        source: compactResult.success ? 'compact_group_template' : 'compact_group_fallback',
        template_id: compactResult.success ? compactResult.templateId : null,
        variant: 'compact',
        slot: index + 1,
        products_on_page: entries.length,
        data: {
          product_name: entry.data.product_name,
          product_short_description: entry.data.product_short_description,
          product_description: entry.data.product_description,
          product_image_path: entry.item.selected_variant?.offer_image_path || entry.product.offer_image_path || null,
          quantity: entry.quantity,
          unit: entry.data.product_unit,
          unit_price: entry.unitPrice,
          total: entry.itemTotal,
        },
      }));
    };

    const addSingleProductPage = async (entry: PreparedProductEntry) => {
      const variant = entry.item.offer_page_variant_override
        || entry.product.offer_page_variant
        || 'default';
      const productResult = await addPdfFromTemplate('product', entry.data, variant);
      if (!productResult.success) await addFallbackProductPage(entry.data, variant);

      if (entry.data.product_page_url) {
        await overlayTextOnPages(
          mergedPdf,
          mergedPdf.getPageCount() - 1,
          1,
          [{
            field_name: 'product_more_link',
            label: 'Zobacz więcej',
            type: 'url',
            link_url: entry.data.product_page_url,
            x: 45,
            y: 748,
            font_size: 8.5,
            font_color: categoryDesign.primary_color,
            max_width: 505,
          }],
          { product_more_link: 'ZOBACZ WIĘCEJ O TEJ USŁUDZE  →' },
        );
      }

      generatedProductPages.push({
        offer_item_id: entry.item.id,
        product_id: entry.product.id,
        source: productResult.success ? 'dynamic_template' : 'dynamic_fallback',
        template_id: productResult.success ? productResult.templateId : null,
        requested_variant: variant,
        resolved_variant: productResult.success ? productResult.templateVariant || variant : variant,
        data: {
          product_name: entry.data.product_name,
          product_short_description: entry.data.product_short_description,
          product_description: entry.data.product_description,
          product_benefits: entry.benefits,
          product_requirements: entry.product.offer_requirements || [],
          product_additional_requirements: entry.product.offer_additional_requirements || [],
          product_image_path: entry.item.selected_variant?.offer_image_path || entry.product.offer_image_path || null,
          product_image_alt: entry.data.product_image_alt,
          quantity: entry.quantity,
          unit: entry.data.product_unit,
          unit_price: entry.unitPrice,
          total: entry.itemTotal,
        },
      });
    };

    const addVariantComparisonPage = async (entry: PreparedProductEntry) => {
      const variants = [...(entry.product.variants || [])]
        .filter((variant: any) => variant.is_active !== false)
        .sort((a: any, b: any) => Number(a.display_order || 0) - Number(b.display_order || 0))
        .slice(0, 3);
      if (variants.length === 0) {
        await addSingleProductPage(entry);
        return;
      }

      const page = mergedPdf.addPage([595.28, 841.89]);
      const { width, height } = page.getSize();
      page.drawRectangle({ x: 0, y: 0, width, height, color: cream });
      page.drawLine({ start: { x: 45, y: height - 112 }, end: { x: 550, y: height - 112 }, thickness: 0.8, color: burgundy });
      page.drawLine({ start: { x: 45, y: height - 330 }, end: { x: 550, y: height - 330 }, thickness: 0.8, color: burgundy });

      const selectedVariantId = entry.item.product_variant_id || entry.item.selected_variant?.id || '';
      const fallbackRecommendedId = variants.find((variant: any) => variant.is_recommended)?.id || variants[0].id;
      const highlightedId = selectedVariantId || fallbackRecommendedId;
      const showVariantPrices = entry.item.show_variant_prices_in_pdf !== false;
      const productImageUrl = await getProductImageUrl(entry.product) || entry.data.product_image;
      const variantImageUrls = await Promise.all(
        variants.map((variant: any) => getProductImageUrl(variant)),
      );
      const formatDuration = (value: unknown) => {
        const duration = Number(value || 0);
        if (!Number.isFinite(duration) || duration <= 0) return '';
        return duration.toLocaleString('pl-PL', {
          minimumFractionDigits: Number.isInteger(duration) ? 0 : 1,
          maximumFractionDigits: 2,
        });
      };
      const getServiceTerms = (durationHours: unknown, extensionPriceNetPerHour: unknown) => {
        const terms: string[] = [];
        const duration = formatDuration(durationHours);
        const extensionPrice = Number(extensionPriceNetPerHour || 0);
        if (duration) terms.push(`CZAS USŁUGI: ${duration} H`);
        if (Number.isFinite(extensionPrice) && extensionPrice > 0) {
          terms.push(`DODATKOWA GODZINA: ${formatMoney(extensionPrice)} NETTO`);
        }
        return terms.join('  •  ');
      };
      const fields: TextFieldConfig[] = [
        { field_name: 'variant_page_title', label: 'Produkt', x: 45, y: 42, font_size: 24, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'variant_page_lead', label: 'Opis skrócony', x: 45, y: 82, font_size: 9.5, font_color: '#756f6b', max_width: 505 },
        { field_name: 'variant_page_description', label: 'Opis produktu', x: 45, y: 137, font_size: 8.3, line_height: 11.5, font_color: '#171717', max_width: 250 },
        { field_name: 'variant_page_service_terms', label: 'Czas i przedłużenie usługi', x: 45, y: 307, font_size: 6.8, font_color: categoryDesign.primary_color, max_width: 250 },
        { field_name: 'variant_page_image', label: 'Zdjęcie produktu', type: 'image', x: 330, y: 132, width: 220, height: 165, border_radius: 8 },
        { field_name: 'variant_section_title', label: 'Sekcja wariantów', x: 45, y: 350, font_size: 12, font_color: categoryDesign.primary_color, max_width: 505, font_role: 'heading' },
        { field_name: 'variant_page_note', label: 'Nota', x: 45, y: 782, font_size: 7.5, font_color: '#756f6b', max_width: 360 },
        ...(entry.data.product_page_url ? [{
          field_name: 'variant_more_link',
          label: 'Zobacz więcej',
          type: 'url' as const,
          link_url: entry.data.product_page_url,
          x: 420,
          y: 782,
          font_size: 7.8,
          font_color: categoryDesign.primary_color,
          max_width: 130,
          align: 'right' as const,
        }] : []),
      ];
      const comparisonPageTitle = String(entry.product.name || entry.data.product_name || '').trim();
      const pageData: Record<string, any> = {
        ...offerData,
        variant_page_title: comparisonPageTitle.toLocaleUpperCase('pl-PL'),
        variant_page_lead: entry.product.offer_short_description || entry.data.product_short_description || 'Kompletny zakres usługi dopasowany do charakteru wydarzenia.',
        variant_page_description: truncateAtWord(entry.product.offer_description || entry.product.description || entry.data.product_description || '', 720),
        variant_page_service_terms: getServiceTerms(
          entry.product.service_duration_hours,
          entry.product.extension_price_net_per_hour,
        ),
        variant_page_image: productImageUrl,
        variant_section_title: 'WARIANTY',
        variant_page_note: showVariantPrices
          ? 'Ceny wariantów są wartościami netto; obok podano wartość brutto z VAT 23%.'
          : 'Zakres wariantu można doprecyzować przed akceptacją oferty.',
        variant_more_link: entry.data.product_page_url ? 'ZOBACZ WIĘCEJ  →' : '',
      };

      variants.forEach((variant: any, index: number) => {
        const x = 45;
        const rowTop = 382 + index * 132;
        const rowHeight = 120;
        const isHighlighted = variant.id === highlightedId;
        drawRoundedRectangle(page, {
          x,
          y: height - rowTop - rowHeight,
          width: 505,
          height: rowHeight,
          radius: 9,
          color: rgb(1, 1, 1),
        });
        page.drawRectangle({
          x: x + 14,
          y: height - rowTop - rowHeight + 10,
          width: 3,
          height: rowHeight - 20,
          color: isHighlighted ? accent : burgundy,
        });

        const fieldPrefix = `variant_${index + 1}`;
        fields.push(
          { field_name: `${fieldPrefix}_number`, label: 'Numer wariantu', x: x + 28, y: rowTop + 16, font_size: 12, font_color: categoryDesign.accent_color, max_width: 30, font_role: 'heading' },
          { field_name: `${fieldPrefix}_name`, label: 'Nazwa wariantu', x: x + 72, y: rowTop + 14, font_size: 12, font_color: categoryDesign.primary_color, max_width: 205, font_role: 'heading' },
          { field_name: `${fieldPrefix}_badge`, label: 'Status', x: x + 280, y: rowTop + 17, font_size: 5.8, font_color: categoryDesign.primary_color, max_width: 75, align: 'right' },
          { field_name: `${fieldPrefix}_short`, label: 'Lead wariantu', x: x + 72, y: rowTop + 38, font_size: 7.8, line_height: 10, font_color: '#756f6b', max_width: 285 },
          { field_name: `${fieldPrefix}_description`, label: 'Opis wariantu', x: x + 72, y: rowTop + 57, font_size: 7.2, line_height: 9.5, font_color: '#171717', max_width: 205 },
          { field_name: `${fieldPrefix}_service_terms`, label: 'Czas i przedłużenie wariantu', x: x + 72, y: rowTop + 103, font_size: 5.8, font_color: categoryDesign.primary_color, max_width: 205 },
          { field_name: `${fieldPrefix}_price`, label: 'Cena netto', x: x + 280, y: rowTop + 50, font_size: 9.4, font_color: categoryDesign.primary_color, max_width: 77, align: 'right', font_role: 'heading' },
          { field_name: `${fieldPrefix}_price_label`, label: 'Cena brutto', x: x + 270, y: rowTop + 72, font_size: 5.2, font_color: '#756f6b', max_width: 87, align: 'right' },
          { field_name: `${fieldPrefix}_image`, label: 'Zdjęcie wariantu', type: 'image', x: x + 375, y: rowTop + 10, width: 118, height: rowHeight - 20, border_radius: 6 },
        );
        pageData[`${fieldPrefix}_number`] = String(index + 1).padStart(2, '0');
        pageData[`${fieldPrefix}_badge`] = isHighlighted || variant.is_recommended
          ? 'REKOMENDOWANY'
          : '';
        pageData[`${fieldPrefix}_name`] = String(variant.name || '').toLocaleUpperCase('pl-PL');
        pageData[`${fieldPrefix}_short`] = truncateAtWord(variant.short_description || '', 95);
        pageData[`${fieldPrefix}_image`] = variantImageUrls[index] || productImageUrl;
        pageData[`${fieldPrefix}_price`] = showVariantPrices ? `${formatMoney(Number(variant.price_net || 0))} NETTO` : '';
        pageData[`${fieldPrefix}_price_label`] = showVariantPrices
          ? `${formatMoney(Number(variant.price_gross || Number(variant.price_net || 0) * 1.23))} BRUTTO · VAT 23%`
          : '';
        pageData[`${fieldPrefix}_description`] = truncateAtWord(variant.description || '', 205);
        pageData[`${fieldPrefix}_service_terms`] = getServiceTerms(
          variant.service_duration_hours ?? entry.product.service_duration_hours,
          variant.extension_price_net_per_hour ?? entry.product.extension_price_net_per_hour,
        );
      });

      await overlayTextOnPages(
        mergedPdf,
        mergedPdf.getPageCount() - 1,
        1,
        fields,
        pageData,
      );

      generatedProductPages.push({
        offer_item_id: entry.item.id,
        product_id: entry.product.id,
        product_variant_id: selectedVariantId || null,
        source: 'variant_comparison_fallback',
        variant: 'comparison',
        variants: variants.map((variant: any) => ({
          id: variant.id,
          name: variant.name,
          price_net: Number(variant.price_net || 0),
          selected: variant.id === highlightedId,
        })),
        show_variant_prices_in_pdf: showVariantPrices,
        show_product_variants_in_pdf: true,
      });
    };

    for (const item of sortedOfferItems) {
      const product = item.product;
      if (!product) continue;

      if (product.offer_page_enabled === false) {
        await flushCompactProducts();
        const staticPageAdded = await addStaticProductPdf(item);
        if (staticPageAdded) {
          generatedProductPages.push({
            offer_item_id: item.id,
            product_id: product.id,
            source: 'static_pdf',
            pdf_page_url: product.pdf_page_url,
          });
        }
        continue;
      }

      const entry = await prepareProductEntry(item);
      const activeProductVariants = (product.variants || []).filter((variant: any) => variant.is_active !== false);
      const showAllProductVariants = item.show_product_variants_in_pdf !== false;
      const requestedPageVariant = item.offer_page_variant_override
        || product.offer_page_variant
        || 'default';
      if (activeProductVariants.length > 0 && showAllProductVariants) {
        await flushCompactProducts();
        await addVariantComparisonPage(entry);
      } else if (requestedPageVariant === 'compact') {
        compactBuffer.push(entry);
        if (compactBuffer.length === 3) await flushCompactProducts();
      } else {
        await flushCompactProducts();
        await addSingleProductPage(entry);
      }
    }
    await flushCompactProducts();

    const logisticsPriceNet = offerData.logistics_enabled
      ? Number(offerData.logistics_price_net || 0)
      : 0;
    const pricingItems = [
      ...offerData.offer_items,
      ...(logisticsPriceNet > 0 ? [{
        id: 'offer-logistics',
        name: 'Logistyka',
        description: offerData.logistics_description || '',
        quantity: 1,
        unit: 'usł.',
        unit_price: logisticsPriceNet,
        vat_rate: 23,
        subtotal: logisticsPriceNet,
        total: logisticsPriceNet,
      }] : []),
    ];
    const pricingListNet = pricingItems.reduce(
      (sum: number, item: any) => sum + Number(
        item.subtotal ?? Number(item.quantity || 0) * Number(item.unit_price || 0),
      ),
      0,
    );
    const pricingDiscountAmount = Math.min(
      pricingListNet,
      Math.max(0, Number(offerData.discount_amount || 0)),
    );
    const pricingDiscountPercent = pricingListNet > 0
      ? pricingDiscountAmount / pricingListNet * 100
      : 0;
    const pricingTotalNet = Math.max(0, pricingListNet - pricingDiscountAmount);
    const pricingDiscountFactor = pricingListNet > 0 ? pricingTotalNet / pricingListNet : 0;
    const pricingTotalGross = pricingItems.reduce((sum: number, item: any) => {
      const itemNet = Number(
        item.subtotal ?? Number(item.quantity || 0) * Number(item.unit_price || 0),
      );
      const vatRate = Number(item.product?.vat_rate ?? item.vat_rate ?? 23);
      return sum + itemNet * pricingDiscountFactor * (1 + vatRate / 100);
    }, 0);

    const packageComparisonRequested = Boolean(
      offerData.package_mode && (offerData.offer_packages || []).length > 0,
    );
    // Przy pakietach korzystamy z przewidywalnej strony kalkulacji bez pola sumy.
    // Szablon PDF może zawierać statyczne etykiety podsumowania, których nie da się usunąć.
    const pricingResult = packageComparisonRequested
      ? { success: false, tableConfig: null }
      : await addPdfFromTemplate('pricing');
    if (pricingResult.success && pricingItems.length > 0) {
      const pricingPageIndex = mergedPdf.getPageCount() - 1;
      await drawOfferItemsTable(
        mergedPdf,
        pricingPageIndex,
        pricingItems,
        pricingTotalNet,
        {
          ...(pricingResult.tableConfig || {}),
          col_lp_width: 22,
          col_qty_width: 34,
          col_unit_width: 32,
          col_unit_price_width: 56,
          col_vat_width: 34,
          col_value_net_width: 66,
          col_value_gross_width: 66,
          header_height: 34,
          show_unit_price_net: true,
          show_value_net: true,
          show_value_gross: true,
          show_vat_column: true,
          show_summary: !packageComparisonRequested,
          discount_amount: pricingDiscountAmount,
          discount_percent: pricingDiscountPercent,
          total_gross: pricingTotalGross,
        },
      );
    } else if (!pricingResult.success) {
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      page.drawLine({ start: { x: 45, y: 700 }, end: { x: 550, y: 700 }, thickness: 0.8, color: burgundy });

      const pricingCardEnabled = !packageComparisonRequested && categoryDesign.pricing_style !== 'minimal';
      if (!packageComparisonRequested) {
        if (categoryDesign.pricing_style === 'minimal') {
          page.drawLine({ start: { x: 45, y: 150 }, end: { x: 550, y: 150 }, thickness: 1.2, color: burgundy });
        } else {
          drawRoundedRectangle(page, { x: 45, y: 72, width: 505, height: 108, radius: 9, color: burgundy });
        }
      }

      const pricingFields: TextFieldConfig[] = [
        { field_name: 'pricing_title', label: 'Tytuł', x: 45, y: 58, font_size: 24, font_color: categoryDesign.primary_color, font_role: 'heading' },
        { field_name: 'pricing_subtitle', label: 'Opis', x: 45, y: 108, font_size: 10.5, font_color: '#575c66', max_width: 505 },
      ];
      if (packageComparisonRequested) {
        pricingFields.push({ field_name: 'pricing_note', label: 'Nota', x: 45, y: 748, font_size: 8, font_color: '#575c66', max_width: 505 });
      } else {
        pricingFields.push(
          { field_name: 'total_label_title', label: 'Razem', x: 70, y: 678, font_size: 9, font_color: pricingCardEnabled ? categoryDesign.accent_color : categoryDesign.primary_color },
          { field_name: 'discount_summary', label: 'Rabat', x: 70, y: 691, font_size: 7.5, font_color: pricingCardEnabled ? '#f0c8d3' : categoryDesign.primary_color },
          { field_name: 'total_price', label: 'Wartość', x: 70, y: 704, font_size: 22, font_color: pricingCardEnabled ? '#ffffff' : categoryDesign.primary_color, max_width: 455, font_role: 'heading' },
          { field_name: 'total_net_summary', label: 'Wartość netto', x: 70, y: 733, font_size: 7.5, font_color: pricingCardEnabled ? '#f0c8d3' : '#575c66', max_width: 455 },
          { field_name: 'pricing_note', label: 'Nota', x: 70, y: 750, font_size: 7.5, font_color: pricingCardEnabled ? '#f0c8d3' : '#575c66', max_width: 455 },
        );
      }

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, pricingFields, {
        ...offerData,
        total_price: formatMoney(pricingTotalGross),
        total_price_numeric: pricingTotalGross,
        pricing_title: 'WYCENA',
        pricing_subtitle: packageComparisonRequested
          ? 'Ceny jednostkowe pozycji tworzących warianty pakietowe przedstawione na kolejnej stronie.'
          : 'Zakres i wartości wynikają bezpośrednio z pozycji zatwierdzonych w CRM.',
        total_label_title: 'ŁĄCZNA WARTOŚĆ OFERTY BRUTTO',
        total_net_summary: `WARTOŚĆ NETTO: ${formatMoney(pricingTotalNet)}`,
        discount_summary: pricingDiscountAmount > 0
          ? `RABAT ${pricingDiscountPercent.toFixed(2)}% · ${formatMoney(pricingDiscountAmount)}`
          : '',
        pricing_note: packageComparisonRequested
          ? 'Ostateczna wartość zależy od wybranego pakietu. Kwoty pakietowe znajdują się na kolejnej stronie.'
          : 'Ostateczny zakres potwierdzimy po akceptacji oferty i weryfikacji warunków technicznych obiektu.',
      });

      if (pricingItems.length > 0) {
        await drawOfferItemsTable(
          mergedPdf,
          mergedPdf.getPageCount() - 1,
          pricingItems,
          pricingTotalNet,
          {
            start_y: 155,
            total_gross: pricingTotalGross,
            margin_left: 45,
            margin_right: 45,
            header_color: categoryDesign.primary_color,
            header_text_color: '#ffffff',
            text_color: '#0c1a30',
            row_bg_color: '#ffffff',
            row_odd_bg_color: '#f4f0e8',
            summary_color: categoryDesign.primary_color,
            summary_label_color: '#0c1a30',
            show_unit_price_net: true,
            show_value_net: true,
            show_value_gross: true,
            show_vat_column: true,
            show_summary: !packageComparisonRequested,
            discount_amount: pricingDiscountAmount,
            discount_percent: pricingDiscountPercent,
            show_borders: false,
            col_lp_width: 22,
            col_qty_width: 34,
            col_unit_width: 32,
            col_unit_price_width: 56,
            col_vat_width: 34,
            col_value_net_width: 66,
            col_value_gross_width: 66,
            row_height: 27,
            header_height: 34,
            body_font_size: 9,
            header_font_size: 9,
          },
        );
      }
    }

    // Porównanie pakietów zawsze następuje po kalkulacji jednostkowej.
    await addBuiltInPackageComparison();

    const splitConfiguredLines = (value: unknown) => String(value || '')
      .split(/\r?\n/)
      .map((line) => line.replace(/^[•\-–—]\s*/, '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const ensureSentence = (value: string) => {
      const normalized = value.replace(/\s+/g, ' ').trim();
      if (!normalized) return '';
      return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
    };
    const inferTechnicalTitle = (description: string) => {
      const normalized = description.toLocaleLowerCase('pl-PL');
      if (/internet|łącze|ethernet|wi-?fi/.test(normalized)) return 'ŁĄCZE INTERNETOWE';
      if (/zasil|230\s*v|400\s*v|prąd|przyłącze/.test(normalized)) return 'ZASILANIE I INFRASTRUKTURA';
      if (/dostęp|sali|obiektu|montaż|demontaż/.test(normalized)) return 'DOSTĘP DO OBIEKTU';
      if (/kontakt|technicz|koordyn/.test(normalized)) return 'KOORDYNACJA Z OBIEKTEM';
      return 'WARUNEK TECHNICZNY';
    };
    const requirementCategoryLabels: Record<string, string> = {
      technical: 'WARUNEK TECHNICZNY',
      accommodation: 'ZAKWATEROWANIE',
      backstage: 'ZAPLECZE / GARDEROBA',
      hospitality: 'GOŚCINNOŚĆ / CATERING',
      logistics: 'LOGISTYKA',
      other: 'INNE WYMAGANIE',
    };
    type OfferRequirementEntry = {
      title: string;
      description: string;
      category: string;
      sources: string[];
    };
    const requirementEntries: OfferRequirementEntry[] = [];
    const requirementEntryByKey = new Map<string, OfferRequirementEntry>();
    const addRequirementEntry = (entry: OfferRequirementEntry) => {
      const title = entry.title.replace(/\s+/g, ' ').trim();
      const description = ensureSentence(entry.description || title);
      if (!title && !description) return;
      const key = `${title}|${description}`.toLocaleLowerCase('pl-PL');
      const existing = requirementEntryByKey.get(key);
      if (existing) {
        entry.sources.forEach((source) => {
          if (source && !existing.sources.includes(source)) existing.sources.push(source);
        });
        return;
      }
      const normalizedEntry = {
        ...entry,
        title: title || requirementCategoryLabels[entry.category] || 'WYMAGANIE',
        description,
        sources: entry.sources.filter(Boolean),
      };
      requirementEntryByKey.set(key, normalizedEntry);
      requirementEntries.push(normalizedEntry);
    };

    splitConfiguredLines(categoryDesign.technical_requirements_text).forEach((description) => {
      addRequirementEntry({
        title: inferTechnicalTitle(description),
        description,
        category: 'technical',
        sources: ['Warunki wspólne realizacji'],
      });
    });
    sortedOfferItems.forEach((item: any) => {
      const productName = String(item.name || item.product?.name || 'Produkt').trim();
      const technicalRequirements = Array.isArray(item.product?.offer_requirements)
        ? item.product.offer_requirements
        : [];
      technicalRequirements
        .filter((requirement: unknown) => typeof requirement === 'string' && requirement.trim())
        .forEach((description: string) => {
          addRequirementEntry({
            title: inferTechnicalTitle(description),
            description,
            category: 'technical',
            sources: [productName],
          });
        });

      const additionalRequirements = Array.isArray(item.product?.offer_additional_requirements)
        ? item.product.offer_additional_requirements
        : [];
      additionalRequirements.forEach((requirement: any) => {
        if (!requirement || typeof requirement !== 'object') return;
        const category = Object.prototype.hasOwnProperty.call(requirementCategoryLabels, requirement.category)
          ? String(requirement.category)
          : 'other';
        const title = String(requirement.title || requirementCategoryLabels[category] || 'Inne wymaganie').trim();
        const description = String(requirement.description || title).trim();
        if (!title && !description) return;
        addRequirementEntry({
          title: title.toLocaleUpperCase('pl-PL'),
          description,
          category,
          sources: [productName],
        });
      });
    });

    if (categoryDesign.info_page_enabled !== false) {
      const orderSteps = splitConfiguredLines(categoryDesign.order_process_text);
      const reservationTerms = splitConfiguredLines(categoryDesign.reservation_terms_text);
      const page = mergedPdf.addPage([595.28, 841.89]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
      page.drawLine({ start: { x: 45, y: 700 }, end: { x: 550, y: 700 }, thickness: 0.8, color: burgundy });
      drawRoundedRectangle(page, { x: 45, y: 410, width: 505, height: 255, radius: 9, color: rgb(1, 1, 1) });
      drawRoundedRectangle(page, { x: 45, y: 130, width: 505, height: 255, radius: 9, color: rgb(1, 1, 1) });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'info_title', label: 'Tytuł', x: 45, y: 58, font_size: 24, font_color: categoryDesign.primary_color, font_role: 'heading', max_width: 505 },
        { field_name: 'info_subtitle', label: 'Opis', x: 45, y: 118, font_size: 9.5, font_color: '#765f55', max_width: 505 },
        { field_name: 'order_number_title', label: 'Numer', x: 65, y: 205, font_size: 22, font_color: categoryDesign.accent_color, font_role: 'heading' },
        { field_name: 'order_title', label: 'Sekcja', x: 125, y: 205, font_size: 10, font_color: categoryDesign.primary_color },
        { field_name: 'order_content', label: 'Treść', x: 125, y: 244, font_size: 9, line_height: 19, font_color: '#171717', max_width: 395 },
        { field_name: 'reservation_number_title', label: 'Numer', x: 65, y: 485, font_size: 22, font_color: categoryDesign.accent_color, font_role: 'heading' },
        { field_name: 'reservation_title', label: 'Sekcja', x: 125, y: 485, font_size: 10, font_color: categoryDesign.primary_color },
        { field_name: 'reservation_content', label: 'Treść', x: 125, y: 524, font_size: 9, line_height: 19, font_color: '#171717', max_width: 395 },
        { field_name: 'info_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'info_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        info_title: String(categoryDesign.info_page_title || 'INFORMACJE I WARUNKI').toLocaleUpperCase('pl-PL'),
        info_subtitle: 'Najważniejsze informacje organizacyjne przed potwierdzeniem realizacji.',
        order_number_title: '01',
        order_title: 'JAK WYGLĄDA ZAMÓWIENIE',
        order_content: orderSteps.map((line, index) => `${index + 1}.  ${line}`).join('\n'),
        reservation_number_title: '02',
        reservation_title: 'REZERWACJA I ZMIANY',
        reservation_content: reservationTerms.map((line) => ensureSentence(line)).join('\n\n'),
        info_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        info_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
      });
    }

    if (categoryDesign.requirements_page_enabled !== false && requirementEntries.length > 0) {
      const estimateRequirementLines = (description: string) => description
        .split(/\r?\n/)
        .reduce((sum, paragraph) => sum + Math.max(1, Math.ceil(paragraph.length / 78)), 0);
      const requirementCards = requirementEntries.map((entry, index) => ({
        ...entry,
        number: String(index + 1).padStart(2, '0'),
        height: Math.max(104, 76 + estimateRequirementLines(entry.description) * 13),
      }));
      const requirementPages: typeof requirementCards[] = [];
      let currentPageCards: typeof requirementCards = [];
      let usedHeight = 0;
      requirementCards.forEach((card) => {
        const cardHeight = Math.min(card.height, 310);
        const requiredHeight = cardHeight + (currentPageCards.length > 0 ? 14 : 0);
        if (currentPageCards.length > 0 && usedHeight + requiredHeight > 570) {
          requirementPages.push(currentPageCards);
          currentPageCards = [];
          usedHeight = 0;
        }
        currentPageCards.push({ ...card, height: cardHeight });
        usedHeight += cardHeight + (currentPageCards.length > 1 ? 14 : 0);
      });
      if (currentPageCards.length > 0) requirementPages.push(currentPageCards);

      for (let requirementPageIndex = 0; requirementPageIndex < requirementPages.length; requirementPageIndex += 1) {
        const pageCards = requirementPages[requirementPageIndex];
        const page = mergedPdf.addPage([595.28, 841.89]);
        page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: cream });
        page.drawLine({ start: { x: 45, y: 700 }, end: { x: 550, y: 700 }, thickness: 0.8, color: burgundy });

        const fields: TextFieldConfig[] = [
          { field_name: 'requirements_title', label: 'Tytuł', x: 45, y: 58, font_size: 22, font_color: categoryDesign.primary_color, font_role: 'heading', max_width: 505 },
          { field_name: 'requirements_subtitle', label: 'Opis', x: 45, y: 112, font_size: 9.2, font_color: '#765f55', max_width: 505 },
          { field_name: 'requirements_footer', label: 'Stopka', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
          { field_name: 'requirements_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
        ];
        const pageData: Record<string, any> = {
          requirements_title: String(categoryDesign.requirements_page_title || 'WARUNKI TECHNICZNE I ORGANIZACYJNE').toLocaleUpperCase('pl-PL'),
          requirements_subtitle: requirementPageIndex === 0
            ? String(categoryDesign.requirements_page_subtitle || 'Wymagania niezbędne do bezpiecznego i sprawnego przygotowania realizacji.')
            : 'Dalsza część warunków wynikających z zakresu wybranych produktów.',
          requirements_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
          requirements_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
        };

        let cardTop = 176;
        pageCards.forEach((card, cardIndex) => {
          const fieldPrefix = `requirement_${cardIndex}`;
          const cardBottom = 841.89 - cardTop - card.height;
          drawRoundedRectangle(page, { x: 45, y: cardBottom, width: 505, height: card.height, radius: 9, color: rgb(1, 1, 1) });
          page.drawRectangle({ x: 65, y: cardBottom + 18, width: 2.5, height: card.height - 36, color: accent });
          fields.push(
            { field_name: `${fieldPrefix}_number`, label: 'Numer wymagania', x: 78, y: cardTop + 22, font_size: 13, font_color: categoryDesign.accent_color, font_role: 'heading', max_width: 30 },
            { field_name: `${fieldPrefix}_title`, label: 'Nazwa wymagania', x: 125, y: cardTop + 20, font_size: 10, font_color: categoryDesign.primary_color, max_width: 395 },
            { field_name: `${fieldPrefix}_meta`, label: 'Kategoria i źródło', x: 125, y: cardTop + 39, font_size: 6.5, font_color: categoryDesign.accent_color, max_width: 395 },
            { field_name: `${fieldPrefix}_description`, label: 'Opis wymagania', x: 125, y: cardTop + 58, font_size: 8.7, line_height: 13, font_color: '#171717', max_width: 395 },
          );
          pageData[`${fieldPrefix}_number`] = card.number;
          pageData[`${fieldPrefix}_title`] = card.title;
          pageData[`${fieldPrefix}_meta`] = [
            requirementCategoryLabels[card.category] || requirementCategoryLabels.other,
            card.sources.length > 0 ? `DOTYCZY: ${card.sources.join(', ')}` : '',
          ].filter(Boolean).join('  ·  ');
          pageData[`${fieldPrefix}_description`] = card.description;
          cardTop += card.height + 14;
        });

        await overlayTextOnPages(
          mergedPdf,
          mergedPdf.getPageCount() - 1,
          1,
          fields,
          pageData,
        );
      }
    }

    // Strona końcowa zawsze powstaje z aktualnych danych CRM i brandbooka.
    // Dzięki temu stary, częściowo skonfigurowany PDF nie może zastąpić nowego układu.
    {
      const page = mergedPdf.addPage([595.28, 841.89]);
      const finalLeft = colorFromHex('#69102d', [0.412, 0.063, 0.176]);
      const finalRight = colorFromHex('#470018', [0.278, 0, 0.094]);
      page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: finalRight });
      page.drawRectangle({ x: 0, y: 0, width: 286, height: 841.89, color: finalLeft });
      if (!offerData.employee_avatar_url) {
        page.drawCircle({ x: 143, y: 396.89, size: 70, color: accent });
        page.drawCircle({ x: 143, y: 419, size: 20, color: finalLeft });
        drawRoundedRectangle(page, { x: 111, y: 341, width: 64, height: 48, radius: 19, color: finalLeft });
      }
      page.drawLine({ start: { x: 45, y: 74 }, end: { x: 550, y: 74 }, thickness: 0.8, color: accent, opacity: 0.85 });

      const finalFirstName = String(offerData.employee_first_name || '').toLocaleUpperCase('pl-PL');
      const finalLastName = String(offerData.employee_last_name || '').toLocaleUpperCase('pl-PL');
      const nameSize = 14;
      const nameFont = overlayFontCache?.headingFont || overlayFontCache?.boldFont;
      const firstNameWidth = nameFont?.widthOfTextAtSize(finalFirstName, nameSize) || finalFirstName.length * 8;
      const lastNameX = Math.min(158, 45 + firstNameWidth + 7);

      // Oryginalne wektorowe ikony z public/icons. Każda zajmuje pole 12 × 12 pt,
      // a odstęp 18 pt odpowiada dokładnie odstępowi między wierszami tekstu.
      page.drawSvgPath('M256,0C114.609,0,0,114.609,0,256s114.609,256,256,256s256-114.609,256-256S397.391,0,256,0z M256,472c-119.297,0-216-96.703-216-216S136.703,40,256,40s216,96.703,216,216S375.297,472,256,472z M327.125,383.969c5.703,0.016,56.875-37.828,56.875-42.656s-57.266-40.906-62.219-40.906s-21.578,19.938-26.062,22.156c-4.5,2.219-32.5,1.422-63.703-29.781c-31.219-31.188-41.875-67.109-41.875-72.75s26.031-23.062,26.75-27.156S182.578,128,176.891,128S128,180.5,128,184.875s3.953,60.656,75.219,131.906S321.422,383.938,327.125,383.969z', { x: 45, y: 140, scale: 0.0234375, color: accent });
      page.drawSvgPath('M27.9999,51.9063C41.0546,51.9063,51.9063,41.0781,51.9063,28C51.9063,14.9453,41.0312,4.0937,27.9765,4.0937C14.8983,4.0937,4.0937,14.9453,4.0937,28C4.0937,41.0781,14.9218,51.9063,27.9999,51.9063z M27.9999,47.9219C16.9374,47.9219,8.1014,39.0625,8.1014,28C8.1014,16.9609,16.914,8.0781,27.9765,8.0781C39.0155,8.0781,47.8983,16.9609,47.9219,28C47.9454,39.0625,39.039,47.9219,27.9999,47.9219z M27.9765,29.289C28.3749,29.289,28.8202,29.125,29.2655,28.6797L39.6014,18.3437C39.3202,18.1094,38.6405,17.875,37.6327,17.875L18.2968,17.875C17.3124,17.875,16.6093,18.1094,16.328,18.3437L26.664,28.6797C27.1327,29.1484,27.578,29.289,27.9765,29.289z M23.3358,28.0469L15.1796,19.8906C15.039,20.125,14.9687,20.6875,14.9687,21.5078L14.9687,34.4922C14.9687,35.3125,15.039,35.8984,15.203,36.1797z M32.5234,28.0469L40.6562,36.1797C40.8202,35.8984,40.8905,35.3125,40.8905,34.4922L40.8905,21.5078C40.8905,20.6875,40.8202,20.125,40.703,19.8906z M27.953,31.1406C27.1093,31.1406,26.453,30.8359,25.539,29.9922L24.789,29.289L16.3749,37.7031C16.6562,37.9609,17.3124,38.125,18.2968,38.125L37.6093,38.125C38.5936,38.125,39.2499,37.9609,39.5312,37.7031L31.1171,29.289L30.3671,29.9922C29.453,30.8359,28.7968,31.1406,27.953,31.1406z', { x: 45, y: 122, scale: 0.2142857, color: accent });
      page.drawSvgPath('M336.5,160C322,70.7,287.8,8,248,8s-74,62.7-88.5,152h177z M152,256c0,22.2,1.2,43.5,3.3,64h185.3c2.1-20.5,3.3-41.8,3.3-64s-1.2-43.5-3.3-64H155.3c-2.1,20.5-3.3,41.8-3.3,64z M476.7,160c-28.6-67.9-86.5-120.4-158-141.6c24.4,33.8,41.2,84.7,50,141.6h108z M177.2,18.4C105.8,39.6,47.8,92.1,19.3,160h108c8.7-56.9,25.5-107.8,49.9-141.6z M487.4,192H372.7c2.1,21,3.3,42.5,3.3,64s-1.2,43-3.3,64h114.6c5.5-20.5,8.6-41.8,8.6-64s-3.1-43.5-8.5-64z M120,256c0-21.5,1.2-43,3.3-64H8.6C3.2,212.5,0,233.8,0,256s3.2,43.5,8.6,64h114.6c-2-21-3.2-42.5-3.2-64z M159.5,352c14.5,89.3,48.7,152,88.5,152s74-62.7,88.5-152h-177z M318.8,493.6c71.4-21.2,129.4-73.7,158-141.6h-108c-8.8,56.9-25.6,108-50,141.6z M19.3,352c28.6,67.9,86.5,120.4,158,141.6c-24.4-33.8-41.2-84.7-50-141.6h-108z', { x: 45.2, y: 104, scale: 0.0234375, color: accent });

      const socialItems = [
        { key: 'facebook', url: offerData.social_facebook_url },
        { key: 'instagram', url: offerData.social_instagram_url },
        { key: 'linkedin', url: offerData.social_linkedin_url },
        { key: 'youtube', url: offerData.social_youtube_url },
      ].filter((item) => item.url).slice(0, 4);
      socialItems.forEach((item, index) => {
        const x = 198 + index * 20;
        drawRoundedRectangle(page, { x, y: 92, width: 16, height: 16, radius: 4, color: accent });
        if (item.key === 'facebook') {
          // Znak z public/icons/facebook-gold.svg.
          page.drawSvgPath('M13.5 8H16V4.5h-2.5C10.7 4.5 9 6.2 9 9v2H6v3.5h3V22h3.8v-7.5h3l.5-3.5h-3.5V9.2c0-.8.3-1.2.7-1.2Z', { x: x + 1.9, y: 108, scale: 0.62, color: finalRight });
        } else if (item.key === 'instagram') {
          // Znak z public/icons/instagram-gold.svg.
          page.drawSvgPath('M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm0 2a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1H7Zm5 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm4.5-2.5a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z', { x: x + 0.8, y: 108, scale: 0.6, color: finalRight });
        } else if (item.key === 'linkedin') {
          // Znak z public/icons/linkedin-gold.svg.
          page.drawSvgPath('M7.4 9.2H4.2V19h3.2V9.2ZM5.8 4A1.8 1.8 0 1 0 5.8 7.6 1.8 1.8 0 0 0 5.8 4ZM19.8 13.4c0-3-1.6-4.5-3.8-4.5-1.8 0-2.6 1-3 1.7V9.2H9.8V19H13v-4.9c0-1.3.2-2.6 1.9-2.6 1.6 0 1.7 1.5 1.7 2.7V19h3.2v-5.6Z', { x: x + 1.6, y: 107.5, scale: 0.62, color: finalRight });
        } else if (item.key === 'youtube') {
          page.drawSvgPath('M 0 0 L 0 7 L 6 3.5 Z', { x: x + 6, y: 96.5, color: finalRight });
        }
        try {
          const linkAnnotation = mergedPdf.context.obj({
            Type: 'Annot',
            Subtype: 'Link',
            Rect: [x, 92, x + 16, 108],
            Border: [0, 0, 0],
            A: { S: 'URI', URI: PDFString.of(String(item.url)) },
          });
          const linkAnnotationRef = mergedPdf.context.register(linkAnnotation);
          const annotations = page.node.lookup(PDFName.of('Annots'), PDFArray) || mergedPdf.context.obj([]);
          annotations.push(linkAnnotationRef);
          page.node.set(PDFName.of('Annots'), annotations);
        } catch (error) {
          console.error('Error adding social link annotation:', error);
        }
      });

      await overlayTextOnPages(mergedPdf, mergedPdf.getPageCount() - 1, 1, [
        { field_name: 'closing_title', label: 'Zakończenie', x: 45, y: 56, font_size: 25, line_height: 34, font_color: '#ffffff', max_width: 230, font_role: 'heading' },
        { field_name: 'caretaker_title', label: 'Opiekun', x: 45, y: 176, font_size: 8.5, font_color: categoryDesign.accent_color },
        { field_name: 'employee_avatar_url', label: 'Zdjęcie', type: 'image', image_fit: 'contain', x: 45, y: 480, width: 146, height: 165 },
        { field_name: 'avatar_placeholder_label', label: 'Miejsce na zdjęcie', x: 45, y: 650, font_size: 8.5, font_color: '#ffffff', max_width: 196, align: 'center' },
        { field_name: 'final_first_name', label: 'Imię', x: 45, y: 670, font_size: nameSize, font_color: '#ffffff', max_width: 110, font_role: 'heading' },
        { field_name: 'final_last_name', label: 'Nazwisko', x: lastNameX, y: 670, font_size: nameSize, font_color: categoryDesign.accent_color, max_width: 128, font_role: 'heading' },
        { field_name: 'employee_phone', label: 'Telefon', type: 'phone', show_icon: false, x: 63, y: 702, font_size: 10, font_color: '#ffffff', max_width: 178 },
        { field_name: 'employee_email', label: 'E-mail', type: 'email', show_icon: false, x: 63, y: 720, font_size: 9, font_color: '#ffffff', max_width: 178 },
        { field_name: 'seller_website', label: 'Strona WWW', x: 63, y: 738, font_size: 9, font_color: '#ffffff', max_width: 128 },
        { field_name: 'company_logo', label: 'Logo firmy', type: 'image', image_fit: 'contain', x: 358, y: 65, width: 165, height: 115 },
        { field_name: 'brand_title', label: 'Marka', x: 358, y: 80, font_size: 16, font_color: '#ffffff', font_role: 'heading' },
        { field_name: 'thanks_title', label: 'Podziękowanie', x: 344, y: 440, font_size: 11, font_color: categoryDesign.accent_color },
        { field_name: 'closing_text', label: 'Treść', x: 344, y: 482, font_size: 11, line_height: 19, font_color: '#ffffff', max_width: 205 },
        { field_name: 'final_footer', label: 'Stopka', x: 45, y: 795, font_size: 7, font_color: categoryDesign.accent_color, max_width: 390 },
        { field_name: 'final_page_number', label: 'Numer strony', x: 505, y: 795, font_size: 8, font_color: categoryDesign.accent_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        ...offerData,
        brand_title: brandLogoUrl ? '' : brandCompanyName.toLocaleUpperCase('pl-PL'),
        closing_title: 'ZAPRASZAMY\nDO WSPÓŁPRACY',
        caretaker_title: 'OPIEKUN OFERTY',
        avatar_placeholder_label: offerData.employee_avatar_url ? '' : 'MIEJSCE NA ZDJĘCIE OPIEKUNA',
        final_first_name: finalFirstName,
        final_last_name: finalLastName,
        thanks_title: 'DZIĘKUJEMY ZA ZAPYTANIE.',
        closing_text: 'Jesteśmy gotowi doprecyzować zakres oraz zaplanować realizację.',
        final_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        final_page_number: String(mergedPdf.getPageCount()).padStart(2, '0'),
      });
    }

    if (mergedPdf.getPageCount() === 0) {
      throw new Error("No PDF pages found. Please add PDF pages to templates or products first.");
    }

    const totalPages = mergedPdf.getPageCount();
    for (let pageIndex = 2; pageIndex < totalPages - 1; pageIndex += 1) {
      await overlayTextOnPages(mergedPdf, pageIndex, 1, [
        { field_name: 'document_footer', label: 'Stopka dokumentu', x: 45, y: 805, font_size: 7, font_color: categoryDesign.accent_color, max_width: 400 },
        { field_name: 'document_page_number', label: 'Numer strony', x: 505, y: 805, font_size: 8, font_color: categoryDesign.primary_color, max_width: 45, align: 'right', font_role: 'heading' },
      ], {
        document_footer: `${brandCompanyName.toLocaleUpperCase('pl-PL')} / OFERTA NR ${offerData.offer_number}`,
        document_page_number: String(pageIndex + 1).padStart(2, '0'),
      });
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

    const { data: previousSnapshot } = await supabase
      .from('offer_generation_snapshots')
      .select('generation_number')
      .eq('offer_id', offerId)
      .order('generation_number', { ascending: false })
      .limit(1)
      .maybeSingle();
    const generationNumber = Number(previousSnapshot?.generation_number || 0) + 1;
    const generatedAt = new Date().toISOString();
    const snapshot = {
      snapshot_version: 1,
      generated_at: generatedAt,
      offer_id: offerId,
      template_category_id: templateCategoryId,
      client: {
        name: offerData.client_name,
        organization_name: offerData.organization_name,
        organization_legal_name: offerData.organization_legal_name,
        contact_person_name: offerData.contact_person_name,
        contact_person_email: offerData.contact_person_email,
        contact_person_phone: offerData.contact_person_phone,
        address: offerData.client_address,
        nip: offerData.client_nip,
        city: offerData.client_city,
        postal_code: offerData.client_postal_code,
        street: offerData.client_street,
      },
      offer: {
        number: offerData.offer_number,
        name: offerData.offer_name,
        date: offerData.offer_date,
        total_price: offerData.total_price_numeric,
      },
      event: {
        name: offerData.event_name,
        category_id: offerData.event_category_id,
        category_name: offerData.event_category_name,
        date: offerData.event_date,
        location: offerData.event_location,
        assumptions: offerData.event_assumptions,
        goal: offerData.event_goal,
      },
      employee: {
        id: currentEmployee?.id || null,
        first_name: offerData.employee_first_name,
        last_name: offerData.employee_last_name,
        email: offerData.employee_email,
        phone: offerData.employee_phone,
        avatar_url: offerData.employee_avatar_url,
      },
      items: sortedOfferItems.map((item: any) => ({
        id: item.id,
        product_id: item.product?.id || item.product_id || null,
        name: item.name || item.product?.name || '',
        description: item.description || '',
        quantity: Number(item.quantity || 0),
        unit: item.unit || item.product?.unit || 'szt',
        unit_price: Number(item.unit_price || item.final_price || 0),
        discount_percent: Number(item.discount_percent || 0),
        discount_amount: Number(item.discount_amount || 0),
        transport_cost: Number(item.transport_cost || 0),
        logistics_cost: Number(item.logistics_cost || 0),
        total: Number(item.total || 0),
        vat_rate: Number(item.product?.vat_rate || item.vat_rate || 0),
      })),
      product_pages: generatedProductPages,
      generated_pdf_path: fileName,
    };

    const { error: snapshotError } = await supabase
      .from('offer_generation_snapshots')
      .insert({
        offer_id: offerId,
        generation_number: generationNumber,
        snapshot_version: 1,
        snapshot,
        generated_pdf_path: fileName,
        generated_by: currentEmployee?.id || offer.created_by || null,
      });
    if (snapshotError) {
      throw new Error("Failed to save offer generation snapshot: " + snapshotError.message);
    }

    const { error: updateError } = await supabase
      .from('offers')
      .update({
        generated_pdf_url: fileName,
        modified_after_generation: false,
        last_generated_by: currentEmployee?.id || offer.created_by || null,
        last_generated_at: generatedAt,
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
        generationNumber,
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
