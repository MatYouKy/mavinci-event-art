import React from 'react';
import { View, Image, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, borderRadius } from '../theme';

interface ImagePosition {
  posX: number;
  posY: number;
  scale: number;
}

interface ImageMetadata {
  desktop?: {
    src?: string;
    position?: ImagePosition;
    objectFit?: string;
  };
  mobile?: {
    src?: string;
    position?: ImagePosition;
    objectFit?: string;
  };
}

interface EmployeeAvatarProps {
  avatarUrl?: string | null;
  avatarMetadata?: ImageMetadata | null;
  employeeName: string;
  size?: number;
  onPress?: () => void;
}

export default function EmployeeAvatar({
  avatarUrl,
  avatarMetadata,
  employeeName,
  size = 48,
  onPress,
}: EmployeeAvatarProps) {
  const position = avatarMetadata?.mobile?.position || avatarMetadata?.desktop?.position || { posX: 0, posY: 0, scale: 1 };
  const objectFit = avatarMetadata?.mobile?.objectFit || avatarMetadata?.desktop?.objectFit || 'cover';

  const Container = onPress ? TouchableOpacity : View;

  return (
    <Container
      onPress={onPress}
      style={[
        styles.container,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
        },
      ]}
    >
      {avatarUrl ? (
        <View style={styles.imageContainer}>
          <Image
            source={{ uri: avatarUrl }}
            style={[
              styles.image,
              {
                width: size * position.scale,
                height: size * position.scale,
                transform: [
                  { translateX: (position.posX / 100) * size },
                  { translateY: (position.posY / 100) * size },
                ],
                resizeMode: objectFit === 'contain' ? 'contain' : 'cover',
              },
            ]}
          />
        </View>
      ) : (
        <View style={styles.placeholder}>
          <Text style={[styles.placeholderText, { fontSize: size / 2.5 }]}>
            {employeeName ? employeeName.charAt(0).toUpperCase() : '?'}
          </Text>
        </View>
      )}
    </Container>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 2,
    borderColor: colors.primary.gold,
    backgroundColor: colors.background.tertiary,
    overflow: 'hidden',
  },
  imageContainer: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    position: 'absolute',
  },
  placeholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background.tertiary,
  },
  placeholderText: {
    color: colors.text.tertiary,
    fontWeight: '600',
  },
});
