export interface SaldeoDeliveryBundleFile {
  filename: string;
  contentBase64: string;
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let checksum = 0xffffffff;
  for (const byte of bytes) checksum = crcTable[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

/**
 * A dependency-free ZIP_STORED bundle of the exact reviewed attachment bytes.
 * It performs no upload, request or source-document conversion. The control HTML
 * is intentionally not added here; callers provide only outgoing attachments.
 */
export function buildSaldeoDeliveryBundle(files: SaldeoDeliveryBundleFile[]): Blob {
  if (!files.length) throw new Error('Brak przygotowanych plików do pobrania.');
  if (files.length > 65535) throw new Error('Zbyt wiele plików w paczce. Podziel ją na mniejsze części.');
  const encoder = new TextEncoder();
  const names = new Set<string>();
  const localParts: BlobPart[] = [];
  const centralParts: BlobPart[] = [];
  let offset = 0;
  let centralSize = 0;
  const now = new Date();
  const dosDate = ((Math.max(1980, Math.min(2107, now.getFullYear())) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);

  for (const file of files) {
    const filename = file.filename.replace(/\\/g, '/');
    const segments = filename.split('/');
    if (!filename || filename.startsWith('/') || /^[a-z]:/i.test(filename)
      || segments.some((part) => !part || part === '.' || part === '..') || /[\u0000-\u001f\u007f]/.test(filename)) {
      throw new Error('Nieprawidłowa nazwa pliku w paczce. Przygotuj paczkę ponownie.');
    }
    const uniqueName = filename.normalize('NFC').toLocaleLowerCase('pl-PL');
    if (names.has(uniqueName)) throw new Error(`Nazwa „${filename}” powtarza się w paczce. Każdy załącznik musi mieć osobną nazwę.`);
    names.add(uniqueName);
    const nameBytes = encoder.encode(filename);
    if (nameBytes.byteLength > 65535) throw new Error('Nazwa załącznika jest zbyt długa.');
    const encoded = file.contentBase64.replace(/\s/g, '');
    if (!encoded || encoded.length % 4 !== 0
      || /[^A-Za-z0-9+/]/.test(encoded.slice(0, -2)) || !/^(?:[A-Za-z0-9+/]{2}|[A-Za-z0-9+/]=|==)$/.test(encoded.slice(-2))) {
      throw new Error(`Nieprawidłowa zawartość pliku „${filename}”. Przygotuj paczkę ponownie.`);
    }
    // Bound memory use before decoding; this is an offline browser archive.
    const estimatedSize = Math.floor(encoded.length * 3 / 4);
    if (offset + estimatedSize > 512 * 1024 * 1024) throw new Error('Paczka przekracza 512 MB. Przygotuj mniejsze paczki.');
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    const checksum = crc32(bytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(6, 0x0800, true); // UTF-8 filenames.
    localView.setUint16(10, dosTime, true);
    localView.setUint16(12, dosDate, true);
    localView.setUint32(14, checksum, true);
    localView.setUint32(18, bytes.length, true);
    localView.setUint32(22, bytes.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(8, 0x0800, true);
    centralView.setUint16(12, dosTime, true);
    centralView.setUint16(14, dosDate, true);
    centralView.setUint32(16, checksum, true);
    centralView.setUint32(20, bytes.length, true);
    centralView.setUint32(24, bytes.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    localParts.push(local, bytes);
    centralParts.push(central);
    offset += local.length + bytes.length;
    centralSize += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  return new Blob([...localParts, ...centralParts, end], { type: 'application/zip' });
}
