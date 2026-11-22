import React from 'react';
import { Platform, StyleSheet, Text, type TextProps } from 'react-native';

/*
 * Nagłówek fontem marki — tak samo jak w CRM (`ShowcasePresenter`) i na Macu (`ShowcaseHeadingText`): font nagłówków
 * w pogrubieniu ucina części znaków, więc zawsze krój regularny i wersaliki (czytelne), a cyfry fontem systemowym
 * (w kroju nagłówków „0” wygląda jak „O”).
 */

const DIGITS_FONT = Platform.select({ ios: 'System', android: 'sans-serif', default: undefined });

/** Tekst nagłówka w częściach: litery fontem marki, cyfry fontem systemowym. */
export function brandHeadingParts(text: string): { text: string; digits: boolean }[] {
  return text.toLocaleUpperCase('pl-PL').split(/(\d+)/).filter(Boolean).map((part) => ({ text: part, digits: /^\d+$/.test(part) }));
}

export default function BrandHeading({ children, style, ...props }: Omit<TextProps, 'children'> & { children: string }) {
  const size = StyleSheet.flatten(style)?.fontSize ?? 16;
  return (
    <Text {...props} style={[style, { fontWeight: '400', letterSpacing: size * 0.02 }]}>
      {brandHeadingParts(children).map((part, index) => (part.digits
        ? <Text key={index} style={styles.digits}>{part.text}</Text>
        : <React.Fragment key={index}>{part.text}</React.Fragment>))}
    </Text>
  );
}

const styles = StyleSheet.create({
  digits: { fontFamily: DIGITS_FONT },
});
