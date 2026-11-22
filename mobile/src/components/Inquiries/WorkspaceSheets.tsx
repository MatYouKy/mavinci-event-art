import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, ink, tone } from '../../theme';
import { formatInquiryMoney, plannedAt, stageOf } from '../../lib/inquiryFunnel';
import {
  TASK_COLUMNS, TASK_PRIORITIES, briefProblem, linkWorkspaceClient, normalizeBrief, warsawDate, warsawDay, workspaceClientSearch, workspaceClientSetup,
  workspaceConvertSetup, workspaceHandoffCandidates,
  type InquiryWorkspace, type WorkspaceBrief, type WorkspaceClientRecord, type WorkspaceClientSetup, type WorkspaceConvertSetup, type WorkspaceOffer,
  type WorkspacePerson,
} from '../../lib/inquiryWorkspace';
import {
  Chip, DateTimeField, DayField, Label, Segmented, SelectField, SelectList, Sheet, SheetActions, TimeField, afterModal, kit,
} from './InquiryKit';

/*
 * Okna karty zapytania na tablecie — odpowiedniki okien w CRM (`InquiryWorkspaceClient`) i na Macu (`InquiryWorkspace.swift`,
 * `InquiryWorkspaceTools.swift`): ustalenia, nazwa, etap z powodem utraty, przekazanie / oddanie do puli, akceptacja oferty,
 * powód (ponowne negocjacje), klient i organizacja (bez cichego dublowania), wydarzenie z zapytania, nowe zadanie i menu czynności.
 */

type IconName = React.ComponentProps<typeof Feather>['name'];
/** Zapis w oknie: `true` — zapisano (okno się zamyka), `false` — błąd pokazany w komunikacie. */
type Save<T extends unknown[]> = (...args: T) => Promise<boolean>;

const useSaving = () => {
  const [saving, setSaving] = useState(false);
  const wrap = async (action: () => Promise<boolean>, close: () => void) => {
    if (saving) return;
    setSaving(true);
    try { if (await action()) close(); } finally { setSaving(false); }
  };
  return { saving, wrap };
};

// MARK: Ustalenia

