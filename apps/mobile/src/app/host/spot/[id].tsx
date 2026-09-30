import { useCallback, useRef, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import type { CreateSpotInput, HostSpot } from '@parking/shared';
import { StepHeader } from '@/features/host/components';
import { useHostFee, useHostSpot, useSpotCache } from '@/features/host/queries';
import { AccessStep, DescriptionStep, LocationStep, PhotoStep, PriceStep, ReviewStep, VehicleStep, type SubmitRef } from '@/features/host/steps';
import { api } from '@/lib/api';
import { userMessage } from '@/lib/errors';
import { Button, ErrorState, radius, Screen, Skeleton, spacing } from '@/ui';

const TITLES = ['Wo ist dein Parkplatz?', 'Fahrzeuge und Ausstattung', 'Zugang und Zeiten', 'Beschreibung', 'Preise und Regeln', 'Fotos', 'Prüfen und veröffentlichen'];

/**
 * Inserat-Assistent. Jeder Schritt speichert beim "Weiter", so geht nichts verloren
 * und der Entwurf erscheint sofort unter "Meine Parkplätze".
 */
export default function SpotWizard() {
  const params = useLocalSearchParams<{ id: string; step?: string }>();
  const isNew = params.id === 'new';
  const [spotId, setSpotId] = useState<string | null>(isNew ? null : params.id);
  const [step, setStep] = useState(() => Math.min(Math.max(Number(params.step ?? 0) || 0, 0), TITLES.length - 1));
  const [saving, setSaving] = useState(false);
  const query = useHostSpot(spotId);
  const fee = useHostFee();
  const put = useSpotCache();
  const submit: SubmitRef = useRef(null);
  const feeBps = fee.data?.hostFeeBps ?? 1500;

  const onSaved = useCallback((s: HostSpot) => put(s), [put]);
  const create = async (input: CreateSpotInput) => {
    const s = await api.host.create(input);
    setSpotId(s.id);
    return s;
  };

  const next = async () => {
    if (!submit.current) return;
    setSaving(true);
    const ok = await submit.current().finally(() => setSaving(false));
    if (!ok) return;
    if (step === TITLES.length - 1) {
      const done = () => router.replace('/host');
      if (Platform.OS === 'web') done();
      else Alert.alert('Veröffentlicht', 'Dein Parkplatz ist jetzt auf der Karte sichtbar.', [{ text: 'OK', onPress: done }]);
      return;
    }
    setStep(step + 1);
  };

  const spot = query.data ?? null;
  const loading = !!spotId && query.isPending;

  return (
    <Screen
      keyboard
      edges={['bottom']}
      footer={
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          {step > 0 ? <Button title="Zurück" variant="secondary" fullWidth={false} style={{ flex: 1 }} onPress={() => setStep(step - 1)} disabled={saving} /> : null}
          <Button
            title={step === TITLES.length - 1 ? (spot?.status === 'ACTIVE' ? 'Speichern' : 'Veröffentlichen') : 'Weiter'}
            style={{ flex: 2 }}
            loading={saving}
            disabled={loading}
            onPress={() => void next()}
          />
        </View>
      }
    >
      <Stack.Screen options={{ title: isNew && !spotId ? 'Parkplatz inserieren' : 'Inserat bearbeiten' }} />
      <StepHeader step={step} total={TITLES.length} title={TITLES[step]!} />
      {loading ? (
        <Skeleton height={240} rounded={radius.lg} />
      ) : query.isError ? (
        <ErrorState message={userMessage(query.error)} onRetry={() => void query.refetch()} />
      ) : step === 0 ? (
        <LocationStep key={`0-${spot?.id ?? 'new'}`} spot={spot} submit={submit} onSaved={onSaved} create={create} />
      ) : !spot ? null : step === 1 ? (
        <VehicleStep key="1" spot={spot} submit={submit} onSaved={onSaved} />
      ) : step === 2 ? (
        <AccessStep key="2" spot={spot} submit={submit} onSaved={onSaved} />
      ) : step === 3 ? (
        <DescriptionStep key="3" spot={spot} submit={submit} onSaved={onSaved} />
      ) : step === 4 ? (
        <PriceStep key="4" spot={spot} submit={submit} onSaved={onSaved} feeBps={feeBps} />
      ) : step === 5 ? (
        <PhotoStep key="5" spot={spot} submit={submit} onSaved={onSaved} />
      ) : (
        <ReviewStep key="6" spot={spot} submit={submit} onSaved={onSaved} goTo={setStep} feeBps={feeBps} />
      )}
    </Screen>
  );
}
