import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, TextInput, ScrollView, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { colors, spacing, typography } from '../theme';


export function SearchableDropdown<T extends { id: string }>({
  dropdownId,
  openedDropdown,
  setOpenedDropdown,
  label,
  placeholder,
  items,
  textValue,
  onTextChange,
  onSelect,
  onClear,
  renderItem,
  getFilterText,
  selectedLabel,
  icon,
}: {
  dropdownId: string;
  openedDropdown: string | null;
  setOpenedDropdown: React.Dispatch<React.SetStateAction<string | null>>;
  label: string;
  placeholder: string;
  items: T[];
  textValue: string;
  onTextChange: (t: string) => void;
  onSelect: (item: T) => void;
  onClear: () => void;
  renderItem: (item: T) => string;
  getFilterText: (item: T) => string;
  selectedLabel: string | null;
  icon: string;
}) {
  const isOpen = openedDropdown === dropdownId;

  const filtered = useMemo(() => {
    const q = textValue.toLowerCase().trim();

    if (!q) return [];

    return items.filter((item) => getFilterText(item).toLowerCase().includes(q)).slice(0, 30);
  }, [textValue, items, getFilterText]);

  const handleClear = () => {
    onClear();
    onTextChange('');
    setOpenedDropdown(null);
  };

  return (
    <View style={styles.inputGroup}>
      <Text style={styles.label}>{label}</Text>

      {selectedLabel ? (
        <View style={styles.selectedRow}>
          <Feather name={icon as any} size={14} color={colors.primary.gold} />

          <Text style={styles.selectedText} numberOfLines={1}>
            {selectedLabel}
          </Text>

          <TouchableOpacity
            onPress={handleClear}
            hitSlop={{
              top: 8,
              bottom: 8,
              left: 8,
              right: 8,
            }}
          >
            <Feather name="x" size={16} color={colors.text.tertiary} />
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <TextInput
            style={styles.input}
            value={textValue}
            onChangeText={(text) => {
              onTextChange(text);
              setOpenedDropdown(dropdownId);
            }}
            onFocus={() => {
              setOpenedDropdown(dropdownId);
            }}
            placeholder={placeholder}
            placeholderTextColor={colors.text.tertiary}
          />

          {isOpen && textValue.trim().length > 0 && (
            <View style={styles.dropdownList}>
              {filtered.length > 0 ? (
                <ScrollView
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator
                >
                  {filtered.map((item) => (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.dropdownItem}
                      activeOpacity={0.7}
                      onPress={() => {
                        onSelect(item);
                        setOpenedDropdown(null);
                      }}
                    >
                      <Text style={styles.dropdownItemText}>{renderItem(item)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              ) : (
                <View style={styles.dropdownEmpty}>
                  <Text style={styles.dropdownEmptyText}>Brak wyników</Text>
                </View>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSizes.md,
    color: colors.text.primary,
  },
  label: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.secondary,
    marginBottom: spacing.xs,
    fontWeight: '500',
  },
  inputGroup: {
    marginBottom: spacing.md,
  },
  selectedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.primary.gold + '10',
    borderWidth: 1,
    borderColor: colors.primary.gold + '40',
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  selectedText: {
    flex: 1,
    fontSize: typography.fontSizes.sm,
    fontWeight: '600',
    color: colors.text.primary,
  },
  dropdownList: {
    backgroundColor: colors.background.secondary,
    borderWidth: 1,
    borderColor: colors.border.default,
    borderRadius: 8,
    marginTop: 4,
    maxHeight: 150,
    overflow: 'hidden',
  },
  dropdownItem: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border.default,
  },
  dropdownItemText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.primary,
  },
  dropdownEmpty: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  
  dropdownEmptyText: {
    fontSize: typography.fontSizes.sm,
    color: colors.text.tertiary,
  },
});
