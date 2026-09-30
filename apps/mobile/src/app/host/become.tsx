import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { becomeHostSchema } from '@parking/shared';
import { LEGAL_URLS } from '@/config/app';
import { displayName, useBecomeHost, useMe } from '@/features/profile/queries';
import { useZodForm } from '@/hooks/use-zod-form';
import { userMessage } from '@/lib/errors';
import { Banner, Button, Checkbox, Screen, ScreenHeader, spacing, Text, TextField } from '@/ui';

export default function BecomeHost() {
  const me = useMe();
  const becomeHost = useBecomeHost();
  const [error, setError] = useState<string | null>(null);
  const form = useZodForm(becomeHostSchema, {
    displayName: me.data?.firstName ?? (me.data ? displayName(me.data) : ''),
    acceptHostTerms: false,
  });

  const onSubmit = () => {
    const data = form.submit();
    if (!data) return;
    setError(null);
    becomeHost.mutate(data, {
      onSuccess: () => router.back(),
      onError: (e) => setError(userMessage(e)),
    });
  };

  return (
    <Screen
      keyboard
      edges={['bottom']}
      footer={<Button title="Weiter" loading={becomeHost.isPending} onPress={onSubmit} />}
    >
      <ScreenHeader
        title="Vermieter werden"
        subtitle="Für Auszahlungen verifizieren wir dich im nächsten Schritt über unseren Zahlungspartner Stripe."
      />
      <View style={{ gap: spacing.lg }}>
        {error ? <Banner>{error}</Banner> : null}
        <TextField
          label="Öffentlicher Anzeigename"
          value={form.values.displayName}
          onChangeText={(v) => form.setValue('displayName', v)}
          onBlur={() => form.blur('displayName')}
          error={form.error('displayName')}
          hint="Mieter sehen diesen Namen auf deinen Inseraten."
        />
        <Checkbox
          checked={form.values.acceptHostTerms}
          onChange={(v) => form.setValue('acceptHostTerms', v)}
          error={form.error('acceptHostTerms')}
          label={
            <Text variant="callout" tone="secondary">
              Ich akzeptiere die{' '}
              <Text
                variant="callout"
                style={{ textDecorationLine: 'underline' }}
                onPress={() => Linking.openURL(LEGAL_URLS.hostTerms)}
              >
                Vermieter-Bedingungen
              </Text>{' '}
              und bestätige, dass ich den Parkplatz vermieten darf (bei gemieteten Plätzen mit Zustimmung
              des Eigentümers).
            </Text>
          }
        />
      </View>
    </Screen>
  );
}