/** Ustalenia zapytania (`save_inquiry_brief`): termin, godziny, miejsce, liczba osób, zakres, budżet i notatka z rozmowy. */
export function BriefSheet({ brief, subtitle, onClose, onSave }: {
  brief: WorkspaceBrief | null; subtitle: string; onClose: () => void; onSave: Save<[WorkspaceBrief]>;
}) {
  const [draft, setDraft] = useState<WorkspaceBrief | null>(null);
  const { saving, wrap } = useSaving();
  useEffect(() => { setDraft(brief ? normalizeBrief(brief) : null); }, [brief]);
  if (!brief || !draft) return null;
  const set = (patch: Partial<WorkspaceBrief>) => setDraft((current) => (current ? { ...current, ...patch } : current));
  const problem = briefProblem(draft);
  return (
    <Sheet visible title="Ustalenia zapytania" subtitle={subtitle} onClose={onClose} width={680}
      footer={<SheetActions onCancel={onClose} label="Zapisz ustalenia" disabled={Boolean(problem)} saving={saving}
        onConfirm={() => void wrap(() => onSave(normalizeBrief(draft)), onClose)} />}>
      <Label>Termin</Label>
      <View style={kit.wrap}>
        <Chip label="Termin ustalony" active={Boolean(draft.termin)} onPress={() => { if (!draft.termin) set({ termin: warsawDay(new Date()) }); }} />
        <Chip label="Bez terminu" active={!draft.termin} onPress={() => set({ termin: '' })} />
      </View>
      {draft.termin ? (
        <>
          <DayField value={draft.termin} onChange={(termin) => set({ termin })} />
          <Segmented value={draft.eventSingleDay ? 'single' : 'multi'} onChange={(value) => set({ eventSingleDay: value === 'single' })}
            options={[{ id: 'single', label: 'Jednodniowe' }, { id: 'multi', label: 'Wielodniowe' }]} />
          {!draft.eventSingleDay ? (
            <>
              <Label>Do dnia</Label>
              <DayField value={draft.eventEndDate} onChange={(eventEndDate) => set({ eventEndDate })} placeholder="Wybierz dzień zakończenia" />
            </>
          ) : null}
          <View style={kit.wrap}>
            <View style={kit.gapSm}><Label>Od godziny</Label><TimeField value={draft.eventStartTime} onChange={(eventStartTime) => set({ eventStartTime })} placeholder="np. 18:00" /></View>
            <View style={kit.gapSm}><Label>Do godziny</Label><TimeField value={draft.eventEndTime} onChange={(eventEndTime) => set({ eventEndTime })} placeholder="np. 23:30" /></View>
          </View>
          {draft.eventSingleDay && draft.eventEndTime ? (
            <Chip label="Kończy się następnego dnia" active={draft.eventEndNextDay} onPress={() => set({ eventEndNextDay: !draft.eventEndNextDay })} />
          ) : null}
        </>
      ) : null}
      <Label>Miejsce</Label>
      <TextInput value={draft.locationText} onChangeText={(locationText) => set({ locationText })} style={kit.input} placeholder="Nazwa obiektu, miasto" placeholderTextColor={ink(0.35)} />
      <Label>Liczba osób</Label>
      <TextInput value={draft.guestCount} onChangeText={(guestCount) => set({ guestCount })} keyboardType="number-pad" style={kit.input} placeholder="np. 120" placeholderTextColor={ink(0.35)} />
      {draft.guestCountText ? <Text style={kit.muted}>Z wiadomości: {draft.guestCountText}</Text> : null}
      <Label>Zakres</Label>
      <TextInput value={draft.scope} onChangeText={(scope) => set({ scope })} multiline style={[kit.input, kit.multiline]} placeholder="Czego potrzebuje klient" placeholderTextColor={ink(0.35)} />
      <Label>Budżet (zł netto)</Label>
      <View style={kit.wrap}>
        <TextInput value={draft.budgetMin} onChangeText={(budgetMin) => set({ budgetMin })} keyboardType="decimal-pad" style={[kit.input, kit.flex]} placeholder="Od, np. 15000" placeholderTextColor={ink(0.35)} />
        <TextInput value={draft.budgetMax} onChangeText={(budgetMax) => set({ budgetMax })} keyboardType="decimal-pad" style={[kit.input, kit.flex]} placeholder="Do, np. 20000" placeholderTextColor={ink(0.35)} />
      </View>
      <Label>Notatka z rozmowy</Label>
      <TextInput value={draft.conversationNotes} onChangeText={(conversationNotes) => set({ conversationNotes })} multiline style={[kit.input, kit.multiline]}
        placeholder="Co ustaliliście z klientem" placeholderTextColor={ink(0.35)} />
      <Text style={kit.muted}>Zmieniona notatka trafia też do historii kontaktu z klientem.</Text>
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
    </Sheet>
  );
}

// MARK: Nazwa, etap, powód

export function TitleSheet({ visible, title, onClose, onSave }: { visible: boolean; title: string; onClose: () => void; onSave: Save<[string]> }) {
  const [value, setValue] = useState(title);
  const { saving, wrap } = useSaving();
  useEffect(() => { if (visible) setValue(title); }, [visible, title]);
  if (!visible) return null;
  return (
    <Sheet visible title="Nazwa zapytania" onClose={onClose} width={560}
      footer={<SheetActions onCancel={onClose} label="Zapisz" disabled={!value.trim() || value.trim().length > 300} saving={saving}
        onConfirm={() => void wrap(() => onSave(value.trim()), onClose)} />}>
      <TextInput value={value} onChangeText={setValue} style={kit.input} placeholder="Nazwa zapytania" placeholderTextColor={ink(0.35)} autoFocus maxLength={300} />
    </Sheet>
  );
}

