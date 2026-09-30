import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, RefreshControl, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { colors, gutter, spacing } from './theme';

export interface ScreenProps {
  children: ReactNode;
  /** Scrollbarer Inhalt (Standard) oder fixes Layout. */
  scroll?: boolean;
  /** Tastatur-Ausweichen für Formulare. */
  keyboard?: boolean;
  edges?: Edge[];
  padded?: boolean;
  contentStyle?: ViewStyle;
  /** Fixer Bereich unten (z. B. primärer CTA). */
  footer?: ReactNode;
  refreshing?: boolean;
  onRefresh?: () => void;
}

export function Screen({
  children,
  scroll = true,
  keyboard = false,
  edges = ['top'],
  padded = true,
  contentStyle,
  footer,
  refreshing,
  onRefresh,
}: ScreenProps) {
  const inner = scroll ? (
    <ScrollView
      contentContainerStyle={[padded && styles.padded, styles.scrollContent, contentStyle]}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={colors.inkSecondary} /> : undefined
      }
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.flex, padded && styles.padded, contentStyle]}>{children}</View>
  );

  const body = (
    <>
      {inner}
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </>
  );

  return (
    <SafeAreaView style={styles.root} edges={edges}>
      {keyboard ? (
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {body}
        </KeyboardAvoidingView>
      ) : (
        body
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  padded: { paddingHorizontal: gutter },
  scrollContent: { paddingBottom: spacing.huge, flexGrow: 1 },
  footer: {
    paddingHorizontal: gutter,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
});
