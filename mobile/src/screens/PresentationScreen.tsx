import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Image, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { colors, spacing, borderRadius, typography } from '../theme';
import { showcaseBrand, showcaseItem, showcaseSiblings, type ShowcasePage } from '../lib/showcaseApi';
import { useShowcaseOffer, type ShowcaseOfferChoice } from '../lib/showcaseOffer';
import {
  formatShowcasePrice, showcaseMediaKey, showcaseVisibleBlocks,
  type ShowcaseBlock, type ShowcaseItemDetail, type ShowcaseMedia, type ShowcasePoint, type ShowcaseProductView, type ShowcaseUrls,
} from '../lib/showcaseShared';

/*
 * Karta prezentacji w aplikacji — tak, jak zobaczy ją klient (jak podgląd w CRM i na Macu): zdjęcie główne, hasło, wstęp,
 * nawigacja po blokach, zdjęcia (pełny ekran z przewijaniem w bok i powiększaniem dwoma palcami), korzyści, warianty i pakiety
 * z katalogu (ceny ukryte — przełącznik w nagłówku), przygotowanie, specyfikacja, pytania klientów i realizacje. Kolory z księgi
 * znaku. Przesunięcie palcem w bok — sąsiednia karta działu (kolejność jak na liście), na końcu karty — poprzednia / następna.
 * „Do oferty” przy wariantach, pakietach i w nagłówku karty + „Oferta” w nagłówku — oferta ze spotkania (`ShowcaseOfferScreen`).
 */

type Viewer = { photos: ShowcaseMedia[]; index: number; urls: ShowcaseUrls } | null;
type PageNav = { pages: ShowcasePage[]; index: number; onStep: (direction: 1 | -1) => void };
/** „Do oferty” w karcie (bez uprawnień do ofert z pokazu — `null`). */
type OfferActions = {
  has: (product: ShowcaseProductView, choice: ShowcaseOfferChoice) => boolean;
  add: (product: ShowcaseProductView, choice: ShowcaseOfferChoice, item: { id: string; title: string }) => void;
} | null;
type Toast = { text: string; error: boolean; openOffer: boolean };

