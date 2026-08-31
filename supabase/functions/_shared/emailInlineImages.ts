export interface RelayEmailAttachment {
  filename: string;
  content: string;
  contentType?: string;
  contentDisposition?: "attachment" | "inline";
  cid?: string;
}

interface PreparedEmail {
  html: string;
  attachments: RelayEmailAttachment[];
}

const extensionForMime = (mime: string): string => {
  const normalized = mime.toLowerCase();
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/svg+xml") return "svg";
  if (normalized === "image/gif") return "gif";
  if (normalized === "image/webp") return "webp";
  return "png";
};

/**
 * Gmail usuwa data:image/... z HTML wiadomości. Zamieniamy je na obrazy MIME
 * osadzone przez Content-ID, zachowując przy tym dotychczasowy szablon stopki.
 */
export const prepareInlineEmailImages = (
  html: string,
  existingAttachments: RelayEmailAttachment[] = [],
): PreparedEmail => {
  if (!html || !/data:image\//i.test(html)) {
    return { html, attachments: [...existingAttachments] };
  }

  const inlineAttachments: RelayEmailAttachment[] = [];
  const knownImages = new Map<string, string>();
  let imageIndex = 0;

  const preparedHtml = html.replace(
    /(<img\b[^>]*?\bsrc\s*=\s*)(["'])(data:(image\/[a-z0-9.+-]+)(?:;[^,]*)?;base64,([^"']+))\2/gi,
    (_match, prefix: string, quote: string, dataUri: string, mime: string, base64: string) => {
      const existingCid = knownImages.get(dataUri);
      if (existingCid) return `${prefix}${quote}cid:${existingCid}${quote}`;

      imageIndex += 1;
      const cid = `mavinci-inline-${imageIndex}-${crypto.randomUUID()}@mavinci.pl`;
      knownImages.set(dataUri, cid);
      inlineAttachments.push({
        filename: `mavinci-inline-${imageIndex}.${extensionForMime(mime)}`,
        content: base64.replace(/\s+/g, ""),
        contentType: mime,
        contentDisposition: "inline",
        cid,
      });

      return `${prefix}${quote}cid:${cid}${quote}`;
    },
  );

  return {
    html: preparedHtml,
    attachments: [...existingAttachments, ...inlineAttachments],
  };
};
