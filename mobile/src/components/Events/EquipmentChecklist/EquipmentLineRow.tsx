import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, borderRadius } from '../../../theme';
import {
  EQUIPMENT_KIND_LABELS,
  EQUIPMENT_RETURN_PHOTO_LIMIT,
  EQUIPMENT_SHORTAGE_LABELS,
  type EquipmentChecklistLine,
  type EquipmentLineTone,
  type EquipmentStageKey,
  equipmentLineTone,
  equipmentLoadbackError,
  equipmentPackedError,
  equipmentReturnError,
  equipmentReturnMissing,
} from '../../../lib/equipmentChecklist';
import { equipmentReturnPhotoUrl } from '../../../lib/equipmentChecklistApi';
import { formatEventStepDate } from '../../../lib/eventSteps';

/*
 * Pozycja checklisty sprzętu na telefonie. Dotknięcie wiersza = pełna ilość (spakowane / wraca / wróciło sprawne),
 * ponowne dotknięcie pełnej pozycji = odznacz; przycisk „±” (albo dotknięcie pozycji z brakiem) otwiera edycję ilości
 * z powodem / opisem. Kolor tła z `equipmentLineTone` (wspólny z CRM): czerwony brak / uszkodzenie, żółty czeka,
 * zielony zgodne. Walidacja jak w bazie (wspólne `equipment*Error`), ostatecznie decyduje baza.
 */

export type EquipmentLineDraft = { qty: number | null; ok: number; damaged: number; note: string };

export const TONE_BACKGROUND: Record<EquipmentLineTone, string> = {
  unchecked: colors.background.tertiary,
  ok: colors.status.success + '24',
  shortage: colors.status.error + '26',
  missing: colors.status.error + '30',
  damaged: colors.status.error + '30',
  pending: colors.status.warning + '2b',
  skipped: colors.background.secondary,
};

const TONE_ICON: Record<EquipmentLineTone, { name: string; color: string }> = {
  unchecked: { name: 'circle', color: colors.text.tertiary },
  ok: { name: 'check-circle', color: colors.status.success },
  shortage: { name: 'alert-octagon', color: '#f87171' },
  missing: { name: 'alert-octagon', color: '#f87171' },
  damaged: { name: 'tool', color: '#f87171' },
  pending: { name: 'clock', color: colors.status.warning },
  skipped: { name: 'minus-circle', color: colors.text.tertiary },
};

const RED_TEXT = '#fca5a5';
const AMBER_TEXT = '#fcd34d';
const GREEN_TEXT = '#86efac';

