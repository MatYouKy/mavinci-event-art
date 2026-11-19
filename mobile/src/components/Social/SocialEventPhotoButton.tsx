import React, { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, borderRadius, typography } from '../../theme';
import { pickSocialPhoto, socialErrorMessage, uploadSocialPhoto } from '../../lib/socialApi';

/*
 * „Zdjęcie do social media” na karcie wydarzenia — członek zespołu wydarzenia dodaje zdjęcie z realizacji do biblioteki
 * marki (bez uprawnień social media trafia jako propozycja, twórca treści przyjmuje je w Bibliotece). Kadry, miniatury
 * i sprawdzenie duplikatów liczy serwer; zgodę klienta ustawia twórca treści.
 */

export default function SocialEventPhotoButton({ eventId }: { eventId: string }) {
  const [busy, setBusy] = useState(false);

  const add = async (source: 'camera' | 'library') => {
    try {
      const photo = await pickSocialPhoto(source);
      if (!photo) return;
      setBusy(true);
      const result = await uploadSocialPhoto(photo, { eventId });
      if (result.duplicateOf) Alert.alert('Social media', 'To zdjęcie jest już w bibliotece.');
      else if (result.asset?.status === 'proposed') Alert.alert('Dziękujemy!', 'Zdjęcie trafiło do biblioteki social media jako propozycja.');
      else Alert.alert('Social media', 'Zdjęcie dodane do biblioteki.');
    } catch (error) {
      Alert.alert('Social media', socialErrorMessage(error, 'Nie udało się dodać zdjęcia.'));
    } finally {
      setBusy(false);
    }
  };

  const choose = () => {
    if (busy) return;
    Alert.alert('Zdjęcie do social media', 'Zdjęcie z tego wydarzenia trafi do biblioteki marki.', [
      { text: 'Zrób zdjęcie', onPress: () => void add('camera') },
      { text: 'Wybierz z galerii', onPress: () => void add('library') },
      { text: 'Anuluj', style: 'cancel' },
    ]);
  };

  return (
    <TouchableOpacity style={styles.button} onPress={choose} disabled={busy} accessibilityRole="button" accessibilityLabel="Dodaj zdjęcie do social media">
      <View style={styles.icon}>{busy ? <ActivityIndicator color={colors.primary.gold} /> : <Feather name="camera" size={18} color={colors.primary.gold} />}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{busy ? 'Wgrywam zdjęcie…' : 'Zdjęcie do social media'}</Text>
        <Text style={styles.subtitle}>Dodaj ujęcie z realizacji do biblioteki marki</Text>
      </View>
      <Feather name="chevron-right" size={18} color={colors.text.tertiary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginHorizontal: spacing.md, marginTop: spacing.sm,
    padding: spacing.md, borderRadius: borderRadius.lg, backgroundColor: colors.background.secondary,
    borderWidth: 1, borderColor: colors.border.default,
  },
  icon: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(211,187,115,0.12)' },
  title: { color: colors.text.primary, fontSize: typography.fontSizes.sm, fontWeight: typography.fontWeights.medium },
  subtitle: { color: colors.text.tertiary, fontSize: typography.fontSizes.xs, marginTop: 2 },
});
