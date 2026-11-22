import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, ScrollView, StyleSheet, Text, TouchableOpacity, View, type LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, shade } from '../theme';

/*
 * Siatki wyboru rozmiaru w konfiguratorze (tablet i telefon) — jak `StageModuleGrid` / `LedSectionGrid` w CRM i
 * `StageDeckGrid` / `LedSectionGrid` na Macu, pod dotyk: dotknięcie pola wybiera prostokątny układ od lewego górnego rogu,
 * przeciągnięcie palcem pokazuje układ na żywo (z opisem pod siatką) i wybiera go po puszczeniu. Podziałka w metrach.
 * Siatka wypełnia całą dostępną szerokość (pola wygodne pod palec), rośnie razem z wyborem (zapas 1 m), a pasy „+” przy
 * prawej i dolnej krawędzi dokładają kolumnę albo rząd. Za duża siatka przewija się w poziomie za podziałkę; liczby obok
 * siatki zostają do dokładnego wpisania.
 */

type Cell = { column: number; row: number };

const RULER_WIDTH = 28;
const RULER_HEIGHT = 18;
const GAP = 2;
/** Pas „+” przy prawej i dolnej krawędzi siatki (dokłada kolumnę albo rząd). */
const EDGE = 30;
/** Miejsce zajęte obok pól w poziomie: podziałka, pas „+” i odstępy. */
const CHROME = RULER_WIDTH + EDGE + 3 * GAP + 4;
/** Powyżej tylu pól siatka nie jest rysowana (układ ustawia się liczbami) — płynność na telefonie. */
const MAX_CELLS = 1800;

const plain = (value: number) => String(Math.round(value * 100) / 100).replace('.', ',');
const plural = (count: number, one: string, few: string, many: string) => {
  if (count === 1) return one;
  const tens = count % 100;
  return count % 10 >= 2 && count % 10 <= 4 && (tens < 12 || tens > 14) ? few : many;
};
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Pola siatki — osobna, zapamiętana warstwa (przeciąganie zmienia tylko wycinek zaznaczenia). */
const TileLayer = memo(function TileLayer({ columns, rows, pitchX, pitchY, color }: { columns: number; rows: number; pitchX: number; pitchY: number; color: string }) {
  const tiles: React.ReactNode[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      tiles.push(
        <View key={`${column}:${row}`} style={{
          position: 'absolute', left: column * pitchX, top: row * pitchY, width: pitchX - GAP, height: pitchY - GAP, borderRadius: 2, backgroundColor: color,
        }} />,
      );
    }
  }
  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>{tiles}</View>;
});

type Ruler = { at: number; text: string };

type Expand = { label: string; onPress: () => void } | null;

/**
 * Siatka dotykowa: `columns` × `rows` pól o rozstawie `pitchX` × `pitchY`; wybór zawsze od pola (1, 1). `right` / `down` —
 * pasy „+” przy krawędziach (bez nich: siatka ma już największy rozmiar).
 */
