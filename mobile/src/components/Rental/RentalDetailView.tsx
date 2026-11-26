import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import BrandHeading from '../BrandHeading';
import { afterModal, kit, SmallButton, useNotice } from '../Inquiries/InquiryKit';
import { useForegroundEffect } from '../../hooks/useForegroundEffect';
import { supabase } from '../../lib/supabase';
import {
  RENTAL_LOG_LABELS, getRental, removeRentalFile, rentalDateTime, rentalErrorMessage, rentalFileUrl, rentalMoney, rentalOutQty,
  setRentalStatus, setRentalWarehouseNote, type RentalDetail, type RentalFile, type RentalItem, type RentalProtocol, type RentalProtocolLine,
  type RentalStatus,
} from '../../lib/rental';
import { rentalProtocolPdf, uploadRentalAsset, type RentalAsset } from '../../lib/rentalApi';
import RentalSettlementCard from './RentalSettlementCard';
import { RentalCancelSheet, RentalFormSheet, RentalItemsSheet, RentalProtocolSheet, RentalResolveSheet, RentalTripsSheet } from './RentalSheets';
import {
  RentalCard, RentalPill, RentalStatusBadge, chooseRentalSource, openRentalUrl, pickRentalAssets, rentalPlain, ui, type RentalPickSource,
} from './rentalUi';
import { colors, spacing, typography } from '../../theme';

/*
 * Karta wypożyczenia w telefonie — jak `/crm/rental/[id]` i karta na Macu. Sprzedaż: dane, pozycje z cenami, rezerwacja,
 * anulowanie (z rezerwacji — z powodem), rozliczenie (naliczenia, kaucja, faktury). Magazyn: protokoły wydania i odbioru ze
 * zdjęciami z aparatu, PDF do podpisu (z serwera) i skan podpisanego protokołu, rozbieżności po zwrocie, uwagi magazynu,
 * dostawa i odbiór. Co kto widzi i robi — `rental.access` z bazy.
 */

type Notice = ReturnType<typeof useNotice>;
type SheetState =
  | { kind: 'form' } | { kind: 'items'; catalog?: boolean } | { kind: 'trips' } | { kind: 'issue' } | { kind: 'return' } | { kind: 'cancel' }
  | { kind: 'resolve'; item: RentalItem }
  | null;

