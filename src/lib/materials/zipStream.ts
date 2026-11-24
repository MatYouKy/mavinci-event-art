/*
 * Archiwum ZIP składane w locie (strona `/pobierz` — „Pobierz wszystkie”): pliki bez kompresji (zdjęcia i filmy i tak są
 * skompresowane), kolejno strumieniem z magazynu prosto do przeglądarki — serwer nie trzyma plików w pamięci ani na dysku.
 * Format: nagłówek lokalny z flagą „deskryptor danych” (CRC i rozmiar po treści), katalog centralny na końcu, nazwy w UTF-8.
 * Bez ZIP64 — całe archiwum do 4 GB i 65 535 plików (`ZIP_MAX_BYTES`, `ZIP_MAX_ENTRIES`); większe zestawy strona dzieli
 * na foldery. Plik, którego nie udało się otworzyć, jest pomijany (wpis w „NIE-POBRANO.txt” na końcu archiwum).
 */

export const ZIP_MAX_ENTRIES = 65_000;
/** Limit treści archiwum (z zapasem na nagłówki i katalog — format bez ZIP64 kończy się na 4 GiB). */
export const ZIP_MAX_BYTES = 4_000_000_000;

export type ZipEntry = {
  /** Ścieżka w archiwum („Folder/zdjęcie.jpg”) — już bez znaków niedozwolonych (`zipSafeName`). */
  name: string;
  modified: Date | null;
  /** Otwiera treść; `null` — pliku nie ma (pominięty). */
  open: () => Promise<AsyncIterable<Uint8Array> | null>;
};

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(crc: number, chunk: Uint8Array) {
  let c = crc ^ 0xffffffff;
  for (let i = 0; i < chunk.length; i += 1) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Data i czas w formacie DOS (czas polski — tak pokażą je systemy po rozpakowaniu). */
function dosDateTime(value: Date | null) {
  const date = value && !Number.isNaN(value.getTime()) ? value : new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((part) => [part.type, part.value]));
  const year = Math.min(2107, Math.max(1980, Number(parts.year)));
  return {
    time: ((Number(parts.hour) & 31) << 11) | ((Number(parts.minute) & 63) << 5) | (Math.floor(Number(parts.second) / 2) & 31),
    date: (((year - 1980) & 127) << 9) | ((Number(parts.month) & 15) << 5) | (Number(parts.day) & 31),
  };
}

/** Część ścieżki w archiwum: bez ukośników, znaków sterujących i niedozwolonych w Windows, nie „.” ani „..”, do 120 znaków. */
export function zipSafeName(value: string, fallback = 'plik') {
  const cleaned = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 120)
    .trim();
  return !cleaned || cleaned === '.' || cleaned === '..' ? fallback : cleaned;
}

/** Ścieżki bez powtórzeń (wielkość liter bez znaczenia, jak w Windows i macOS): „zdjęcie (2).jpg”. */
export function uniqueZipPaths(paths: string[]) {
  const used = new Set<string>();
  return paths.map((path) => {
    const slash = path.lastIndexOf('/');
    const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
    const file = slash >= 0 ? path.slice(slash + 1) : path;
    const dot = file.lastIndexOf('.');
    const base = dot > 0 ? file.slice(0, dot) : file;
    const ext = dot > 0 ? file.slice(dot) : '';
    let candidate = path;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) candidate = `${dir}${base} (${n})${ext}`;
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

const encoder = new TextEncoder();

function header(size: number, write: (view: DataView) => void) {
  const bytes = new Uint8Array(size);
  write(new DataView(bytes.buffer));
  return bytes;
}

type Written = { name: Uint8Array; crc: number; size: number; offset: number; time: number; date: number };

/**
 * Strumień archiwum ZIP z podanych plików (kolejno, z przeciwciśnieniem — następny fragment powstaje, gdy przeglądarka odbierze
 * poprzedni). `onSkipped` — plik pominięty (nie dało się go otworzyć).
 */
export function zipStream(entries: ZipEntry[], onSkipped?: (name: string) => void): ReadableStream<Uint8Array> {
  const iterator = zipChunks(entries, onSkipped);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next();
        if (done) controller.close();
        else controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  }, { highWaterMark: 4 });
}

