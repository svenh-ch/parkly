import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useQueryClient } from '@tanstack/react-query';
import { PRICE_UNITS, type PriceUnit } from '@parking/shared';
import { Chips } from '@/features/host/components';
import { parseChf } from '@/features/host/labels';
import { useFacility } from '@/features/map/queries';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Banner, Button, colors, ErrorState, radius, Screen, ScreenHeader, Skeleton, spacing, Text, TextField } from '@/ui';

const UNIT_LABEL: Record<PriceUnit, string> = { HOUR: 'Stunde', DAY: 'Tag', WEEK: 'Woche', MONTH: 'Monat' };

interface Row {
  label: string;
  amount: string;
  unit: PriceUnit;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Tarife eines Parkhauses pflegen (nur Admins). Tarife werden von Hand erfasst,
 * nicht automatisch von Betreiber-Websites übernommen, und immer mit "Stand vom" und Quelle.
 */
export default function TariffEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const facility = useFacility(id);
  const qc = useQueryClient();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [asOf, setAsOf] = useState(today());
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!facility.data || rows) return;
    const f = facility.data;
    setRows(f.tariffs.map((t) => ({ label: t.label, amount: (t.amount / 100).toFixed(2), unit: t.unit })));
    setSource(f.tariffsSourceUrl ?? f.website ?? '');
  }, [facility.data, rows]);

  if (facility.isPending || !rows) return <Screen><Skeleton height={200} rounded={radius.lg} /></Screen>;
  if (facility.isError) return <ErrorState message={userMessage(facility.error)} onRetry={() => void facility.refetch()} />;

  const save = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return setError('Datum im Format JJJJ-MM-TT');
    const items = [];
    for (const r of rows) {
      const amount = parseChf(r.amount);
      if (!r.label.trim() || amount === null) return setError('Jede Zeile braucht eine Bezeichnung und einen Betrag.');
      items.push({ label: r.label.trim(), amount, unit: r.unit });
    }
    setSaving(true);
    try {
      await api.admin.setTariffs(id, { asOf, sourceUrl: source.trim() || null, items });
      await qc.invalidateQueries({ queryKey: ['facility', id] });
      router.back();
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen keyboard edges={['bottom']} footer={<Button title="Tarife speichern" loading={saving} onPress={() => void save()} />}>
      <Stack.Screen options={{ title: 'Tarife' }} />
      <ScreenHeader title={facility.data.name} subtitle="Tarife von Hand erfassen, mit Stand und Quelle." />
      {error ? <Banner>{error}</Banner> : null}
      <View style={{ gap: spacing.lg }}>
        {rows.map((r, i) => (
          <View key={i} style={styles.row}>
            <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-end' }}>
              <View style={{ flex: 2 }}>
                <TextField label="Bezeichnung" value={r.label} onChangeText={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, label: v } : x)))} placeholder="z. B. Bis 1 Std." />
              </View>
              <View style={{ flex: 1 }}>
                <TextField label="CHF" value={r.amount} keyboardType="decimal-pad" onChangeText={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
              </View>
              <Pressable onPress={() => setRows(rows.filter((_, j) => j !== i))} hitSlop={10} style={{ paddingBottom: 14 }} accessibilityLabel="Zeile löschen">
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            </View>
            <Chips options={PRICE_UNITS.map((u) => ({ value: u, label: UNIT_LABEL[u] }))} value={[r.unit]} onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, unit: v[0]! } : x)))} />
          </View>
        ))}
        <Button title="Zeile hinzufügen" variant="secondary" icon="add" onPress={() => setRows([...rows, { label: '', amount: '', unit: 'HOUR' }])} />
        <TextField label="Stand vom (JJJJ-MM-TT)" value={asOf} onChangeText={setAsOf} />
        <TextField label="Quelle (Link)" value={source} onChangeText={setSource} autoCapitalize="none" keyboardType="url" />
        <Text variant="caption" tone="tertiary">
          Nur Angaben übernehmen, die du selbst geprüft hast oder die der Betreiber freigegeben hat. Keine automatischen Kopien von Websites.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { gap: spacing.sm, padding: spacing.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border },
});
