import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography, glow } from '../../theme';
import { calcMoney, calcPdfLink, duplicateCalculation, generateCalcPdf, selectCalculation } from '../../lib/inquiryCalculations';
import type { WorkspaceCalculation } from '../../lib/inquiryWorkspace';
import { SmallButton, kit } from './InquiryKit';

/*
 * Kalkulacje zapytania (`InquiryCalculationsPanel` w CRM, lista na Macu): liczba pozycji, wartość netto, „PDF gotowy” / „Robocza”,
 * „Wybrana kalkulacja”. Czynności: otwórz (edytor), wybierz kalkulację, duplikuj, generuj PDF (serwer), pokaż PDF.
 */

type Run = <T>(label: string, action: () => Promise<T>, success?: string) => Promise<T | null>;

export function CalculationsList({ inquiryId, calculations, canManage, run, onCreate, onOpen, onChanged, onPdf }: {
  inquiryId: string; calculations: WorkspaceCalculation[]; canManage: boolean; run: Run;
  onCreate: () => void; onOpen: (calculationId: string) => void; onChanged: () => void; onPdf: (url: string, title: string) => void;
}) {
  const selected = calculations.find((item) => item.selected)?.id ?? null;
  const select = async (calculation: WorkspaceCalculation) => {
    const reply = await run('Zapisuję wybór…', () => selectCalculation(inquiryId, calculation.id, selected),
      'Wybrano kalkulację. Wyceny zapisanych ofert pozostają zachowane.');
    if (reply) onChanged();
  };
  const duplicate = async (calculation: WorkspaceCalculation) => {
    const reply = await run('Duplikuję…', () => duplicateCalculation(inquiryId, calculation.id), 'Kalkulacja została zduplikowana.');
    if (reply) onChanged();
  };
  const generate = async (calculation: WorkspaceCalculation) => {
    const reply = await run('Generuję PDF kalkulacji na serwerze…', () => generateCalcPdf(inquiryId, calculation.id), 'PDF kalkulacji został wygenerowany.');
    if (reply) onChanged();
  };
  const showPdf = async (calculation: WorkspaceCalculation) => {
    const file = await run('Otwieram PDF…', () => calcPdfLink(inquiryId, calculation.id, false));
    if (file) onPdf(file.url, calculation.name);
  };

  return (
    <View style={kit.gapSm}>
      <View style={kit.between}>
        <Text style={styles.title}>Kalkulacje</Text>
        {canManage ? <SmallButton label="Utwórz kalkulację" icon="plus" primary onPress={onCreate} /> : null}
      </View>
      {!calculations.length ? <Text style={[kit.muted, styles.empty]}>Nie przygotowano jeszcze kalkulacji.</Text> : null}
      {calculations.map((calculation) => (
        <View key={calculation.id} style={[styles.row, calculation.id === selected && styles.rowSelected]}>
          <TouchableOpacity onPress={() => onOpen(calculation.id)} style={styles.main} accessibilityRole="button" accessibilityLabel={`Otwórz kalkulację ${calculation.name}`}>
            <View style={kit.row}>
              <Text style={[kit.text, styles.strong]} numberOfLines={2}>{calculation.name}</Text>
              {calculation.id === selected ? (
                <View style={styles.badge}><Feather name="award" size={13} color={colors.status.success} /><Text style={[kit.muted, { color: colors.status.success }]}>Wybrana kalkulacja</Text></View>
              ) : null}
            </View>
            <Text style={kit.muted}>{calculation.itemsCount} pozycji · {calcMoney(calculation.total)} zł netto · {calculation.pdf ? 'PDF gotowy' : 'Robocza'}</Text>
          </TouchableOpacity>
          <View style={kit.row}>
            <SmallButton label={canManage ? 'Otwórz' : 'Podgląd'} icon={canManage ? 'edit-2' : 'eye'} primary onPress={() => onOpen(calculation.id)} />
            {canManage && calculation.id !== selected ? <SmallButton label="Wybierz kalkulację" icon="check-circle" onPress={() => void select(calculation)} /> : null}
            {canManage ? <SmallButton label="Duplikuj" icon="copy" onPress={() => void duplicate(calculation)} /> : null}
            {canManage ? <SmallButton label="Generuj PDF" icon="file-text" onPress={() => void generate(calculation)} /> : null}
            {calculation.pdf ? <SmallButton label="Pokaż PDF" icon="file" onPress={() => void showPdf(calculation)} /> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { color: colors.text.primary, fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold },
  strong: { fontWeight: typography.fontWeights.semibold },
  empty: { textAlign: 'center', paddingVertical: spacing.lg },
  row: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: glow(0.04), borderWidth: 1, borderColor: glow(0.06) },
  rowSelected: { borderColor: colors.status.success },
  main: { gap: 4 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