async function* zipChunks(entries: ZipEntry[], onSkipped?: (name: string) => void): AsyncGenerator<Uint8Array> {
  if (entries.length > ZIP_MAX_ENTRIES) throw new Error('Za dużo plików na jedno archiwum ZIP.');
  const written: Written[] = [];
  const skipped: string[] = [];
  let offset = 0;

  const add = async function* (path: string, modified: Date | null, source: AsyncIterable<Uint8Array>) {
    const name = encoder.encode(path);
    const { time, date } = dosDateTime(modified);
    const start = offset;
    const local = header(30 + name.length, (v) => {
      v.setUint32(0, 0x04034b50, true);
      v.setUint16(4, 20, true);
      v.setUint16(6, 0x0808, true); // deskryptor danych + nazwy UTF-8
      v.setUint16(8, 0, true); // bez kompresji
      v.setUint16(10, time, true);
      v.setUint16(12, date, true);
      v.setUint32(14, 0, true);
      v.setUint32(18, 0, true);
      v.setUint32(22, 0, true);
      v.setUint16(26, name.length, true);
      v.setUint16(28, 0, true);
    });
    local.set(name, 30);
    yield local;
    offset += local.length;
    let crc = 0;
    let size = 0;
    for await (const chunk of source) {
      if (!chunk?.length) continue;
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk as ArrayBufferLike);
      crc = crc32(crc, bytes);
      size += bytes.length;
      if (offset + size > ZIP_MAX_BYTES) throw new Error('Archiwum przekroczyło 4 GB — pobierz foldery osobno.');
      yield bytes;
    }
    offset += size;
    const descriptor = header(16, (v) => {
      v.setUint32(0, 0x08074b50, true);
      v.setUint32(4, crc, true);
      v.setUint32(8, size, true);
      v.setUint32(12, size, true);
    });
    yield descriptor;
    offset += descriptor.length;
    written.push({ name, crc, size, offset: start, time, date });
  };

  for (const entry of entries) {
    let source: AsyncIterable<Uint8Array> | null = null;
    try {
      source = await entry.open();
    } catch {
      source = null;
    }
    if (!source) {
      skipped.push(entry.name);
      onSkipped?.(entry.name);
      continue;
    }
    yield* add(entry.name, entry.modified, source);
  }

  if (skipped.length) {
    const note = encoder.encode([
      'Tych plików nie udało się dołączyć do archiwum — pobierz je pojedynczo ze strony linku:',
      '',
      ...skipped,
      '',
    ].join('\r\n'));
    yield* add('NIE-POBRANO.txt', new Date(), (async function* () { yield note; })());
  }

  const directoryStart = offset;
  for (const item of written) {
    const central = header(46 + item.name.length, (v) => {
      v.setUint32(0, 0x02014b50, true);
      v.setUint16(4, (3 << 8) | 20, true); // Unix, wersja 2.0
      v.setUint16(6, 20, true);
      v.setUint16(8, 0x0808, true);
      v.setUint16(10, 0, true);
      v.setUint16(12, item.time, true);
      v.setUint16(14, item.date, true);
      v.setUint32(16, item.crc, true);
      v.setUint32(20, item.size, true);
      v.setUint32(24, item.size, true);
      v.setUint16(28, item.name.length, true);
      v.setUint16(30, 0, true);
      v.setUint16(32, 0, true);
      v.setUint16(34, 0, true);
      v.setUint16(36, 0, true);
      v.setUint32(38, (0o100644 << 16) >>> 0, true);
      v.setUint32(42, item.offset, true);
    });
    central.set(item.name, 46);
    yield central;
    offset += central.length;
  }
  if (offset > 0xffffffff) throw new Error('Archiwum przekroczyło 4 GB — pobierz foldery osobno.');
  const end = header(22, (v) => {
    v.setUint32(0, 0x06054b50, true);
    v.setUint16(4, 0, true);
    v.setUint16(6, 0, true);
    v.setUint16(8, written.length, true);
    v.setUint16(10, written.length, true);
    v.setUint32(12, offset - directoryStart, true);
    v.setUint32(16, directoryStart, true);
    v.setUint16(20, 0, true);
  });
  yield end;
}