/** Zmiana etapu jak `InquiryStageModal`: domyślna szansa etapu, kategoria i powód przy „Przegrane”. */
export function StageSheet({ data, visible, onClose, onSave }: {
  data: InquiryWorkspace; visible: boolean; onClose: () => void; onSave: Save<[string, string, string]>;
}) {
  const [stage, setStage] = useState(data.inquiry.stage);
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const { saving, wrap } = useSaving();
  useEffect(() => {
    if (!visible) return;
    setStage(data.inquiry.stage); setCategory(data.inquiry.lostReasonCategory); setReason(data.inquiry.lostReason);
  }, [visible, data.inquiry.stage, data.inquiry.lostReasonCategory, data.inquiry.lostReason]);
  if (!visible) return null;
  const valid = Boolean(stage) && stage !== data.inquiry.stage && (stage !== 'lost' || (Boolean(category) && Boolean(reason.trim())));
  return (
    <Sheet visible title="Zmień etap zapytania" subtitle="Wybierz miejsce w lejku zapytań" onClose={onClose} width={520}
      footer={<SheetActions onCancel={onClose} label="Zapisz etap" disabled={!valid} saving={saving} onConfirm={() => void wrap(() => onSave(stage, category, reason.trim()), onClose)} />}>
      {data.stages.map((item) => {
        const active = stage === item.id;
        return (
          <TouchableOpacity key={item.id} onPress={() => setStage(item.id)} style={[kit.selectRow, kit.selectList, active && kit.selectRowActive]} accessibilityRole="radio" accessibilityState={{ checked: active }}>
            <View style={[kit.dot, { backgroundColor: tone(stageOf(item.id).color) }]} />
            <Text style={[kit.text, kit.flex, active && { color: colors.primary.gold }]}>{item.label}{item.id === data.inquiry.stage ? ' (obecny)' : ''}</Text>
            <Text style={kit.muted}>{item.probability}%</Text>
          </TouchableOpacity>
        );
      })}
      {stage === 'lost' ? (
        <>
          <Label>Kategoria utraty</Label>
          <SelectField value={category} onChange={setCategory} placeholder="Wybierz kategorię" options={data.lostCategories.map((item) => ({ id: item.value, label: item.label }))} />
          <Label>Powód przegrania</Label>
          <TextInput value={reason} onChangeText={setReason} multiline style={[kit.input, kit.multiline]} placeholder="Opisz, dlaczego klient zrezygnował" placeholderTextColor={ink(0.35)} />
        </>
      ) : null}
    </Sheet>
  );
}

export function ReasonSheet({ visible, title, prompt, action, onClose, onSave }: {
  visible: boolean; title: string; prompt: string; action: string; onClose: () => void; onSave: Save<[string]>;
}) {
  const [reason, setReason] = useState('');
  const { saving, wrap } = useSaving();
  useEffect(() => { if (visible) setReason(''); }, [visible]);
  if (!visible) return null;
  return (
    <Sheet visible title={title} onClose={onClose} width={520}
      footer={<SheetActions onCancel={onClose} label={action} disabled={!reason.trim()} saving={saving} onConfirm={() => void wrap(() => onSave(reason.trim()), onClose)} />}>
      <Label>{prompt}</Label>
      <TextInput value={reason} onChangeText={setReason} multiline style={[kit.input, kit.multiline]} placeholder={prompt} placeholderTextColor={ink(0.35)} />
    </Sheet>
  );
}

// MARK: Przekazanie, akceptacja

