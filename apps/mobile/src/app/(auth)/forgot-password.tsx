import { useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { z } from 'zod';
import { useAuth } from '@/features/auth/AuthProvider';
import { useZodForm } from '@/hooks/use-zod-form';
import { userMessage } from '@/lib/errors';
import { Banner, Button, EmptyState, Screen, ScreenHeader, spacing, TextField } from '@/ui';

const schema = z.object({ email: z.email('Ungültige E-Mail-Adresse').trim().toLowerCase() });

export default function ForgotPassword() {
  const { requestPasswordReset } = useAuth();
  const form = useZodForm(schema, { email: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onSubmit = async () => {
    const data = form.submit();
    if (!data) return;
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(data.email);
      setSent(true);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Screen edges={['bottom']} footer={<Button title="Zurück zur Anmeldung" onPress={() => router.back()} />}>
        {/* Bewusst neutral formuliert: verrät nicht, ob ein Konto existiert */}
        <EmptyState
          icon="mail-outline"
          title="E-Mail unterwegs"
          message="Falls ein Konto mit dieser Adresse existiert, erhältst du in Kürze einen Link zum Zurücksetzen."
        />
      </Screen>
    );
  }

  return (
    <Screen keyboard edges={['bottom']} footer={<Button title="Link senden" loading={loading} onPress={onSubmit} />}>
      <ScreenHeader title="Passwort vergessen" subtitle="Wir senden dir einen Link, um ein neues Passwort zu setzen." />
      <View style={{ gap: spacing.lg }}>
        {error ? <Banner>{error}</Banner> : null}
        <TextField
          label="E-Mail"
          value={form.values.email}
          onChangeText={(v) => form.setValue('email', v)}
          error={form.error('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          onSubmitEditing={onSubmit}
        />
      </View>
    </Screen>
  );
}
