import React, { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow, ink, shade, tone } from '../../theme';
import { inquiryEmployees, type InquiryUpdate } from '../../lib/inquiriesApi';
import {
  INQUIRY_LOST_CATEGORIES, INQUIRY_STAGES, isClosedStage, plannedAt, stageOf, type InquiryAccess, type InquiryStageId,
} from '../../lib/inquiryFunnel';
import { warsawDate, warsawDay, warsawTime } from '../../lib/inquiryWorkspace';

/*
 * Wspólne elementy zapytań na tablecie (lejek i karta zapytania): przyciski i znaczniki do dotyku (min. 38–44 pt), okno na środku
 * ekranu, wybór daty i godziny w czasie polskim, lista wyboru z wyszukiwaniem (zamiast rzędów znaczników — np. pracownicy),
 * okno ładowania i komunikat po czynności, okna „Opiekun, etap i termin działania” i „Kontakt wykonany”.
 */

type IconName = React.ComponentProps<typeof Feather>['name'];

/**
 * Następne okno po zamknięciu poprzedniego (menu → formularz): iOS nie pokaże nowego okna w trakcie animacji zamykania
 * poprzedniego, więc czekamy chwilę; Android — od razu.
 */
export const afterModal = (action: () => void) => { setTimeout(action, Platform.OS === 'ios' ? 350 : 0); };