function Stepper({
  label,
  value,
  max,
  min = 0,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  max: number;
  min?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <View style={styles.stepperRow}>
      <Text style={styles.stepperLabel}>{label}</Text>
      <View style={styles.stepper}>
        <TouchableOpacity
          style={[styles.stepperBtn, (disabled || value <= min) && styles.stepperBtnDisabled]}
          onPress={() => onChange(Math.max(min, value - 1))}
          disabled={disabled || value <= min}
          accessibilityRole="button"
          accessibilityLabel={`${label}: mniej`}
        >
          <Feather name="minus" size={22} color={colors.text.primary} />
        </TouchableOpacity>
        <Text style={styles.stepperValue} accessibilityLabel={`${label}: ${value} z ${max}`}>
          {value}
          <Text style={styles.stepperMax}> / {max}</Text>
        </Text>
        <TouchableOpacity
          style={[styles.stepperBtn, (disabled || value >= max) && styles.stepperBtnDisabled]}
          onPress={() => onChange(Math.min(max, value + 1))}
          disabled={disabled || value >= max}
          accessibilityRole="button"
          accessibilityLabel={`${label}: więcej`}
        >
          <Feather name="plus" size={22} color={colors.text.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function initialDraft(line: EquipmentChecklistLine, stage: EquipmentStageKey): EquipmentLineDraft {
  if (stage === 'dispatch') {
    return { qty: line.packed_qty ?? line.quantity, ok: 0, damaged: 0, note: line.shortage_reason ?? '' };
  }
  if (stage === 'loadback') {
    return { qty: line.loadback_qty ?? line.shipped_qty, ok: 0, damaged: 0, note: line.loadback_note ?? '' };
  }
  // Brak zgłoszony przy załadunku powrotnym: domyślnie sprawne = tyle, ile wracało (resztę trzeba opisać).
  const loadbackShort = line.loadback_qty != null && line.loadback_qty < line.shipped_qty;
  return {
    qty: null,
    ok: line.return_ok_qty ?? (loadbackShort ? (line.loadback_qty as number) : line.shipped_qty),
    damaged: line.return_damaged_qty ?? 0,
    note: line.return_note ?? '',
  };
}

/** Czy pozycja ma zapisany stan na etapie (do przycisku „Odznacz”). */
function isChecked(line: EquipmentChecklistLine, stage: EquipmentStageKey): boolean {
  if (stage === 'dispatch') return line.packed_qty != null;
  if (stage === 'loadback') return line.loadback_qty != null;
  return line.return_ok_qty != null;
}

function statusLines(line: EquipmentChecklistLine, stage: EquipmentStageKey, tone: EquipmentLineTone) {
  const rows: { text: string; color?: string; italic?: boolean }[] = [];
  const by = (name: string | null, at: string | null) => [name, formatEventStepDate(at)].filter(Boolean).join(', ');
  if (stage === 'dispatch') {
    if (line.packed_qty == null) {
      rows.push({ text: line.required ? `Do spakowania: ${line.quantity} szt.` : `Niewymagane — ${line.quantity} szt.` });
    } else {
      const shortage = Math.max(line.quantity - line.packed_qty, 0);
      rows.push({
        text: `Spakowano ${line.packed_qty} z ${line.quantity}${shortage > 0 ? ` · brak ${shortage} szt.` : ''}`,
        color: tone === 'ok' ? GREEN_TEXT : tone === 'pending' ? AMBER_TEXT : tone === 'skipped' ? undefined : RED_TEXT,
      });
      if (line.shortage_status !== 'none') {
        rows.push({
          text: EQUIPMENT_SHORTAGE_LABELS[line.shortage_status],
          color: line.shortage_status === 'pending' ? AMBER_TEXT : RED_TEXT,
        });
      }
      if (line.shortage_reason) rows.push({ text: `Powód: ${line.shortage_reason}`, italic: true });
      if (line.shortage_status === 'approved' || line.shortage_status === 'rejected') {
        const who = by(line.shortage_decided_name, line.shortage_decided_at);
        const decision = line.shortage_status === 'approved' ? 'Zgoda' : 'Odmowa';
        rows.push({
          text: `${decision}${who ? ` (${who})` : ''}${line.shortage_decision_note ? `: ${line.shortage_decision_note}` : ''}`,
          italic: true,
        });
      }
      const who = by(line.packed_by_name, line.packed_at);
      if (who) rows.push({ text: `Spakował(a): ${who}` });
    }
    return rows;
  }
  if (stage === 'loadback') {
    if (line.loadback_qty == null) {
      rows.push({ text: `Wydano ${line.shipped_qty} szt. — do sprawdzenia` });
    } else {
      const missing = Math.max(line.shipped_qty - line.loadback_qty, 0);
      rows.push({
        text: `Wraca ${line.loadback_qty} z ${line.shipped_qty}${missing > 0 ? ` · brak ${missing} szt.` : ''}`,
        color: missing > 0 ? RED_TEXT : GREEN_TEXT,
      });
      if (line.loadback_note) rows.push({ text: line.loadback_note, italic: true });
      const who = by(line.loadback_by_name, line.loadback_at);
      if (who) rows.push({ text: `Sprawdził(a): ${who}` });
    }
    return rows;
  }
  if (line.return_ok_qty == null) {
    rows.push({ text: `Wydano ${line.shipped_qty} szt. — do sprawdzenia` });
    if (line.loadback_qty != null && line.loadback_qty < line.shipped_qty) {
      rows.push({
        text: `Przy załadunku wracało ${line.loadback_qty} z ${line.shipped_qty}${line.loadback_note ? ` — ${line.loadback_note}` : ''}`,
        color: AMBER_TEXT,
      });
    }
  } else {
    const damaged = line.return_damaged_qty ?? 0;
    const missing = line.return_missing_qty ?? 0;
    rows.push({
      text: `Sprawne ${line.return_ok_qty} · uszkodzone ${damaged} · brak ${missing} (z ${line.shipped_qty})`,
      color: damaged > 0 || missing > 0 ? RED_TEXT : GREEN_TEXT,
    });
    if (line.return_note) rows.push({ text: line.return_note, italic: true });
    const who = by(line.returned_by_name, line.returned_at);
    if (who) rows.push({ text: `Sprawdził(a): ${who}` });
  }
  return rows;
}

export function EquipmentLineRow({
  line,
  stage,
  editable,
  busy,
  expanded,
  onQuick,
  onExpand,
  onCollapse,
  onSave,
  onUncheck,
  onAddPhotos,
  onRemovePhoto,
  onPreview,
}: {
  line: EquipmentChecklistLine;
  stage: EquipmentStageKey;
  /** Osoba może zmieniać pozycję na tym etapie (`can.pack` / `can.loadback` / `can.return`). */
  editable: boolean;
  busy: boolean;
  expanded: boolean;
  onQuick: () => void;
  onExpand: () => void;
  onCollapse: () => void;
  onSave: (draft: EquipmentLineDraft) => Promise<boolean>;
  onUncheck: () => Promise<boolean>;
  onAddPhotos: () => void;
  onRemovePhoto: (path: string) => void;
  onPreview: (url: string) => void;
}) {
  const tone = equipmentLineTone(line, stage);
  const icon = TONE_ICON[tone];
  const [draft, setDraft] = useState<EquipmentLineDraft>(() => initialDraft(line, stage));
  const [error, setError] = useState<string | null>(null);

  // Edycję zaczynamy od zapisanego stanu; zmiany z innych urządzeń w trakcie edycji nie nadpisują wpisywanego tekstu.
  useEffect(() => {
    if (expanded) {
      setDraft(initialDraft(line, stage));
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded, stage]);

  const meta = [
    `${line.quantity} szt.`,
    line.kind !== 'equipment' ? EQUIPMENT_KIND_LABELS[line.kind] : null,
    line.optional ? 'Opcjonalne' : null,
    line.external_rental ? 'Wynajem zewnętrzny' : null,
    line.removed ? 'Usunięte z oferty' : null,
  ].filter(Boolean);
  const photos = stage === 'return' ? line.return_photos : [];

  const validate = (next: EquipmentLineDraft): string | null => {
    if (stage === 'dispatch') return equipmentPackedError(line, next.qty, next.note);
    if (stage === 'loadback') return equipmentLoadbackError(line, next.qty, next.note);
    return equipmentReturnError(line, next.ok, next.damaged, next.note);
  };

  const save = async () => {
    const problem = validate(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    await onSave(draft);
  };

  const update = (patch: Partial<EquipmentLineDraft>) => {
    setDraft((previous) => ({ ...previous, ...patch }));
    if (error) setError(null);
  };

  const missing = stage === 'return' ? equipmentReturnMissing(line, draft.ok, draft.damaged) : 0;
  const shortage =
    stage === 'dispatch'
      ? Math.max(line.quantity - (draft.qty ?? line.quantity), 0)
      : stage === 'loadback'
        ? Math.max(line.shipped_qty - (draft.qty ?? line.shipped_qty), 0)
        : 0;
  const noteNeeded =
    stage === 'dispatch'
      ? shortage > 0 && line.required
      : stage === 'loadback'
        ? shortage > 0
        : draft.damaged > 0 || missing > 0;
  const noteVisible = noteNeeded || (stage === 'dispatch' ? shortage > 0 : stage === 'return') || draft.note.trim().length > 0;
  const noteLabel =
    stage === 'dispatch' ? 'Powód braku' : stage === 'loadback' ? 'Co się stało?' : 'Opis uszkodzeń lub braku';
  const notePlaceholder =
    stage === 'dispatch'
      ? 'np. uszkodzony, wypożyczony gdzie indziej'
      : stage === 'loadback'
        ? 'np. zostało na obiekcie, zaginęło, uszkodzone'
        : 'co, ile, co się stało';
  const fullLabel = stage === 'dispatch' ? 'Pełna ilość' : stage === 'loadback' ? 'Wszystko wraca' : 'Wszystko sprawne';

  return (
    <View style={[styles.row, { backgroundColor: TONE_BACKGROUND[tone] }]}>
      <View style={styles.rowMain}>
        <TouchableOpacity
          style={styles.rowPress}
          onPress={onQuick}
          disabled={!editable || busy}
          activeOpacity={0.7}
          accessibilityRole={editable ? 'button' : undefined}
          accessibilityLabel={`${line.name}. ${statusLines(line, stage, tone)[0]?.text ?? ''}`}
          accessibilityHint={editable ? 'Dotknij, aby zaznaczyć pełną ilość albo odznaczyć' : undefined}
        >
          <View style={styles.statusIcon}>
            {busy ? (
              <ActivityIndicator size="small" color={colors.primary.gold} />
            ) : (
              <Feather name={icon.name as any} size={26} color={icon.color} />
            )}
          </View>
          {line.thumbnail_url ? (
            <TouchableOpacity onPress={() => onPreview(line.thumbnail_url as string)} activeOpacity={0.8}>
              <Image source={{ uri: line.thumbnail_url }} style={styles.thumb} resizeMode="cover" />
            </TouchableOpacity>
          ) : null}
          <View style={styles.rowText}>
            <Text style={styles.name} numberOfLines={3}>
              {line.name}
            </Text>
            <Text style={styles.meta}>{meta.join(' · ')}</Text>
            {!!line.notes && (
              <Text style={styles.lineNotes} numberOfLines={3}>
                {line.notes}
              </Text>
            )}
            {statusLines(line, stage, tone).map((status, index) => (
              <Text
                key={index}
                style={[styles.status, status.color ? { color: status.color } : null, status.italic && styles.italic]}
              >
                {status.text}
              </Text>
            ))}
          </View>
        </TouchableOpacity>
        {editable && (
          <TouchableOpacity
            style={[styles.qtyBtn, expanded && styles.qtyBtnActive]}
            onPress={expanded ? onCollapse : onExpand}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Zamknij edycję ilości' : 'Zmień ilość'}
          >
            <Feather name={expanded ? 'chevron-up' : 'sliders'} size={20} color={colors.primary.gold} />
            <Text style={styles.qtyBtnText}>{expanded ? 'Zamknij' : 'Ilość'}</Text>
          </TouchableOpacity>
        )}
      </View>

      {photos.length > 0 && !expanded && (
        <View style={styles.photoRowCollapsed}>
          {photos.map((path) => (
            <TouchableOpacity key={path} onPress={() => onPreview(equipmentReturnPhotoUrl(path))} activeOpacity={0.8}>
              <Image source={{ uri: equipmentReturnPhotoUrl(path) }} style={styles.photoSmall} />
            </TouchableOpacity>
          ))}
        </View>
      )}

      {editable && expanded && (
        <View style={styles.editor}>
          {stage !== 'return' ? (
            <Stepper
              label={stage === 'dispatch' ? 'Spakowano' : 'Wraca'}
              value={draft.qty ?? 0}
              max={stage === 'dispatch' ? line.quantity : line.shipped_qty}
              onChange={(qty) => update({ qty })}
              disabled={busy}
            />
          ) : (
            <>
              <Stepper
                label="Sprawne"
                value={draft.ok}
                max={Math.max(line.shipped_qty - draft.damaged, 0)}
                onChange={(ok) => update({ ok })}
                disabled={busy}
              />
              <Stepper
                label="Uszkodzone"
                value={draft.damaged}
                max={Math.max(line.shipped_qty - draft.ok, 0)}
                onChange={(damaged) => update({ damaged })}
                disabled={busy}
              />
              <Text style={[styles.missing, missing > 0 && { color: RED_TEXT }]}>
                Brak: {missing} szt. (wydano {line.shipped_qty})
              </Text>
            </>
          )}
          {stage === 'dispatch' && shortage > 0 && (
            <Text style={[styles.hint, { color: line.required ? AMBER_TEXT : colors.text.secondary }]}>
              {line.required
                ? `Brak ${shortage} szt. — wydanie wymaga zgody sprzedawcy wydarzenia lub administratora.`
                : `Pozycja niewymagana — brak ${shortage} szt. nie blokuje wydania.`}
            </Text>
          )}
          {noteVisible && (
            <>
              <Text style={styles.inputLabel}>
                {noteLabel}
                {noteNeeded ? <Text style={styles.required}> *</Text> : <Text> (opcjonalnie)</Text>}
              </Text>
              <TextInput
                value={draft.note}
                onChangeText={(note) => update({ note })}
                placeholder={notePlaceholder}
                placeholderTextColor={colors.text.tertiary}
                multiline
                maxLength={stage === 'return' ? 2000 : 1000}
                editable={!busy}
                style={styles.input}
                accessibilityLabel={noteLabel}
              />
            </>
          )}
          {stage === 'return' && (
            <View style={styles.photoBlock}>
              <Text style={styles.inputLabel}>
                Zdjęcia ({photos.length}/{EQUIPMENT_RETURN_PHOTO_LIMIT})
              </Text>
              <View style={styles.photoRow}>
                {photos.map((path) => (
                  <View key={path} style={styles.photoWrap}>
                    <TouchableOpacity onPress={() => onPreview(equipmentReturnPhotoUrl(path))} activeOpacity={0.8}>
                      <Image source={{ uri: equipmentReturnPhotoUrl(path) }} style={styles.photo} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.photoRemove}
                      onPress={() => onRemovePhoto(path)}
                      disabled={busy}
                      accessibilityRole="button"
                      accessibilityLabel="Usuń zdjęcie"
                    >
                      <Feather name="x" size={14} color={colors.white} />
                    </TouchableOpacity>
                  </View>
                ))}
                {photos.length < EQUIPMENT_RETURN_PHOTO_LIMIT && (
                  <TouchableOpacity
                    style={styles.photoAdd}
                    onPress={onAddPhotos}
                    disabled={busy}
                    accessibilityRole="button"
                    accessibilityLabel="Dodaj zdjęcie"
                  >
                    <Feather name="camera" size={22} color={colors.primary.gold} />
                    <Text style={styles.photoAddText}>Dodaj</Text>
                  </TouchableOpacity>
                )}
              </View>
              <Text style={styles.hint}>Zdjęcia zapisują się od razu; ilości i opis — przyciskiem „Zapisz”.</Text>
            </View>
          )}
          {!!error && (
            <Text style={styles.error} accessibilityRole="alert">
              {error}
            </Text>
          )}
          <View style={styles.editorActions}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() =>
                update(
                  stage === 'dispatch'
                    ? { qty: line.quantity }
                    : stage === 'loadback'
                      ? { qty: line.shipped_qty }
                      : { ok: line.shipped_qty, damaged: 0 },
                )
              }
              disabled={busy}
            >
              <Text style={styles.secondaryBtnText}>{fullLabel}</Text>
            </TouchableOpacity>
            {isChecked(line, stage) && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => void onUncheck()} disabled={busy}>
                <Text style={styles.secondaryBtnText}>Odznacz</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.primaryBtn, busy && styles.disabled]} onPress={() => void save()} disabled={busy}>
              {busy ? (
                <ActivityIndicator size="small" color={colors.background.primary} />
              ) : (
                <Text style={styles.primaryBtnText}>Zapisz</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { borderRadius: 12, marginBottom: 8, overflow: 'hidden' },
  rowMain: { flexDirection: 'row', alignItems: 'stretch' },
  rowPress: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 12, paddingLeft: 12, paddingRight: 6, minHeight: 64 },
  statusIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  thumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: colors.background.secondary },
  rowText: { flex: 1, gap: 2 },
  name: {
    fontFamily: 'MBFAtom',
    textTransform: 'uppercase',
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.primary,
  },
  meta: { fontSize: 12, color: colors.text.tertiary },
  lineNotes: { fontSize: 12, color: colors.text.secondary, lineHeight: 17 },
  status: { fontSize: 13, color: colors.text.secondary, lineHeight: 18 },
  italic: { fontStyle: 'italic' },
  qtyBtn: {
    width: 64,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  qtyBtnActive: { backgroundColor: 'rgba(211,187,115,0.14)' },
  qtyBtnText: { fontSize: 11, color: colors.primary.gold, fontWeight: '600' },
  editor: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, gap: 8, backgroundColor: 'rgba(0,0,0,0.14)' },
  stepperRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 8 },
  stepperLabel: { color: colors.text.primary, fontSize: 14, fontWeight: '600', flex: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepperBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.elevated,
  },
  stepperBtnDisabled: { opacity: 0.35 },
  stepperValue: { minWidth: 72, textAlign: 'center', fontSize: 22, fontWeight: '700', color: colors.text.primary },
  stepperMax: { fontSize: 14, fontWeight: '500', color: colors.text.tertiary },
  missing: { fontSize: 14, fontWeight: '600', color: colors.text.secondary },
  hint: { fontSize: 12, color: colors.text.secondary, lineHeight: 17 },
  inputLabel: { color: colors.text.secondary, fontSize: 12, fontWeight: '600', marginTop: 4 },
  required: { color: '#f87171' },
  input: {
    minHeight: 64,
    maxHeight: 160,
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.primary,
    color: colors.text.primary,
    fontSize: 15,
    textAlignVertical: 'top',
  },
  photoBlock: { gap: 6 },
  photoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 6 },
  photoWrap: { position: 'relative' },
  photo: { width: 72, height: 72, borderRadius: 8, backgroundColor: colors.background.secondary },
  photoRowCollapsed: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 12, paddingBottom: 10 },
  photoSmall: { width: 48, height: 48, borderRadius: 6, backgroundColor: colors.background.secondary },
  photoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.status.error,
  },
  photoAdd: {
    width: 72,
    height: 72,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    backgroundColor: colors.primary.gold + '1f',
  },
  photoAddText: { fontSize: 11, color: colors.primary.gold, fontWeight: '600' },
  error: { color: '#ff9999', fontSize: 13, lineHeight: 18 },
  editorActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 4 },
  primaryBtn: {
    minHeight: 48,
    minWidth: 110,
    paddingHorizontal: 18,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary.gold,
  },
  primaryBtnText: { color: colors.background.primary, fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.elevated,
  },
  secondaryBtnText: { color: colors.text.primary, fontSize: 14, fontWeight: '600' },
  disabled: { opacity: 0.6 },
});

