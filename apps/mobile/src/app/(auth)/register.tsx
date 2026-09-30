import { useState } from 'react';
import { Linking, View } from 'react-native';
import { router } from 'expo-router';
import { signUpSchema } from '@parking/shared';
import { LEGAL_URLS } from '@/config/app';
import { useAuth } from '@/features/auth/AuthProvider';
import { useZodForm } from '@/hooks/use-zod-form';
import { userMessage } from '@/lib/errors';
import { Banner, Button, Checkbox, EmptyState, Screen, ScreenHeader, spacing, Text, TextField } from '@/ui';

export default function Register() {
  const { signUp } = useAuth();
  const form = useZodForm(signUpSchema, {
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    acceptTerms: false,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);

  const onSubmit = async () => {
    const data = form.submit();
    if (!data) return;
    setError(null);
    setLoading(true);
    try {
      const { needsConfirmation } = await signUp(data);
      if (needsConfirmation) setConfirmEmail(data.email);
    } catch (e) {
      setError(userMessage(e));
    } finally {
      setLoading(false);
    }
  };

  if (confirmEmail) {
    return (
      <Screen edges={['bottom']} footer={<Button title="Zur Anmeldung" onPress={() => router.replace('/login')} />}>
        <EmptyState
          icon="mail-unread-outline"
          title="Bestätige deine E-Mail"
          message={`Wir haben einen Link an ${confirmEmail} gesendet. Danach kannst du dich anmelden.`}
        />
      </Screen>
    );
  }

  return (
    <Screen keyboard edges={['bottom']} footer={<Button title="Konto erstellen" loading={loading} onPress={onSubmit} />}>
      <ScreenHeader title="Konto erstellen" subtitle="Ein Konto für Parken und Vermieten." />
      <View style={{ gap: spacing.lg }}>
        {error ? <Banner>{error}</Banner> : null}
        <View style={{ flexDirection: 'row', gap: spacing.md }}>
          <View style={{ flex: 1 }}>
            <TextField
              label="Vorname"
              value={form.values.firstName}
              onChangeText={(v) => form.setValue('firstName', v)}
              onBlur={() => form.blur('firstName')}
              error={form.error('firstName')}
              autoComplete="given-name"
              textContentType="givenName"
            />
          </View>
          <View style={{ flex: 1 }}>
            <TextField
              label="Nachname"
              value={form.values.lastName}
              onChangeText={(v) => form.setValue('lastName', v)}
              onBlur={() => form.blur('lastName')}
              error={form.error('lastName')}
              autoComplete="family-name"
              textContentType="familyName"
            />
          </View>
        </View>
        <TextField
          label="E-Mail"
          value={form.values.email}
          onChangeText={(v) => form.setValue('email', v)}
          onBlur={() => form.blur('email')}
          error={form.error('email')}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          textContentType="emailAddress"
        />
        <TextField
          label="Passwort"
          password
          value={form.values.password}
          onChangeText={(v) => form.setValue('password', v)}
          onBlur={() => form.blur('password')}
          error={form.error('password')}
          hint="Mindestens 10 Zeichen mit Gross-, Kleinbuchstaben und einer Ziffer"
          autoComplete="new-password"
          textContentType="newPassword"
        />
        <Checkbox
          checked={form.values.acceptTerms === true}
          onChange={(v) => form.setValue('acceptTerms', v)}
          error={form.error('acceptTerms')}
          label={
            <Text variant="callout" tone="secondary">
              Ich akzeptiere die{' '}
              <Text variant="callout" style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL(LEGAL_URLS.terms)}>
                AGB
              </Text>{' '}
              und habe die{' '}
              <Text variant="callout" style={{ textDecorationLine: 'underline' }} onPress={() => Linking.openURL(LEGAL_URLS.privacy)}>
                Datenschutzerklärung
              </Text>{' '}
              gelesen.
            </Text>
          }
        />
      </View>
    </Screen>
  );
}