function TouchGrid({ columns, rows, pitchX, pitchY, selected, accent, disabled, horizontal, vertical, label, right, down, onPreview, onChoose }: {
  columns: number; rows: number; pitchX: number; pitchY: number; selected: Cell | null; accent: string; disabled: boolean;
  horizontal: Ruler[]; vertical: Ruler[]; label: string; right: Expand; down: Expand;
  onPreview: (cell: Cell | null) => void; onChoose: (cell: Cell) => void;
}) {
  const [preview, setPreview] = useState<Cell | null>(null);
  const width = columns * pitchX;
  const height = rows * pitchY;
  // Aktualne wartości dla obsługi gestu (tworzonej raz).
  const live = useRef({ columns, rows, pitchX, pitchY, disabled, onPreview, onChoose });
  live.current = { columns, rows, pitchX, pitchY, disabled, onPreview, onChoose };
  const start = useRef({ x: 0, y: 0 });
  const current = useRef<Cell | null>(null);

  const responder = useMemo(() => {
    const cellAt = (x: number, y: number): Cell => {
      const grid = live.current;
      return {
        column: clamp(Math.floor(x / grid.pitchX) + 1, 1, grid.columns),
        row: clamp(Math.floor(y / grid.pitchY) + 1, 1, grid.rows),
      };
    };
    const show = (cell: Cell | null) => {
      const before = current.current;
      if (before?.column === cell?.column && before?.row === cell?.row) return;
      current.current = cell;
      setPreview(cell);
      live.current.onPreview(cell);
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => !live.current.disabled,
      onMoveShouldSetPanResponder: () => !live.current.disabled,
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (event) => {
        start.current = { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY };
        show(cellAt(start.current.x, start.current.y));
      },
      onPanResponderMove: (_event, gesture) => {
        show(cellAt(start.current.x + gesture.dx, start.current.y + gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        const cell = cellAt(start.current.x + gesture.dx, start.current.y + gesture.dy);
        show(null);
        live.current.onChoose(cell);
      },
      onPanResponderTerminate: () => show(null),
    });
  }, []);

  const shown = preview || selected;
  return (
    <View>
      <View style={{ height: RULER_HEIGHT, width: RULER_WIDTH + width }}>
        <Text style={[styles.ruler, { position: 'absolute', left: 0, width: RULER_WIDTH - 4, bottom: 2, textAlign: 'right' }]}>0 m</Text>
        {horizontal.map((mark) => (
          <Text key={mark.at} style={[styles.ruler, { position: 'absolute', left: RULER_WIDTH + mark.at - 40, width: 38, bottom: 2, textAlign: 'right' }]}>{mark.text}</Text>
        ))}
      </View>
      <View style={styles.gridRow}>
        <View style={{ width: RULER_WIDTH, height }}>
          {vertical.map((mark) => (
            <Text key={mark.at} style={[styles.ruler, { position: 'absolute', top: mark.at - 14, right: 4 }]}>{mark.text}</Text>
          ))}
        </View>
        <View style={{ width, height }} {...responder.panHandlers}
          accessible accessibilityLabel={label}
          accessibilityHint="Dotknij pola albo przeciągnij palcem, aby wybrać układ; liczby obok siatki ustawiają go dokładnie.">
          <TileLayer columns={columns} rows={rows} pitchX={pitchX} pitchY={pitchY} color={glow(0.09)} />
          {shown ? (
            <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: shown.column * pitchX, height: shown.row * pitchY, overflow: 'hidden', opacity: preview ? 0.55 : 0.75 }}>
              <TileLayer columns={columns} rows={rows} pitchX={pitchX} pitchY={pitchY} color={accent} />
            </View>
          ) : null}
        </View>
        {right ? (
          <TouchableOpacity onPress={right.onPress} disabled={disabled} style={[styles.edge, { height: height - GAP, borderColor: accent }]}
            accessibilityRole="button" accessibilityLabel={`Rozszerz siatkę: ${right.label}`}>
            <Feather name="plus" size={16} color={accent} />
            <Text style={[styles.edgeText, { color: accent }]}>{right.label}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      {down ? (
        <TouchableOpacity onPress={down.onPress} disabled={disabled} style={[styles.edgeDown, { width: width - GAP, borderColor: accent }]}
          accessibilityRole="button" accessibilityLabel={`Rozszerz siatkę: ${down.label}`}>
          <Feather name="plus" size={16} color={accent} />
          <Text style={[styles.edgeText, { color: accent }]}>{down.label}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

/** Szerokość miejsca na siatkę (pomiar kontenera) i przewijanie w poziomie, gdy siatka jest szersza. */
function GridFrame({ contentWidth, onWidth, children }: { contentWidth: number; onWidth: (width: number) => void; children: React.ReactNode }) {
  const [frame, setFrame] = useState(0);
  const layout = (event: LayoutChangeEvent) => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next !== frame) { setFrame(next); onWidth(next); }
  };
  return (
    <View onLayout={layout}>
      {frame ? (
        <ScrollView horizontal bounces={false} showsHorizontalScrollIndicator={contentWidth > frame} contentContainerStyle={styles.frameContent}>
          {children}
        </ScrollView>
      ) : null}
    </View>
  );
}

/** Wybór wysłany na serwer — pokazywany do odpowiedzi (albo do końca zapytania, gdy serwer go nie przyjął). */
function usePending(disabled: boolean, ...committed: unknown[]) {
  const [pending, setPending] = useState<Cell | null>(null);
  const wasDisabled = useRef(disabled);
  useEffect(() => { setPending(null); }, committed); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (wasDisabled.current && !disabled) setPending(null);
    wasDisabled.current = disabled;
  }, [disabled]);
  return [pending, setPending] as const;
}

const metreMarks = (metres: number, pixelsPerMetre: number, minimumSpacing: number) => {
  const step = Math.max(1, Math.ceil(minimumSpacing / pixelsPerMetre));
  const marks: Ruler[] = [];
  for (let metre = step; metre <= metres; metre += step) marks.push({ at: metre * pixelsPerMetre, text: `${metre} m` });
  return marks;
};

/** Podest: siatka blatów 1 × 2 m (front w poziomie, głębokość w pionie); obrót zmienia ułożenie blatów. */
export function StageDeckGrid({ width, depth, accent, disabled, onChoose }: {
  width: number | null; depth: number | null; accent: string; disabled: boolean; onChoose: (width: number, depth: number) => void;
}) {
  const [verticalDecks, setVerticalDecks] = useState(false);
  const [extent, setExtent] = useState({ columns: 0, rows: 0 });
  const [frame, setFrame] = useState(0);
  const [preview, setPreview] = useState<Cell | null>(null);
  const [pending, setPending] = usePending(disabled, width, depth, verticalDecks);

  const cellWidth = verticalDecks ? 1 : 2;
  const cellDepth = verticalDecks ? 2 : 1;
  const count = (value: number | null, size: number) => {
    if (value == null || !Number.isFinite(value) || value < 1) return null;
    const ratio = value / size;
    return Math.round(ratio) === ratio ? ratio : null;
  };
  const columns = count(width, cellWidth);
  const rows = count(depth, cellDepth);

  // Ułożenie blatów, w którym bieżący rozmiar da się złożyć (jak `orient()` na Macu i efekt w `StageModuleGrid`).
  useEffect(() => {
    if (width == null || depth == null) return;
    const horizontalFits = count(width, 2) != null && count(depth, 1) != null;
    const verticalFits = count(width, 1) != null && count(depth, 2) != null;
    if (verticalDecks && !verticalFits && horizontalFits) setVerticalDecks(false);
    if (!verticalDecks && !horizontalFits && verticalFits) setVerticalDecks(true);
  }, [width, depth]); // eslint-disable-line react-hooks/exhaustive-deps

  const maxColumns = Math.floor(100 / cellWidth);
  const maxRows = Math.floor(100 / cellDepth);
  const room = Math.max(0, frame - CHROME);
  /** Cała szerokość: tyle blatów, ile mieści się przy ~36 pkt na metr (na telefonie — co najmniej 12 m, gęściej). */
  const fitColumns = Math.floor(Math.floor(room / 36) / cellWidth);
  const visibleColumns = Math.min(maxColumns, Math.max(Math.floor(12 / cellWidth), (columns ?? 0) + 1, extent.columns, fitColumns));
  const visibleRows = Math.min(maxRows, Math.max(Math.floor(6 / cellDepth), (rows ?? 0) + 1, extent.rows));
  const metresX = visibleColumns * cellWidth;
  const metresY = visibleRows * cellDepth;
  const pixelsPerMetre = clamp(Math.floor(room / metresX), 10, 44);
  const tooLarge = visibleColumns * visibleRows > MAX_CELLS;
  const selected = pending || (columns && rows ? { column: columns, row: rows } : null);

  const choose = (cell: Cell) => {
    setPending(cell);
    onChoose(cell.column * cellWidth, cell.row * cellDepth);
  };
  const rotate = () => {
    setPreview(null);
    setExtent({ columns: 0, rows: 0 });
    setVerticalDecks(!verticalDecks);
  };
  const caption = preview
    ? `Wybierasz ${plain(preview.column * cellWidth)} × ${plain(preview.row * cellDepth)} m — ${preview.column * preview.row} ${plural(preview.column * preview.row, 'blat', 'blaty', 'blatów')}.`
    : 'Dotknij pola albo przeciągnij palcem, aby wybrać prostokątny układ (front × głębokość). „+” przy krawędzi dokłada kolumnę albo rząd blatów.';

  return (
    <View style={styles.box}>
      <View style={styles.head}>
        <Text style={[styles.muted, styles.headText]}>Siatka blatów 1 × 2 m — blat: {cellWidth} m w poziomie × {cellDepth} m w pionie</Text>
        <TouchableOpacity onPress={rotate} disabled={disabled} style={[styles.expand, { borderColor: accent }]} accessibilityRole="button" accessibilityLabel="Obróć układ blatów o 90 stopni">
          <Feather name="rotate-cw" size={14} color={accent} /><Text style={[styles.expandText, { color: accent }]}>Obróć o 90°</Text>
        </TouchableOpacity>
      </View>
      {tooLarge ? (
        <Text style={styles.muted}>Ten układ jest za duży na siatkę — ustaw szerokość i głębokość liczbami.</Text>
      ) : (
        <GridFrame contentWidth={CHROME + metresX * pixelsPerMetre} onWidth={setFrame}>
          {frame ? (
            <TouchGrid columns={visibleColumns} rows={visibleRows} pitchX={cellWidth * pixelsPerMetre} pitchY={cellDepth * pixelsPerMetre}
              selected={selected} accent={accent} disabled={disabled}
              horizontal={metreMarks(metresX, pixelsPerMetre, 26)} vertical={metreMarks(metresY, pixelsPerMetre, 16)}
              label={selected ? `Podest ${plain(selected.column * cellWidth)} × ${plain(selected.row * cellDepth)} m` : 'Siatka podestu — nie wybrano układu'}
              right={visibleColumns < maxColumns ? { label: `${cellWidth} m`, onPress: () => setExtent({ columns: Math.min(maxColumns, visibleColumns + 1), rows: visibleRows }) } : null}
              down={visibleRows < maxRows ? { label: `${cellDepth} m`, onPress: () => setExtent({ columns: visibleColumns, rows: Math.min(maxRows, visibleRows + 1) }) } : null}
              onPreview={setPreview} onChoose={choose} />
          ) : null}
        </GridFrame>
      )}
      <Text style={[styles.caption, preview && { color: accent }]}>{caption}</Text>
    </View>
  );
}

/** Sekcja ekranu LED: kafelki 0,5 × 0,5 m (2 kafelki = 1 m), do 200 w każdą stronę. */
export function LedSectionGrid({ columns, rows, accent, disabled, onChoose }: {
  columns: number | null; rows: number | null; accent: string; disabled: boolean; onChoose: (columns: number, rows: number) => void;
}) {
  const [extent, setExtent] = useState({ columns: 12, rows: 8 });
  const [frame, setFrame] = useState(0);
  const [preview, setPreview] = useState<Cell | null>(null);
  const [pending, setPending] = usePending(disabled, columns, rows);

  const whole = (value: number | null) => (value != null && Number.isFinite(value) && value >= 1 ? Math.round(value) : 0);
  const selectedColumns = whole(columns);
  const selectedRows = whole(rows);
  /** Pełne metry (parzysta liczba kafelków) z zapasem 1 m na powiększenie — jak na Macu. */
  const margin = (selected: number) => Math.ceil((selected + 2) / 2) * 2;
  const room = Math.max(0, frame - CHROME);
  /** Cała szerokość: tyle pełnych metrów, ile mieści się przy kafelku ~44 pkt (na telefonie — co najmniej 6 m, gęściej). */
  const fitColumns = Math.floor(room / 44 / 2) * 2;
  const visibleColumns = Math.min(200, Math.max(extent.columns, margin(selectedColumns), fitColumns));
  const visibleRows = Math.min(200, Math.max(extent.rows, margin(selectedRows)));
  const pitch = clamp(Math.floor(room / visibleColumns), 12, 56);
  const tooLarge = visibleColumns * visibleRows > MAX_CELLS;
  const selected = pending || (selectedColumns && selectedRows ? { column: selectedColumns, row: selectedRows } : null);

  const choose = (cell: Cell) => {
    setPending(cell);
    onChoose(cell.column, cell.row);
  };
  const caption = preview
    ? `Wybierasz ${preview.column} × ${preview.row} ${plural(preview.column * preview.row, 'kafelek', 'kafelki', 'kafelków')} · ${plain(preview.column / 2)} × ${plain(preview.row / 2)} m · ${plain(preview.column * preview.row / 4)} m².`
    : '2 kafelki = 1 m. Dotknij pola albo przeciągnij palcem, aby wybrać układ sekcji; „+” przy krawędzi dokłada metr siatki.';

  return (
    <View style={styles.gap}>
      {tooLarge ? (
        <Text style={styles.muted}>Ta sekcja jest za duża na siatkę — ustaw kafelki w poziomie i w pionie liczbami.</Text>
      ) : (
        <GridFrame contentWidth={CHROME + visibleColumns * pitch} onWidth={setFrame}>
          {frame ? (
            <TouchGrid columns={visibleColumns} rows={visibleRows} pitchX={pitch} pitchY={pitch}
              selected={selected} accent={accent} disabled={disabled}
              horizontal={metreMarks(visibleColumns / 2, pitch * 2, 26)} vertical={metreMarks(visibleRows / 2, pitch * 2, 16)}
              label={selected ? `Sekcja ${selected.column} × ${selected.row} kafelków` : 'Siatka sekcji — nie wybrano układu'}
              right={visibleColumns < 200 ? { label: '1 m', onPress: () => setExtent({ columns: Math.min(200, visibleColumns + 2), rows: visibleRows }) } : null}
              down={visibleRows < 200 ? { label: '1 m', onPress: () => setExtent({ columns: visibleColumns, rows: Math.min(200, visibleRows + 2) }) } : null}
              onPreview={setPreview} onChoose={choose} />
          ) : null}
        </GridFrame>
      )}
      <Text style={[styles.caption, preview && { color: accent }]}>{caption}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headText: { flexGrow: 1, flexShrink: 1, flexBasis: 180 },
  gap: { gap: spacing.sm },
  box: { gap: spacing.sm, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: shade(0.18) },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  gridRow: { flexDirection: 'row' },
  frameContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 2, paddingRight: 4 },
  ruler: { color: colors.text.tertiary, fontSize: 10 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  caption: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  expand: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1,
  },
  expandText: { fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  edge: {
    width: EDGE, marginLeft: GAP * 2, borderRadius: borderRadius.md, borderWidth: 1, borderStyle: 'dashed',
    alignItems: 'center', justifyContent: 'center', gap: 2,
  },
  edgeDown: {
    height: EDGE, marginLeft: RULER_WIDTH, marginTop: GAP * 2, borderRadius: borderRadius.md, borderWidth: 1, borderStyle: 'dashed',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
  },
  edgeText: { fontSize: 10, fontWeight: typography.fontWeights.semibold },
});