export function Chip({ label, active, onPress, dot, disabled = false }: { label: string; active: boolean; onPress: () => void; dot?: string; disabled?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[kit.chip, active && kit.chipActive, disabled && kit.disabled]} accessibilityRole="button"
      accessibilityState={{ selected: active, disabled }}>
      {dot ? <View style={[kit.dot, { backgroundColor: tone(dot) }]} /> : null}
      <Text style={[kit.chipText, active && kit.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

export function SmallButton({ label, icon, onPress, primary = false, danger = false, disabled = false }: {
  label: string; icon: IconName; onPress: () => void; primary?: boolean; danger?: boolean; disabled?: boolean;
}) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled} style={[kit.smallButton, primary && kit.smallPrimary, disabled && kit.disabled]} accessibilityRole="button"
      accessibilityState={{ disabled }}>
      <Feather name={icon} size={14} color={primary ? colors.background.primary : danger ? colors.status.error : colors.primary.gold} />
      <Text style={[kit.smallText, primary && { color: colors.background.primary }, danger && { color: colors.status.error }]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** Przyciski w stopce okna: „Anuluj” i główna czynność (z kółkiem w trakcie zapisu). */
export function SheetActions({ onCancel, onConfirm, label, disabled = false, saving = false, danger = false, cancelLabel = 'Anuluj' }: {
  onCancel: () => void; onConfirm: () => void; label: string; disabled?: boolean; saving?: boolean; danger?: boolean; cancelLabel?: string;
}) {
  return (
    <>
      <TouchableOpacity onPress={onCancel} disabled={saving} style={kit.secondary}><Text style={kit.secondaryText}>{cancelLabel}</Text></TouchableOpacity>
      <TouchableOpacity onPress={onConfirm} disabled={disabled || saving} style={[danger ? kit.danger : kit.primary, (disabled || saving) && kit.disabled]} accessibilityRole="button">
        {saving ? <ActivityIndicator color={danger ? colors.white : colors.background.primary} /> : <Text style={danger ? kit.dangerText : kit.primaryText}>{label}</Text>}
      </TouchableOpacity>
    </>
  );
}

type Toast = { text: string; error: boolean };
type NoticeState = { busy: string | null; toast: Toast | null };
const NoticeContext = createContext<NoticeState>({ busy: null, toast: null });
/**
 * Stan czynności ekranu dla okien: okno zakrywa ekran, więc komunikat błędu i okno ładowania pokazujemy także w otwartym oknie
 * (inaczej błąd zapisu byłby niewidoczny pod oknem).
 */
export const NoticeScope = NoticeContext.Provider;

/** Okno na środku ekranu (tablet) albo na całą szerokość (telefon). */
export function Sheet({ visible, title, subtitle, onClose, children, footer, width = 600 }: {
  visible: boolean; title: string; subtitle?: string; onClose: () => void; children: ReactNode; footer: ReactNode; width?: number;
}) {
  const notice = useContext(NoticeContext);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={kit.sheetBackdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Zamknij" />
        <View style={[kit.sheet, { maxWidth: width }]}>
          <Text style={kit.sheetTitle}>{title}</Text>
          {subtitle ? <Text style={kit.muted} numberOfLines={2}>{subtitle}</Text> : null}
          <ScrollView style={kit.sheetScroll} contentContainerStyle={kit.sheetBody} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          {notice.toast?.error ? (
            <View style={kit.sheetError} accessibilityLiveRegion="polite">
              <Feather name="alert-circle" size={16} color={colors.status.error} />
              <Text style={[kit.text, kit.flex]}>{notice.toast.text}</Text>
            </View>
          ) : null}
          <View style={kit.sheetFooter}>{footer}</View>
        </View>
      </KeyboardAvoidingView>
      {notice.busy ? (
        <View style={kit.busy} pointerEvents="auto" accessibilityViewIsModal accessibilityLiveRegion="polite">
          <View style={kit.busyCard}><ActivityIndicator color={colors.primary.gold} /><Text style={kit.text}>{notice.busy}</Text></View>
        </View>
      ) : null}
    </Modal>
  );
}

const dayLabel = (value: Date) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', day: 'numeric', month: 'long', year: 'numeric' }).format(value);
const hourLabel = (value: Date) => new Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value);

/** Wybór daty albo godziny: iOS — kółka w oknie, Android — systemowe okno; zawsze czas polski. */
function Picker({ mode, value, minimum, onChange, onClose }: { mode: 'date' | 'time'; value: Date; minimum?: Date; onChange: (value: Date) => void; onClose: () => void }) {
  if (Platform.OS === 'android') {
    return (
      <DateTimePicker value={value} mode={mode} is24Hour timeZoneName="Europe/Warsaw" minimumDate={minimum}
        onChange={(event: { type: string }, date?: Date) => { onClose(); if (event.type === 'set' && date) onChange(date); }} />
    );
  }
  return (
    <View style={kit.pickerPanel}>
      <DateTimePicker value={value} mode={mode} display="spinner" locale="pl-PL" is24Hour timeZoneName="Europe/Warsaw" minimumDate={minimum}
        onChange={(_event: unknown, date?: Date) => { if (date) onChange(date); }} />
      <TouchableOpacity onPress={onClose} style={kit.secondary}><Text style={kit.secondaryText}>Gotowe</Text></TouchableOpacity>
    </View>
  );
}

/** Data i godzina (czas polski). */
export function DateTimeField({ value, onChange, minimum }: { value: Date; onChange: (value: Date) => void; minimum?: Date }) {
  const [picker, setPicker] = useState<'date' | 'time' | null>(null);
  return (
    <View style={kit.gapSm}>
      <View style={kit.row}>
        <TouchableOpacity onPress={() => setPicker('date')} style={kit.dateButton}><Feather name="calendar" size={15} color={colors.primary.gold} /><Text style={kit.text}>{dayLabel(value)}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setPicker('time')} style={kit.dateButton}><Feather name="clock" size={15} color={colors.primary.gold} /><Text style={kit.text}>{hourLabel(value)}</Text></TouchableOpacity>
      </View>
      {picker ? <Picker mode={picker} value={value} minimum={minimum} onChange={onChange} onClose={() => setPicker(null)} /> : null}
    </View>
  );
}

/** Sam dzień (`YYYY-MM-DD`, czas polski) — np. termin w ustaleniach. */
export function DayField({ value, onChange, placeholder = 'Wybierz dzień' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const date = value ? warsawDate(value) : new Date();
  return (
    <View style={kit.gapSm}>
      <TouchableOpacity onPress={() => setOpen(true)} style={kit.dateButton} accessibilityRole="button">
        <Feather name="calendar" size={15} color={colors.primary.gold} />
        <Text style={value ? kit.text : kit.muted}>{value ? dayLabel(date) : placeholder}</Text>
      </TouchableOpacity>
      {open ? <Picker mode="date" value={date} onChange={(next) => onChange(warsawDay(next))} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

/** Sama godzina (`HH:MM`, czas polski) z możliwością wyczyszczenia. */
export function TimeField({ value, onChange, placeholder = 'Godzina' }: { value: string; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const date = warsawDate(warsawDay(new Date()), value || '18:00');
  return (
    <View style={kit.gapSm}>
      <View style={kit.row}>
        <TouchableOpacity onPress={() => setOpen(true)} style={kit.dateButton} accessibilityRole="button">
          <Feather name="clock" size={15} color={colors.primary.gold} />
          <Text style={value ? kit.text : kit.muted}>{value || placeholder}</Text>
        </TouchableOpacity>
        {value ? (
          <TouchableOpacity onPress={() => { onChange(''); setOpen(false); }} style={kit.iconButton} accessibilityLabel="Wyczyść godzinę">
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        ) : null}
      </View>
      {open ? <Picker mode="time" value={date} onChange={(next) => onChange(warsawTime(next))} onClose={() => setOpen(false)} /> : null}
    </View>
  );
}

export type SelectOption = { id: string; label: string; detail?: string };

/** Lista do wyboru (jedna albo wiele pozycji) z wyszukiwaniem — przewijana w miejscu, duże wiersze do dotyku. */
export function SelectList({ options, selected, onToggle, multiple = false, searchable, emptyText = 'Brak pozycji.', maxHeight = 300 }: {
  options: SelectOption[]; selected: string[]; onToggle: (id: string) => void; multiple?: boolean; searchable?: boolean; emptyText?: string; maxHeight?: number;
}) {
  const [query, setQuery] = useState('');
  const search = searchable ?? options.length > 8;
  const visible = useMemo(() => {
    const text = query.trim().toLocaleLowerCase('pl-PL');
    if (!text) return options;
    return options.filter((option) => selected.includes(option.id) || `${option.label} ${option.detail || ''}`.toLocaleLowerCase('pl-PL').includes(text));
  }, [options, query, selected]);
  return (
    <View style={kit.selectList}>
      {search ? (
        <View style={kit.selectSearch}>
          <Feather name="search" size={15} color={colors.text.tertiary} />
          <TextInput value={query} onChangeText={setQuery} placeholder="Szukaj…" placeholderTextColor={ink(0.35)} style={kit.selectSearchInput} autoCorrect={false} />
        </View>
      ) : null}
      <ScrollView style={{ maxHeight }} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {visible.length ? visible.map((option) => {
          const active = selected.includes(option.id);
          return (
            <TouchableOpacity key={option.id || '∅'} onPress={() => onToggle(option.id)} style={[kit.selectRow, active && kit.selectRowActive]}
              accessibilityRole={multiple ? 'checkbox' : 'radio'} accessibilityState={{ checked: active }}>
              <Feather name={multiple ? (active ? 'check-square' : 'square') : (active ? 'check-circle' : 'circle')} size={18} color={active ? colors.primary.gold : colors.text.tertiary} />
              <View style={kit.flex}>
                <Text style={[kit.text, active && { color: colors.primary.gold }]} numberOfLines={2}>{option.label}</Text>
                {option.detail ? <Text style={kit.muted} numberOfLines={1}>{option.detail}</Text> : null}
              </View>
            </TouchableOpacity>
          );
        }) : <Text style={[kit.muted, kit.selectEmpty]}>{emptyText}</Text>}
      </ScrollView>
    </View>
  );
}

/** Pole wyboru: pokazuje wybraną pozycję, dotknięcie rozwija listę (z wyszukiwaniem przy dłuższych listach). */
export function SelectField({ value, options, onChange, placeholder = 'Wybierz…', disabled = false, emptyText }: {
  value: string; options: SelectOption[]; onChange: (id: string) => void; placeholder?: string; disabled?: boolean; emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.id === value) || null;
  return (
    <View style={kit.gapSm}>
      <TouchableOpacity onPress={() => setOpen((state) => !state)} disabled={disabled} style={[kit.selectField, open && kit.selectFieldOpen, disabled && kit.disabled]}
        accessibilityRole="button" accessibilityState={{ expanded: open, disabled }}>
        <View style={kit.flex}>
          <Text style={current ? kit.text : kit.muted} numberOfLines={1}>{current ? current.label : placeholder}</Text>
          {current?.detail ? <Text style={kit.muted} numberOfLines={1}>{current.detail}</Text> : null}
        </View>
        <Feather name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.tertiary} />
      </TouchableOpacity>
      {open ? <SelectList options={options} selected={value ? [value] : []} emptyText={emptyText} onToggle={(id) => { onChange(id); setOpen(false); }} /> : null}
    </View>
  );
}

/** Przełącznik kilku wariantów (np. „Przekaż osobie | Oddaj do puli”). */
export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: ReadonlyArray<{ id: T; label: string }>; onChange: (value: T) => void }) {
  return (
    <View style={kit.segment}>
      {options.map((option) => (
        <TouchableOpacity key={option.id} onPress={() => onChange(option.id)} style={[kit.segmentItem, value === option.id && kit.segmentActive]}
          accessibilityRole="tab" accessibilityState={{ selected: value === option.id }}>
          <Text style={[kit.segmentText, value === option.id && kit.segmentTextActive]} numberOfLines={1}>{option.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <Text style={kit.fieldLabel}>{children}</Text>;
}

/** Okno ładowania na czas czynności i komunikat po sukcesie albo błędzie. */
export function useNotice() {
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 6000 : 3000);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = (text: string, error = false) => setToast({ text, error });
  /** Czynność z oknem ładowania; zwraca odpowiedź albo `null` (błąd pokazany w komunikacie). */
  const run = async <T,>(label: string, action: () => Promise<T>, success?: string): Promise<T | null> => {
    setBusy(label);
    try {
      const reply = await action();
      if (success) notify(success);
      return reply;
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : 'Operacja nie powiodła się.', true);
      return null;
    } finally {
      setBusy(null);
    }
  };
  const overlay = (
    <>
      {busy ? (
        <View style={kit.busy} pointerEvents="auto" accessibilityViewIsModal accessibilityLiveRegion="polite">
          <View style={kit.busyCard}><ActivityIndicator color={colors.primary.gold} /><Text style={kit.text}>{busy}</Text></View>
        </View>
      ) : null}
      {toast ? (
        <View pointerEvents="none" style={[kit.toast, toast.error && kit.toastError]} accessibilityLiveRegion="polite">
          <Feather name={toast.error ? 'alert-circle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : colors.status.success} />
          <Text style={kit.toastText}>{toast.text}</Text>
        </View>
      ) : null}
    </>
  );
  return { busy, notify, run, overlay, scope: { busy, toast } };
}

const dateOr = (value: string | null | undefined, fallback: number) => {
  const parsed = value ? Date.parse(value) : NaN;
  return new Date(Number.isNaN(parsed) ? fallback : parsed);
};

/** Pola zapytania potrzebne w oknie „Opiekun, etap i termin działania” (lejek i karta zapytania). */
export type EditableInquiry = {
  id: string; title: string; titleLabel: string; stage: string; ownerId: string | null; ownerName: string; nextActionAt: string | null;
  lastContactAt: string | null; estimatedValue: number | null; probability: number; lostReason: string; lostReasonCategory: string;
};

/** „Opiekun, etap i termin działania” — pola jak w CRM (`InquiryEditorModal`) i na Macu. */
export function InquiryEditSheet<T extends EditableInquiry>({ target, access, onClose, onSave }: {
  target: { inquiry: T; stage?: InquiryStageId } | null; access: Pick<InquiryAccess, 'canAssign'> | null; onClose: () => void;
  onSave: (inquiry: T, data: InquiryUpdate) => Promise<void>;
}) {
  const [title, setTitle] = useState('');
  const [stage, setStage] = useState<InquiryStageId>('new');
  const [ownerId, setOwnerId] = useState('');
  const [hasNext, setHasNext] = useState(false);
  const [next, setNext] = useState(new Date());
  const [hasLast, setHasLast] = useState(false);
  const [last, setLast] = useState(new Date());
  const [value, setValue] = useState('');
  const [probability, setProbability] = useState(10);
  const [lostCategory, setLostCategory] = useState('');
  const [lostReason, setLostReason] = useState('');
  const [owners, setOwners] = useState<Array<{ id: string; name: string }>>([]);
  const [saving, setSaving] = useState(false);
  const canAssign = Boolean(access?.canAssign);

  useEffect(() => {
    if (!target) return;
    const { inquiry } = target;
    const initialStage = target.stage || stageOf(inquiry.stage).id;
    setTitle(inquiry.title);
    setStage(initialStage);
    setOwnerId(inquiry.ownerId || '');
    setHasNext(Boolean(inquiry.nextActionAt)); setNext(dateOr(inquiry.nextActionAt, Date.now() + 86_400_000));
    setHasLast(Boolean(inquiry.lastContactAt)); setLast(dateOr(inquiry.lastContactAt, Date.now()));
    setValue(inquiry.estimatedValue ? String(Math.round(inquiry.estimatedValue)) : '');
    setProbability(target.stage ? stageOf(target.stage).probability : inquiry.probability);
    setLostCategory(inquiry.lostReasonCategory); setLostReason(inquiry.lostReason);
    let active = true;
    inquiryEmployees().then((reply) => {
      if (!active) return;
      const list = [...reply.employees];
      if (inquiry.ownerId && !list.some((entry) => entry.id === inquiry.ownerId)) list.unshift({ id: inquiry.ownerId, name: inquiry.ownerName || 'Obecny opiekun' });
      setOwners(list);
    }).catch(() => { if (active) setOwners(inquiry.ownerId ? [{ id: inquiry.ownerId, name: inquiry.ownerName || 'Obecny opiekun' }] : []); });
    return () => { active = false; };
  }, [target]);

  if (!target) return null;
  const closed = isClosedStage(stage);
  const amount = value.trim() ? Number(value.replace(/\s/g, '').replace(',', '.')) : null;
  const valid = Boolean(title.trim()) && (stage !== 'lost' || (Boolean(lostCategory) && Boolean(lostReason.trim()))) && (amount === null || (Number.isFinite(amount) && amount >= 0));
  const changeStage = (id: InquiryStageId) => { setStage(id); setProbability(stageOf(id).probability); };
  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    try {
      await onSave(target.inquiry, {
        title: title.trim(), stage, nextActionAt: hasNext && !closed ? next.toISOString() : null, lastContactAt: hasLast ? last.toISOString() : null,
        estimatedValue: amount, probability: closed ? stageOf(stage).probability : probability,
        lostReason: stage === 'lost' ? lostReason.trim() : '', lostReasonCategory: stage === 'lost' ? lostCategory : '',
        ...(canAssign ? { ownerId: ownerId || null } : {}),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet visible title="Opiekun, etap i termin działania" subtitle={target.inquiry.titleLabel} onClose={onClose}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void save()} label="Zapisz" disabled={!valid} saving={saving} />}>
      <Label>Tytuł zapytania</Label>
      <TextInput value={title} onChangeText={setTitle} style={kit.input} placeholder="Nazwa zapytania" placeholderTextColor={ink(0.35)} />
      <Label>Etap sprzedaży</Label>
      <View style={kit.wrap}>
        {INQUIRY_STAGES.map((item) => <Chip key={item.id} label={item.label} dot={item.color} active={stage === item.id} onPress={() => changeStage(item.id)} />)}
      </View>
      <Label>Osoba odpowiedzialna</Label>
      <SelectField value={ownerId} disabled={!canAssign} placeholder="Bez opiekuna" onChange={setOwnerId}
        options={[{ id: '', label: 'Bez opiekuna', detail: 'Zapytanie w puli „Nieprzypisane”' }, ...owners.map((owner) => ({ id: owner.id, label: owner.name }))]} />
      {!canAssign ? <Text style={kit.muted}>Opiekuna zmienia menedżer albo osoba z uprawnieniem do przydzielania.</Text> : null}
      <Label>Następne działanie</Label>
      {closed ? <Text style={kit.muted}>Zamknięte zapytanie nie ma kolejnych działań.</Text> : (
        <>
          <View style={kit.wrap}>
            <Chip label="Jutro 9:00" active={false} onPress={() => { setNext(new Date(plannedAt(1))); setHasNext(true); }} />
            <Chip label="Za 3 dni" active={false} onPress={() => { setNext(new Date(plannedAt(3))); setHasNext(true); }} />
            <Chip label="Za tydzień" active={false} onPress={() => { setNext(new Date(plannedAt(7))); setHasNext(true); }} />
            <Chip label={hasNext ? 'Bez terminu' : 'Wybierz termin…'} active={false} onPress={() => setHasNext((current) => !current)} />
          </View>
          {hasNext ? <DateTimeField value={next} onChange={setNext} /> : (
            <Text style={kit.warningText}>Brak zaplanowanego działania — zapytanie łatwo przeoczyć.</Text>
          )}
        </>
      )}
      <Label>Ostatni kontakt</Label>
      {hasLast ? (
        <>
          <DateTimeField value={last} onChange={setLast} />
          <TouchableOpacity onPress={() => setHasLast(false)}><Text style={kit.link}>Wyczyść</Text></TouchableOpacity>
        </>
      ) : (
        <View style={kit.between}><Text style={kit.muted}>Kontakt jeszcze niepodjęty</Text><SmallButton label="Teraz" icon="clock" onPress={() => { setHasLast(true); setLast(new Date()); }} /></View>
      )}
      <Label>Szacowana wartość (zł)</Label>
      <TextInput value={value} onChangeText={setValue} keyboardType="decimal-pad" style={kit.input} placeholder="0" placeholderTextColor={ink(0.35)} />
      <Label>Prawdopodobieństwo wygranej: {closed ? stageOf(stage).probability : probability}%</Label>
      <View style={[kit.stepperRow, closed && kit.disabled]} pointerEvents={closed ? 'none' : 'auto'}>
        <TouchableOpacity onPress={() => setProbability((current) => Math.max(0, current - 5))} style={kit.stepperButton} accessibilityLabel="Mniej o 5 punktów"><Feather name="minus" size={18} color={colors.primary.gold} /></TouchableOpacity>
        <View style={kit.progressTrack}><View style={[kit.progressFill, { width: `${closed ? stageOf(stage).probability : probability}%` }]} /></View>
        <TouchableOpacity onPress={() => setProbability((current) => Math.min(100, current + 5))} style={kit.stepperButton} accessibilityLabel="Więcej o 5 punktów"><Feather name="plus" size={18} color={colors.primary.gold} /></TouchableOpacity>
      </View>
      {stage === 'lost' ? (
        <>
          <Label>Kategoria utraty</Label>
          <SelectField value={lostCategory} onChange={setLostCategory} placeholder="Wybierz kategorię"
            options={INQUIRY_LOST_CATEGORIES.map((item) => ({ id: item.value, label: item.label }))} />
          <Label>Powód utraty</Label>
          <TextInput value={lostReason} onChangeText={setLostReason} multiline style={[kit.input, kit.multiline]}
            placeholder="Opisz, dlaczego klient zrezygnował" placeholderTextColor={ink(0.35)} />
        </>
      ) : null}
    </Sheet>
  );
}

/** „Kontakt wykonany” z opcjonalnym terminem kolejnego działania (`complete_inquiry_followup`). */
export function InquiryContactSheet<T extends { id: string; titleLabel: string }>({ inquiry, onClose, onConfirm, title = 'Kontakt wykonany' }: {
  inquiry: T | null; onClose: () => void; onConfirm: (inquiry: T, next: string | null) => Promise<void>; title?: string;
}) {
  const [planNext, setPlanNext] = useState(true);
  const [next, setNext] = useState(new Date(plannedAt(1)));
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (inquiry) { setPlanNext(true); setNext(new Date(plannedAt(1))); } }, [inquiry]);
  if (!inquiry) return null;
  return (
    <Sheet visible title={title} subtitle={inquiry.titleLabel} onClose={onClose} width={520}
      footer={<SheetActions onCancel={onClose} label="Potwierdź kontakt" saving={saving}
        onConfirm={async () => { setSaving(true); try { await onConfirm(inquiry, planNext ? next.toISOString() : null); } finally { setSaving(false); } }} />}>
      <View style={kit.wrap}>
        <Chip label="Zaplanuj kolejne działanie" active={planNext} onPress={() => setPlanNext(true)} />
        <Chip label="Bez kolejnego terminu" active={!planNext} onPress={() => setPlanNext(false)} />
      </View>
      {planNext ? (
        <>
          <View style={kit.wrap}>
            <Chip label="Jutro 9:00" active={false} onPress={() => setNext(new Date(plannedAt(1)))} />
            <Chip label="Za 3 dni" active={false} onPress={() => setNext(new Date(plannedAt(3)))} />
            <Chip label="Za tydzień" active={false} onPress={() => setNext(new Date(plannedAt(7)))} />
          </View>
          <DateTimeField value={next} onChange={setNext} minimum={new Date()} />
        </>
      ) : null}
    </Sheet>
  );
}

export const kit = StyleSheet.create({
  flex: { flex: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.xs },
  between: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  gapSm: { gap: spacing.sm },
  text: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.sm },
  link: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, marginTop: 4 },
  warningText: { color: '#fde68a', fontSize: typography.fontSizes.xs },
  disabled: { opacity: 0.45 },
  chip: {
    minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: glow(0.15),
  },
  chipActive: { borderColor: colors.primary.gold, backgroundColor: glow(0.08) },
  chipText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  chipTextActive: { color: colors.primary.gold, fontWeight: typography.fontWeights.semibold },
  dot: { width: 9, height: 9, borderRadius: 5 },
  smallButton: {
    minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.sm + 2, borderRadius: borderRadius.full, borderWidth: 1,
    borderColor: glow(0.15),
  },
  smallPrimary: { backgroundColor: colors.primary.gold, borderColor: colors.primary.gold },
  smallText: { color: colors.primary.gold, fontSize: typography.fontSizes.sm },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22 },
  primary: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg, backgroundColor: colors.primary.gold,
  },
  primaryText: { color: colors.background.primary, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  secondary: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, paddingHorizontal: spacing.md,
    borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.15),
  },
  secondaryText: { color: colors.primary.gold, fontSize: typography.fontSizes.md },
  danger: { minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.status.error },
  dangerText: { color: colors.white, fontSize: typography.fontSizes.md, fontWeight: typography.fontWeights.semibold },
  fieldLabel: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textTransform: 'uppercase', marginTop: spacing.xs },
  input: {
    minHeight: 48, color: colors.text.primary, fontSize: typography.fontSizes.md, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.1),
  },
  multiline: { minHeight: 96, paddingTop: spacing.sm, textAlignVertical: 'top' },
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  sheet: {
    width: '100%', maxHeight: '90%', gap: spacing.sm, padding: spacing.lg, borderRadius: borderRadius.xl, borderWidth: 1, borderColor: glow(0.1),
    backgroundColor: colors.background.elevated,
  },
  sheetTitle: { color: colors.text.primary, fontSize: typography.fontSizes.xl, fontWeight: typography.fontWeights.semibold },
  sheetScroll: { flexGrow: 0 },
  sheetBody: { gap: spacing.sm, paddingVertical: spacing.xs },
  sheetFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, paddingTop: spacing.xs },
  sheetError: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.md, borderWidth: 1,
    borderColor: colors.status.error, backgroundColor: 'rgba(239,68,68,0.08)',
  },
  dateButton: {
    minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderRadius: borderRadius.lg,
    backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.1),
  },
  pickerPanel: { alignItems: 'center', gap: spacing.xs, padding: spacing.sm, borderRadius: borderRadius.lg, backgroundColor: shade(0.2) },
  selectField: {
    minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: borderRadius.lg, backgroundColor: shade(0.25), borderWidth: 1, borderColor: glow(0.1),
  },
  selectFieldOpen: { borderColor: colors.primary.gold },
  selectList: { borderRadius: borderRadius.lg, borderWidth: 1, borderColor: glow(0.1), backgroundColor: shade(0.15), overflow: 'hidden' },
  selectSearch: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingHorizontal: spacing.md, borderBottomWidth: 1, borderBottomColor: glow(0.08) },
  selectSearchInput: { flex: 1, minHeight: 44, color: colors.text.primary, fontSize: typography.fontSizes.md },
  selectRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  selectRowActive: { backgroundColor: glow(0.06) },
  selectEmpty: { padding: spacing.md },
  segment: { flexDirection: 'row', alignSelf: 'flex-start', padding: 3, borderRadius: borderRadius.full, borderWidth: 1, borderColor: glow(0.15) },
  segmentItem: { minHeight: 38, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.full },
  segmentActive: { backgroundColor: colors.primary.gold },
  segmentText: { color: colors.text.secondary, fontSize: typography.fontSizes.sm },
  segmentTextActive: { color: colors.background.primary, fontWeight: typography.fontWeights.semibold },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepperButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: glow(0.15) },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: shade(0.3), overflow: 'hidden' },
  progressFill: { height: 8, borderRadius: 4, backgroundColor: colors.primary.gold },
  busy: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  busyCard: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: borderRadius.xl,
    backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: glow(0.1),
  },
  toast: {
    position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.elevated, borderWidth: 1, borderColor: glow(0.12), alignSelf: 'center', maxWidth: 640,
  },
  toastError: { borderColor: colors.status.error },
  toastText: { flex: 1, color: colors.text.primary, fontSize: typography.fontSizes.md },
});
