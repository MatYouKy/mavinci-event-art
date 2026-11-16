import React, { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useRoute } from '@react-navigation/native';
import type { RootStackParamList } from '../navigation/RootNavigator';
import { colors, spacing, borderRadius, typography } from '../theme';
import { MANAGER_HELP } from '../lib/managerHelp';
import { searchHelp, type HelpChapter } from '../lib/helpTypes';
import { SELLER_JOURNEY_STAGES } from '../lib/offerJourney';

/*
 * Instrukcja opiekuna sprzedawców — ta sama treść co panel „?” w CRM i „Instrukcja” na Macu
 * (wspólne kopie managerHelp.ts i helpTypes.ts). Wejście: „?” w „Moich sprzedawcach” i w karcie sprzedawcy.
 */

type HelpRoute = RouteProp<RootStackParamList, 'SellerHelp'>;

export default function SellerHelpScreen() {
  const route = useRoute<HelpRoute>();
  const initial = route.params?.chapter || '';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>(initial ? { [initial]: true } : {});
  const scrollRef = useRef<ScrollView>(null);
  const scrolled = useRef(false);

  const searching = query.trim().length > 0;
  const chapters = useMemo(() => (searching ? searchHelp(MANAGER_HELP, query) : MANAGER_HELP.chapters), [query, searching]);

  const toggle = (id: string) => setOpen((current) => ({ ...current, [id]: !current[id] }));

  return (
    <ScrollView ref={scrollRef} style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.search}>
        <Feather name="search" size={16} color={colors.text.tertiary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Szukaj w instrukcji…"
          placeholderTextColor={colors.text.tertiary}
          style={styles.searchInput}
          autoCorrect={false}
          accessibilityLabel="Szukaj w instrukcji opiekuna"
          clearButtonMode="while-editing"
        />
      </View>

      {!searching && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Oś w 5 etapach</Text>
          <Text style={styles.summary}>Hotel i Ty widzicie tę samą oś. Pod osią jest zdanie „Teraz” — kto działa i co dalej.</Text>
          {SELLER_JOURNEY_STAGES.map((stage, index) => (
            <View key={stage.key} style={styles.stageRow}>
              <View style={styles.stageNumber}>
                <Text style={styles.stageNumberText}>{index + 1}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.stageLabel}>{stage.label}</Text>
                <Text style={styles.stageHint}>{stage.hint}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      {searching && chapters.length === 0 && <Text style={styles.empty}>Brak wyników dla „{query.trim()}”.</Text>}

      {chapters.map((chapter) => {
        const expanded = searching || open[chapter.id] === true;
        return (
          <View
            key={chapter.id}
            style={styles.card}
            onLayout={(event) => {
              // Rozdział wskazany przy otwarciu (np. „kokpit”) — przewiń do niego raz.
              if (!scrolled.current && chapter.id === initial && !searching) {
                scrolled.current = true;
                const y = event.nativeEvent.layout.y;
                requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.sm), animated: false }));
              }
            }}
          >
            <TouchableOpacity
              style={styles.chapterHeader}
              onPress={() => toggle(chapter.id)}
              disabled={searching}
              accessibilityRole="button"
              accessibilityState={{ expanded }}
              accessibilityLabel={chapter.title}
            >
              <Text style={styles.chapterTitle}>{chapter.title}</Text>
              {!searching && <Feather name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.text.tertiary} />}
            </TouchableOpacity>
            <Text style={styles.summary}>{chapter.summary}</Text>
            {expanded && <ChapterBody chapter={chapter} />}
          </View>
        );
      })}
    </ScrollView>
  );
}

function ChapterBody({ chapter }: { chapter: HelpChapter }) {
  return (
    <View style={{ gap: spacing.sm, marginTop: spacing.xs }}>
      {!!chapter.steps?.length && (
        <View style={{ gap: 6 }}>
          <Text style={styles.subTitle}>Jak to zrobić</Text>
          {chapter.steps.map((step, index) => (
            <View key={index} style={styles.listRow}>
              <Text style={styles.listMarker}>{index + 1}.</Text>
              <Text style={styles.listText}>{step}</Text>
            </View>
          ))}
        </View>
      )}
      {!!chapter.notes?.length && (
        <View style={{ gap: 6 }}>
          <Text style={styles.subTitle}>Dobrze wiedzieć</Text>
          {chapter.notes.map((note, index) => (
            <View key={index} style={styles.listRow}>
              <Text style={styles.listMarker}>•</Text>
              <Text style={styles.listText}>{note}</Text>
            </View>
          ))}
        </View>
      )}
      {!!chapter.faq?.length && (
        <View style={{ gap: 6 }}>
          <Text style={styles.subTitle}>Pytania</Text>
          {chapter.faq.map((item, index) => (
            <View key={index} style={{ gap: 2 }}>
              <Text style={styles.faqQuestion}>{item.q}</Text>
              <Text style={styles.listText}>{item.a}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background.primary },
  content: { padding: spacing.md, paddingBottom: spacing.xl, gap: spacing.sm },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: borderRadius.md,
    borderWidth: 1,
    borderColor: colors.border.default,
    backgroundColor: colors.background.secondary,
  },
  searchInput: { flex: 1, minHeight: 44, color: colors.text.primary },
  card: {
    padding: 12,
    borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    gap: 6,
  },
  sectionTitle: {
    fontFamily: 'MBFAtom',
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary.gold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  summary: { color: colors.text.secondary, fontSize: 13, lineHeight: 19 },
  stageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingTop: 4 },
  stageNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(211, 187, 115, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageNumberText: { color: colors.primary.gold, fontSize: 12, fontWeight: typography.fontWeights.bold },
  stageLabel: { color: colors.text.primary, fontSize: 14, fontWeight: typography.fontWeights.semibold },
  stageHint: { color: colors.text.tertiary, fontSize: 12, lineHeight: 17 },
  chapterHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  chapterTitle: { flex: 1, color: colors.text.primary, fontSize: 15, fontWeight: typography.fontWeights.semibold },
  subTitle: { color: colors.text.tertiary, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  listRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 6 },
  listMarker: { color: colors.primary.gold, fontSize: 13, lineHeight: 19, minWidth: 16 },
  listText: { flex: 1, color: colors.text.secondary, fontSize: 13, lineHeight: 19 },
  faqQuestion: { color: colors.text.primary, fontSize: 13, fontWeight: typography.fontWeights.semibold },
  empty: { color: colors.text.tertiary, fontSize: 13 },
});
