import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../theme';
import { driveErrorMessage, driveTargetOf, driveTargetUrl, fetchDriveListing, shareDriveTarget } from '../lib/driveApi';
import type { DriveFile, DriveListing } from '../lib/driveShared';
import { openInCrmWeb } from '../navigation/navigationRef';

/*
 * Materiały → marka → „Logotypy i księga znaku”: logotypy, fonty i kolory z księgi znaku (1:1 z `DriveBrandStrip` w CRM i na
 * Macu). Jedno źródło — Ustawienia → Moje firmy → Księga znaku (`/bridge/native/v1/drive?op=list&node=brand:<firma>`), bez
 * kopii plików: zmiana w księdze znaku od razu widać tutaj, w CRM, na Macu i w Finderze.
 */

const isSvg = (file: DriveFile) => file.mime === 'image/svg+xml' || /\.svg$/i.test(file.name);

export default function DriveBrandStrip({ companyId, onPhoto, onMessage }: {
  companyId: string;
  /** Logotyp na pełnym ekranie (adres i nazwa). */
  onPhoto: (photo: { url: string; name: string }) => void;
  onMessage: (text: string, error?: boolean) => void;
}) {
  const [listing, setListing] = useState<DriveListing | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setListing(null);
    setError('');
    fetchDriveListing(`brand:${companyId}`)
      .then((data) => { if (active) setListing(data); })
      .catch((cause) => { if (active) setError(driveErrorMessage(cause, 'Nie udało się wczytać księgi znaku.')); });
    return () => { active = false; };
  }, [companyId]);

  const logos = (listing?.files || []).filter((file) => file.kind === 'image');
  const fonts = (listing?.files || []).filter((file) => file.kind !== 'image');

  const openLogo = async (file: DriveFile) => {
    try {
      const url = await driveTargetUrl(driveTargetOf(file));
      // SVG pokazuje przeglądarka (komponent zdjęć w aplikacji nie wyświetla grafiki wektorowej).
      if (isSvg(file)) await Linking.openURL(url);
      else onPhoto({ url, name: file.name });
    } catch (cause) {
      onMessage(driveErrorMessage(cause, 'Nie udało się otworzyć logotypu.'), true);
    }
  };

  const share = async (file: DriveFile) => {
    try {
      await shareDriveTarget(driveTargetOf(file));
    } catch (cause) {
      onMessage(driveErrorMessage(cause, 'Nie udało się udostępnić pliku.'), true);
    }
  };

  const copy = async (hex: string) => {
    try {
      await Clipboard.setStringAsync(hex);
      onMessage(`Skopiowano kolor ${hex}`);
    } catch {
      onMessage('Nie udało się skopiować koloru.', true);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Feather name="award" size={16} color={colors.primary.gold} />
            <Text style={styles.label}>Z księgi znaku</Text>
          </View>
          <Text style={styles.muted}>Logotypy, fonty i kolory z Ustawienia → Moje firmy → Księga znaku — zawsze aktualne, bez kopii.</Text>
        </View>
        <TouchableOpacity onPress={() => openInCrmWeb(`/crm/settings/my-companies/${companyId}/brandbook`)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button" accessibilityLabel="Edytuj księgę znaku w CRM">
          <Feather name="external-link" size={18} color={colors.primary.gold} />
        </TouchableOpacity>
      </View>
      {!listing ? (
        error ? <Text style={[styles.muted, { color: colors.status.error }]}>{error}</Text> : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <ActivityIndicator size="small" color={colors.primary.gold} />
            <Text style={styles.muted}>Wczytuję księgę znaku…</Text>
          </View>
        )
      ) : !listing.files.length && !listing.colors.length ? (
        <Text style={styles.muted}>Księga znaku tej marki jest pusta — dodaj logotypy, kolory i fonty w Ustawieniach → Moje firmy.</Text>
      ) : null}
      {logos.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {logos.map((file) => (
            <TouchableOpacity key={file.id} style={styles.logo} onPress={() => { void openLogo(file); }} onLongPress={() => { void share(file); }}
              accessibilityRole="button" accessibilityLabel={`Logotyp ${file.name}`} accessibilityHint="Przytrzymaj, aby udostępnić">
              <View style={styles.logoThumb}>
                {file.thumbnailUrl && !isSvg(file)
                  ? <Image source={{ uri: file.thumbnailUrl }} style={{ width: 96, height: 96 }} resizeMode="contain" />
                  : <Feather name="image" size={28} color={colors.text.secondary} />}
              </View>
              <Text style={styles.logoName} numberOfLines={2}>{file.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {fonts.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {fonts.map((file) => (
            <TouchableOpacity key={file.id} style={styles.chip} onPress={() => { void share(file); }} accessibilityRole="button" accessibilityLabel={`Udostępnij font ${file.name}`}>
              <Feather name="type" size={16} color={colors.primary.gold} />
              <View>
                <Text style={styles.body} numberOfLines={1}>{file.name}</Text>
                {file.detail ? <Text style={styles.muted} numberOfLines={1}>{file.detail}</Text> : null}
              </View>
              <Feather name="share" size={14} color={colors.text.tertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
      {listing?.colors.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm }}>
          {listing.colors.map((color, index) => (
            <TouchableOpacity key={`${color.hex}-${index}`} style={styles.chip} onPress={() => { void copy(color.hex.toUpperCase()); }}
              accessibilityRole="button" accessibilityLabel={`Kopiuj kolor ${color.hex}`}>
              <View style={[styles.swatch, { backgroundColor: color.hex }]} />
              <View>
                <Text style={styles.body}>{color.hex.toUpperCase()}</Text>
                {color.label || color.role ? <Text style={styles.muted} numberOfLines={1}>{[color.label, color.role].filter(Boolean).join(' · ')}</Text> : null}
              </View>
              <Feather name="copy" size={14} color={colors.text.tertiary} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.tertiary, borderWidth: 1, borderColor: colors.border.default },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  label: { color: colors.primary.gold, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.semibold },
  body: { color: colors.text.primary, fontSize: typography.fontSizes.sm },
  muted: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs },
  logo: { width: 112, alignItems: 'center', gap: 4 },
  logoThumb: {
    width: 112, height: 112, borderRadius: borderRadius.md, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.default,
  },
  logoName: { color: colors.text.secondary, fontSize: 11, textAlign: 'center' },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, borderRadius: borderRadius.md,
    backgroundColor: colors.background.secondary, borderWidth: 1, borderColor: colors.border.default,
  },
  swatch: { width: 26, height: 26, borderRadius: 5, borderWidth: 1, borderColor: colors.border.hover },
});
