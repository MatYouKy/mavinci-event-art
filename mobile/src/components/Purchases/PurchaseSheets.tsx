import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity } from 'react-native';
import { Label, Sheet, SheetActions, kit, useNotice } from '../Inquiries/InquiryKit';
import {
  purchaseMonthLabel, purchaseTotals, purchaseTotalsText, type PurchaseDocument, type PurchaseMonth, type PurchaseMonthCompany,
} from '../../lib/purchaseShared';
import { decidePurchaseMonth, submitPurchaseMonth } from '../../lib/purchasesApi';
import { PurchaseMonthSections, pui } from './purchasesUi';
import { colors } from '../../theme';

/*
 * Okna Zakupów w telefonie — jak w CRM i na Macu: „Wyślij rozliczenie” (pracownik, z uwagą dla finansów), rozliczenie pracownika
 * (zatwierdzający: dokumenty z plikami, „Zatwierdź”, „Zwróć do poprawy”, „Cofnij zatwierdzenie”) i decyzja z uwagą
 * (przy zwrocie — wymagana).
 */

type Notice = ReturnType<typeof useNotice>;

export function PurchaseSubmitSheet({ month, company, notice, onClose, onSubmitted }: {
  month: PurchaseMonth | null; company: PurchaseMonthCompany | null; notice: Notice; onClose: () => void; onSubmitted: (month: PurchaseMonth) => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => { if (company) setNote(''); }, [company]);
  const documents = month && company ? month.documents.filter((document) => document.company_id === company.id) : [];

  const submit = async () => {
    if (!month || !company) return;
    const next = await notice.run('Wysyłanie rozliczenia…', () => submitPurchaseMonth(company.id, month.year, month.month, note),
      'Rozliczenie wysłane do zatwierdzenia.');
    if (next) onSubmitted(next);
  };

  return (
    <Sheet visible={!!(month && company)} title="Wyślij rozliczenie" onClose={onClose}
      subtitle={month && company ? `${company.name} · ${purchaseMonthLabel(month.year, month.month)}` : undefined}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void submit()} label="Wyślij do zatwierdzenia" saving={!!notice.busy} />}>
      <Text style={pui.textSm}>{documents.length} dok. · razem {purchaseTotalsText(purchaseTotals(documents))}.</Text>
      <Text style={pui.muted}>Po wysłaniu dokumentów z tego miesiąca nie da się zmieniać, dopóki osoba z finansów nie zatwierdzi albo nie zwróci rozliczenia.</Text>
      <Label>Uwaga dla finansów (opcjonalnie)</Label>
      <TextInput value={note} onChangeText={setNote} multiline maxLength={2000} style={[kit.input, kit.multiline]} placeholderTextColor={colors.text.tertiary} />
    </Sheet>
  );
}

export type PurchaseDecisionTarget = { month: PurchaseMonth; company: PurchaseMonthCompany; approve: boolean };

/** Rozliczenie pracownika (okno zatwierdzającego); decyzja — `onDecide` (osobne okno z uwagą). */
export function PurchaseReviewSheet({ month, notice, onClose, onDocument, onDecide }: {
  month: PurchaseMonth | null; notice: Notice; onClose: () => void;
  onDocument: (document: PurchaseDocument) => void;
  onDecide: (target: PurchaseDecisionTarget) => void;
}) {
  return (
    <Sheet visible={!!month} title={month ? `Zakupy — ${month.employee.name}` : 'Zakupy'} subtitle={month ? purchaseMonthLabel(month.year, month.month) : undefined}
      onClose={onClose} width={760}
      footer={(
        <TouchableOpacity onPress={onClose} disabled={!!notice.busy} style={kit.secondary} accessibilityRole="button">
          <Text style={kit.secondaryText}>Zamknij</Text>
        </TouchableOpacity>
      )}>
      {month ? (
        <PurchaseMonthSections month={month} futureMonth={false} onDocument={(document) => onDocument(document)}
          onDecide={(company, approve) => onDecide({ month, company, approve })} />
      ) : null}
    </Sheet>
  );
}

export function PurchaseDecisionSheet({ target, notice, onClose, onDecided }: {
  target: PurchaseDecisionTarget | null; notice: Notice; onClose: () => void; onDecided: (month: PurchaseMonth, approve: boolean) => void;
}) {
  const [note, setNote] = useState('');
  useEffect(() => { if (target) setNote(''); }, [target]);
  const approve = target?.approve ?? false;
  const title = approve ? 'Zatwierdź rozliczenie' : target?.company.settlement?.status === 'approved' ? 'Cofnij zatwierdzenie' : 'Zwróć do poprawy';

  const decide = async () => {
    const settlement = target?.company.settlement;
    if (!target || !settlement) return;
    if (!approve && !note.trim()) { notice.notify('Napisz, co trzeba poprawić — pracownik zobaczy tę uwagę.', true); return; }
    const next = await notice.run(approve ? 'Zatwierdzanie rozliczenia…' : 'Zwracanie rozliczenia…', () => decidePurchaseMonth(settlement.id, approve, note),
      approve ? 'Rozliczenie zatwierdzone.' : 'Rozliczenie zwrócone do poprawy.');
    if (next) onDecided(next, approve);
  };

  return (
    <Sheet visible={!!target} title={title} onClose={onClose}
      subtitle={target ? `${target.month.employee.name} · ${target.company.name} · ${purchaseMonthLabel(target.month.year, target.month.month)}` : undefined}
      footer={<SheetActions onCancel={onClose} onConfirm={() => void decide()} label={approve ? 'Zatwierdź' : 'Zwróć pracownikowi'} saving={!!notice.busy}
        disabled={!approve && !note.trim()} />}>
      <Text style={pui.muted}>
        {approve
          ? 'Koszty eventów z tych zakupów zostaną oznaczone jako zatwierdzone. Pracownik dostanie powiadomienie.'
          : 'Pracownik dostanie powiadomienie z uwagą i będzie mógł poprawić dokumenty, a potem wysłać rozliczenie ponownie.'}
      </Text>
      <Label>{approve ? 'Uwaga (opcjonalnie)' : 'Co trzeba poprawić'}</Label>
      <TextInput value={note} onChangeText={setNote} multiline maxLength={2000} style={[kit.input, kit.multiline]} placeholderTextColor={colors.text.tertiary} />
    </Sheet>
  );
}
