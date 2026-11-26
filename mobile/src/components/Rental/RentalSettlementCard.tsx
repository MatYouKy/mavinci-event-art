import React, { useEffect, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { DateTimeField, Label, SelectField, SelectList, SmallButton, kit, useNotice } from '../Inquiries/InquiryKit';
import { openInCrmWeb } from '../../navigation/navigationRef';
import { supabase } from '../../lib/supabase';
import {
  RENTAL_CHARGE_LABELS, linkRentalInvoice, rentalDateTime, rentalMoney, saveRental, setRentalCharges, type RentalCharge, type RentalChargeKind, type RentalDetail,
  type RentalInvoice,
} from '../../lib/rental';
import { searchRentalInvoices, type RentalInvoiceHit } from '../../lib/rentalApi';
import { RentalCard, rentalNumber, rentalPlain, ui } from './rentalUi';
import { colors } from '../../theme';

/*
 * Rozliczenie wypożyczenia (sprzedaż) — jak `RentalSettlement.tsx` w CRM i sekcja na Macu: netto / rabat / naliczenia / VAT /
 * brutto, kaucja; naliczenia dla klienta („Z rozbieżności” — uszkodzone i brakujące sztuki × wartość odtworzeniowa), kaucja
 * (wpłata, zwrot, rozliczenie) i faktury z Finansów (dołącz po numerze, odłącz; faktura i nowa faktura — w CRM).
 */

type Notice = ReturnType<typeof useNotice>;
type ChargeRow = { key: string; item_id: string | null; kind: RentalChargeKind; description: string; amount: string };

const INVOICE_KIND_LABELS: Record<RentalInvoice['kind'], string> = { rental: 'Za wypożyczenie', deposit: 'Kaucja', charges: 'Naliczenia' };
const CHARGE_OPTIONS = (Object.keys(RENTAL_CHARGE_LABELS) as RentalChargeKind[]).map((kind) => ({ id: kind, label: RENTAL_CHARGE_LABELS[kind] }));
let chargeCounter = 0;
const chargeKey = () => `charge-${Date.now()}-${(chargeCounter += 1)}`;

export default function RentalSettlementCard({ rental, notice, onChanged }: { rental: RentalDetail; notice: Notice; onChanged: (rental?: RentalDetail | null) => void }) {
  const sales = rental.sales!;
  const canManage = rental.access.sales_manage && !['settled', 'cancelled'].includes(rental.status);
  const chargesOpen = canManage && ['issued', 'returned'].includes(rental.status);
  const toRows = (charges: RentalCharge[]): ChargeRow[] => charges.map((charge) => ({
    key: charge.id || chargeKey(), item_id: charge.item_id, kind: charge.kind, description: charge.description, amount: rentalPlain(charge.amount),
  }));
  const [charges, setCharges] = useState<ChargeRow[]>(() => toRows(sales.charges));
  const [dirty, setDirty] = useState(false);
  const [receivedOn, setReceivedOn] = useState(false);
  const [received, setReceived] = useState(new Date());
  const [returned, setReturned] = useState('');
  const [settledOn, setSettledOn] = useState(false);
  const [settled, setSettled] = useState(new Date());
  const [invoiceQuery, setInvoiceQuery] = useState('');
  const [invoiceHits, setInvoiceHits] = useState<RentalInvoiceHit[]>([]);
  const [invoiceKind, setInvoiceKind] = useState<RentalInvoice['kind']>('rental');

  const chargesSignature = sales.charges.map((charge) => `${charge.id}:${charge.kind}:${charge.amount}:${charge.item_id}:${charge.description}`).join('|');
  useEffect(() => {
    setCharges(toRows(sales.charges));
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chargesSignature]);

  const depositSignature = `${sales.deposit_received_at}|${sales.deposit_returned_amount}|${sales.deposit_settled_at}`;
  useEffect(() => {
    setReceivedOn(Boolean(sales.deposit_received_at));
    setReceived(sales.deposit_received_at ? new Date(sales.deposit_received_at) : new Date());
    setReturned(rentalPlain(sales.deposit_returned_amount));
    setSettledOn(Boolean(sales.deposit_settled_at));
    setSettled(sales.deposit_settled_at ? new Date(sales.deposit_settled_at) : new Date());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depositSignature]);

  useEffect(() => {
    const text = invoiceQuery.trim();
    if (text.length < 2) { setInvoiceHits([]); return; }
    let alive = true;
    const timer = setTimeout(() => {
      searchRentalInvoices(text).then((rows) => { if (alive) setInvoiceHits(rows); }).catch(() => { if (alive) setInvoiceHits([]); });
    }, 250);
    return () => { alive = false; clearTimeout(timer); };
  }, [invoiceQuery]);

  const edit = (key: string, patch: Partial<ChargeRow>) => {
    setDirty(true);
    setCharges((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  /** Podpowiedź z rozbieżności: uszkodzone i brakujące sztuki × wartość odtworzeniowa (do poprawy przed zapisem). */
  const suggest = () => {
    const next: ChargeRow[] = [];
    for (const item of rental.items) {
      if (item.returned_damaged_qty > 0 && !charges.some((charge) => charge.item_id === item.id && charge.kind === 'damage')) {
        const amount = Math.round(item.returned_damaged_qty * Number(item.replacement_value || 0) * 100) / 100;
        next.push({ key: chargeKey(), item_id: item.id, kind: 'damage', description: `${item.name} — uszkodzone ${item.returned_damaged_qty} ${item.unit}`, amount: rentalPlain(amount) });
      }
      if (item.returned_missing_qty > 0 && !charges.some((charge) => charge.item_id === item.id && charge.kind === 'missing')) {
        const amount = Math.round(item.returned_missing_qty * Number(item.replacement_value || 0) * 100) / 100;
        next.push({ key: chargeKey(), item_id: item.id, kind: 'missing', description: `${item.name} — brak ${item.returned_missing_qty} ${item.unit}`, amount: rentalPlain(amount) });
      }
    }
    if (!next.length) { notice.notify('Brak rozbieżności bez naliczenia'); return; }
    setDirty(true);
    setCharges((current) => [...current, ...next]);
  };

  const saveCharges = async () => {
    if (charges.some((charge) => !charge.description.trim() || (rentalNumber(charge.amount) ?? -1) < 0)) {
      notice.notify('Każde naliczenie wymaga opisu i kwoty netto.', true);
      return;
    }
    const saved = await notice.run('Zapisywanie…', () => setRentalCharges(supabase, rental.id, charges.map((charge) => ({
      item_id: charge.item_id, kind: charge.kind, description: charge.description.trim(), amount: rentalNumber(charge.amount) ?? 0,
    }))), 'Zapisano naliczenia');
    if (saved) { setDirty(false); onChanged(saved); }
  };

  const saveDeposit = async () => {
    const amount = rentalNumber(returned);
    if (returned.trim() && (amount == null || amount < 0)) { notice.notify('Podaj kwotę zwrotu kaucji.', true); return; }
    const done = await notice.run('Zapisywanie…', () => saveRental(supabase, rental.id, {
      deposit_received_at: receivedOn ? received.toISOString() : null,
      deposit_returned_amount: amount,
      deposit_settled_at: settledOn ? settled.toISOString() : null,
    }), 'Zapisano kaucję');
    if (done) onChanged(null);
  };

  const link = async (invoiceId: string, kind: RentalInvoice['kind'], attach: boolean) => {
    const saved = await notice.run('Zapisywanie…', () => linkRentalInvoice(supabase, rental.id, invoiceId, kind, attach),
      attach ? 'Dołączono fakturę' : 'Odłączono fakturę');
    if (saved) onChanged(saved);
  };

  const totals = sales.totals;
  const depositLeft = Number(totals.deposit || 0) - Number(totals.deposit_returned || 0);

  return (
    <RentalCard title="Rozliczenie">
      <Amount label="Pozycje netto" value={rentalMoney(totals.lines_net)} />
      {Number(totals.discount_amount) > 0 ? <Amount label={`Rabat ${rentalPlain(sales.discount_percent)}%`} value={`−${rentalMoney(totals.discount_amount)}`} /> : null}
      <Amount label="Naliczenia netto" value={rentalMoney(totals.charges_net)} />
      <Amount label="Razem netto" value={rentalMoney(totals.net)} />
      <Amount label={`VAT ${rentalPlain(sales.vat_rate)}%`} value={rentalMoney(totals.vat)} />
      <Amount label="Razem brutto" value={rentalMoney(totals.gross)} strong />
      <Amount label="Kaucja" value={`${rentalMoney(totals.deposit)}${totals.deposit_returned != null ? ` · zwrócono ${rentalMoney(totals.deposit_returned)}` : ''}`} />
      {totals.deposit_returned != null && depositLeft > 0 ? <Amount label="Zatrzymano z kaucji" value={rentalMoney(depositLeft)} /> : null}

      <Label>Naliczenia dla klienta</Label>
      {chargesOpen ? (
        <View style={ui.wrap}>
          <SmallButton icon="zap" label="Z rozbieżności" onPress={suggest} />
          <SmallButton icon="plus" label="Naliczenie" onPress={() => { setDirty(true); setCharges((current) => [...current, { key: chargeKey(), item_id: null, kind: 'other', description: '', amount: '' }]); }} />
        </View>
      ) : null}
      {!charges.length ? <Text style={ui.muted}>{chargesOpen ? 'Brak naliczeń. Po zwrocie z rozbieżnościami użyj „Z rozbieżności”.' : 'Brak naliczeń.'}</Text> : null}
      {charges.map((charge) => (
        <View key={charge.key} style={ui.well}>
          <SelectField value={charge.kind} options={CHARGE_OPTIONS} disabled={!chargesOpen} onChange={(kind) => edit(charge.key, { kind: kind as RentalChargeKind })} />
          <TextInput value={charge.description} editable={chargesOpen} onChangeText={(description) => edit(charge.key, { description })} placeholder="Opis"
            placeholderTextColor={colors.text.tertiary} style={kit.input} />
          <View style={ui.row}>
            <TextInput value={charge.amount} editable={chargesOpen} onChangeText={(amount) => edit(charge.key, { amount })} placeholder="Netto zł"
              placeholderTextColor={colors.text.tertiary} keyboardType="decimal-pad" style={[kit.input, ui.flex]} />
            {chargesOpen ? (
              <TouchableOpacity onPress={() => { setDirty(true); setCharges((current) => current.filter((row) => row.key !== charge.key)); }} style={kit.iconButton}
                accessibilityLabel="Usuń naliczenie">
                <Feather name="trash-2" size={18} color={colors.status.error} />
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ))}
      {chargesOpen && dirty ? <SmallButton primary icon="save" label="Zapisz naliczenia" onPress={() => void saveCharges()} /> : null}

      {Number(sales.deposit_amount) > 0 ? (
        <>
          <Label>Kaucja {rentalMoney(sales.deposit_amount)}</Label>
          <Toggle label="Wpłacona" value={receivedOn} disabled={!canManage} onChange={setReceivedOn} />
          {receivedOn ? (canManage ? <DateTimeField value={received} onChange={setReceived} /> : <Text style={ui.text}>{rentalDateTime(received.toISOString())}</Text>) : null}
          <Text style={ui.mutedXs}>Zwrócono klientowi (zł)</Text>
          <TextInput value={returned} editable={canManage} onChangeText={setReturned} keyboardType="decimal-pad" style={kit.input} />
          <Toggle label="Rozliczona" value={settledOn} disabled={!canManage} onChange={setSettledOn} />
          {settledOn ? (canManage ? <DateTimeField value={settled} onChange={setSettled} /> : <Text style={ui.text}>{rentalDateTime(settled.toISOString())}</Text>) : null}
          {canManage ? <SmallButton icon="save" label="Zapisz kaucję" onPress={() => void saveDeposit()} /> : null}
        </>
      ) : null}

      <Label>Faktury</Label>
      {!sales.invoices.length ? <Text style={ui.muted}>Brak powiązanych faktur.</Text> : null}
      {sales.invoices.map((invoice) => (
        <View key={invoice.invoice_id} style={[ui.well, ui.row]}>
          <TouchableOpacity style={ui.flex} onPress={() => openInCrmWeb(`/crm/invoices/${invoice.invoice_id}`)}>
            <Text style={ui.link}>{invoice.invoice_number}</Text>
            <Text style={ui.mutedXs}>{INVOICE_KIND_LABELS[invoice.kind]} · {rentalMoney(invoice.total_gross)}</Text>
          </TouchableOpacity>
          {canManage ? (
            <TouchableOpacity onPress={() => void link(invoice.invoice_id, invoice.kind, false)} accessibilityRole="button">
              <Text style={ui.danger}>Odłącz</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ))}
      {canManage && rental.status !== 'draft' ? (
        <>
          <SelectField value={invoiceKind} onChange={(kind) => setInvoiceKind(kind as RentalInvoice['kind'])}
            options={(Object.keys(INVOICE_KIND_LABELS) as RentalInvoice['kind'][]).map((kind) => ({ id: kind, label: INVOICE_KIND_LABELS[kind] }))} />
          <TextInput value={invoiceQuery} onChangeText={setInvoiceQuery} placeholder="Dołącz fakturę — wpisz numer…" placeholderTextColor={colors.text.tertiary}
            style={kit.input} autoCorrect={false} autoCapitalize="characters" />
          {invoiceHits.length ? (
            <SelectList searchable={false} selected={[]}
              options={invoiceHits.map((hit) => ({ id: hit.id, label: hit.invoice_number, detail: rentalMoney(hit.total_gross) }))}
              onToggle={(id) => { setInvoiceQuery(''); setInvoiceHits([]); void link(id, invoiceKind, true); }} />
          ) : null}
          <SmallButton icon="external-link" label="Nowa faktura (CRM)" onPress={() => openInCrmWeb('/crm/invoices/new')} />
        </>
      ) : null}
    </RentalCard>
  );
}

function Amount({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={ui.between}>
      <Text style={strong ? ui.text : ui.muted}>{label}</Text>
      <Text style={[ui.money, strong && ui.gold]} selectable>{value}</Text>
    </View>
  );
}

function Toggle({ label, value, disabled, onChange }: { label: string; value: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return (
    <TouchableOpacity onPress={() => onChange(!value)} disabled={disabled} style={[ui.row, disabled && kit.disabled]} accessibilityRole="checkbox"
      accessibilityState={{ checked: value, disabled }}>
      <Feather name={value ? 'check-square' : 'square'} size={18} color={value ? colors.primary.gold : colors.text.tertiary} />
      <Text style={ui.text}>{label}</Text>
    </TouchableOpacity>
  );
}