export default function RentalDetailView({ id, notice, openCatalog = false, onCatalogOpened, onBack, onChanged }: {
  id: string; notice: Notice;
  /** Zaraz po utworzeniu wypożyczenia — otwórz okno pozycji na katalogu magazynu (jak `?pozycje=1` w CRM). */
  openCatalog?: boolean; onCatalogOpened?: () => void;
  onBack: () => void; onChanged: () => void;
}) {
  const navigation = useNavigation<any>();
  const [rental, setRental] = useState<RentalDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const [warehouseNote, setWarehouseNote] = useState('');
  const [savedProtocol, setSavedProtocol] = useState<string | null>(null);

  const load = useCallback(async (pull = false, signal?: AbortSignal) => {
    if (pull) setRefreshing(true);
    try {
      const data = await getRental(supabase, id);
      if (signal?.aborted) return;
      setRental(data);
      setWarehouseNote(data.warehouse_note || '');
      setError(null);
    } catch (cause) {
      if (!signal?.aborted) setError(rentalErrorMessage(cause, 'Nie udało się pobrać wypożyczenia.'));
    } finally {
      if (!signal?.aborted) setRefreshing(false);
    }
  }, [id]);

  useEffect(() => { setRental(null); setError(null); setSavedProtocol(null); }, [id]);
  useForegroundEffect((signal) => { void load(false, signal); }, [load]);

  useEffect(() => {
    if (!openCatalog || !rental || rental.id !== id) return;
    onCatalogOpened?.();
    if (rental.access.sales_manage && ['draft', 'reserved', 'issued'].includes(rental.status)) afterModal(() => setSheet({ kind: 'items', catalog: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCatalog, rental, id]);

  /** Po zapisie: świeża karta (z odpowiedzi albo z bazy) i lista. */
  const changed = (next?: RentalDetail | null) => {
    if (next) {
      setRental(next);
      setWarehouseNote(next.warehouse_note || '');
    } else void load();
    onChanged();
  };

  const issues = useMemo(() => (rental?.items || []).filter((item) => item.open_damaged + item.open_missing > 0), [rental]);

  if (!rental) {
    return (
      <View style={styles.centered}>
        {error ? (
          <>
            <Text style={[ui.danger, styles.centerText]}>{error}</Text>
            <SmallButton label="Spróbuj ponownie" icon="refresh-cw" onPress={() => void load()} />
            <SmallButton label="Wypożyczenia" icon="chevron-left" onPress={onBack} />
          </>
        ) : <ActivityIndicator size="large" color={colors.primary.gold} />}
      </View>
    );
  }

  const access = rental.access;
  const sales = access.sales_manage;
  const warehouse = access.warehouse_act;
  const editable = sales && ['draft', 'reserved', 'issued', 'returned'].includes(rental.status);
  const itemsEditable = sales && ['draft', 'reserved', 'issued'].includes(rental.status);
  const canFiles = sales || warehouse;
  const equipment = rental.items.filter((item) => item.kind === 'equipment');
  const services = rental.items.filter((item) => item.kind === 'service');
  const canIssue = warehouse && ['reserved', 'issued'].includes(rental.status) && equipment.some((item) => item.issued_qty < item.quantity);
  const canReturn = warehouse && rental.status === 'issued' && equipment.some((item) => rentalOutQty(item) > 0);
  const tripsEditable = (sales || warehouse) && ['draft', 'reserved', 'issued'].includes(rental.status);
  const noteEditable = sales || warehouse;
  const generalFiles = rental.files.filter((file) => !file.protocol_id);
  const saved = savedProtocol ? rental.protocols.find((protocol) => protocol.id === savedProtocol) ?? null : null;

  const changeStatus = (status: RentalStatus, title: string, question: string) => {
    Alert.alert(title, question, [
      { text: 'Wróć', style: 'cancel' },
      {
        text: title,
        style: status === 'cancelled' ? 'destructive' : 'default',
        onPress: () => void notice.run('Zapisywanie…', () => setRentalStatus(supabase, rental.id, status), 'Zmieniono status wypożyczenia')
          .then((done) => { if (done) changed(); }),
      },
    ]);
  };

  const openPath = async (path: string, name: string, mime: string | null) => {
    const url = await notice.run('Otwieranie…', () => rentalFileUrl(supabase, path));
    if (url) openRentalUrl(navigation, url, name, mime);
  };

  const openPdf = async (protocol: RentalProtocol) => {
    const pdf = await notice.run('Przygotowanie PDF…', () => rentalProtocolPdf(rental.id, protocol.id));
    if (pdf) openRentalUrl(navigation, pdf.url, protocol.number, 'application/pdf');
  };

  /** Skan protokołu (`scanFor` — protokół) albo plik wypożyczenia: zdjęcie magazynu, dokument (PDF, sprzedaż). */
  const upload = (title: string, area: 'sales' | 'warehouse', scanFor: string | null) => {
    chooseRentalSource(title, (source: RentalPickSource) => {
      void (async () => {
        let assets: RentalAsset[];
        try {
          assets = await pickRentalAssets(source, 10);
        } catch (cause) {
          notice.notify(cause instanceof Error ? cause.message : 'Nie udało się wybrać pliku.', true);
          return;
        }
        if (!assets.length) return;
        const done = await notice.run(assets.length === 1 ? 'Przesyłanie pliku…' : `Przesyłanie plików (${assets.length})…`, async () => {
          for (const asset of assets) {
            const image = source !== 'files' || (asset.mimeType || '').startsWith('image/');
            const kind = scanFor ? 'scan' : area === 'sales' || !image ? 'document' : 'photo';
            await uploadRentalAsset(rental.id, asset, area, kind, scanFor);
          }
          return true;
        }, assets.length === 1 ? 'Dodano plik' : `Dodano pliki (${assets.length})`);
        if (done) changed();
      })();
    }, true);
  };

  const removeFile = (file: RentalFile) => {
    Alert.alert('Usuń plik', `Usunąć plik „${file.file_name}”? Tej operacji nie można cofnąć.`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń', style: 'destructive',
        onPress: () => void notice.run('Usuwanie…', () => removeRentalFile(supabase, file.id).then(() => true), 'Usunięto plik').then((done) => { if (done) changed(); }),
      },
    ]);
  };

  const saveNote = async () => {
    const done = await notice.run('Zapisywanie…', () => setRentalWarehouseNote(supabase, rental.id, warehouseNote).then(() => true), 'Zapisano uwagi magazynu');
    if (done) changed();
  };

  const lineSummary = (line: RentalProtocolLine, issue: boolean) => {
    if (issue) return `${line.qty} ${line.unit}`;
    return [line.qty > 0 ? `sprawne ${line.qty}` : '', line.damaged > 0 ? `uszkodzone ${line.damaged}` : '', line.missing > 0 ? `brak ${line.missing}` : '']
      .filter(Boolean).join(', ');
  };

  const itemMeta = (item: RentalItem) => [
    item.kind === 'equipment' ? (item.storage_location ? `Magazyn: ${item.storage_location}` : '') : 'Usługa',
    item.kit_name ? `z zestawu ${item.kit_name}` : '',
    item.note || '',
  ].filter(Boolean).join(' · ');

  const progress = (item: RentalItem) => [
    `wydano ${item.issued_qty}`,
    item.issued_qty > 0 ? `u klienta ${item.out_qty}` : '',
    item.returned_ok_qty > 0 ? `sprawne ${item.returned_ok_qty}` : '',
    item.returned_damaged_qty > 0 ? `uszk. ${item.returned_damaged_qty}` : '',
    item.returned_missing_qty > 0 ? `brak ${item.returned_missing_qty}` : '',
  ].filter(Boolean).join(' · ');

  const price = (item: RentalItem) => {
    let text = rentalMoney(item.unit_price);
    text += item.price_mode === 'flat' ? ' ryczałt' : ` × ${rentalPlain(item.days ?? rental.default_days)} dob.`;
    if (item.discount_percent) text += ` −${rentalPlain(item.discount_percent)}%`;
    return text;
  };

  return (
    <View style={ui.flex}>
      <View style={styles.topBar}>
        <TouchableOpacity onPress={onBack} style={styles.back} accessibilityRole="button" accessibilityLabel="Wróć do listy wypożyczeń">
          <Feather name="chevron-left" size={20} color={colors.primary.gold} />
          <Text style={ui.gold}>Wypożyczenia</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => void load(true)} style={kit.iconButton} accessibilityLabel="Odśwież">
          <Feather name="refresh-cw" size={18} color={colors.text.secondary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary.gold} />}>
        <View style={styles.header}>
          <View style={ui.wrap}>
            <BrandHeading style={styles.number}>{rental.number}</BrandHeading>
            <RentalStatusBadge status={rental.status} />
          </View>
          <View style={ui.wrap}>
            {rental.overdue ? <RentalPill label="Po terminie zwrotu" color="#fca5a5" /> : null}
            {issues.length ? <RentalPill label="Rozbieżności do rozstrzygnięcia" color="#f59e0b" /> : null}
          </View>
          {rental.title ? <Text style={styles.title}>{rental.title}</Text> : null}
          <Text style={ui.muted}>{rental.client_name} · wydanie {rentalDateTime(rental.starts_at)} · zwrot {rentalDateTime(rental.ends_at)}</Text>
        </View>

        <View style={ui.wrap}>
          {canIssue ? <SmallButton primary icon="clipboard" label={rental.status === 'issued' ? 'Dowydanie' : 'Protokół wydania'} onPress={() => setSheet({ kind: 'issue' })} /> : null}
          {canReturn ? <SmallButton primary icon="check-square" label="Protokół odbioru" onPress={() => setSheet({ kind: 'return' })} /> : null}
          {sales && rental.status === 'draft' ? (
            <SmallButton primary icon="bookmark" label="Zarezerwuj" onPress={() => changeStatus('reserved', 'Zarezerwuj',
              'Zarezerwować sprzęt? Pozycje zajmą stan magazynu w terminie wypożyczenia, a magazyn dostanie powiadomienie.')} />
          ) : null}
          {sales && rental.status === 'reserved' ? (
            <SmallButton icon="rotate-ccw" label="Cofnij rezerwację" onPress={() => changeStatus('draft', 'Cofnij rezerwację',
              'Cofnąć rezerwację? Sprzęt wróci do dostępnych, a magazyn dostanie powiadomienie.')} />
          ) : null}
          {sales && rental.status === 'returned' ? (
            <SmallButton primary icon="credit-card" label="Rozlicz" onPress={() => changeStatus('settled', 'Rozlicz',
              'Oznaczyć wypożyczenie jako rozliczone? Zmiany danych i naliczeń zostaną zablokowane.')} />
          ) : null}
          {access.admin && rental.status === 'settled' ? (
            <SmallButton icon="rotate-ccw" label="Cofnij rozliczenie" onPress={() => changeStatus('returned', 'Cofnij rozliczenie',
              'Cofnąć rozliczenie? Wypożyczenie wróci do statusu „Zwrócone”.')} />
          ) : null}
          {editable ? <SmallButton icon="edit-2" label="Edytuj dane" onPress={() => setSheet({ kind: 'form' })} /> : null}
          {sales && ['draft', 'reserved'].includes(rental.status) ? (
            <SmallButton danger icon="slash" label="Anuluj" onPress={() => (rental.status === 'reserved'
              ? setSheet({ kind: 'cancel' })
              : changeStatus('cancelled', 'Anuluj', 'Anulować szkic wypożyczenia?'))} />
          ) : null}
        </View>

        {saved ? (
          <View style={ui.okWell}>
            <Text style={ui.textSm}>Protokół {saved.number} zapisany. Otwórz PDF do podpisu, a zdjęcie podpisanego protokołu dodaj jako skan.</Text>
            <View style={ui.wrap}>
              <SmallButton primary icon="file-text" label="PDF do podpisu" onPress={() => void openPdf(saved)} />
              <SmallButton icon="camera" label="Dodaj skan" onPress={() => upload('Skan protokołu', 'warehouse', saved.id)} />
              <SmallButton icon="x" label="Zamknij" onPress={() => setSavedProtocol(null)} />
            </View>
          </View>
        ) : null}

        {rental.status === 'cancelled' && rental.cancel_reason ? <Text style={ui.danger}>Powód anulowania: {rental.cancel_reason}</Text> : null}

        <RentalCard title="Pozycje" action={itemsEditable ? <SmallButton icon="edit-2" label="Edytuj pozycje" onPress={() => setSheet({ kind: 'items' })} /> : undefined}>
          {rental.items.length === 0 ? (
            <Text style={ui.muted}>{itemsEditable ? 'Wybierz sprzęt z katalogu magazynu — „Edytuj pozycje”.' : 'Brak pozycji.'}</Text>
          ) : [...equipment, ...services].map((item) => (
            <View key={item.id} style={ui.line}>
              <View style={ui.between}>
                <Text style={[ui.text, ui.flex]}>{item.name}</Text>
                <Text style={ui.money}>{item.quantity} {item.unit}</Text>
              </View>
              {itemMeta(item) ? <Text style={ui.mutedXs}>{itemMeta(item)}</Text> : null}
              {item.kind === 'equipment' ? <Text style={ui.mutedXs}>{progress(item)}</Text> : null}
              {access.sales_view && item.line_net != null ? (
                <View style={ui.between}>
                  <Text style={ui.mutedXs}>{price(item)}</Text>
                  <Text style={ui.money}>{rentalMoney(item.line_net)}</Text>
                </View>
              ) : null}
            </View>
          ))}
        </RentalCard>

        {issues.length ? (
          <RentalCard title="Rozbieżności po zwrocie">
            <Text style={ui.mutedXs}>Do rozstrzygnięcia te sztuki zajmują stan magazynu (eventy i wypożyczenia ich nie dostaną).</Text>
            {issues.map((item) => (
              <View key={item.id} style={ui.warnWell}>
                <Text style={ui.text}>{item.name}</Text>
                <Text style={ui.muted}>{[item.open_damaged ? `uszkodzone ${item.open_damaged}` : '', item.open_missing ? `brak ${item.open_missing}` : ''].filter(Boolean).join(' · ')}</Text>
                {warehouse ? <SmallButton icon="tool" label="Rozstrzygnij" onPress={() => setSheet({ kind: 'resolve', item })} /> : null}
              </View>
            ))}
          </RentalCard>
        ) : null}

        <RentalCard title="Wydanie i zwrot">
          {!rental.protocols.length ? (
            <Text style={ui.muted}>{rental.status === 'draft' ? 'Po rezerwacji magazyn wyda sprzęt z protokołem wydania.' : 'Brak protokołów.'}</Text>
          ) : null}
          {rental.protocols.map((protocol) => {
            const issue = protocol.kind === 'issue';
            const scans = rental.files.filter((file) => file.protocol_id === protocol.id);
            return (
              <View key={protocol.id} style={ui.well}>
                <Text style={ui.text}>{issue ? 'Wydanie' : 'Odbiór'} · {protocol.number}</Text>
                <Text style={ui.mutedXs}>
                  {rentalDateTime(protocol.created_at)} · {issue ? 'odebrał(a)' : 'zwrócił(a)'} {protocol.person_name}{protocol.created_by_name ? ` · magazyn: ${protocol.created_by_name}` : ''}
                </Text>
                {protocol.lines.map((line) => (
                  <View key={line.item_id} style={styles.protocolLine}>
                    <Text style={ui.textSm}>{line.name}: {lineSummary(line, issue)}{line.note ? ` — ${line.note}` : ''}</Text>
                    {line.photos.length ? (
                      <View style={ui.wrap}>
                        {line.photos.map((path, index) => (
                          <TouchableOpacity key={path} onPress={() => void openPath(path, `${line.name} — zdjęcie ${index + 1}`, 'image/jpeg')}>
                            <Text style={ui.link}>zdjęcie {index + 1}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ))}
                {protocol.note ? <Text style={ui.mutedXs}>Uwagi: {protocol.note}</Text> : null}
                {scans.length ? scans.map((file) => (
                  <View key={file.id} style={ui.row}>
                    <TouchableOpacity style={ui.flex} onPress={() => void openPath(file.storage_path, file.file_name, file.mime_type)}>
                      <Text style={ui.link} numberOfLines={1}>{file.file_name}</Text>
                    </TouchableOpacity>
                    {canFiles ? (
                      <TouchableOpacity onPress={() => removeFile(file)} accessibilityLabel="Usuń skan" style={styles.trash}>
                        <Feather name="trash-2" size={16} color={colors.status.error} />
                      </TouchableOpacity>
                    ) : null}
                  </View>
                )) : <Text style={ui.warning}>Brak skanu podpisanego protokołu.</Text>}
                <View style={ui.wrap}>
                  <SmallButton icon="file-text" label="PDF do podpisu" onPress={() => void openPdf(protocol)} />
                  {canFiles ? <SmallButton icon="camera" label="Dodaj skan" onPress={() => upload('Skan protokołu', 'warehouse', protocol.id)} /> : null}
                </View>
              </View>
            );
          })}
        </RentalCard>

        {rental.sales ? <RentalSettlementCard rental={rental} notice={notice} onChanged={changed} /> : null}

        <RentalCard title="Klient i termin">
          <Field label="Klient" value={rental.client_name} />
          {rental.recipient_name || rental.recipient_phone ? (
            <Field label="Odbierający" value={[rental.recipient_name, rental.recipient_phone].filter(Boolean).join(' · ')} />
          ) : null}
          <Field label="Wydanie" value={rentalDateTime(rental.starts_at)} />
          <Field label="Planowany zwrot" value={rentalDateTime(rental.ends_at)} danger={rental.overdue} />
          <Field label="Przekazanie" value={rental.handover === 'delivery' ? `Dostawa${rental.delivery_address ? ` — ${rental.delivery_address}` : ''}` : 'Odbiór własny'} />
          <Field label="Opiekun" value={rental.seller_name || '—'} />
          {rental.my_company_name ? <Field label="Firma" value={rental.my_company_name} /> : null}
          {rental.sales?.sales_note ? <Field label="Uwagi sprzedaży" value={rental.sales.sales_note} /> : null}
        </RentalCard>

        {rental.handover === 'delivery' || rental.trips.length ? (
          <RentalCard title="Dostawa i odbiór" action={tripsEditable ? <SmallButton icon="truck" label="Zaplanuj" onPress={() => setSheet({ kind: 'trips' })} /> : undefined}>
            {!rental.trips.length ? <Text style={ui.muted}>Nie zaplanowano pojazdu i kierowcy.</Text> : null}
            {rental.trips.map((trip) => (
              <View key={trip.id} style={ui.line}>
                <Text style={ui.text}>{trip.kind === 'delivery' ? 'Dostawa do klienta' : 'Odbiór od klienta'}</Text>
                <Text style={ui.mutedXs}>
                  {rentalDateTime(trip.starts_at)} – {rentalDateTime(trip.ends_at)} · {trip.vehicle_name || 'bez pojazdu z floty'}{trip.driver_name ? ` · ${trip.driver_name}` : ''}
                </Text>
                {trip.note ? <Text style={ui.mutedXs}>{trip.note}</Text> : null}
              </View>
            ))}
          </RentalCard>
        ) : null}

        <RentalCard title="Uwagi magazynu">
          {noteEditable ? (
            <>
              <TextInput value={warehouseNote} onChangeText={setWarehouseNote} multiline placeholder="Np. delikatne elementy, miejsce odbioru"
                placeholderTextColor={colors.text.tertiary} style={[kit.input, kit.multiline]} />
              {warehouseNote !== (rental.warehouse_note || '') ? <SmallButton primary icon="save" label="Zapisz uwagi" onPress={() => void saveNote()} /> : null}
            </>
          ) : <Text style={ui.muted}>{rental.warehouse_note || 'Brak uwag.'}</Text>}
        </RentalCard>

        <RentalCard title="Pliki" action={canFiles ? (
          <SmallButton icon="paperclip" label="Dodaj" onPress={() => {
            upload('Plik wypożyczenia', sales && !warehouse ? 'sales' : 'warehouse', null);
          }} />
        ) : undefined}>
          {!generalFiles.length ? <Text style={ui.mutedXs}>Brak plików. Skany protokołów dodajesz przy protokole.</Text> : null}
          {generalFiles.map((file) => (
            <View key={file.id} style={ui.row}>
              <TouchableOpacity style={ui.flex} onPress={() => void openPath(file.storage_path, file.file_name, file.mime_type)}>
                <Text style={ui.link} numberOfLines={1}>{file.file_name}</Text>
              </TouchableOpacity>
              <Text style={ui.mutedXs}>{file.area === 'sales' ? 'sprzedaż' : 'magazyn'}</Text>
              {canFiles ? (
                <TouchableOpacity onPress={() => removeFile(file)} accessibilityLabel="Usuń plik" style={styles.trash}>
                  <Feather name="trash-2" size={16} color={colors.status.error} />
                </TouchableOpacity>
              ) : null}
            </View>
          ))}
        </RentalCard>

        <RentalCard title="Historia">
          {rental.log.slice(0, 60).map((entry, index) => (
            <View key={`${entry.created_at}-${index}`} style={ui.line}>
              <Text style={ui.textSm}>{RENTAL_LOG_LABELS[entry.action] || entry.action}{entry.details?.protocol ? ` · ${entry.details.protocol}` : ''}</Text>
              <Text style={ui.mutedXs}>{rentalDateTime(entry.created_at)}{entry.actor_name ? ` · ${entry.actor_name}` : ''}</Text>
              {entry.note ? <Text style={ui.mutedXs}>{entry.note}</Text> : null}
            </View>
          ))}
        </RentalCard>
      </ScrollView>

      <RentalFormSheet visible={sheet?.kind === 'form'} rental={rental} access={access} notice={notice} onClose={() => setSheet(null)}
        onSaved={() => { setSheet(null); changed(); }} />
      <RentalItemsSheet visible={sheet?.kind === 'items'} rental={rental} notice={notice} startInCatalog={sheet?.kind === 'items' && !!sheet.catalog} onClose={() => setSheet(null)}
        onSaved={(next) => { setSheet(null); changed(next); }} />
      <RentalTripsSheet visible={sheet?.kind === 'trips'} rental={rental} notice={notice} onClose={() => setSheet(null)}
        onSaved={(next) => { setSheet(null); changed(next); }} />
      <RentalProtocolSheet visible={sheet?.kind === 'issue' || sheet?.kind === 'return'} issue={sheet?.kind === 'issue'} rental={rental} notice={notice}
        onClose={() => setSheet(null)} onSaved={(protocolId) => { setSheet(null); setSavedProtocol(protocolId); changed(); }} />
      <RentalResolveSheet item={sheet?.kind === 'resolve' ? sheet.item : null} rental={rental} notice={notice} onClose={() => setSheet(null)}
        onSaved={(next) => { setSheet(null); changed(next); }} />
      <RentalCancelSheet visible={sheet?.kind === 'cancel'} rental={rental} notice={notice} onClose={() => setSheet(null)}
        onSaved={() => { setSheet(null); changed(); }} />
    </View>
  );
}

function Field({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.field}>
      <Text style={ui.label}>{label}</Text>
      <Text style={[ui.text, danger && ui.danger]} selectable>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  centerText: { textAlign: 'center' },
  topBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.sm, backgroundColor: colors.background.secondary,
  },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, minHeight: 44, paddingRight: spacing.md },
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  header: { gap: spacing.xs },
  number: { color: colors.text.primary, fontSize: typography.fontSizes.xl, fontFamily: typography.fontFamilies.heading },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg },
  protocolLine: { gap: 2 },
  trash: { padding: spacing.xs },
  field: { gap: 1 },
});