/** Przekaż osobie z listy (`get_inquiry_handoff_candidates`) albo oddaj do puli (`reassign_inquiry`). */
export function HandoffSheet({ inquiryId, title, visible, onClose, onSave }: {
  inquiryId: string; title: string; visible: boolean; onClose: () => void; onSave: Save<[string | null]>;
}) {
  const [transfer, setTransfer] = useState<'person' | 'pool'>('person');
  const [target, setTarget] = useState('');
  const [candidates, setCandidates] = useState<WorkspacePerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [problem, setProblem] = useState('');
  const { saving, wrap } = useSaving();
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setTransfer('person'); setTarget(''); setLoading(true); setProblem('');
    workspaceHandoffCandidates(inquiryId)
      .then((reply) => { if (active) setCandidates(reply.candidates); })
      .catch((cause) => { if (active) setProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać listy opiekunów.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [visible, inquiryId]);
  if (!visible) return null;
  return (
    <Sheet visible title="Przekaż / oddaj zapytanie" subtitle={title} onClose={onClose} width={540}
      footer={<SheetActions onCancel={onClose} label={transfer === 'person' ? 'Przekaż zapytanie' : 'Oddaj do puli'} saving={saving}
        disabled={loading || (transfer === 'person' && !target)} onConfirm={() => void wrap(() => onSave(transfer === 'person' ? target : null), onClose)} />}>
      <Segmented value={transfer} onChange={setTransfer} options={[{ id: 'person', label: 'Przekaż osobie' }, { id: 'pool', label: 'Oddaj do puli' }]} />
      {loading ? <ActivityIndicator color={colors.primary.gold} /> : transfer === 'person' ? (
        <>
          <Label>Nowy opiekun</Label>
          <SelectField value={target} onChange={setTarget} placeholder="Wybierz osobę" options={candidates.map((person) => ({ id: person.id, label: person.name }))}
            emptyText="Brak dostępnych opiekunów w Twoim zakresie uprawnień." />
          {!candidates.length && !problem ? <Text style={kit.muted}>Brak dostępnych opiekunów w Twoim zakresie uprawnień. Możesz oddać zapytanie do puli.</Text> : null}
        </>
      ) : <Text style={kit.muted}>Zapytanie trafi do „Nieprzypisanych”. Inna osoba będzie mogła je przejąć.</Text>}
      <Text style={kit.muted}>Po zmianie opiekuna zapytanie może zniknąć z Twojej listy. Historia, oferty i kalkulacje pozostaną przy zapytaniu.</Text>
      {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
    </Sheet>
  );
}

/** Akceptacja oferty przez klienta (`accept_inquiry_offer`): kto i jak potwierdził zakres, pakiet przy ofercie pakietowej. */
export function AcceptOfferSheet({ offer, onClose, onSave }: { offer: WorkspaceOffer | null; onClose: () => void; onSave: Save<[WorkspaceOffer, string | null, string]> }) {
  const [packageId, setPackageId] = useState('');
  const [note, setNote] = useState('');
  const { saving, wrap } = useSaving();
  useEffect(() => { setPackageId(''); setNote(''); }, [offer]);
  if (!offer) return null;
  const valid = Boolean(note.trim()) && (!offer.packageMode || Boolean(packageId));
  return (
    <Sheet visible title={`Akceptacja: ${offer.number || offer.title}`} subtitle="Zapisz, kto i w jaki sposób potwierdził zakres. Rezerwację zasobów zatwierdzisz przy przekazaniu do realizacji."
      onClose={onClose} width={560}
      footer={<SheetActions onCancel={onClose} label="Zapisz akceptację" disabled={!valid} saving={saving}
        onConfirm={() => void wrap(() => onSave(offer, packageId || null, note.trim()), onClose)} />}>
      {offer.packageMode ? (
        <>
          <Label>Pakiet wybrany przez klienta</Label>
          <SelectField value={packageId} onChange={setPackageId} placeholder="Wybierz pakiet"
            options={offer.packages.map((item) => ({ id: item.id, label: item.name, detail: `${formatInquiryMoney(item.priceNet)} netto` }))} />
        </>
      ) : null}
      <Label>Potwierdzenie klienta</Label>
      <TextInput value={note} onChangeText={setNote} multiline style={[kit.input, kit.multiline]} placeholder="np. rozmowa telefoniczna z dnia…" placeholderTextColor={ink(0.35)} />
    </Sheet>
  );
}

// MARK: Klient i organizacja

type ClientMode = 'new' | 'existing';
type OrgMode = 'none' | 'existing' | 'new';
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Wyszukiwanie kontaktów albo organizacji po 2 znakach (z opóźnieniem, bez zbędnych zapytań). */
function useClientSearch(inquiryId: string, kind: 'contact' | 'organization', query: string, enabled: boolean) {
  const [results, setResults] = useState<WorkspaceClientRecord[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    const text = query.trim();
    if (!enabled || text.length < 2) { setSearching(false); return; }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      workspaceClientSearch(inquiryId, kind, text)
        .then((reply) => { if (active) setResults(reply.results); })
        .catch(() => { if (active) setResults([]); })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [inquiryId, kind, query, enabled]);
  return { results, setResults, searching };
}

/**
 * „Klient i organizacja” jak w CRM: nowy kontakt albo wybór z bazy, typ (indywidualny / firmowy), organizacja (później, istniejąca,
 * nowa z NIP). Serwer nie dubluje rekordów — przy zgodnym adresie, NIP lub nazwie zwraca istniejące do wyboru.
 */
export function ClientSheet({ inquiryId, visible, onClose, onSaved }: { inquiryId: string; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [setup, setSetup] = useState<WorkspaceClientSetup | null>(null);
  const [loadProblem, setLoadProblem] = useState('');
  const [mode, setMode] = useState<ClientMode>('new');
  const [type, setType] = useState('');
  const [first, setFirst] = useState('');
  const [last, setLast] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contact, setContact] = useState<WorkspaceClientRecord | null>(null);
  const [query, setQuery] = useState('');
  const [orgMode, setOrgMode] = useState<OrgMode>('none');
  const [organization, setOrganization] = useState<WorkspaceClientRecord | null>(null);
  const [orgQuery, setOrgQuery] = useState('');
  const [orgName, setOrgName] = useState('');
  const [nip, setNip] = useState('');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const contacts = useClientSearch(inquiryId, 'contact', query, visible && mode === 'existing');
  const organizations = useClientSearch(inquiryId, 'organization', orgQuery, visible && orgMode === 'existing');

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSetup(null); setLoadProblem(''); setProblem(''); setQuery(''); setOrgQuery(''); setOrgName(''); setNip('');
    contacts.setResults([]); organizations.setResults([]);
    workspaceClientSetup(inquiryId).then((next) => {
      if (!active) return;
      setSetup(next);
      setMode(next.contactId ? 'existing' : 'new');
      setType(next.organizationId ? 'contact' : next.contact?.type || '');
      setContact(next.contact);
      setOrgMode(next.organizationId ? 'existing' : 'none');
      setOrganization(next.organization);
      setFirst(next.firstName); setLast(next.lastName); setEmail(next.email); setPhone(next.phone);
      if (next.suggestedOrganization) organizations.setResults([next.suggestedOrganization]);
    }).catch((cause) => { if (active) setLoadProblem(cause instanceof Error ? cause.message : 'Nie udało się pobrać danych klienta.'); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, inquiryId]);

  if (!visible) return null;
  const save = async () => {
    if (!setup || saving) return;
    setProblem('');
    const mail = email.trim();
    if (!type) { setProblem('Wybierz typ klienta.'); return; }
    if (mode === 'existing' && !contact) { setProblem('Wybierz kontakt z listy.'); return; }
    if (mode === 'new' && !first.trim()) { setProblem('Podaj imię klienta.'); return; }
    if (mode === 'new' && mail && !EMAIL.test(mail)) { setProblem('Podaj poprawny adres e-mail.'); return; }
    if (type === 'contact' && orgMode === 'existing' && !organization) { setProblem('Wybierz organizację.'); return; }
    if (type === 'contact' && orgMode === 'new' && !orgName.trim()) { setProblem('Podaj nazwę organizacji.'); return; }
    const body: Record<string, unknown> = {
      type,
      organizationMode: type === 'contact' ? orgMode : 'none',
      expectedContactId: setup.contactId,
      expectedOrganizationId: setup.organizationId,
    };
    if (mode === 'existing' && contact) body.contactId = contact.id;
    else Object.assign(body, { firstName: first.trim(), lastName: last.trim(), email: mail, phone: phone.trim() });
    if (type === 'contact' && orgMode === 'existing' && organization) body.organizationId = organization.id;
    if (type === 'contact' && orgMode === 'new') Object.assign(body, { organizationName: orgName.trim(), nip: nip.trim() });
    setSaving(true);
    try {
      const reply = await linkWorkspaceClient(inquiryId, body);
      if ('duplicate' in reply) {
        // Bez cichego dublowania — istniejące rekordy do wyboru (jak w CRM).
        if (reply.duplicate === 'contact') { contacts.setResults(reply.results); setMode('existing'); setContact(null); }
        else { organizations.setResults(reply.results); setOrgMode('existing'); setOrganization(null); }
        setProblem(reply.message);
        return;
      }
      onSaved();
    } catch (cause) {
      setProblem(cause instanceof Error ? cause.message : 'Nie udało się zapisać klienta.');
    } finally {
      setSaving(false);
    }
  };
  const record = (row: WorkspaceClientRecord) => ({ id: row.id, label: row.name, detail: row.email || undefined });
  return (
    <Sheet visible title="Klient i organizacja" onClose={onClose} width={640}
      subtitle="Dane zostaną zapisane dopiero po zatwierdzeniu. Zmiana typu istniejącego kontaktu dotyczy również jego karty klienta."
      footer={<SheetActions onCancel={onClose} label="Zapisz i powiąż" disabled={!setup} saving={saving} onConfirm={() => void save()} />}>
      {!setup ? (loadProblem ? <Text style={kit.warningText}>{loadProblem}</Text> : <ActivityIndicator color={colors.primary.gold} />) : (
        <>
          <Label>Kontakt</Label>
          <Segmented value={mode} onChange={setMode} options={[{ id: 'new', label: 'Dodaj nowy kontakt' }, { id: 'existing', label: 'Wybierz z bazy' }]} />
          {mode === 'existing' ? (
            <>
              {contact ? <Text style={[kit.text, { color: colors.primary.gold }]}>Wybrano: {contact.name}</Text> : null}
              <TextInput value={query} onChangeText={setQuery} style={kit.input} placeholder="Szukaj po imieniu i nazwisku" placeholderTextColor={ink(0.35)} autoCorrect={false} />
              {contacts.searching ? <ActivityIndicator color={colors.primary.gold} /> : null}
              {contacts.results.length ? (
                <SelectList options={contacts.results.map(record)} selected={contact ? [contact.id] : []} searchable={false}
                  onToggle={(id) => {
                    const row = contacts.results.find((entry) => entry.id === id) || null;
                    setContact(row);
                    if (row) setType(row.type || 'contact');
                  }} />
              ) : query.trim().length >= 2 && !contacts.searching ? <Text style={kit.muted}>Brak kontaktów pasujących do wyszukiwania.</Text> : null}
            </>
          ) : (
            <>
              <View style={kit.wrap}>
                <TextInput value={first} onChangeText={setFirst} style={[kit.input, kit.flex]} placeholder="Imię" placeholderTextColor={ink(0.35)} />
                <TextInput value={last} onChangeText={setLast} style={[kit.input, kit.flex]} placeholder="Nazwisko" placeholderTextColor={ink(0.35)} />
              </View>
              <TextInput value={email} onChangeText={setEmail} style={kit.input} placeholder="adres@firma.pl" placeholderTextColor={ink(0.35)} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} />
              <TextInput value={phone} onChangeText={setPhone} style={kit.input} placeholder="Telefon, np. +48 …" placeholderTextColor={ink(0.35)} keyboardType="phone-pad" />
            </>
          )}
          <Label>Typ klienta</Label>
          <View style={kit.wrap}>
            <Chip label="Klient indywidualny" active={type === 'individual'} onPress={() => setType('individual')} />
            <Chip label="Kontakt firmowy" active={type === 'contact'} onPress={() => setType('contact')} />
          </View>
          {type === 'contact' ? (
            <>
              <Label>Organizacja</Label>
              <Segmented value={orgMode} onChange={setOrgMode}
                options={[{ id: 'none', label: 'Powiąż później' }, { id: 'existing', label: 'Wybierz istniejącą' }, { id: 'new', label: 'Dodaj nową' }]} />
              {orgMode === 'existing' ? (
                <>
                  {organization ? <Text style={[kit.text, { color: colors.primary.gold }]}>Wybrano: {organization.name}</Text> : null}
                  <TextInput value={orgQuery} onChangeText={setOrgQuery} style={kit.input} placeholder="Szukaj organizacji po nazwie" placeholderTextColor={ink(0.35)} autoCorrect={false} />
                  {organizations.searching ? <ActivityIndicator color={colors.primary.gold} /> : null}
                  {organizations.results.length ? (
                    <SelectList options={organizations.results.map(record)} selected={organization ? [organization.id] : []} searchable={false}
                      onToggle={(id) => setOrganization(organizations.results.find((entry) => entry.id === id) || null)} />
                  ) : null}
                  {!orgQuery.trim() && setup.suggestedOrganization ? <Text style={kit.muted}>Podpowiedź z domeny adresu e-mail klienta.</Text> : null}
                </>
              ) : orgMode === 'new' ? (
                <>
                  <TextInput value={orgName} onChangeText={setOrgName} style={kit.input} placeholder="Nazwa firmy" placeholderTextColor={ink(0.35)} />
                  <TextInput value={nip} onChangeText={setNip} style={kit.input} placeholder="NIP (opcjonalnie), np. 1234567890" placeholderTextColor={ink(0.35)} keyboardType="number-pad" />
                  <Text style={kit.muted}>Pozostałe dane organizacji uzupełnisz w jej karcie.</Text>
                </>
              ) : null}
            </>
          ) : null}
          {problem ? <Text style={kit.warningText}>{problem}</Text> : null}
        </>
      )}
    </Sheet>
  );
}

// MARK: Wydarzenie z zapytania

/** „Utwórz wydarzenie” / „Przygotuj realizację” (`ConvertInquiryModal`): nazwa, termin, kategoria i działalność. */
export function ConvertSheet({ inquiryId, visible, onClose, onSave }: {
  inquiryId: string; visible: boolean; onClose: () => void; onSave: Save<[{ name: string; date: string; categoryId: string | null; companyId: string | null }, boolean]>;
}) {
  const [setup, setSetup] = useState<WorkspaceConvertSetup | null>(null);
  const [loadProblem, setLoadProblem] = useState('');
  const [name, setName] = useState('');
  const [hasDate, setHasDate] = useState(false);
  const [date, setDate] = useState(new Date());
  const [categoryId, setCategoryId] = useState('');
  const [companyId, setCompanyId] = useState('');
  const { saving, wrap } = useSaving();
  useEffect(() => {
    if (!visible) return;
    let active = true;
    setSetup(null); setLoadProblem('');
    workspaceConvertSetup(inquiryId).then((next) => {
      if (!active) return;
      setSetup(next);
      setName(next.name);
      setCategoryId('');
      setCompanyId(next.companyId);
      const [day, time] = next.dateLocal.split('T');
      setHasDate(/^\d{4}-\d{2}-\d{2}$/.test(day || ''));
      setDate(/^\d{4}-\d{2}-\d{2}$/.test(day || '') ? warsawDate(day, time || '00:00') : new Date());
    }).catch((cause) => { if (active) setLoadProblem(cause instanceof Error ? cause.message : 'Nie udało się przygotować wydarzenia.'); });
    return () => { active = false; };
  }, [visible, inquiryId]);
  if (!visible) return null;
  const realization = Boolean(setup?.realization);
  const label = realization ? 'Przygotuj realizację' : 'Utwórz wydarzenie';
  return (
    <Sheet visible title={realization ? 'Przygotuj realizację' : 'Utwórz wydarzenie z zapytania'} onClose={onClose} width={600}
      footer={<SheetActions onCancel={onClose} label={label} saving={saving} disabled={!setup || !hasDate || !name.trim()}
        onConfirm={() => void wrap(() => onSave({ name: name.trim(), date: date.toISOString(), categoryId: categoryId || null, companyId: companyId || null }, realization), onClose)} />}>
      {!setup ? (loadProblem ? <Text style={kit.warningText}>{loadProblem}</Text> : <ActivityIndicator color={colors.primary.gold} />) : (
        <>
          <Text style={kit.muted}>
            Dokumenty i zadania zachowają powiązania. Przy zaakceptowanej ofercie przeniesiemy wycenę oraz plan zasobów i dodamy zadanie weryfikacji dostępności.
            Bez akceptacji utworzymy robocze wydarzenie, pozostawiając sprzedaż otwartą.
          </Text>
          {setup.endNote ? <Text style={kit.text}>{setup.endNote}</Text> : null}
          {setup.location ? <Text style={kit.text}>Miejsce wydarzenia: {setup.location}</Text> : null}
          <Label>Nazwa</Label>
          <TextInput value={name} onChangeText={setName} style={kit.input} placeholder="Nazwa wydarzenia" placeholderTextColor={ink(0.35)} />
          <Label>Termin *</Label>
          {hasDate ? <DateTimeField value={date} onChange={setDate} /> : (
            <View style={kit.between}>
              <Text style={kit.warningText}>Uzupełnij termin wydarzenia — jest wymagany.</Text>
              <Chip label="Ustal termin" active={false} onPress={() => { setDate(new Date(plannedAt(7, 18))); setHasDate(true); }} />
            </View>
          )}
          <Label>Kategoria</Label>
          <SelectField value={categoryId} onChange={setCategoryId} placeholder="Bez kategorii"
            options={[{ id: '', label: 'Bez kategorii' }, ...setup.categories.map((item) => ({ id: item.id, label: item.name }))]} />
          <Label>Działalność</Label>
          <SelectField value={companyId} onChange={setCompanyId} placeholder="Nieprzypisana"
            options={[{ id: '', label: 'Nieprzypisana' }, ...setup.companies.map((item) => ({ id: item.id, label: item.name }))]} />
        </>
      )}
    </Sheet>
  );
}

// MARK: Zadanie

export type NewTask = { title: string; description: string; priority: string; column: string; dueDate: string | null; assignees: string[] };

/** „Nowe zadanie w zapytaniu” — tytuł, opis, priorytet, kolumna, termin i przypisani pracownicy (z powiadomieniem push). */
export function TaskSheet({ visible, employees, onClose, onSave }: { visible: boolean; employees: WorkspacePerson[]; onClose: () => void; onSave: Save<[NewTask]> }) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [column, setColumn] = useState('todo');
  const [hasDue, setHasDue] = useState(false);
  const [due, setDue] = useState(new Date(plannedAt(1)));
  const [assignees, setAssignees] = useState<string[]>([]);
  const { saving, wrap } = useSaving();
  useEffect(() => {
    if (!visible) return;
    setTitle(''); setDescription(''); setPriority('medium'); setColumn('todo'); setHasDue(false); setDue(new Date(plannedAt(1))); setAssignees([]);
  }, [visible]);
  if (!visible) return null;
  return (
    <Sheet visible title="Nowe zadanie w zapytaniu" onClose={onClose} width={620}
      footer={<SheetActions onCancel={onClose} label="Utwórz zadanie" disabled={!title.trim()} saving={saving}
        onConfirm={() => void wrap(() => onSave({ title: title.trim(), description: description.trim(), priority, column, dueDate: hasDue ? due.toISOString() : null, assignees }), onClose)} />}>
      <Label>Tytuł</Label>
      <TextInput value={title} onChangeText={setTitle} style={kit.input} placeholder="Co trzeba zrobić" placeholderTextColor={ink(0.35)} />
      <Label>Opis</Label>
      <TextInput value={description} onChangeText={setDescription} multiline style={[kit.input, kit.multiline]} placeholder="Szczegóły (opcjonalnie)" placeholderTextColor={ink(0.35)} />
      <Label>Priorytet</Label>
      <Segmented value={priority} onChange={setPriority} options={TASK_PRIORITIES} />
      <Label>Kolumna</Label>
      <Segmented value={column} onChange={setColumn} options={TASK_COLUMNS} />
      <Label>Termin</Label>
      <View style={kit.wrap}>
        <Chip label="Bez terminu" active={!hasDue} onPress={() => setHasDue(false)} />
        <Chip label="Jutro 9:00" active={false} onPress={() => { setDue(new Date(plannedAt(1))); setHasDue(true); }} />
        <Chip label="Za 3 dni" active={false} onPress={() => { setDue(new Date(plannedAt(3))); setHasDue(true); }} />
        <Chip label="Wybierz termin…" active={hasDue} onPress={() => setHasDue(true)} />
      </View>
      {hasDue ? <DateTimeField value={due} onChange={setDue} /> : null}
      <Label>Przypisani pracownicy ({assignees.length})</Label>
      <SelectList multiple searchable options={employees.map((person) => ({ id: person.id, label: person.name }))} selected={assignees}
        emptyText="Brak pracowników do przypisania."
        onToggle={(id) => setAssignees((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]))} />
    </Sheet>
  );
}