export default function PresentationScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const startId: string = route.params?.id;
  const { width } = useWindowDimensions();
  const [showPrices, setShowPrices] = useState(false);
  // Karty działu jak na liście — stała kolejność na czas oglądania (przesunięcie palcem w bok).
  const [pages] = useState<ShowcasePage[]>(() => showcaseSiblings(startId, route.params?.title || ''));
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex((page) => page.id === startId)));
  const [height, setHeight] = useState(0);
  const pager = useRef<FlatList<ShowcasePage>>(null);
  const indexRef = useRef(index);
  indexRef.current = index;
  const brand = showcaseBrand();
  const accent = brand?.accent || colors.primary.gold;
  const surface = brand?.surface || '#1c1f33';
  const offer = useShowcaseOffer();
  const [toast, setToast] = useState<Toast | null>(null);
  const count = offer.draft.lines.length;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 3500);
    return () => clearTimeout(timer);
  }, [toast]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerButtons}>
          {offer.canOffer ? (
            <TouchableOpacity onPress={() => navigation.navigate('ShowcaseOffer')} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Oferta dla klienta${count ? `, pozycje: ${count}` : ''}`}
              style={[styles.priceToggle, { borderColor: accent }, count > 0 && { backgroundColor: accent }]}>
              <Feather name="clipboard" size={14} color={count > 0 ? surface : accent} />
              <Text style={{ color: count > 0 ? surface : accent, fontSize: typography.fontSizes.xs }}>{count ? `Oferta · ${count}` : 'Oferta'}</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => setShowPrices((value) => !value)} hitSlop={10} accessibilityRole="switch" accessibilityState={{ checked: showPrices }}
            style={[styles.priceToggle, { borderColor: accent }, showPrices && { backgroundColor: accent }]}>
            <Feather name={showPrices ? 'eye' : 'eye-off'} size={14} color={showPrices ? surface : accent} />
            <Text style={{ color: showPrices ? surface : accent, fontSize: typography.fontSizes.xs }}>{showPrices ? 'Ceny widoczne' : 'Ceny'}</Text>
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, showPrices, accent, surface, offer.canOffer, count]);

  const offerActions: OfferActions = offer.canOffer ? {
    has: offer.has,
    add: (product, choice, item) => {
      const { result, label } = offer.add(product, choice, item);
      if (result === 'added') setToast({ text: `Dodano do oferty: ${label}`, error: false, openOffer: true });
      else if (result === 'exists') setToast({ text: `„${label}” jest już w ofercie.`, error: false, openOffer: true });
      else if (result === 'full') setToast({ text: 'Oferta ze spotkania może mieć najwyżej 30 pozycji.', error: true, openOffer: false });
      else setToast({ text: `„${label}” dodasz w edytorze oferty po jej utworzeniu.`, error: true, openOffer: false });
    },
  } : null;

  // Tytuł w nagłówku idzie za kartą widoczną po przesunięciu.
  const routeId: string | undefined = route.params?.id;
  useEffect(() => {
    const page = pages[index];
    if (page && page.id !== routeId) navigation.setParams({ id: page.id, title: page.title });
  }, [index, pages, navigation, routeId]);

  // Zmiana szerokości (podział ekranu na iPadzie) — zostajemy na tej samej karcie.
  useEffect(() => {
    if (height > 0) pager.current?.scrollToOffset({ offset: indexRef.current * width, animated: false });
  }, [width, height]);

  const step = (from: number, direction: 1 | -1) => {
    const target = from + direction;
    if (target < 0 || target >= pages.length) return;
    pager.current?.scrollToOffset({ offset: target * width, animated: true });
    setIndex(target);
  };

  return (
    <View style={[styles.flex, { backgroundColor: surface }]} onLayout={(event) => setHeight(Math.round(event.nativeEvent.layout.height))}>
      {height > 0 ? (
        <FlatList
          ref={pager}
          data={pages}
          extraData={`${showPrices}|${offer.canOffer}|${offer.draft.lines.map((line) => line.key).join(',')}`}
          keyExtractor={(page) => page.id}
          horizontal
          pagingEnabled
          scrollEnabled={pages.length > 1}
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, position) => ({ length: width, offset: width * position, index: position })}
          initialNumToRender={1}
          maxToRenderPerBatch={1}
          windowSize={3}
          onMomentumScrollEnd={(event) => setIndex(Math.max(0, Math.min(pages.length - 1, Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width)))))}
          renderItem={({ item: page, index: position }) => (
            <View style={{ width, height }}>
              <CardPage id={page.id} showPrices={showPrices} offer={offerActions}
                nav={pages.length > 1 ? { pages, index: position, onStep: (direction) => step(position, direction) } : null} />
            </View>
          )}
        />
      ) : null}
      {toast ? (
        <View style={[styles.toast, { backgroundColor: surface }, toast.error && { borderColor: colors.status.error }]}>
          <Feather name={toast.error ? 'alert-triangle' : 'check-circle'} size={18} color={toast.error ? colors.status.error : accent} />
          <Text style={[styles.pointTitle, styles.flex]}>{toast.text}</Text>
          {toast.openOffer ? (
            <TouchableOpacity onPress={() => { setToast(null); navigation.navigate('ShowcaseOffer'); }} style={[styles.toastButton, { backgroundColor: accent }]}>
              <Text style={{ color: surface, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold }}>Pokaż ofertę</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function OfferButton({ added, label = 'Do oferty', accent, onPress }: { added: boolean; label?: string; accent: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.offerButton, { borderColor: accent }, added && styles.offerButtonAdded]} accessibilityRole="button"
      accessibilityLabel={added ? `${label} — już w ofercie` : label}>
      <Feather name={added ? 'check-circle' : 'plus'} size={16} color={accent} />
      <Text style={{ color: accent, fontSize: typography.fontSizes.sm }}>{added ? 'W ofercie' : label}</Text>
    </TouchableOpacity>
  );
}

function CardPage({ id, showPrices, nav, offer }: { id: string; showPrices: boolean; nav: PageNav | null; offer: OfferActions }) {
  const { width } = useWindowDimensions();
  const [detail, setDetail] = useState<ShowcaseItemDetail | null>(null);
  const [error, setError] = useState('');
  const [viewer, setViewer] = useState<Viewer>(null);
  const [openQuestion, setOpenQuestion] = useState<string | null>(null);
  const scroller = useRef<ScrollView>(null);
  const offsets = useRef<Record<string, number>>({});
  const brand = showcaseBrand();
  const accent = brand?.accent || colors.primary.gold;
  const surface = brand?.surface || '#1c1f33';
  const wide = width >= 700;
  /** Szerokość kolumny siatki (treść bez marginesów, odstęp 16 albo 8 punktów). */
  const column = (count: number, gap: number = spacing.md) => Math.floor((width - spacing.lg * 2 - gap * (count - 1)) / count);

  const load = useCallback(async () => {
    try {
      setDetail(await showcaseItem(id));
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nie udało się otworzyć karty.');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const blocks = useMemo(() => (detail ? showcaseVisibleBlocks(detail.item.content, detail.products) : []), [detail]);

  if (!detail) {
    return (
      <View style={[styles.center, { backgroundColor: surface }]}>
        {error ? <Text style={styles.muted}>{error}</Text> : <ActivityIndicator color={accent} />}
      </View>
    );
  }

  const { item, products, realizations, urls } = detail;
  const heroUrl = item.content.hero ? urls[showcaseMediaKey(item.content.hero)]?.url : null;
  const linked = item.productIds.map((productId) => products.find((product) => product.id === productId)).filter((product): product is ShowcaseProductView => Boolean(product && product.priceNet != null));
  const open = (photos: ShowcaseMedia[], index: number) => setViewer({ photos, index, urls });
  const itemRef = { id: item.id, title: item.title };
  const offerable = (product: ShowcaseProductView) => Boolean(offer && product.isActive && !product.configurable);
  const heroProducts = item.productIds.map((productId) => products.find((product) => product.id === productId))
    .filter((product): product is ShowcaseProductView => Boolean(product && offerable(product)));

  const points = (list: ShowcasePoint[], style: string) => {
    if (style === 'steps') {
      return list.map((point, index) => (
        <View key={index} style={styles.step}>
          <View style={[styles.stepNumber, { backgroundColor: accent }]}><Text style={[styles.stepNumberText, { color: surface }]}>{index + 1}</Text></View>
          <View style={styles.flex}>
            <Text style={styles.pointTitle}>{point.title}</Text>
            {point.text ? <Text style={styles.pointText}>{point.text}</Text> : null}
          </View>
        </View>
      ));
    }
    if (style === 'checklist') {
      return list.map((point, index) => (
        <View key={index} style={styles.check}>
          <Feather name="check" size={18} color={accent} style={styles.checkIcon} />
          <View style={styles.flex}>
            <Text style={styles.pointTitle}>{point.title}</Text>
            {point.text ? <Text style={styles.pointText}>{point.text}</Text> : null}
          </View>
        </View>
      ));
    }
    return (
      <View style={styles.grid}>
        {list.map((point, index) => (
          <View key={index} style={[styles.tile, { width: column(wide ? 3 : 1) }]}>
            <View style={[styles.tileIcon, { backgroundColor: 'rgba(255,255,255,0.06)' }]}><Feather name="check" size={18} color={accent} /></View>
            <Text style={styles.pointTitle}>{point.title}</Text>
            {point.text ? <Text style={styles.pointText}>{point.text}</Text> : null}
          </View>
        ))}
      </View>
    );
  };

  const price = (value: number | null, unit: string, onRequest = false) => {
    if (!showPrices) return null;
    if (onRequest) return <Text style={[styles.price, { color: accent }]}>Wycena indywidualna</Text>;
    if (value == null) return null;
    return <Text style={[styles.price, { color: accent }]}>{formatShowcasePrice(value)}{unit ? ` / ${unit}` : ''}</Text>;
  };

  const catalog = (block: ShowcaseBlock) => {
    const product = products.find((entry) => entry.id === block.productId);
    if (!product) return null;
    if (block.style === 'benefits') {
      const list = product.benefits.length ? product.benefits : product.variants.flatMap((variant) => variant.benefits.map((benefit) => ({ title: benefit, text: '' })));
      return points(list, 'benefits');
    }
    if (block.style === 'variants' || block.style === 'packages') {
      const kind: 'variant' | 'package' = block.style === 'variants' ? 'variant' : 'package';
      const entries = block.style === 'variants'
        ? product.variants.map((variant) => ({ id: variant.id, name: variant.name, text: variant.shortDescription, image: variant.image, extra: variant.benefits, priceNet: variant.priceNet, onRequest: false, highlighted: variant.recommended, bonus: '' }))
        : product.packages.map((entry) => ({ id: entry.id, name: entry.name, text: [entry.description, entry.scope ? `W pakiecie: ${entry.scope}` : ''].filter(Boolean).join('\n'), image: entry.image, extra: [] as string[], priceNet: entry.priceNet, onRequest: entry.priceOnRequest, highlighted: entry.highlighted, bonus: entry.bonus }));
      return (
        <View style={styles.grid}>
          {entries.map((entry) => {
            const image = entry.image ? urls[showcaseMediaKey(entry.image)]?.thumb : null;
            return (
              <View key={entry.id} style={[styles.offer, { width: column(wide ? 2 : 1) }, entry.highlighted && { borderColor: accent, borderWidth: 2 }]}>
                {image ? <Image source={{ uri: image }} style={styles.offerImage} /> : null}
                <View style={styles.offerBody}>
                  <View style={styles.row}>
                    <Text style={[styles.pointTitle, styles.flex]}>{entry.name}</Text>
                    {entry.highlighted && block.style === 'variants' ? <Text style={[styles.badge, { backgroundColor: accent, color: surface }]}>Polecany</Text> : null}
                  </View>
                  {entry.text ? <Text style={styles.pointText}>{entry.text}</Text> : null}
                  {entry.extra.map((benefit, index) => (
                    <View key={index} style={styles.check}><Feather name="check" size={15} color={accent} style={styles.checkIcon} /><Text style={styles.pointText}>{benefit}</Text></View>
                  ))}
                  {entry.bonus ? <Text style={[styles.pointText, { color: accent }]}>Gratis: {entry.bonus}</Text> : null}
                  {price(entry.priceNet, block.style === 'variants' ? product.unit : '', entry.onRequest)}
                  {offer && offerable(product) ? (
                    <View style={styles.offerRow}>
                      <OfferButton accent={accent} added={offer.has(product, { kind, optionId: entry.id })} onPress={() => offer.add(product, { kind, optionId: entry.id }, itemRef)} />
                    </View>
                  ) : null}
                </View>
              </View>
            );
          })}
        </View>
      );
    }
    const hours = (value: number) => String(value).replace('.', ',');
    return (
      <View style={styles.flexGap}>
        {product.requirements.length ? (
          <View style={styles.tile}>
            <Text style={[styles.tileHeading, { color: accent }]}>Co zapewnia obiekt lub klient</Text>
            {points(product.requirements, 'checklist')}
          </View>
        ) : null}
        {product.setupHours != null || product.teardownHours != null || product.preparation.length ? (
          <View style={styles.tile}>
            <Text style={[styles.tileHeading, { color: accent }]}>Montaż i ustalenia</Text>
            {points([
              ...(product.setupHours != null ? [{ title: `Montaż: ok. ${hours(product.setupHours)} h przed wydarzeniem`, text: '' }] : []),
              ...(product.teardownHours != null ? [{ title: `Demontaż: ok. ${hours(product.teardownHours)} h`, text: '' }] : []),
              ...product.preparation.map((step) => ({ title: `${step.title}${step.leadDays != null ? ` — ${step.leadDays} dni przed` : ''}`, text: step.details })),
            ], 'checklist')}
          </View>
        ) : null}
      </View>
    );
  };

  const blockContent = (block: ShowcaseBlock) => {
    switch (block.kind) {
      case 'photos':
        if (block.style === 'large') {
          return block.photos.map((photo, index) => (
            <TouchableOpacity key={photo.id} onPress={() => open(block.photos, index)} activeOpacity={0.85} style={styles.largePhotoBox}>
              <Image source={{ uri: urls[showcaseMediaKey(photo)]?.url || undefined }} style={styles.largePhoto} />
              {photo.caption ? <Text style={styles.caption}>{photo.caption}</Text> : null}
            </TouchableOpacity>
          ));
        }
        return (
          <View style={styles.photoGrid}>
            {block.photos.map((photo, index) => (
              <TouchableOpacity key={photo.id} onPress={() => open(block.photos, index)} style={{ width: column(wide ? 4 : 3, 8) }}>
                <Image source={{ uri: urls[showcaseMediaKey(photo)]?.thumb || undefined }} style={styles.gridPhoto} />
              </TouchableOpacity>
            ))}
          </View>
        );
      case 'points':
        return points(block.rows.map((row) => ({ title: row.title, text: row.text })), block.style);
      case 'specs':
        return (
          <View style={styles.specs}>
            {block.rows.map((row, index) => (
              <View key={row.id} style={[styles.specRow, { backgroundColor: index % 2 ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.25)' }]}>
                <Text style={[styles.pointText, styles.flex]}>{row.title}</Text>
                <Text style={[styles.pointTitle, styles.flex2]}>{row.text}</Text>
              </View>
            ))}
          </View>
        );
      case 'faq':
        return block.rows.map((row) => {
          const expanded = (openQuestion ?? block.rows[0]?.id) === row.id;
          return (
            <View key={row.id} style={styles.faq}>
              <TouchableOpacity onPress={() => setOpenQuestion(expanded ? '' : row.id)} style={styles.faqHead}>
                <Text style={[styles.pointTitle, styles.flex]}>{row.title}</Text>
                <Feather name={expanded ? 'chevron-down' : 'chevron-right'} size={18} color={accent} />
              </TouchableOpacity>
              {expanded && row.text ? <Text style={[styles.pointText, styles.faqText]}>{row.text}</Text> : null}
            </View>
          );
        });
      case 'text':
        return block.text.split('\n\n').map((paragraph, index) => <Text key={index} style={styles.paragraph}>{paragraph}</Text>);
      case 'realizations':
        return (
          <View style={styles.grid}>
            {block.refs.map((ref) => realizations.find((entry) => entry.id === ref)).filter(Boolean).map((entry) => {
              const realization = entry!;
              const thumb = realization.photos[0] ? urls[showcaseMediaKey(realization.photos[0])]?.thumb : null;
              return (
                <TouchableOpacity key={realization.id} disabled={!realization.photos.length} onPress={() => open(realization.photos, 0)}
                  style={[styles.offer, { width: column(wide ? 2 : 1) }]}>
                  {thumb ? <Image source={{ uri: thumb }} style={styles.offerImage} /> : null}
                  <View style={styles.offerBody}>
                    <Text style={styles.pointTitle}>{realization.title}</Text>
                    <Text style={styles.muted}>{[realization.location, realization.date?.slice(0, 4)].filter(Boolean).join(' · ')}{realization.photos.length > 1 ? ` · ${realization.photos.length} zdj.` : ''}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        );
      case 'catalog':
        return catalog(block);
      default:
        return null;
    }
  };

  return (
    <View style={[styles.flex, { backgroundColor: surface }]}>
      <ScrollView ref={scroller} contentContainerStyle={styles.content} stickyHeaderIndices={blocks.length > 1 ? [2] : undefined}>
        <TouchableOpacity activeOpacity={0.9} disabled={!item.content.hero} onPress={() => item.content.hero && open([item.content.hero], 0)}>
          {heroUrl ? <Image source={{ uri: heroUrl }} style={[styles.hero, { aspectRatio: wide ? 16 / 9 : 4 / 3 }]} /> : <View style={[styles.hero, { aspectRatio: 16 / 9 }]} />}
        </TouchableOpacity>
        <View style={styles.intro}>
          <Text style={styles.title}>{item.title}</Text>
          {item.tagline ? <Text style={[styles.tagline, { color: accent }]}>{item.tagline}</Text> : null}
          {item.content.lead ? <Text style={styles.lead}>{item.content.lead}</Text> : null}
          {showPrices && linked.length ? (
            <View style={styles.priceChips}>
              {linked.map((product) => (
                <Text key={product.id} style={[styles.priceChip, { color: accent }]}>
                  {linked.length > 1 ? `${product.name}: ` : 'od '}{formatShowcasePrice(product.priceNet)}{product.unit ? ` / ${product.unit}` : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {offer && heroProducts.length ? (
            <View style={styles.priceChips}>
              {heroProducts.map((product) => (
                <OfferButton key={product.id} accent={accent} added={offer.has(product, null)} label={heroProducts.length > 1 ? `Do oferty: ${product.name}` : 'Do oferty'}
                  onPress={() => offer.add(product, null, itemRef)} />
              ))}
            </View>
          ) : null}
        </View>
        {blocks.length > 1 ? (
          <View style={[styles.navBar, { backgroundColor: surface }]}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.navChips}>
              {blocks.map((block) => (
                <TouchableOpacity key={block.id} onPress={() => scroller.current?.scrollTo({ y: Math.max(0, (offsets.current[block.id] || 0) - 56), animated: true })}
                  style={[styles.navChip, { borderColor: accent }]}>
                  <Text style={{ color: accent, fontSize: typography.fontSizes.sm }}>{block.title}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : <View />}
        {blocks.map((block) => (
          <View key={block.id} style={styles.block} onLayout={(event) => { offsets.current[block.id] = event.nativeEvent.layout.y; }}>
            <Text style={styles.blockTitle}>{block.title}</Text>
            {block.kind !== 'text' && block.text ? <Text style={styles.blockIntro}>{block.text}</Text> : null}
            <View style={styles.blockBody}>{blockContent(block)}</View>
          </View>
        ))}
        {!blocks.length ? <Text style={styles.empty}>Karta nie ma jeszcze treści do pokazania.</Text> : null}
        {nav ? (
          // Koniec karty: sąsiednie karty działu (to samo daje przesunięcie palcem w bok).
          <View style={styles.neighbours}>
            <Text style={styles.neighboursInfo}>
              Karta {nav.index + 1} z {nav.pages.length}{nav.pages[nav.index]?.sectionTitle ? ` · ${nav.pages[nav.index].sectionTitle}` : ''} — przesuń palcem w bok, żeby przejść do sąsiedniej
            </Text>
            <View style={wide ? styles.neighbourRow : styles.neighbourColumn}>
              {nav.pages[nav.index - 1] ? <Neighbour page={nav.pages[nav.index - 1]} direction={-1} accent={accent} grow={wide} onPress={() => nav.onStep(-1)} /> : wide ? <View style={styles.flex} /> : null}
              {nav.pages[nav.index + 1] ? <Neighbour page={nav.pages[nav.index + 1]} direction={1} accent={accent} grow={wide} onPress={() => nav.onStep(1)} /> : wide ? <View style={styles.flex} /> : null}
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(viewer)} animationType="fade" onRequestClose={() => setViewer(null)} supportedOrientations={['portrait', 'landscape']}>
        {viewer ? <PhotoViewer viewer={viewer} accent={accent} onClose={() => setViewer(null)} /> : null}
      </Modal>
    </View>
  );
}

function Neighbour({ page, direction, accent, grow, onPress }: { page: ShowcasePage; direction: 1 | -1; accent: string; grow: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.neighbour, direction === 1 && styles.neighbourNext, grow && styles.flex]} accessibilityRole="button"
      accessibilityLabel={`${direction === 1 ? 'Następna' : 'Poprzednia'} karta: ${page.title}`}>
      {page.thumb ? <Image source={{ uri: page.thumb }} style={styles.neighbourThumb} />
        : <View style={[styles.neighbourThumb, styles.neighbourEmpty]}><Feather name="image" size={20} color={accent} /></View>}
      <View style={[styles.flex, direction === 1 && styles.alignEnd]}>
        <Text style={{ color: accent, fontSize: typography.fontSizes.sm }}>{direction === 1 ? 'Następna karta ›' : '‹ Poprzednia karta'}</Text>
        <Text style={[styles.pointTitle, direction === 1 && styles.textRight]} numberOfLines={2}>{page.title}</Text>
      </View>
    </TouchableOpacity>
  );
}

function PhotoViewer({ viewer, accent, onClose }: { viewer: NonNullable<Viewer>; accent: string; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(viewer.index);
  const photo = viewer.photos[index];
  return (
    <View style={styles.viewer}>
      <FlatList
        data={viewer.photos}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        initialScrollIndex={viewer.index}
        getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
        onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width)))}
        showsHorizontalScrollIndicator={false}
        renderItem={({ item }) => (
          // Dwa palce — powiększenie zdjęcia (iOS); bez powiększenia przesunięcie w bok zmienia zdjęcie.
          <ScrollView style={{ width, height }} contentContainerStyle={{ width, height }} maximumZoomScale={3} minimumZoomScale={1} bouncesZoom centerContent
            alwaysBounceHorizontal={false} alwaysBounceVertical={false} showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
            <Image source={{ uri: viewer.urls[showcaseMediaKey(item)]?.url || undefined }} style={styles.viewerImage} resizeMode="contain" />
          </ScrollView>
        )}
      />
      <View style={styles.viewerTop}>
        <Text style={styles.viewerCount}>{viewer.photos.length > 1 ? `${index + 1} / ${viewer.photos.length}` : ''}</Text>
        <TouchableOpacity onPress={onClose} hitSlop={12} style={styles.viewerClose} accessibilityRole="button" accessibilityLabel="Zamknij galerię">
          <Feather name="x" size={24} color={accent} />
        </TouchableOpacity>
      </View>
      {photo?.caption ? <Text style={styles.viewerCaption}>{photo.caption}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  flex2: { flex: 2 },
  flexGap: { gap: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  content: { paddingBottom: spacing.xxl },
  hero: { width: '100%', backgroundColor: 'rgba(0,0,0,0.35)' },
  intro: { padding: spacing.lg, gap: spacing.sm },
  title: { color: colors.text.primary, fontSize: 30, fontFamily: typography.fontFamilies.heading },
  tagline: { fontSize: typography.fontSizes.lg },
  lead: { color: 'rgba(229,228,226,0.85)', fontSize: typography.fontSizes.md, lineHeight: 24 },
  priceChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  priceChip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: borderRadius.full, backgroundColor: 'rgba(0,0,0,0.4)', overflow: 'hidden' },
  priceToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: borderRadius.full, borderWidth: 1 },
  headerButtons: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  offerRow: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: spacing.xs },
  offerButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, borderRadius: borderRadius.full, borderWidth: 1 },
  offerButtonAdded: { backgroundColor: 'rgba(255,255,255,0.08)' },
  toast: {
    position: 'absolute', left: spacing.md, right: spacing.md, bottom: spacing.lg, flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  toastButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, borderRadius: borderRadius.full },
  navBar: { paddingVertical: spacing.sm },
  navChips: { gap: spacing.sm, paddingHorizontal: spacing.lg },
  navChip: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: borderRadius.full, borderWidth: 1 },
  block: { paddingHorizontal: spacing.lg, paddingTop: spacing.xl },
  blockTitle: { color: colors.text.primary, fontSize: 24, fontFamily: typography.fontFamilies.heading },
  blockIntro: { color: 'rgba(229,228,226,0.7)', fontSize: typography.fontSizes.md, marginTop: spacing.xs },
  blockBody: { marginTop: spacing.md, gap: spacing.md },
  largePhotoBox: { gap: spacing.xs },
  largePhoto: { width: '100%', aspectRatio: 16 / 10, borderRadius: borderRadius.xl, backgroundColor: 'rgba(0,0,0,0.3)' },
  caption: { color: 'rgba(229,228,226,0.6)', fontSize: typography.fontSizes.sm },
  photoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  gridPhoto: { width: '100%', aspectRatio: 1, borderRadius: borderRadius.lg, backgroundColor: 'rgba(0,0,0,0.3)' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  tile: { padding: spacing.md, borderRadius: borderRadius.xl, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', gap: 6 },
  tileIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  tileHeading: { fontSize: typography.fontSizes.lg, marginBottom: spacing.xs },
  pointTitle: { color: colors.text.primary, fontSize: typography.fontSizes.md },
  pointText: { color: 'rgba(229,228,226,0.7)', fontSize: typography.fontSizes.sm, lineHeight: 20 },
  step: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  stepNumber: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  stepNumberText: { fontWeight: typography.fontWeights.semibold, fontSize: typography.fontSizes.md },
  check: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  checkIcon: { marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  offer: { borderRadius: borderRadius.xl, overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  offerImage: { width: '100%', aspectRatio: 16 / 9, backgroundColor: 'rgba(0,0,0,0.3)' },
  offerBody: { padding: spacing.md, gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: borderRadius.full, overflow: 'hidden', fontSize: typography.fontSizes.xs },
  price: { fontSize: typography.fontSizes.lg, fontWeight: typography.fontWeights.semibold, marginTop: 4 },
  specs: { borderRadius: borderRadius.xl, overflow: 'hidden' },
  specRow: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 12 },
  faq: { borderRadius: borderRadius.lg, backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  faqHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  faqText: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  paragraph: { color: 'rgba(229,228,226,0.85)', fontSize: typography.fontSizes.md, lineHeight: 24 },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  empty: { color: colors.text.tertiary, textAlign: 'center', padding: spacing.xl },
  neighbours: { paddingHorizontal: spacing.lg, paddingTop: spacing.xxl, gap: spacing.md },
  neighboursInfo: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, textAlign: 'center' },
  neighbourRow: { flexDirection: 'row', gap: spacing.md },
  neighbourColumn: { gap: spacing.md },
  neighbour: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 88, padding: spacing.md, borderRadius: borderRadius.xl,
    backgroundColor: 'rgba(0,0,0,0.25)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  neighbourNext: { flexDirection: 'row-reverse' },
  neighbourThumb: { width: 96, height: 60, borderRadius: borderRadius.lg, backgroundColor: 'rgba(0,0,0,0.3)' },
  neighbourEmpty: { alignItems: 'center', justifyContent: 'center' },
  alignEnd: { alignItems: 'flex-end' },
  textRight: { textAlign: 'right' },
  viewer: { flex: 1, backgroundColor: '#000' },
  viewerImage: { width: '100%', height: '100%' },
  viewerTop: { position: 'absolute', top: 48, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center' },
  viewerCount: { flex: 1, color: 'rgba(255,255,255,0.7)' },
  viewerClose: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  viewerCaption: { position: 'absolute', bottom: 40, left: spacing.lg, right: spacing.lg, color: 'rgba(255,255,255,0.8)', textAlign: 'center' },
});