// MARK: Menu czynności

export type MenuItem = { key: string; label: string; icon: IconName; danger?: boolean; detail?: string };

/** Menu czynności (jak „Więcej” na Macu) — duże wiersze do dotyku. */
export function ActionMenu({ visible, title, subtitle, items, onClose, onPick }: {
  visible: boolean; title: string; subtitle?: string; items: MenuItem[]; onClose: () => void; onPick: (key: string) => void;
}) {
  if (!visible) return null;
  return (
    <Sheet visible title={title} subtitle={subtitle} onClose={onClose} width={480}
      footer={<TouchableOpacity onPress={onClose} style={kit.secondary}><Text style={kit.secondaryText}>Zamknij</Text></TouchableOpacity>}>
      {items.map((item) => (
        <TouchableOpacity key={item.key} onPress={() => { onClose(); afterModal(() => onPick(item.key)); }} style={kit.selectRow} accessibilityRole="button">
          <Feather name={item.icon} size={18} color={item.danger ? colors.status.error : colors.primary.gold} />
          <View style={kit.flex}>
            <Text style={[kit.text, item.danger && { color: colors.status.error }]}>{item.label}</Text>
            {item.detail ? <Text style={kit.muted} numberOfLines={2}>{item.detail}</Text> : null}
          </View>
        </TouchableOpacity>
      ))}
    </Sheet>
  );
}
